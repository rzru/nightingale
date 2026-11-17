//! Performance recordings: the voice captured during a song, placed on the song
//! timeline and mixed with the music that played.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cache::nightingale_dir;
use crate::config::AppConfig;
use crate::error::NightingaleError;
use crate::vendor::{ffmpeg_path, silent_command};

/// Takes in progress and unsaved takes; emptied on every start.
pub fn recordings_tmp_dir() -> PathBuf {
    nightingale_dir().join("recordings-tmp")
}

/// Where saved recordings go: the configured folder or `recordings/` in the data folder.
pub fn recordings_dir() -> PathBuf {
    AppConfig::load()
        .recordings_dir
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| nightingale_dir().join("recordings"))
}

pub(crate) fn clear_unsaved_takes() {
    let dir = recordings_tmp_dir();
    if dir.is_dir()
        && let Err(error) = std::fs::remove_dir_all(&dir)
    {
        tracing::warn!("[recording] could not remove unsaved takes: {error}");
    }
}

#[derive(Deserialize)]
struct SegmentsFile {
    sample_rate: u32,
    segments: Vec<SegmentEntry>,
}

#[derive(Deserialize)]
struct SegmentEntry {
    file: String,
    start_sec: f64,
}

/// A take folder handed back by the frontend must be one of ours.
fn take_dir(take: &str) -> Result<PathBuf, NightingaleError> {
    let base = std::fs::canonicalize(recordings_tmp_dir())?;
    let dir = std::fs::canonicalize(take)?;
    if dir.parent() != Some(base.as_path()) {
        return Err("not a recording take".into());
    }
    Ok(dir)
}

fn read_samples(path: &Path) -> Result<Vec<f32>, NightingaleError> {
    let bytes = std::fs::read(path)?;
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn sample_index(seconds: f64, sample_rate: u32) -> usize {
    let index = (seconds * f64::from(sample_rate)).round();
    if index <= 0.0 {
        0
    } else {
        // Song positions are minutes long, far below the usize range.
        format!("{index:.0}").parse().unwrap_or(0)
    }
}

fn write_wav_f32(path: &Path, sample_rate: u32, samples: &[f32]) -> Result<(), NightingaleError> {
    let data_len = u32::try_from(samples.len() * 4).map_err(|_| "recording is too long")?;
    let mut out = Vec::with_capacity(samples.len() * 4 + 44);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 4).to_le_bytes());
    out.extend_from_slice(&4u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    std::fs::write(path, out)?;
    Ok(())
}

/// Build `voice.wav` for a take: every segment is placed at its song time, a
/// later segment replaces what an earlier one had at the same place (sung
/// again after seeking back), and everything moves `offset_sec` earlier to
/// cancel the microphone latency. Returns the path of the voice track.
pub fn render_recording_voice(take: &str, offset_sec: f64) -> Result<String, NightingaleError> {
    let dir = take_dir(take)?;
    let meta: SegmentsFile =
        serde_json::from_str(&std::fs::read_to_string(dir.join("segments.json"))?)?;
    if meta.sample_rate == 0 {
        return Err("recording has no audio".into());
    }

    let mut voice: Vec<f32> = Vec::new();
    for segment in &meta.segments {
        let file = dir.join(
            Path::new(&segment.file)
                .file_name()
                .ok_or("bad segment name")?,
        );
        let samples = read_samples(&file)?;
        let start = sample_index(segment.start_sec - offset_sec, meta.sample_rate);
        // The part of a segment that would land before the song start is cut.
        let skip =
            sample_index(offset_sec - segment.start_sec, meta.sample_rate).min(samples.len());
        let samples = &samples[skip..];
        let end = start + samples.len();
        if voice.len() < end {
            voice.resize(end, 0.0);
        }
        voice[start..end].copy_from_slice(samples);
    }

    let out = dir.join("voice.wav");
    write_wav_f32(&out, meta.sample_rate, &voice)?;
    Ok(out.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SaveRecordingRequest {
    pub take: String,
    pub file_hash: String,
    /// 0..2, applied to the voice and to the music.
    pub voice_gain: f64,
    pub music_gain: f64,
    /// `mp3` (default) or `wav`.
    pub format: String,
    pub artist: String,
    pub title: String,
    pub profile: Option<String>,
}

fn safe_name_part(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    trimmed.chars().take(60).collect()
}

fn recording_file_name(request: &SaveRecordingRequest, extension: &str) -> String {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let parts: Vec<String> = [
        Some(request.artist.as_str()),
        Some(request.title.as_str()),
        request.profile.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(safe_name_part)
    .filter(|part| !part.is_empty())
    .collect();
    format!("{} - {stamp}.{extension}", parts.join(" - "))
}

/// Mix the take's voice over the music that played and save it to the
/// recordings folder. The take is removed afterwards. Returns the saved path.
pub fn save_recording(request: &SaveRecordingRequest) -> Result<String, NightingaleError> {
    let dir = take_dir(&request.take)?;
    let voice = dir.join("voice.wav");
    if !voice.is_file() {
        return Err("the voice track was not prepared".into());
    }
    let music = crate::playback::get_audio_paths(&request.file_hash).instrumental;
    let wav = request.format == "wav";
    let out_dir = recordings_dir();
    std::fs::create_dir_all(&out_dir)?;
    let out = out_dir.join(recording_file_name(
        request,
        if wav { "wav" } else { "mp3" },
    ));

    let voice_gain = request.voice_gain.clamp(0.0, 2.0);
    let music_gain = request.music_gain.clamp(0.0, 2.0);
    let filter = format!(
        "[0:a]volume={music_gain:.3}[m];[1:a]volume={voice_gain:.3}[v];\
         [m][v]amix=inputs=2:duration=first:normalize=0[out]"
    );
    let mut command = silent_command(ffmpeg_path());
    command
        .arg("-y")
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(&music)
        .arg("-i")
        .arg(&voice)
        .arg("-filter_complex")
        .arg(&filter)
        .arg("-map")
        .arg("[out]");
    if wav {
        command.arg("-c:a").arg("pcm_s16le");
    } else {
        command.arg("-c:a").arg("libmp3lame").arg("-q:a").arg("2");
    }
    let output = command.arg(&out).output()?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&out);
        return Err(format!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }

    std::fs::remove_dir_all(&dir)?;
    Ok(out.to_string_lossy().into_owned())
}

/// Throw a take away; nothing with the voice stays on disk.
pub fn discard_recording(take: &str) -> Result<(), NightingaleError> {
    let dir = take_dir(take)?;
    std::fs::remove_dir_all(dir)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct RecordingFile {
    pub path: String,
    pub name: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub modified: u64,
}

pub fn list_recordings() -> Vec<RecordingFile> {
    let Ok(entries) = std::fs::read_dir(recordings_dir()) else {
        return Vec::new();
    };
    let mut files: Vec<RecordingFile> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            if extension != "mp3" && extension != "wav" {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Some(RecordingFile {
                name: path.file_name()?.to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                size: meta.len(),
                modified,
            })
        })
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    files
}

/// Delete a saved recording; only files directly inside the recordings folder.
pub fn delete_recording(path: &str) -> Result<(), NightingaleError> {
    let base = std::fs::canonicalize(recordings_dir())?;
    let file = std::fs::canonicalize(path)?;
    if file.parent() != Some(base.as_path()) || !file.is_file() {
        return Err("not a recording".into());
    }
    std::fs::remove_file(file)?;
    Ok(())
}
