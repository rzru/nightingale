//! Source-agnostic scan dispatcher. File walking and remote-provider sync
//! live in their respective `source` adapters. This module owns:
//!  - resolving the configured `LibrarySource` and instantiating the right adapter
//!  - bumping the cancellation generation
//!  - spawning the scan thread
//!  - reconciling library rows against analyses that landed in a shared cache
//!  - exposing `SongsStore` load/load_meta entry points used by the bridge

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::{
    analyzer,
    cache::CacheDir,
    config::AppConfig,
    library_db,
    library_model::{LibraryMenuFilters, LoadSongsParams, SongTarget, SongsMeta, SongsStore},
    song::try_read_transcript_meta,
    source::{ScanContext, active_source_from_config},
};

impl SongsStore {
    pub fn load_all() -> Self {
        let processed = library_db::load_all_songs().unwrap_or_default();
        let (folder, count) = library_db::read_library_meta().unwrap_or((String::new(), 0));
        let processed_count = processed.len();
        let analyzed_count = processed.iter().filter(|song| song.is_analyzed).count();
        let analysis_busy_count = analyzer::AnalysisQueue::load()
            .entries
            .values()
            .filter(|status| {
                matches!(
                    status,
                    analyzer::QueuedStatus::Queued | analyzer::QueuedStatus::Analyzing(_)
                )
            })
            .count();
        SongsStore {
            count,
            folder,
            processed,
            processed_count,
            analyzed_count,
            analysis_busy_count,
        }
    }

    pub fn load(params: &LoadSongsParams) -> Self {
        library_db::load_songs_page(params).unwrap_or_else(|_| SongsStore {
            count: 0,
            folder: String::new(),
            processed: Vec::new(),
            processed_count: 0,
            analyzed_count: 0,
            analysis_busy_count: 0,
        })
    }

    pub fn load_by_hashes(file_hashes: &[String]) -> Vec<crate::song::Song> {
        library_db::load_songs_by_hashes(file_hashes).unwrap_or_default()
    }

    pub fn load_meta() -> SongsMeta {
        library_db::load_meta_sql().unwrap_or_default()
    }
}

/// Trigger a scan using whatever `LibrarySource` is currently configured.
/// Returns immediately; the scan runs on a background thread.
pub fn start_scan() {
    let scan_generation = library_db::bump_scan_generation();

    let source = match active_source_from_config(&AppConfig::load()) {
        Ok(Some(s)) => s,
        Ok(None) => {
            warn!("[scanner] No library source configured; ignoring scan request");
            return;
        }
        Err(e) => {
            warn!("[scanner] Failed to instantiate library source: {e}");
            return;
        }
    };

    // If the active source's identity changed (folder → Jellyfin, different
    // Jellyfin server, different folder path) the rows already in the DB
    // belong to a different library and would otherwise stick around — each
    // source's per-scan pruning only touches its own rows. Wipe everything
    // up front so the upcoming scan starts from a clean slate.
    let new_label = source.label();
    let (existing_label, _) = library_db::read_library_meta().unwrap_or_default();
    if existing_label != new_label {
        let _ = library_db::replace_all_songs_sorted(&[]);
        let _ = library_db::analysis_queue_clear();
        let _ = library_db::update_library_meta(&new_label, 0);
    }

    std::thread::spawn(move || {
        let cache = CacheDir::new();
        let ctx = ScanContext {
            generation: scan_generation,
            cache: &cache,
        };
        if let Err(e) = source.scan(&ctx) {
            warn!("[scanner] Scan failed: {e}");
            return;
        }

        if library_db::scan_generation_is_current(scan_generation)
            && AppConfig::load().auto_analyze()
        {
            let _ = analyzer::enqueue(SongTarget::Filter {
                filters: LibraryMenuFilters::default(),
            });
        }
    });
}

/// Outcome of [`reconcile_cache`], scoped to this library: `matched` rows had
/// a transcript in the cache, of which `updated` were marked analyzed and
/// `skipped` were left alone because the entry is incomplete.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CacheReconcileSummary {
    pub matched: usize,
    pub updated: usize,
    pub skipped: usize,
}

const TRANSCRIPT_SUFFIX: &str = "_transcript.json";

/// Mark library rows analyzed when a complete analysis for their hash exists
/// in the cache — the case where another machine sharing the cache folder did
/// the work. Only rows already in the library are touched; nothing is created,
/// moved, or re-analyzed. Entries without stems or with a transcript that is
/// not valid JSON yet are skipped so a half-written analysis never becomes a
/// playable song.
pub fn reconcile_cache() -> Result<CacheReconcileSummary, String> {
    let cache = CacheDir::new();
    let cached_hashes = list_transcript_hashes(&cache)?;
    let candidates: HashSet<String> = library_db::iter_file_hashes_reconcilable()
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();

    let mut summary = CacheReconcileSummary {
        matched: 0,
        updated: 0,
        skipped: 0,
    };
    for hash in cached_hashes
        .iter()
        .filter(|hash| candidates.contains(*hash))
    {
        summary.matched += 1;
        let meta = match try_read_transcript_meta(&cache, hash) {
            Some(meta) if cache.transcript_exists(hash) => meta,
            _ => {
                warn!(
                    "[scanner] Cached analysis for {hash} is incomplete; leaving song unanalyzed"
                );
                summary.skipped += 1;
                continue;
            }
        };
        let _ = library_db::analysis_queue_delete(hash);
        if analyzer::update_song_analyzed(
            hash,
            true,
            meta.language,
            Some(meta.source),
            meta.key,
            Some(meta.tempo),
        ) {
            summary.updated += 1;
        }
    }

    info!(
        "[scanner] Cache reconcile: {} library song(s) have a cached transcript, {} marked analyzed, {} incomplete",
        summary.matched, summary.updated, summary.skipped
    );
    Ok(summary)
}

/// Song hashes that have a base transcript in the cache, read from file names
/// so a shared network cache is listed once instead of stat-ed per song.
fn list_transcript_hashes(cache: &CacheDir) -> Result<HashSet<String>, String> {
    let entries =
        std::fs::read_dir(&cache.path).map_err(|e| format!("Cannot read cache folder: {e}"))?;
    let mut hashes = HashSet::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if let Some(hash) = name.strip_suffix(TRANSCRIPT_SUFFIX)
            && is_song_hash(hash)
        {
            hashes.insert(hash.to_string());
        }
    }
    Ok(hashes)
}

/// Song hashes are the first 32 hex chars of a blake3 digest; variant
/// transcripts (`<hash>_transcript_<tempo>.json`) never match this shape.
fn is_song_hash(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
