//! Performance recording: the raw voice of one microphone capture, written
//! without processing as 32-bit float samples into segments tied to song time.
//! Mixing with the music happens in `app-core` once the song ends.

use std::{
    fs::File,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use serde::Serialize;
use tracing::warn;

/// Recording does not start with less free space than this on the data disk.
const MIN_FREE_BYTES: u64 = 500 * 1024 * 1024;

struct Segment {
    file: String,
    start_sec: f64,
    samples: u64,
}

struct Recorder {
    capture_id: String,
    dir: PathBuf,
    sample_rate: u32,
    segments: Vec<Segment>,
    writer: Option<BufWriter<File>>,
}

impl Recorder {
    fn close_segment(&mut self) {
        if let Some(mut writer) = self.writer.take() {
            if let Err(error) = writer.flush() {
                warn!("[recording] flush failed: {error}");
            }
        }
    }
}

static RECORDER: once_cell::sync::Lazy<Mutex<Option<Recorder>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

fn recorder() -> std::sync::MutexGuard<'static, Option<Recorder>> {
    RECORDER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Called from the microphone loop with the samples of a recording capture.
pub(crate) fn append(capture_id: &str, sample_rate: u32, samples: &[f32]) {
    let mut guard = recorder();
    let Some(recorder) = guard.as_mut() else {
        return;
    };
    if recorder.capture_id != capture_id {
        return;
    }
    recorder.sample_rate = sample_rate;
    let Some(writer) = recorder.writer.as_mut() else {
        // Paused: the song is not playing, so the voice is not part of it.
        return;
    };
    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    if let Err(error) = writer.write_all(&bytes) {
        warn!("[recording] write failed: {error}");
        recorder.writer = None;
        return;
    }
    if let Some(segment) = recorder.segments.last_mut() {
        segment.samples += samples.len() as u64;
    }
}

/// Free bytes on the disk holding `path`, when the platform tool reports it.
fn free_space_bytes(path: &Path) -> Option<u64> {
    if cfg!(windows) {
        let drive = path
            .to_str()?
            .chars()
            .next()
            .filter(char::is_ascii_alphabetic)?;
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("(Get-PSDrive -Name {drive}).Free"),
            ])
            .output()
            .ok()?;
        String::from_utf8_lossy(&output.stdout).trim().parse().ok()
    } else {
        let output = Command::new("df").arg("-Pk").arg(path).output().ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let available_kb: u64 = text
            .lines()
            .nth(1)?
            .split_whitespace()
            .nth(3)?
            .parse()
            .ok()?;
        Some(available_kb * 1024)
    }
}

#[derive(Serialize)]
struct SegmentsFile<'a> {
    sample_rate: u32,
    segments: Vec<SegmentEntry<'a>>,
}

#[derive(Serialize)]
struct SegmentEntry<'a> {
    file: &'a str,
    start_sec: f64,
    samples: u64,
}

fn write_segments_file(recorder: &Recorder) -> Result<(), String> {
    let content = SegmentsFile {
        sample_rate: recorder.sample_rate,
        segments: recorder
            .segments
            .iter()
            .filter(|segment| segment.samples > 0)
            .map(|segment| SegmentEntry {
                file: &segment.file,
                start_sec: segment.start_sec,
                samples: segment.samples,
            })
            .collect(),
    };
    let json = serde_json::to_vec_pretty(&content).map_err(|e| e.to_string())?;
    std::fs::write(recorder.dir.join("segments.json"), json).map_err(|e| e.to_string())
}

fn take_name() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("take-{millis}")
}

/// Arm recording for a capture. Nothing is written until `recording_mark`.
#[tauri::command]
pub(crate) fn recording_begin(capture_id: String) -> Result<(), String> {
    let base = app_core::recordings_tmp_dir();
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    if free_space_bytes(&base).is_some_and(|free| free < MIN_FREE_BYTES) {
        return Err("not enough free disk space".to_string());
    }
    let dir = base.join(take_name());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let previous = recorder().replace(Recorder {
        capture_id: capture_id.clone(),
        dir,
        sample_rate: 0,
        segments: Vec::new(),
        writer: None,
    });
    if let Some(previous) = previous {
        crate::microphones::set_recording(&previous.capture_id, false);
        let _ = std::fs::remove_dir_all(&previous.dir);
    }
    crate::microphones::set_recording(&capture_id, true);
    Ok(())
}

/// The song plays from `song_time_sec`: the voice from now on belongs there.
#[tauri::command]
pub(crate) fn recording_mark(song_time_sec: f64) -> Result<(), String> {
    let mut guard = recorder();
    let Some(recorder) = guard.as_mut() else {
        return Err("recording is not active".to_string());
    };
    recorder.close_segment();
    let file = format!("seg-{:04}.f32", recorder.segments.len());
    let handle = File::create(recorder.dir.join(&file)).map_err(|e| e.to_string())?;
    recorder.writer = Some(BufWriter::new(handle));
    recorder.segments.push(Segment {
        file,
        start_sec: song_time_sec.max(0.0),
        samples: 0,
    });
    Ok(())
}

/// The song is paused: stop writing until the next mark.
#[tauri::command]
pub(crate) fn recording_hold() {
    if let Some(recorder) = recorder().as_mut() {
        recorder.close_segment();
    }
}

/// Finish the take; returns its folder for mixing, or `None` when nothing was sung.
#[tauri::command]
pub(crate) fn recording_end() -> Result<Option<String>, String> {
    let Some(mut recorder) = recorder().take() else {
        return Ok(None);
    };
    crate::microphones::set_recording(&recorder.capture_id, false);
    recorder.close_segment();
    if recorder.sample_rate == 0 || recorder.segments.iter().all(|s| s.samples == 0) {
        let _ = std::fs::remove_dir_all(&recorder.dir);
        return Ok(None);
    }
    write_segments_file(&recorder)?;
    Ok(Some(recorder.dir.to_string_lossy().into_owned()))
}

/// Drop the take in progress without keeping any voice on disk.
#[tauri::command]
pub(crate) fn recording_cancel() {
    if let Some(mut recorder) = recorder().take() {
        crate::microphones::set_recording(&recorder.capture_id, false);
        recorder.close_segment();
        let _ = std::fs::remove_dir_all(&recorder.dir);
    }
}
