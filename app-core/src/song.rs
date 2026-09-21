use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::Accessor,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use blake3::Hasher;
use std::{fs::File, io::Read};

use crate::{cache::CacheDir, error::NightingaleError, usdx::UsdxBundle};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum TranscriptSource {
    Lyrics,
    Generated,
    Usdx,
    /// Timing came directly from a provided LRC / Enhanced LRC file (no AI
    /// transcription or alignment).
    Lrc,
}

/// Where the bytes for a song actually live. `LocalFile` means `Song.path` is the
/// real source-of-truth on disk; the remote variants (`Jellyfin`, `Navidrome`,
/// `Plex`) mean `Song.path` is a placeholder inside `cache/sources/` that the source
/// adapter will materialise on demand.
///
/// The server's base URL deliberately does NOT live on the origin: it lives on
/// the active `AppConfig.library_source` and would otherwise go stale the next
/// time the user reconnects to a different host.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum SongOrigin {
    LocalFile,
    Jellyfin {
        item_id: String,
        #[serde(default)]
        container: Option<String>,
        /// Jellyfin's `ImageTags.Primary` for this item, captured at scan
        /// time. We re-fetch the cover only when this value changes.
        #[serde(default)]
        cover_tag: Option<String>,
    },
    Navidrome {
        item_id: String,
        #[serde(default)]
        container: Option<String>,
        /// Subsonic `coverArt` id for this song, captured at scan time. We
        /// re-fetch the cover only when this value changes.
        #[serde(default)]
        cover_tag: Option<String>,
    },
    Plex {
        item_id: String,
        /// Server-relative original-media part key. Keeping it relative lets
        /// the backend authenticate without exposing a token-bearing URL.
        part_key: String,
        #[serde(default)]
        container: Option<String>,
        /// Server-relative Plex thumb path used for cover invalidation.
        #[serde(default)]
        cover_tag: Option<String>,
    },
}

pub(crate) fn default_origin() -> SongOrigin {
    SongOrigin::LocalFile
}

impl SongOrigin {
    /// Mutable handle to the `cover_tag` slot on any remote-origin variant.
    /// `library_db::remote::refresh_remote_cover_for_item` uses this to clear
    /// the stored tag when the upstream cover disappears, without needing to
    /// know which remote source it's dealing with.
    pub fn cover_tag_mut(&mut self) -> Option<&mut Option<String>> {
        match self {
            Self::LocalFile => None,
            Self::Jellyfin { cover_tag, .. }
            | Self::Navidrome { cover_tag, .. }
            | Self::Plex { cover_tag, .. } => Some(cover_tag),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Song {
    pub path: PathBuf,
    pub file_hash: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
    pub album_art_path: Option<PathBuf>,
    pub is_analyzed: bool,
    pub language: Option<String>,
    #[serde(default)]
    pub transcript_source: Option<TranscriptSource>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub override_key: Option<String>,
    #[serde(default = "default_tempo")]
    pub tempo: f64,
    #[serde(default)]
    pub key_offset: i32,
    pub is_video: bool,
    #[serde(default)]
    pub usdx: Option<UsdxBundle>,
    #[serde(default = "default_origin")]
    pub origin: SongOrigin,
    /// True when the song was made playable from provided LRC without stem
    /// separation: playback uses the original mix and the guide control is
    /// hidden. Defaults to `false` for stem-separated songs.
    #[serde(default)]
    pub no_stems: bool,
}

fn default_tempo() -> f64 {
    1.0
}

#[derive(Debug, Clone)]
pub(crate) struct TranscriptMetaInfo {
    pub source: TranscriptSource,
    pub language: Option<String>,
    pub key: Option<String>,
    pub tempo: f64,
    pub no_stems: bool,
}

/// File-derived fields -- everything `Song::from_path` reads straight from
/// the audio file itself (tags + sidecar), as opposed to analysis-derived
/// fields (key, tempo, transcript_source, ...) which live in the cache and
/// are untouched by a metadata refresh.
struct FileDerivedFields {
    title: String,
    artist: String,
    album: String,
    duration_secs: f64,
    album_art_path: Option<PathBuf>,
}

fn try_read_file_derived_fields(
    path: &Path,
    is_video: bool,
    cache: &CacheDir,
) -> Result<FileDerivedFields, NightingaleError> {
    let (mut title, mut artist, mut album, duration_secs, cover_bytes) = if is_video {
        read_video_metadata(path)?
    } else {
        read_metadata(path)?
    };

    if title.is_empty() {
        title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();
    }
    if artist.is_empty() {
        artist = "Unknown Artist".to_string();
    }
    if album.is_empty() {
        album = "Unknown Album".to_string();
    }

    // Content-addressed: writes only if a cover with this exact hash isn't
    // already cached, so a refresh after the physical cover file was
    // deleted (but the DB row still references its path) re-materializes
    // it, while re-reading an unchanged embedded cover is a no-op write.
    let album_art_path = cover_bytes
        .map(|bytes| {
            let cover_hash = blake3::hash(&bytes).to_hex()[..32].to_string();
            let cover_path = cache.cover_path(&cover_hash);
            if !cover_path.exists() {
                std::fs::write(&cover_path, &bytes)?;
            }
            Ok::<_, std::io::Error>(cover_path)
        })
        .transpose()?;

    Ok(FileDerivedFields {
        title,
        artist,
        album,
        duration_secs,
        album_art_path,
    })
}

fn read_file_derived_fields(path: &Path, is_video: bool, cache: &CacheDir) -> FileDerivedFields {
    try_read_file_derived_fields(path, is_video, cache).unwrap_or_else(|_| FileDerivedFields {
        title: path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string(),
        artist: "Unknown Artist".to_string(),
        album: "Unknown Album".to_string(),
        duration_secs: 0.0,
        album_art_path: None,
    })
}

impl Song {
    /// Re-reads title/artist/album/duration/album art straight from
    /// `self.path`, overwriting the current values in place. Everything
    /// analysis-derived (key, tempo,
    /// transcript_source, is_analyzed, ...) is untouched -- this is a
    /// metadata-only refresh, not a reanalysis. Exists for the "Refresh
    /// metadata" action: unlike a rescan (which only ever runs this logic
    /// for brand-new paths, see `source::folder::scan`), it re-derives
    /// these fields for a song already in the library -- e.g. to
    /// re-materialize an album art cache file that was deleted outside the
    /// app, since `Song::from_path`'s cover write only fires for paths the
    /// scanner has never seen before.
    pub fn refresh_metadata(&mut self, cache: &CacheDir) -> Result<(), NightingaleError> {
        let FileDerivedFields {
            title,
            artist,
            album,
            duration_secs,
            album_art_path,
        } = try_read_file_derived_fields(&self.path, self.is_video, cache)?;

        self.title = title;
        self.artist = artist;
        self.album = album;
        self.duration_secs = duration_secs;
        self.album_art_path = album_art_path;
        Ok(())
    }
}

pub(crate) fn compute_file_hash(path: &Path) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Hasher::new();
    let mut buf = [0u8; 8192];

    loop {
        let n = file.read(&mut buf)?;

        if n == 0 {
            break;
        }

        hasher.update(&buf[..n]);
    }

    Ok(hasher.finalize().to_hex()[..32].to_string())
}

pub(crate) fn build_song(
    path: &Path,
    cache: &CacheDir,
    is_video: bool,
) -> Result<Song, NightingaleError> {
    let file_hash = compute_file_hash(path)?;

    let is_analyzed = cache.transcript_exists(&file_hash);
    let (transcript_source, language, key, tempo, no_stems) = if is_analyzed {
        let meta = read_transcript_meta(cache, &file_hash);
        (
            Some(meta.source),
            meta.language,
            meta.key,
            meta.tempo,
            meta.no_stems,
        )
    } else {
        (None, None, None, default_tempo(), false)
    };

    let FileDerivedFields {
        title,
        artist,
        album,
        duration_secs,
        album_art_path,
    } = read_file_derived_fields(path, is_video, cache);

    Ok(Song {
        path: path.to_path_buf(),
        file_hash,
        title,
        artist,
        album,
        duration_secs,
        album_art_path,
        is_analyzed,
        language,
        transcript_source,
        key,
        override_key: None,
        tempo,
        key_offset: 0,
        is_video,
        usdx: None,
        origin: SongOrigin::LocalFile,
        no_stems,
    })
}

pub(crate) fn read_transcript_meta(cache: &CacheDir, hash: &str) -> TranscriptMetaInfo {
    try_read_transcript_meta(cache, hash).unwrap_or(TranscriptMetaInfo {
        source: TranscriptSource::Generated,
        language: None,
        key: None,
        tempo: default_tempo(),
        no_stems: false,
    })
}

/// `None` when the transcript is missing or not (yet) valid JSON — a
/// half-written file from another machine must not pass as an analysis.
pub(crate) fn try_read_transcript_meta(cache: &CacheDir, hash: &str) -> Option<TranscriptMetaInfo> {
    #[derive(serde::Deserialize)]
    struct TranscriptMeta {
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        language: Option<String>,
        #[serde(default)]
        key: Option<String>,
        #[serde(default = "default_tempo")]
        tempo: f64,
        #[serde(default)]
        no_stems: bool,
    }
    let data = std::fs::read_to_string(cache.transcript_path(hash)).ok()?;
    let parsed = serde_json::from_str::<TranscriptMeta>(&data).ok()?;
    let source = match parsed.source.as_deref() {
        Some("lyrics") => TranscriptSource::Lyrics,
        Some("usdx") => TranscriptSource::Usdx,
        Some("lrc") => TranscriptSource::Lrc,
        _ => TranscriptSource::Generated,
    };
    Some(TranscriptMetaInfo {
        source,
        language: parsed.language,
        key: parsed.key,
        tempo: parsed.tempo,
        no_stems: parsed.no_stems,
    })
}

type MediaMetadata = (String, String, String, f64, Option<Vec<u8>>);

fn read_metadata(path: &Path) -> Result<MediaMetadata, NightingaleError> {
    let tagged = lofty::read_from_path(path)
        .map_err(|e| NightingaleError::Other(format!("failed reading {}: {e}", path.display())))?;

    let properties = tagged.properties();
    let duration_secs = properties.duration().as_secs_f64();

    let tag = match tagged.primary_tag().or_else(|| tagged.first_tag()) {
        Some(t) => t,
        None => {
            return Ok((
                String::new(),
                String::new(),
                String::new(),
                duration_secs,
                None,
            ));
        }
    };

    let title = tag.title().map(|s| s.to_string()).unwrap_or_default();
    let artist = tag.artist().map(|s| s.to_string()).unwrap_or_default();
    let album = tag.album().map(|s| s.to_string()).unwrap_or_default();

    let album_art = tag.pictures().first().map(|pic| pic.data().to_vec());

    Ok((title, artist, album, duration_secs, album_art))
}

fn read_video_metadata(path: &Path) -> Result<MediaMetadata, NightingaleError> {
    let ffmpeg = crate::vendor::ffmpeg_path();

    // Just probe the header -- no output file means ffmpeg reads metadata and exits immediately.
    let output = crate::vendor::silent_command(&ffmpeg)
        .args(["-i", &path.to_string_lossy()])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| NightingaleError::Other(format!("failed reading {}: {e}", path.display())))?;

    let mut title = String::new();
    let mut artist = String::new();
    let mut album = String::new();
    let mut duration_secs = 0.0;
    let mut found_duration = false;
    let mut reading_audio_stream = false;
    let stderr = String::from_utf8_lossy(&output.stderr);

    for line in stderr.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Stream #") {
            reading_audio_stream = trimmed.contains(" Audio:");
        }
        if let Some(rest) = trimmed.strip_prefix("Duration:") {
            found_duration = true;
            if let Some(ts) = rest.split(',').next() {
                duration_secs = parse_ffmpeg_duration(ts.trim());
            }
        }
        if reading_audio_stream
            && title.is_empty()
            && let Some(val) = strip_meta_tag(trimmed, "title")
        {
            title = val;
        }
        if let Some(val) = strip_meta_tag(trimmed, "artist") {
            artist = val;
        }
        if let Some(val) = strip_meta_tag(trimmed, "album") {
            album = val;
        }
    }

    if !found_duration {
        return Err(NightingaleError::Other(format!(
            "failed reading {}",
            path.display()
        )));
    }

    let album_art = extract_video_thumbnail(&ffmpeg, path);

    Ok((title, artist, album, duration_secs, album_art))
}

fn extract_video_thumbnail(ffmpeg: &Path, video_path: &Path) -> Option<Vec<u8>> {
    let output = crate::vendor::silent_command(ffmpeg)
        .args([
            "-i",
            &video_path.to_string_lossy(),
            "-vframes",
            "1",
            "-f",
            "image2pipe",
            "-c:v",
            "mjpeg",
            "-vf",
            "scale=300:-1",
            "-v",
            "error",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if output.status.success() && !output.stdout.is_empty() {
        Some(output.stdout)
    } else {
        None
    }
}

fn strip_meta_tag(line: &str, tag: &str) -> Option<String> {
    let lower = line.to_lowercase();
    if lower.starts_with(tag) {
        let after = &line[tag.len()..];
        let after = after.trim_start();
        if let Some(val) = after.strip_prefix(':') {
            let val = val.trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

fn parse_ffmpeg_duration(s: &str) -> f64 {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().unwrap_or(0.0);
        let m: f64 = parts[1].parse().unwrap_or(0.0);
        let s: f64 = parts[2].parse().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s
    } else {
        0.0
    }
}
