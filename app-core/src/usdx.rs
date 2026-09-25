//! UltraStar Deluxe (USDX) song-file support.
//!
//! Implements just enough of the [usdx.eu/format](https://usdx.eu/format/) spec to:
//!   - Parse the header tags + note body (absolute and `#RELATIVE:yes` timing).
//!   - Resolve sibling media (`#AUDIO`/`#MP3`, `#VOCALS`, `#INSTRUMENTAL`, `#VIDEO`, `#COVER`).
//!   - Synthesize a transcript JSON identical in shape to what the analyzer pipeline writes,
//!     so the rest of the playback pipeline reuses the cache transparently.

use std::path::{Path, PathBuf};

use lofty::file::{AudioFile, TaggedFileExt};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cache::CacheDir;
use crate::error::NightingaleError;
use crate::song::{Song, TranscriptSource, compute_file_hash};

/// Parsed USDX file, reduced to the fields that drive transcript synthesis and
/// sibling-file resolution. Note kinds (golden / freestyle / rap / …) and unread
/// tags are discarded at parse time.
struct UsdxFile {
    title: String,
    artist: String,
    audio_filename: String,
    vocals_filename: Option<String>,
    instrumental_filename: Option<String>,
    video_filename: Option<String>,
    cover_filename: Option<String>,
    language: Option<String>,
    edition: Option<String>,
    end_ms: Option<f64>,
    bpm: f64,
    gap_ms: f64,
    phrases: Vec<Vec<UsdxNote>>,
}

struct UsdxNote {
    /// Absolute beat (relative-mode files have already had the line offset folded in).
    beat: i64,
    length: i64,
    pitch: i32,
    text: String,
}

impl UsdxFile {
    /// `#BPM` counts UltraStar quarter-note beats per minute, and a *note beat* is 1/4
    /// of one of those — so `secs_per_note_beat = 60 / (BPM * 4)`. This matches the
    /// formula used by UltraStar Deluxe, Vocaluxe, and Performous. `#GAP` is a flat
    /// millisecond offset added to every timestamp.
    fn beat_to_seconds(&self, beat: i64) -> f64 {
        self.gap_ms / 1000.0 + (beat as f64) * 60.0 / (self.bpm * 4.0)
    }
}

/// Sibling-file paths referenced by a USDX song, resolved relative to the .txt file's
/// parent directory. Stored on the Song row and consulted by playback to bypass the
/// stem-cache lookup entirely.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export)]
pub struct UsdxBundle {
    pub txt_path: PathBuf,
    pub audio: PathBuf,
    #[serde(default)]
    pub vocals: Option<PathBuf>,
    #[serde(default)]
    pub instrumental: Option<PathBuf>,
    #[serde(default)]
    pub video: Option<PathBuf>,
}

// ─── Parsing ─────────────────────────────────────────────────────────

fn parse_usdx_path(path: &Path) -> Result<UsdxFile, NightingaleError> {
    let bytes = std::fs::read(path)?;
    let content = decode_text(&bytes);
    parse_usdx_str(&content)
}

fn parse_usdx_str(content: &str) -> Result<UsdxFile, NightingaleError> {
    let mut title: Option<String> = None;
    let mut artist: Option<String> = None;
    let mut audio_filename: Option<String> = None;
    let mut vocals_filename: Option<String> = None;
    let mut instrumental_filename: Option<String> = None;
    let mut video_filename: Option<String> = None;
    let mut cover_filename: Option<String> = None;
    let mut language: Option<String> = None;
    let mut edition: Option<String> = None;
    let mut end_ms: Option<f64> = None;
    let mut bpm: Option<f64> = None;
    let mut gap_ms: f64 = 0.0;
    let mut relative = false;

    let mut phrases: Vec<Vec<UsdxNote>> = Vec::new();
    let mut current: Vec<UsdxNote> = Vec::new();
    let mut line_offset: i64 = 0;
    let mut in_notes = false;

    for raw in content.lines() {
        let line = raw.trim_end_matches('\r');
        let trimmed = line.trim_start();

        if trimmed.is_empty() {
            continue;
        }

        if !in_notes && trimmed.starts_with('#') {
            if let Some((key, value)) = parse_tag(trimmed) {
                match key.to_ascii_uppercase().as_str() {
                    "TITLE" => title = non_empty(value),
                    "ARTIST" => artist = non_empty(value),
                    // `#AUDIO` is the v1.1.0 successor to `#MP3`; prefer it when both are set.
                    "AUDIO" => audio_filename = non_empty(value),
                    "MP3" if audio_filename.is_none() => audio_filename = non_empty(value),
                    "VOCALS" => vocals_filename = non_empty(value),
                    "INSTRUMENTAL" => instrumental_filename = non_empty(value),
                    "VIDEO" => video_filename = non_empty(value),
                    "COVER" => cover_filename = non_empty(value),
                    "LANGUAGE" => {
                        language = value
                            .split(',')
                            .next()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                    }
                    "EDITION" => {
                        edition = value
                            .split(',')
                            .next()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                    }
                    "BPM" => {
                        bpm = value.trim().replace(',', ".").parse::<f64>().ok();
                    }
                    "GAP" => {
                        gap_ms = value.trim().replace(',', ".").parse::<f64>().unwrap_or(0.0);
                    }
                    "END" => {
                        end_ms = value.trim().replace(',', ".").parse::<f64>().ok();
                    }
                    "RELATIVE" => {
                        relative = value.trim().eq_ignore_ascii_case("yes");
                    }
                    _ => {}
                }
            }
            continue;
        }

        in_notes = true;

        let Some(first) = trimmed.chars().next() else {
            continue;
        };

        match first {
            ':' | '*' | 'F' | 'R' | 'G' => {
                if let Some(note) = parse_note(&trimmed[first.len_utf8()..], line_offset, relative)
                {
                    current.push(note);
                }
            }
            '-' => {
                if !current.is_empty() {
                    phrases.push(std::mem::take(&mut current));
                }
                if relative && let Some(delta) = leading_int(&trimmed[1..]) {
                    line_offset += delta;
                }
            }
            'E' => break,
            _ => continue,
        }
    }

    if !current.is_empty() {
        phrases.push(current);
    }

    let title = title.ok_or_else(|| NightingaleError::Other("Missing #TITLE tag".into()))?;
    let artist = artist.ok_or_else(|| NightingaleError::Other("Missing #ARTIST tag".into()))?;
    let audio_filename =
        audio_filename.ok_or_else(|| NightingaleError::Other("Missing #AUDIO/#MP3 tag".into()))?;
    let bpm = bpm
        .filter(|v| *v > 0.0)
        .ok_or_else(|| NightingaleError::Other("Missing or invalid #BPM tag".into()))?;

    Ok(UsdxFile {
        title,
        artist,
        audio_filename,
        vocals_filename,
        instrumental_filename,
        video_filename,
        cover_filename,
        language,
        edition,
        end_ms,
        bpm,
        gap_ms,
        phrases,
    })
}

fn non_empty(value: String) -> Option<String> {
    Some(value).filter(|s| !s.is_empty())
}

fn parse_tag(line: &str) -> Option<(String, String)> {
    let after_hash = line.strip_prefix('#')?;
    let (key, value) = after_hash.split_once(':')?;
    Some((key.trim().to_string(), value.trim().to_string()))
}

fn parse_note(rest: &str, line_offset: i64, relative: bool) -> Option<UsdxNote> {
    let mut s = rest;
    let beat = consume_int(&mut s)?;
    let length = consume_int(&mut s)?;
    let pitch = consume_int(&mut s)? as i32;
    let text = consume_text_remainder(s);

    Some(UsdxNote {
        beat: if relative { line_offset + beat } else { beat },
        length: length.max(0),
        pitch,
        text,
    })
}

fn leading_int(rest: &str) -> Option<i64> {
    let mut s = rest;
    consume_int(&mut s)
}

fn consume_int(s: &mut &str) -> Option<i64> {
    *s = s.trim_start_matches([' ', '\t']);
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let mut i = 0usize;
    if bytes[0] == b'-' || bytes[0] == b'+' {
        i = 1;
    }
    let digits_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == digits_start {
        return None;
    }
    let n = s[..i].parse::<i64>().ok()?;
    *s = &s[i..];
    Some(n)
}

/// Consume exactly one separator (space or tab) and return the rest verbatim.
/// USDX preserves leading spaces in note text as a "new word starts here" marker.
fn consume_text_remainder(s: &str) -> String {
    if let Some(rest) = s.strip_prefix([' ', '\t']) {
        rest.to_string()
    } else {
        s.to_string()
    }
}

// ─── Encoding ────────────────────────────────────────────────────────

pub(crate) fn decode_text(bytes: &[u8]) -> String {
    let stripped = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };

    if let Ok(s) = std::str::from_utf8(stripped) {
        return s.to_string();
    }

    stripped.iter().map(|&b| cp1252_to_char(b)).collect()
}

fn cp1252_to_char(b: u8) -> char {
    match b {
        0x80 => '\u{20AC}',
        0x82 => '\u{201A}',
        0x83 => '\u{0192}',
        0x84 => '\u{201E}',
        0x85 => '\u{2026}',
        0x86 => '\u{2020}',
        0x87 => '\u{2021}',
        0x88 => '\u{02C6}',
        0x89 => '\u{2030}',
        0x8A => '\u{0160}',
        0x8B => '\u{2039}',
        0x8C => '\u{0152}',
        0x8E => '\u{017D}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201C}',
        0x94 => '\u{201D}',
        0x95 => '\u{2022}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0x98 => '\u{02DC}',
        0x99 => '\u{2122}',
        0x9A => '\u{0161}',
        0x9B => '\u{203A}',
        0x9C => '\u{0153}',
        0x9E => '\u{017E}',
        0x9F => '\u{0178}',
        _ => b as char,
    }
}

// ─── Sibling resolution ──────────────────────────────────────────────

fn resolve_sibling(parent: &Path, name: Option<&str>) -> Option<PathBuf> {
    let trimmed = name.map(str::trim).filter(|s| !s.is_empty())?;
    let candidate = parent.join(trimmed);
    candidate.is_file().then_some(candidate)
}

fn resolve_bundle(file: &UsdxFile, txt_path: &Path) -> Result<UsdxBundle, NightingaleError> {
    let parent = txt_path
        .parent()
        .ok_or_else(|| NightingaleError::Other("USDX file has no parent directory".into()))?;

    let audio = parent.join(file.audio_filename.trim());
    if !audio.is_file() {
        return Err(NightingaleError::Other(format!(
            "USDX audio file not found: {}",
            audio.display()
        )));
    }

    Ok(UsdxBundle {
        txt_path: txt_path.to_path_buf(),
        audio,
        vocals: resolve_sibling(parent, file.vocals_filename.as_deref()),
        instrumental: resolve_sibling(parent, file.instrumental_filename.as_deref()),
        video: resolve_sibling(parent, file.video_filename.as_deref()),
    })
}

/// Sibling media filenames a USDX descriptor "claims" — used by the scanner so we
/// don't end up with a duplicate raw audio/video song row alongside the USDX one.
pub(crate) struct UsdxSiblings {
    pub audio: PathBuf,
    pub vocals: Option<PathBuf>,
    pub instrumental: Option<PathBuf>,
    pub video: Option<PathBuf>,
}

pub(crate) fn read_siblings(path: &Path) -> Option<UsdxSiblings> {
    let file = parse_usdx_path(path).ok()?;
    let parent = path.parent()?.to_path_buf();
    Some(UsdxSiblings {
        audio: parent.join(file.audio_filename.trim()),
        vocals: file
            .vocals_filename
            .as_deref()
            .map(|n| parent.join(n.trim())),
        instrumental: file
            .instrumental_filename
            .as_deref()
            .map(|n| parent.join(n.trim())),
        video: file
            .video_filename
            .as_deref()
            .map(|n| parent.join(n.trim())),
    })
}

// ─── Detection sniff (for scanner) ───────────────────────────────────

/// Cheap content sniff: is this `.txt` actually a USDX song descriptor?
/// Reads the first ~2 KB of the file and looks for the minimum required tags.
pub(crate) fn looks_like_usdx(path: &Path) -> bool {
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut buf = [0u8; 2048];
    use std::io::Read;
    let n = match f.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    let head = decode_text(&buf[..n]);
    let upper = head.to_ascii_uppercase();
    upper.contains("#TITLE") && (upper.contains("#MP3") || upper.contains("#AUDIO"))
}

// ─── Transcript synthesis ────────────────────────────────────────────

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// Produce a transcript JSON shaped exactly like what `transcribe.py` emits, so the
/// existing client + playback pipeline reuses cached files transparently.
fn synthesize_transcript(file: &UsdxFile) -> serde_json::Value {
    use serde_json::json;

    let mut segments: Vec<serde_json::Value> = Vec::new();

    for phrase in &file.phrases {
        if phrase.is_empty() {
            continue;
        }

        let mut words: Vec<serde_json::Value> = Vec::new();
        let mut text_buf = String::new();
        let mut first_start: Option<f64> = None;
        let mut last_end: f64 = 0.0;

        for note in phrase {
            let start = file.beat_to_seconds(note.beat);
            let end = file.beat_to_seconds(note.beat + note.length);
            if first_start.is_none() {
                first_start = Some(start);
            }
            last_end = end;

            let trimmed = note.text.trim();
            if !text_buf.is_empty() && note.text.starts_with(|c: char| c.is_whitespace()) {
                text_buf.push(' ');
            }
            text_buf.push_str(trimmed);

            words.push(json!({
                "word": trimmed,
                "start": round3(start),
                "end": round3(end),
                "pitch": note.pitch,
            }));
        }

        if words.is_empty() {
            continue;
        }

        segments.push(json!({
            "text": text_buf,
            "start": round3(first_start.unwrap_or(0.0)),
            "end": round3(last_end),
            "words": words,
        }));
    }

    let language = file.language.clone().unwrap_or_else(|| "Unknown".into());

    json!({
        "language": language,
        "segments": segments,
        "source": "usdx",
    })
}

// ─── Song construction ───────────────────────────────────────────────

/// Read the audio file's container metadata for duration + embedded album art.
/// Used as a fallback when USDX doesn't ship a `#COVER` sibling file.
fn read_audio_metadata(path: &Path) -> (f64, Option<Vec<u8>>) {
    let Ok(tagged) = lofty::read_from_path(path) else {
        return (0.0, None);
    };
    let duration_secs = tagged.properties().duration().as_secs_f64();
    let cover_bytes = tagged
        .primary_tag()
        .or_else(|| tagged.first_tag())
        .and_then(|tag| tag.pictures().first().map(|pic| pic.data().to_vec()));
    (duration_secs, cover_bytes)
}

fn cache_album_art(cache: &CacheDir, bytes: &[u8]) -> Option<PathBuf> {
    if bytes.is_empty() {
        return None;
    }
    let cover_hash = blake3::hash(bytes).to_hex()[..32].to_string();
    let cover_path = cache.cover_path(&cover_hash);
    if !cover_path.exists() {
        std::fs::write(&cover_path, bytes).ok()?;
    }
    Some(cover_path)
}

/// Scan-time entry point. Parses the .txt, resolves sibling media, writes the
/// synthesized transcript JSON to the cache, and returns a fully-formed Song row
/// with `is_analyzed = true` so the analyzer queue never sees it.
pub(crate) fn build_usdx_song(path: &Path, cache: &CacheDir) -> Result<Song, NightingaleError> {
    let file = parse_usdx_path(path)?;
    let bundle = resolve_bundle(&file, path)?;

    let file_hash = compute_file_hash(path)?;

    let transcript_json = synthesize_transcript(&file);
    let transcript_path = cache.transcript_path(&file_hash);
    std::fs::write(
        &transcript_path,
        serde_json::to_string_pretty(&transcript_json)?,
    )?;

    let (audio_duration, embedded_cover) = read_audio_metadata(&bundle.audio);
    let duration_secs = if audio_duration > 0.0 {
        audio_duration
    } else {
        file.end_ms.map(|ms| ms / 1000.0).unwrap_or(0.0)
    };

    let cover_bytes = file
        .cover_filename
        .as_deref()
        .and_then(|name| {
            let p = path.parent()?.join(name.trim());
            std::fs::read(p).ok()
        })
        .or(embedded_cover);
    let album_art_path = cover_bytes
        .as_deref()
        .and_then(|b| cache_album_art(cache, b));

    let album = file.edition.clone().unwrap_or_else(|| "USDX".to_string());

    let song = Song {
        path: path.to_path_buf(),
        file_hash,
        title: file.title.clone(),
        artist: file.artist.clone(),
        album,
        duration_secs,
        album_art_path,
        is_analyzed: true,
        language: file.language.clone(),
        transcript_source: Some(TranscriptSource::Usdx),
        key: None,
        override_key: None,
        tempo: 1.0,
        key_offset: 0,
        is_video: false,
        usdx: Some(bundle),
        origin: crate::song::SongOrigin::LocalFile,
        no_stems: false,
    };

    Ok(song)
}
