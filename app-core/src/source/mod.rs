//! Pluggable library backends ("media sources").
//!
//! Each source knows how to enumerate songs for the library and how to make a
//! local file appear on disk when the analyzer/player needs to read bytes.
//! The folder source is the original "Select folder" behavior; the Jellyfin
//! and Jellyfin, Navidrome (Subsonic), and Plex sources talk to remote servers over HTTP. The
//! trait stays small so additional servers (Plex, generic Subsonic forks)
//! can drop in without touching downstream code.

use std::io::Read;
use std::path::PathBuf;

use crate::cache::CacheDir;
use crate::config::{AppConfig, LibrarySource};
use crate::error::NightingaleError;
use crate::library_db;
use crate::song::Song;

pub(crate) mod folder;
pub(crate) mod jellyfin;
pub(crate) mod navidrome;
pub(crate) mod plex;

pub(crate) use folder::FolderSource;
pub use jellyfin::{JellyfinAuth, JellyfinSource};
pub use navidrome::{NavidromeAuth, NavidromeSource};
pub use plex::{PlexAuth, PlexSource};

/// How many songs we buffer in memory before flushing them to the library DB
/// during a scan. Small enough to keep memory bounded, large enough to avoid
/// the per-transaction overhead of writing rows one-by-one.
pub(crate) const SCAN_BATCH_SIZE: usize = 25;

/// Coarse-grained discriminator surfaced to the UI / commands layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    Folder,
    Jellyfin,
    Navidrome,
    Plex,
}

/// Context passed to a source while it is running a scan. Implementations
/// should poll `library_db::scan_generation_is_current` periodically and stop
/// emitting writes once it turns false — the user has triggered a new scan or
/// switched sources.
pub struct ScanContext<'a> {
    pub generation: u64,
    pub cache: &'a CacheDir,
}

/// Source-agnostic streaming response, returned by `MediaSource::open_remote_stream`
/// and proxied verbatim by `media_server`. Lives here (not in any single
/// source impl) so Navidrome / Subsonic / etc. can build one without
/// depending on the Jellyfin module.
pub struct StreamResponse {
    pub status: u16,
    pub content_type: Option<String>,
    pub content_range: Option<String>,
    pub accept_ranges: Option<String>,
    pub content_length: Option<u64>,
    pub body: Box<dyn Read + Send + 'static>,
}

pub trait MediaSource: Send + Sync {
    fn kind(&self) -> SourceKind;

    /// Human-readable label that ends up in `library_meta.folder` and the UI.
    fn label(&self) -> String;

    /// Run a full library scan. Implementations are responsible for:
    /// - flushing songs to `library_db` in batches
    /// - removing entries that no longer exist upstream
    /// - updating `library_meta` with the active label + total count
    /// - bailing out when the scan generation has been bumped
    fn scan(&self, ctx: &ScanContext<'_>) -> Result<(), NightingaleError>;

    /// Refresh source-owned metadata without touching analysis state or identity.
    fn refresh_metadata(&self, song: &mut Song, cache: &CacheDir) -> Result<(), NightingaleError>;

    /// Make sure the song's source file is present on disk and return a path
    /// the analyzer (ffmpeg + Python) or the player can read. For `LocalFile`
    /// origins this just hands `song.path` back; remote sources download to
    /// cache. Audio and video go through the same code path — Jellyfin
    /// doesn't distinguish them, so neither do we.
    fn ensure_local_media(
        &self,
        song: &Song,
        cache: &CacheDir,
    ) -> Result<PathBuf, NightingaleError>;

    /// Open an authenticated, range-aware HTTP stream to this song's bytes
    /// on the upstream server. Used by the local media server to proxy
    /// remote video without the renderer ever seeing the upstream URL or
    /// the auth token.
    ///
    /// Returning `Ok(None)` means "this source has no remote stream"
    /// (folder, or a remote source where streaming isn't applicable for
    /// this song type). The default impl returns `Ok(None)` so adding a new
    /// source that doesn't need streaming requires zero ceremony.
    fn open_remote_stream(
        &self,
        _song: &Song,
        _range: Option<&str>,
    ) -> Result<Option<StreamResponse>, NightingaleError> {
        Ok(None)
    }
}

pub(crate) fn apply_refreshed_metadata(song: &mut Song, refreshed: Song) {
    song.title = refreshed.title;
    song.artist = refreshed.artist;
    song.album = refreshed.album;
    song.genre = refreshed.genre;
    song.duration_secs = refreshed.duration_secs;
    song.album_art_path = refreshed.album_art_path;
    song.is_video = refreshed.is_video;
    song.origin = refreshed.origin;
}

pub(crate) fn retained_cover(song: &Song, tag_unchanged: bool) -> Option<PathBuf> {
    tag_unchanged
        .then(|| {
            song.album_art_path
                .as_ref()
                .filter(|path| path.is_file())
                .cloned()
        })
        .flatten()
}

/// Shared by every scan implementation: drain `batch` into the DB if it's
/// non-empty (and the scan generation is still current).
pub(crate) fn flush_batch(batch: &mut Vec<Song>, generation: u64) {
    if batch.is_empty() {
        return;
    }
    let _ = library_db::append_songs_for_scan(batch, generation);
    batch.clear();
}

/// Resolve the configured library source, if any.
pub fn active_source() -> Result<Option<Box<dyn MediaSource>>, NightingaleError> {
    active_source_from_config(&AppConfig::load())
}

pub(crate) fn active_source_from_config(
    config: &AppConfig,
) -> Result<Option<Box<dyn MediaSource>>, NightingaleError> {
    let Some(src) = config.library_source.as_ref() else {
        return Ok(None);
    };
    match src {
        LibrarySource::Folder { path } => Ok(Some(Box::new(FolderSource::new(path.clone())))),
        LibrarySource::Jellyfin { .. } => {
            let auth = JellyfinAuth::from_source(src)
                .ok_or_else(|| NightingaleError::Other("invalid jellyfin source".into()))?;
            Ok(Some(Box::new(JellyfinSource::new(auth))))
        }
        LibrarySource::Navidrome { .. } => {
            let auth = NavidromeAuth::from_source(src)
                .ok_or_else(|| NightingaleError::Other("invalid navidrome source".into()))?;
            Ok(Some(Box::new(NavidromeSource::new(auth))))
        }
        LibrarySource::Plex { .. } => {
            let auth = PlexAuth::from_source(src)
                .ok_or_else(|| NightingaleError::Other("invalid plex source".into()))?;
            Ok(Some(Box::new(PlexSource::new(auth))))
        }
    }
}
