use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::AppConfig;
use crate::vendor::{ffmpeg_path, silent_command};

const MAX_RECORDING_BYTES: usize = 64 * 1024 * 1024;
const MAX_FILE_PART_CHARS: usize = 40;

fn input_extension(media_type: &str) -> Option<&'static str> {
    let normalized = media_type.to_ascii_lowercase();

    if normalized.starts_with("audio/webm") {
        Some("webm")
    } else if normalized.starts_with("audio/mp4") {
        Some("m4a")
    } else if normalized.starts_with("audio/ogg") {
        Some("ogg")
    } else {
        None
    }
}

fn sanitize_file_part(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                ' '
            } else {
                character
            }
        })
        .collect();

    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['.', ' '])
        .chars()
        .take(MAX_FILE_PART_CHARS)
        .collect()
}

fn safe_timestamp(value: &str) -> Option<&str> {
    let bytes = value.as_bytes();
    let separators_valid = bytes.len() == 17
        && bytes[2] == b'-'
        && bytes[5] == b'-'
        && bytes[8] == b' '
        && bytes[11] == b'-'
        && bytes[14] == b'-';
    let digits_valid = bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| matches!(index, 2 | 5 | 8 | 11 | 14) || byte.is_ascii_digit());

    (separators_valid && digits_valid).then_some(value)
}

fn recording_stem(
    title: &str,
    album: &str,
    profile: &str,
    saved_at: &str,
) -> Result<String, String> {
    let title = sanitize_file_part(title);
    let album = sanitize_file_part(album);
    let profile = sanitize_file_part(profile);
    let saved_at =
        safe_timestamp(saved_at).ok_or_else(|| "The recording timestamp is invalid".to_string())?;

    Ok(format!(
        "{} - {} - {} - {saved_at}",
        if title.is_empty() { "Untitled" } else { &title },
        if album.is_empty() {
            "Unknown album"
        } else {
            &album
        },
        if profile.is_empty() {
            "No profile"
        } else {
            &profile
        },
    ))
}

fn remove_if_file(path: &Path) {
    if path.is_file() {
        let _ = std::fs::remove_file(path);
    }
}

fn write_input(path: &Path, audio: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Could not prepare the recording: {error}"))?;
    file.write_all(audio)
        .map_err(|error| format!("Could not write the recording: {error}"))
}

fn recordings_root() -> Result<PathBuf, String> {
    let configured = AppConfig::load()
        .recordings_path
        .ok_or_else(|| "Choose a recordings folder in Playback settings first".to_string())?;

    std::fs::create_dir_all(&configured)
        .map_err(|error| format!("Could not create the recordings folder: {error}"))?;
    configured
        .canonicalize()
        .map_err(|error| format!("Could not open the recordings folder: {error}"))
}

pub fn save_recording(
    title: &str,
    album: &str,
    profile: &str,
    saved_at: &str,
    media_type: &str,
    audio: &[u8],
    microphone_audio: Option<&[u8]>,
) -> Result<String, String> {
    if audio.is_empty() {
        return Err("The recording is empty".to_string());
    }
    let microphone_bytes = microphone_audio.map_or(0, <[u8]>::len);
    if audio
        .len()
        .checked_add(microphone_bytes)
        .is_none_or(|size| size > MAX_RECORDING_BYTES)
    {
        return Err("The recording is too large to save".to_string());
    }

    let extension = input_extension(media_type)
        .ok_or_else(|| "This recording format is not supported".to_string())?;
    let root = recordings_root()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not timestamp the recording: {error}"))?;
    let unique = format!("{}-{}", std::process::id(), now.as_nanos());
    let stem = recording_stem(title, album, profile, saved_at)?;
    let input = root.join(format!(".nightingale-{unique}.{extension}"));
    let encoded = root.join(format!(".nightingale-{unique}.mp3"));
    let target_name = format!("{stem}.mp3");
    let target = root.join(&target_name);
    let microphone_path = root.join(format!(".nightingale-{unique}-microphone.wav"));

    if let Err(error) = write_input(&input, audio) {
        remove_if_file(&input);
        return Err(error);
    }
    let microphone_written = if let Some(microphone_audio) = microphone_audio {
        if microphone_audio.is_empty() {
            false
        } else if let Err(error) = write_input(&microphone_path, microphone_audio) {
            remove_if_file(&input);
            remove_if_file(&microphone_path);
            return Err(error);
        } else {
            true
        }
    } else {
        false
    };

    let mut command = silent_command(ffmpeg_path());
    command.args(["-y", "-v", "error", "-i"]).arg(&input);
    if microphone_written {
        command
            .arg("-i")
            .arg(&microphone_path)
            .args([
                "-filter_complex",
                "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]",
                "-map",
                "[aout]",
            ]);
    }

    let transcode = command
        .args([
            "-vn",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "256k",
            "-ar",
            "48000",
            "-ac",
            "2",
        ])
        .arg(&encoded)
        .status()
        .map_err(|error| format!("Could not encode the recording: {error}"));

    remove_if_file(&input);
    remove_if_file(&microphone_path);

    match transcode {
        Ok(status) if status.success() => {}
        Ok(status) => {
            remove_if_file(&encoded);
            return Err(format!(
                "Could not encode the recording: ffmpeg exited with {status}"
            ));
        }
        Err(error) => {
            remove_if_file(&encoded);
            return Err(error);
        }
    }

    if target.exists() {
        remove_if_file(&encoded);
        return Err("A recording with this name already exists; try again in a moment".to_string());
    }

    std::fs::rename(&encoded, &target).map_err(|error| {
        remove_if_file(&encoded);
        format!("Could not finish saving the recording: {error}")
    })?;

    Ok(target_name)
}
