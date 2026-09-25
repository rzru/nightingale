use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::analyzer::{
    enqueue_one, is_usdx_song, mark_stems_only, prepare_lrc_no_stems, update_song_analyzed,
};
use crate::cache::CacheDir;
use crate::library_db;
use crate::lrc::{self, ParsedLrc};
use crate::song::{Song, SongOrigin, TranscriptSource, read_transcript_meta};
use crate::usdx::decode_text;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LrclibCandidate {
    #[serde(default, alias = "trackName")]
    pub track_name: String,
    #[serde(default, alias = "artistName")]
    pub artist_name: String,
    #[serde(default, alias = "albumName")]
    pub album_name: String,
    #[serde(default, alias = "duration")]
    pub duration_secs: f64,
    #[serde(skip_deserializing, default)]
    pub lines: Vec<String>,
    /// Raw LRC (line-level synced lyrics) from LRCLIB, when available. Exposed
    /// to the frontend so the editor can offer timed lyrics without alignment.
    /// `alias` (not `rename`) so it deserializes from LRCLIB's `syncedLyrics`
    /// but still serializes as `synced_lyrics` for the frontend type.
    #[serde(default, alias = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
    #[serde(default, rename = "plainLyrics", skip_serializing)]
    #[ts(skip)]
    plain_lyrics: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LyricsFile {
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SidecarLrcKind {
    Lrc,
    Elrc,
}

impl SidecarLrcKind {
    fn rank(self) -> u8 {
        match self {
            Self::Lrc => 0,
            Self::Elrc => 1,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Lrc => "lrc",
            Self::Elrc => "elrc",
        }
    }
}

/// An `.lrc` / `.elrc` file found next to a local song's audio. `file_name` is
/// the bare basename so the UI can say which file was picked without ever
/// receiving a directory.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SidecarLrc {
    pub text: String,
    pub file_name: String,
    pub kind: SidecarLrcKind,
}

const SIDECAR_LRC_MAX_BYTES: u64 = 1024 * 1024;

pub(crate) fn lrclib_candidates(song: &Song) -> Vec<LrclibCandidate> {
    let title = &song.title;
    let artist = &song.artist;

    if title.is_empty() || artist == "Unknown Artist" {
        return Vec::new();
    }

    let agent = ureq::Agent::new_with_defaults();

    info!(
        "[lrclib] Searching: \"{title}\" by \"{artist}\" ({:.0}s, album=\"{}\")",
        song.duration_secs, song.album
    );

    let url = format!(
        "https://lrclib.net/api/search?track_name={}&artist_name={}",
        urlencoding::encode(title),
        urlencoding::encode(artist),
    );
    let resp = match agent
        .get(&url)
        .header("User-Agent", "Nightingale/1.0")
        .call()
    {
        Ok(r) => r,
        Err(e) => {
            warn!("[lrclib] Search request failed: {e}");
            return Vec::new();
        }
    };
    let results: Vec<LrclibCandidate> = match resp.into_body().read_json() {
        Ok(r) => r,
        Err(e) => {
            warn!("[lrclib] Failed to parse search results: {e}");
            return Vec::new();
        }
    };

    let mut with_lyrics: Vec<_> = results
        .into_iter()
        .filter(|r| {
            !r.plain_lyrics.is_empty()
                || r.synced_lyrics
                    .as_deref()
                    .is_some_and(|s| !s.trim().is_empty())
        })
        .collect();

    info!(
        "[lrclib] Search returned {} results with lyrics",
        with_lyrics.len()
    );

    let album_lower = song.album.to_lowercase();
    with_lyrics.sort_by_key(|r| {
        let album_bonus: i64 = if r.album_name.to_lowercase() == album_lower {
            0
        } else {
            5_000
        };
        let duration_penalty = ((r.duration_secs - song.duration_secs).abs() * 10.0) as i64;
        album_bonus + duration_penalty
    });

    with_lyrics
        .into_iter()
        .filter_map(|mut r| {
            r.lines = r
                .plain_lyrics
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            // Normalize empty synced payloads to `None` so the frontend can
            // treat "has LRC" as a simple presence check.
            if r.synced_lyrics
                .as_deref()
                .is_some_and(|s| s.trim().is_empty())
            {
                r.synced_lyrics = None;
            }
            if r.lines.is_empty() && r.synced_lyrics.is_none() {
                None
            } else {
                Some(r)
            }
        })
        .collect()
}

pub fn search_lrclib_for_hash(file_hash: &str) -> Vec<LrclibCandidate> {
    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Vec::new();
    };
    lrclib_candidates(&song)
}

pub fn load_lyrics_file(file_hash: &str) -> Option<LyricsFile> {
    let cache = CacheDir::new();
    let path = cache.lyrics_path(file_hash);
    if !path.is_file() {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    serde_json::from_slice::<LyricsFile>(&bytes).ok()
}

/// Read-only lookup of a sidecar LRC next to a local song's audio. Nothing is
/// written; the editor decides whether to save the text. Remote origins point
/// `Song.path` at a cache placeholder and USDX songs at their descriptor, so
/// both are skipped. Any failure is treated as "no sidecar".
pub fn load_sidecar_lrc(file_hash: &str) -> Option<SidecarLrc> {
    let song = library_db::load_song_by_hash(file_hash).ok().flatten()?;
    if !matches!(song.origin, SongOrigin::LocalFile) || song.usdx.is_some() {
        return None;
    }

    let parent = song.path.parent()?;
    let stem = song.path.file_stem()?.to_str()?;
    let (path, kind) = find_sidecar(parent, stem)?;

    // A symlinked sidecar must not read outside the song's own directory.
    let canonical_parent = parent.canonicalize().ok()?;
    let canonical_file = path.canonicalize().ok()?;
    if canonical_file.parent()? != canonical_parent.as_path() {
        return None;
    }

    let metadata = std::fs::metadata(&canonical_file).ok()?;
    if !metadata.is_file() || metadata.len() > SIDECAR_LRC_MAX_BYTES {
        return None;
    }

    let bytes = std::fs::read(&canonical_file).ok()?;
    let text = normalize_newlines(&decode_text(&bytes));
    if text.trim().is_empty() {
        return None;
    }

    Some(SidecarLrc {
        text,
        file_name: path.file_name()?.to_str()?.to_string(),
        kind,
    })
}

/// Windows LRC tools commonly write CRLF; the raw text lands in the editor and
/// is sent back on save, so stray returns are normalised here.
fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn match_sidecar_name(name: &str, stem: &str) -> Option<(SidecarLrcKind, bool)> {
    let path = Path::new(name);
    let ext = path.extension()?.to_str()?;
    let kind = if ext.eq_ignore_ascii_case("lrc") {
        SidecarLrcKind::Lrc
    } else if ext.eq_ignore_ascii_case("elrc") {
        SidecarLrcKind::Elrc
    } else {
        return None;
    };
    let file_stem = path.file_stem()?.to_str()?;
    if !file_stem.eq_ignore_ascii_case(stem) {
        return None;
    }
    let exact = file_stem == stem && ext == kind.extension();
    Some((kind, exact))
}

/// Case-insensitive sibling lookup so `Song.LRC` still matches on
/// case-sensitive filesystems. Exact-case names win, then `.lrc` over `.elrc`,
/// then name order so `read_dir` ordering never changes the result.
fn find_sidecar(parent: &Path, stem: &str) -> Option<(PathBuf, SidecarLrcKind)> {
    let mut best: Option<((bool, u8, String), PathBuf, SidecarLrcKind)> = None;
    for entry in std::fs::read_dir(parent).ok()?.flatten() {
        let name_os = entry.file_name();
        let Some(name) = name_os.to_str() else {
            continue;
        };
        let Some((kind, exact)) = match_sidecar_name(name, stem) else {
            continue;
        };
        // `metadata` follows symlinks; the caller's canonicalize check keeps
        // the target inside the song's directory.
        let path = entry.path();
        if !std::fs::metadata(&path).is_ok_and(|m| m.is_file()) {
            continue;
        }
        let key = (!exact, kind.rank(), name.to_string());
        if best.as_ref().is_none_or(|(current, _, _)| key < *current) {
            best = Some((key, path, kind));
        }
    }
    best.map(|(_, path, kind)| (path, kind))
}

pub fn save_lyrics_and_realign(file_hash: &str, lines: Vec<String>) -> Result<(), String> {
    if is_usdx_song(file_hash) {
        return Err("Cannot edit lyrics for USDX songs".to_string());
    }

    let normalized: Vec<String> = lines
        .into_iter()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if normalized.is_empty() {
        return Err("Lyrics cannot be empty".to_string());
    }

    let cache = CacheDir::new();
    let previous_language = library_db::load_song_by_hash(file_hash)
        .ok()
        .flatten()
        .and_then(|song| song.language);
    write_lyrics_file(&cache, file_hash, &normalized)
        .map_err(|e| format!("Failed to write lyrics file: {e}"))?;

    let _ = std::fs::remove_file(cache.transcript_path(file_hash));
    cache.delete_transcript_variants(file_hash);

    update_song_analyzed(file_hash, false, previous_language, None, None, None);
    enqueue_one(file_hash);
    Ok(())
}

/// Build the transcript JSON (playback shape) from parsed LRC segments.
fn build_lrc_transcript(
    parsed: &ParsedLrc,
    language: Option<&str>,
    key: Option<&str>,
    tempo: f64,
    no_stems: bool,
) -> serde_json::Value {
    serde_json::json!({
        // Leave language null when unknown so it isn't later mistaken for a
        // forced alignment language override (whisperx has no "unknown" model).
        "language": language,
        "source": "lrc",
        "key": key,
        "tempo": tempo,
        "no_stems": no_stems,
        "segments": parsed.segments,
    })
}

fn write_transcript_json(
    cache: &CacheDir,
    file_hash: &str,
    value: &serde_json::Value,
) -> std::io::Result<()> {
    let out = cache.transcript_path(file_hash);
    let json = serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?;
    std::fs::write(&out, json)
}

/// Provide LRC / Enhanced LRC for a not-yet-analyzed song, building the
/// transcript directly and skipping transcription. When `separate_stems` is
/// true, a stems-only analysis pass is queued (guide vocals + karaoke
/// instrumental); otherwise the song plays over its original mix and the guide
/// control is hidden on playback.
pub fn provide_lrc(file_hash: &str, lrc_text: &str, separate_stems: bool) -> Result<(), String> {
    if is_usdx_song(file_hash) {
        return Err("Cannot provide lyrics for USDX songs".to_string());
    }

    let parsed = lrc::parse_lrc(lrc_text)?;

    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Err("Song not found".to_string());
    };

    let cache = CacheDir::new();
    cache.delete_transcript_variants(file_hash);
    let _ = std::fs::remove_file(cache.lyrics_path(file_hash));

    let language = song.language.clone();

    if separate_stems {
        let value = build_lrc_transcript(&parsed, language.as_deref(), None, 1.0, false);
        write_transcript_json(&cache, file_hash, &value)
            .map_err(|e| format!("Failed to write transcript: {e}"))?;
        // Stays not-analyzed until stem separation finishes.
        update_song_analyzed(file_hash, false, language, None, None, None);
        mark_stems_only(file_hash);
        enqueue_one(file_hash);
    } else {
        let value = build_lrc_transcript(&parsed, language.as_deref(), None, 1.0, true);
        write_transcript_json(&cache, file_hash, &value)
            .map_err(|e| format!("Failed to write transcript: {e}"))?;
        // Playing over the original mix needs no separation. Prepare everything
        // synchronously (materialize audio, detect the key) and only then mark
        // the song ready — no status-queue pass, and no transient window where
        // playback assets aren't in place yet.
        prepare_lrc_no_stems(file_hash).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Apply provided timed LRC to an already-analyzed song, rebuilding the
/// transcript directly (no realignment) while keeping the existing stems.
pub fn apply_timed_lyrics(file_hash: &str, lrc_text: &str) -> Result<(), String> {
    if is_usdx_song(file_hash) {
        return Err("Cannot edit lyrics for USDX songs".to_string());
    }

    let parsed = lrc::parse_lrc(lrc_text)?;

    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Err("Song not found".to_string());
    };

    let cache = CacheDir::new();
    let meta = read_transcript_meta(&cache, file_hash);
    // Base (unshifted) key so timings line up with the canonical stems.
    let key = song.key.clone().or(meta.key);
    let no_stems = song.no_stems;

    // Timing changed: drop any tempo-shifted transcript variants and the plain
    // lyrics sidecar, and reset the song back to its base key/tempo.
    cache.delete_transcript_variants(file_hash);
    let _ = std::fs::remove_file(cache.lyrics_path(file_hash));

    let value = build_lrc_transcript(
        &parsed,
        song.language.as_deref(),
        key.as_deref(),
        1.0,
        no_stems,
    );
    write_transcript_json(&cache, file_hash, &value)
        .map_err(|e| format!("Failed to write transcript: {e}"))?;

    let mut updated = song;
    updated.is_analyzed = true;
    updated.transcript_source = Some(TranscriptSource::Lrc);
    updated.key = key;
    updated.override_key = None;
    updated.tempo = 1.0;
    updated.key_offset = 0;
    updated.no_stems = no_stems;
    library_db::update_song_fields(file_hash, &updated).map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) fn write_lyrics_file(
    cache: &CacheDir,
    file_hash: &str,
    lines: &[String],
) -> std::io::Result<PathBuf> {
    let out = cache.lyrics_path(file_hash);
    let lyrics_json = serde_json::json!({ "lines": lines });
    let json = serde_json::to_vec_pretty(&lyrics_json).map_err(std::io::Error::other)?;
    std::fs::write(&out, json)?;
    Ok(out)
}

pub(crate) fn fetch_lrclib_lyrics(song: &Song, cache: &CacheDir) -> Option<PathBuf> {
    let existing = cache.lyrics_path(&song.file_hash);
    if existing.is_file() {
        info!(
            "[lrclib] Using existing lyrics file at {}",
            existing.display()
        );
        return Some(existing);
    }

    let candidates = lrclib_candidates(song);
    let pick = candidates.into_iter().next()?;

    info!(
        "[lrclib] Picked \"{}\" from \"{}\" (duration {:.0}s, delta {:.1}s)",
        pick.track_name,
        pick.album_name,
        pick.duration_secs,
        (pick.duration_secs - song.duration_secs).abs()
    );
    info!("[lrclib] Extracted {} lines", pick.lines.len());

    match write_lyrics_file(cache, &song.file_hash, &pick.lines) {
        Ok(out) => {
            info!("[lrclib] Lyrics saved to {}", out.display());
            Some(out)
        }
        Err(e) => {
            warn!("[lrclib] Failed to write lyrics: {e}");
            None
        }
    }
}
