//! yt-dlp, installed on demand into Nightingale's own Python environment.
//!
//! Since yt-dlp 2025.11, YouTube needs an external JavaScript runtime to solve
//! its player challenges: `yt-dlp[default]` brings the `yt-dlp-ejs` solver
//! scripts and the official `deno` wheel from PyPI brings the runtime, both
//! inside the vendor venv — nothing touches the user's system. YouTube breaks
//! old yt-dlp releases quickly, so the packages are refreshed at most every
//! [`UPDATE_INTERVAL`] before a download batch.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::cache::vendor_dir;
use crate::vendor::{self, silent_command};

const UPDATE_INTERVAL: Duration = Duration::from_secs(3 * 24 * 3600);
const PACKAGES: &[&str] = &["yt-dlp[default]", "deno"];
const PROGRESS_MARKER: &str = "NGPCT ";
const PATH_MARKER: &str = "NGPATH ";
const STDERR_TAIL_LINES: usize = 20;

/// Error string returned when [`download_audio`] was cancelled.
pub(crate) const CANCELLED: &str = "download cancelled";

fn marker_path() -> PathBuf {
    vendor_dir().join(".ytdlp_installed")
}

/// Install yt-dlp the first time and refresh it when stale. A failed refresh
/// keeps the installed version (offline, PyPI hiccup); a failed first install
/// is an error.
pub(crate) fn ensure_installed() -> Result<(), String> {
    if !vendor::is_ready() {
        return Err("finish Nightingale's first-run setup before downloading songs".into());
    }
    let marker = marker_path();
    let installed = marker.is_file();
    let stale = std::fs::metadata(&marker)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_none_or(|age| age > UPDATE_INTERVAL);
    if installed && !stale {
        return Ok(());
    }
    match install_or_upgrade() {
        Ok(()) => {
            // Rewriting the marker refreshes its mtime, which is the clock.
            let _ = std::fs::write(&marker, "ok");
            Ok(())
        }
        Err(error) if installed => {
            tracing::warn!("yt-dlp update failed, keeping the installed version: {error}");
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn install_or_upgrade() -> Result<(), String> {
    let output = silent_command(vendor::uv_path())
        .args(["pip", "install", "--upgrade"])
        .args(PACKAGES)
        .arg("--python")
        .arg(vendor::python_path())
        .output()
        .map_err(|error| format!("failed to run uv: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp install failed: {}", stderr.trim()));
    }
    Ok(())
}

/// The `deno` wheel installs its launcher next to the venv's Python.
fn deno_path() -> Option<PathBuf> {
    let name = if cfg!(windows) { "deno.exe" } else { "deno" };
    vendor::python_path()
        .parent()
        .map(|bin| bin.join(name))
        .filter(|path| path.is_file())
}

/// Download the audio of `url` as `<dest_dir>/<base_name>.m4a`, with the
/// video metadata and thumbnail embedded. `on_progress` receives 0–100;
/// `should_cancel` is polled while yt-dlp runs.
pub(crate) fn download_audio(
    url: &str,
    dest_dir: &Path,
    base_name: &str,
    mut on_progress: impl FnMut(f64),
    should_cancel: impl Fn() -> bool,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest_dir)
        .map_err(|error| format!("cannot create {}: {error}", dest_dir.display()))?;
    // `%` starts a yt-dlp template field; the base name is literal text.
    let template = dest_dir.join(format!("{}.%(ext)s", base_name.replace('%', "%%")));

    let mut command = silent_command(vendor::python_path());
    command
        .args([
            "-m",
            "yt_dlp",
            "--no-playlist",
            "--newline",
            "--no-colors",
            "--progress",
            "--progress-template",
        ])
        .arg(format!(
            "download:{PROGRESS_MARKER}%(progress._percent_str)s"
        ))
        .args([
            "--format",
            "bestaudio[ext=m4a]/bestaudio/best",
            "--extract-audio",
            "--audio-format",
            "m4a",
            "--audio-quality",
            "0",
            "--embed-metadata",
            "--embed-thumbnail",
            "--convert-thumbnails",
            "jpg",
            "--no-simulate",
            "--print",
        ])
        .arg(format!("after_move:{PATH_MARKER}%(filepath)s"))
        .arg("--ffmpeg-location")
        .arg(vendor::ffmpeg_path());
    if let Some(deno) = deno_path() {
        command
            .arg("--js-runtimes")
            .arg(format!("deno:{}", deno.display()));
    }
    command
        .arg("--output")
        .arg(&template)
        // Everything after `--` is a URL, never an option.
        .arg("--")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start yt-dlp: {error}"))?;

    // Progress may land on either stream depending on yt-dlp's quiet mode, so
    // both are read on their own threads and funnelled through one channel.
    let (sender, receiver) = mpsc::channel::<(bool, String)>();
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(spawn_line_reader(stdout, false, sender.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(spawn_line_reader(stderr, true, sender.clone()));
    }
    drop(sender);

    let mut final_path: Option<PathBuf> = None;
    let mut stderr_tail: VecDeque<String> = VecDeque::with_capacity(STDERR_TAIL_LINES);
    let mut cancelled = false;
    loop {
        if should_cancel() {
            cancelled = true;
            let _ = child.kill();
            break;
        }
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok((is_stderr, line)) => {
                if let Some(percent) = line.trim().strip_prefix(PROGRESS_MARKER) {
                    if let Some(value) = parse_percent(percent) {
                        on_progress(value);
                    }
                } else if let Some(path) = line.trim().strip_prefix(PATH_MARKER) {
                    final_path = Some(PathBuf::from(path));
                } else if is_stderr && !line.trim().is_empty() {
                    if stderr_tail.len() == STDERR_TAIL_LINES {
                        stderr_tail.pop_front();
                    }
                    stderr_tail.push_back(line);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("yt-dlp did not exit cleanly: {error}"))?;
    for reader in readers {
        let _ = reader.join();
    }
    if cancelled {
        return Err(CANCELLED.into());
    }
    if !status.success() {
        return Err(summarize_error(&stderr_tail));
    }
    final_path
        .filter(|path| path.is_file())
        .or_else(|| Some(dest_dir.join(format!("{base_name}.m4a"))).filter(|path| path.is_file()))
        .ok_or_else(|| "yt-dlp finished without producing an audio file".to_string())
}

/// Run yt-dlp in metadata-only mode (`--dump-single-json --flat-playlist`)
/// with the cookies of `browser`, and parse the JSON it prints. Nothing is
/// downloaded.
pub(crate) fn fetch_json_with_browser_cookies(
    url: &str,
    browser: &str,
    extra_args: &[&str],
) -> Result<serde_json::Value, String> {
    let mut command = silent_command(vendor::python_path());
    command
        .args([
            "-m",
            "yt_dlp",
            "--dump-single-json",
            "--flat-playlist",
            "--no-warnings",
            "--no-colors",
            "--cookies-from-browser",
            browser,
        ])
        .args(extra_args);
    if let Some(deno) = deno_path() {
        command
            .arg("--js-runtimes")
            .arg(format!("deno:{}", deno.display()));
    }
    let output = command
        .arg("--")
        .arg(url)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("failed to start yt-dlp: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: VecDeque<String> = stderr
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(str::to_owned)
            .collect();
        return Err(summarize_error(&tail));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("yt-dlp returned unreadable data: {error}"))
}

fn spawn_line_reader(
    stream: impl Read + Send + 'static,
    is_stderr: bool,
    sender: mpsc::Sender<(bool, String)>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(stream).lines() {
            let Ok(line) = line else {
                break;
            };
            if sender.send((is_stderr, line)).is_err() {
                break;
            }
        }
    })
}

fn parse_percent(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_end_matches('%')
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|percent| percent.is_finite())
        .map(|percent| percent.clamp(0.0, 100.0))
}

/// Keep yt-dlp's own `ERROR:` line — it is usually the actionable one
/// ("Video unavailable", "Sign in to confirm your age", …).
fn summarize_error(stderr_tail: &VecDeque<String>) -> String {
    let line = stderr_tail
        .iter()
        .rev()
        .find(|line| line.contains("ERROR:"))
        .or_else(|| stderr_tail.back())
        .map(|line| line.trim().trim_start_matches("ERROR:").trim().to_string())
        .unwrap_or_else(|| "yt-dlp failed".to_string());
    truncate_chars(&line, 300)
}

fn truncate_chars(value: &str, max: usize) -> String {
    match value.char_indices().nth(max) {
        Some((index, _)) => format!("{}…", &value[..index]),
        None => value.to_string(),
    }
}

/// A file name safe on every desktop OS: no path separators or reserved
/// characters, no trailing dots/spaces, bounded length.
pub(crate) fn sanitize_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let bounded = match collapsed.char_indices().nth(150) {
        Some((index, _)) => &collapsed[..index],
        None => collapsed.as_str(),
    };
    let trimmed = bounded.trim_matches(|c: char| c == '.' || c == ' ');
    if trimmed.is_empty() {
        "track".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_parsing_tolerates_padding() {
        assert_eq!(parse_percent("  42.5%"), Some(42.5));
        assert_eq!(parse_percent("100%"), Some(100.0));
        assert_eq!(parse_percent("N/A"), None);
    }

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(
            sanitize_file_name("AC/DC - Back In Black [abc]"),
            "AC_DC - Back In Black [abc]"
        );
        assert_eq!(sanitize_file_name("What? : Who*"), "What_ _ Who_");
        assert_eq!(sanitize_file_name(" ... "), "track");
        assert_eq!(sanitize_file_name(&"a".repeat(400)).chars().count(), 150);
    }

    #[test]
    fn error_summary_prefers_error_lines() {
        let tail: VecDeque<String> = [
            "WARNING: something".to_string(),
            "ERROR: [youtube] abc: Video unavailable".to_string(),
            "trailing noise".to_string(),
        ]
        .into_iter()
        .collect();
        assert_eq!(summarize_error(&tail), "[youtube] abc: Video unavailable");
        assert_eq!(summarize_error(&VecDeque::new()), "yt-dlp failed");
    }
}
