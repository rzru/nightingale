pub mod cache;
pub mod transcript;

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Stdio};

use crate::error::NightingaleError;
use crate::vendor::silent_command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use bevy::app::AppExit;
use bevy::prelude::*;

use cache::CacheDir;
use crate::scanner::metadata::{AnalysisStatus, Song, SongLibrary, TranscriptSource};

pub struct AnalyzerPlugin;

impl Plugin for AnalyzerPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<AnalysisQueue>()
            .add_systems(Update, (process_queue, poll_active_job))
            .add_systems(Last, kill_analyzer_on_exit);
    }
}

#[derive(Resource)]
pub struct PlayTarget {
    #[allow(dead_code)]
    pub song_index: usize,
}

#[derive(Debug, Clone)]
pub struct ProgressInfo {
    pub percent: u32,
    pub message: String,
    pub finished: Option<bool>,
}

pub struct ActiveJob {
    pub song_index: usize,
    pub progress: Arc<Mutex<ProgressInfo>>,
    #[allow(dead_code)]
    pub child_pid: Arc<AtomicU32>,
    pub thread_handle: Option<std::thread::JoinHandle<()>>,
}

#[derive(Resource, Default)]
pub struct AnalysisQueue {
    pub queue: VecDeque<usize>,
    pub active: Option<ActiveJob>,
}

impl AnalysisQueue {
    pub fn enqueue(&mut self, song_index: usize) {
        if self.active.as_ref().is_some_and(|a| a.song_index == song_index) {
            return;
        }
        if !self.queue.contains(&song_index) {
            self.queue.push_back(song_index);
        }
    }

    pub fn active_progress(&self, song_index: usize) -> Option<ProgressInfo> {
        self.active.as_ref().and_then(|a| {
            if a.song_index == song_index {
                Some(a.progress.lock().unwrap().clone())
            } else {
                None
            }
        })
    }
}

struct ServerProcess {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let pid = self.child.id();
        eprintln!("[analyzer] Killing server process (pid={pid})");
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static ANALYZER_SERVER: LazyLock<Mutex<Option<ServerProcess>>> =
    LazyLock::new(|| Mutex::new(None));

fn spawn_server() -> Result<ServerProcess, NightingaleError> {
    let python = crate::vendor::python_path();
    let script = crate::vendor::analyzer_dir().join("server.py");
    let models = crate::vendor::models_dir();
    let ffmpeg = crate::vendor::ffmpeg_path();
    let ffmpeg_dir = ffmpeg.parent().unwrap_or(std::path::Path::new("."));
    let path_env = if let Some(existing) = std::env::var_os("PATH") {
        let mut paths = std::env::split_paths(&existing).collect::<Vec<_>>();
        paths.insert(0, ffmpeg_dir.to_path_buf());
        std::env::join_paths(paths).unwrap_or(existing)
    } else {
        ffmpeg_dir.as_os_str().to_os_string()
    };

    let mut cmd = silent_command(&python);
    cmd.env("PATH", &path_env)
        .env("TORCH_HOME", models.join("torch"))
        .env("HF_HOME", models.join("huggingface"))
        .env("FFMPEG_PATH", &ffmpeg)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONWARNINGS", "ignore")
        .env("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        .env("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        .env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        .env("NLTK_DATA", models.join("nltk_data"))
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| NightingaleError::Other(format!("Failed to start analyzer server: {e}")))?;
    let pid = child.id();
    eprintln!("[analyzer] Server process spawned (pid={pid})");

    let stdin = BufWriter::new(
        child.stdin.take().ok_or(NightingaleError::Other("Failed to capture server stdin".into()))?,
    );
    let stdout = BufReader::new(
        child.stdout.take().ok_or(NightingaleError::Other("Failed to capture server stdout".into()))?,
    );

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[analyzer stderr] {line}");
            }
        });
    }

    Ok(ServerProcess { child, stdin, stdout })
}

fn ensure_server(guard: &mut std::sync::MutexGuard<Option<ServerProcess>>) -> Result<(), NightingaleError> {
    if guard.is_some() {
        return Ok(());
    }
    let server = spawn_server()?;
    **guard = Some(server);
    Ok(())
}

fn parse_progress_line(line: &str) -> Option<(u32, String)> {
    let prefix = "[nightingale:PROGRESS:";
    let start = line.find(prefix)?;
    let after_prefix = &line[start + prefix.len()..];
    let end_bracket = after_prefix.find(']')?;
    let pct_str = &after_prefix[..end_bracket];
    let pct: u32 = pct_str.parse().ok()?;
    let msg = after_prefix[end_bracket + 1..].trim().to_string();
    Some((pct, msg))
}

fn fetch_lrclib_lyrics(song: &Song, cache: &CacheDir) -> Option<PathBuf> {
    let title = song.display_title();
    let artist = song.display_artist();

    if title.is_empty() || artist == "Unknown Artist" {
        return None;
    }

    let agent = ureq::Agent::new_with_defaults();

    eprintln!("[lrclib] Searching: \"{title}\" by \"{artist}\" ({:.0}s, album=\"{}\")", song.duration_secs, song.album);

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
            eprintln!("[lrclib] Search request failed: {e}");
            return None;
        }
    };
    let results: Vec<serde_json::Value> = match resp.into_body().read_json() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[lrclib] Failed to parse search results: {e}");
            return None;
        }
    };

    let with_lyrics: Vec<_> = results
        .into_iter()
        .filter(|r| {
            r.get("plainLyrics")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty())
                || r.get("syncedLyrics")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
        })
        .collect();

    eprintln!("[lrclib] Search returned {} results with lyrics", with_lyrics.len());

    let album_lower = song.album.to_lowercase();
    let record = with_lyrics
        .into_iter()
        .min_by_key(|r| {
            let album_match = r.get("albumName")
                .and_then(|v| v.as_str())
                .is_some_and(|a| a.to_lowercase() == album_lower);
            let d = r.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let duration_penalty = ((d - song.duration_secs).abs() * 10.0) as i64;
            let album_bonus: i64 = if album_match { 0 } else { 5_000 };

            album_bonus + duration_penalty
        });

    if let Some(ref r) = record {
        let d = r.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let name = r.get("trackName").and_then(|v| v.as_str()).unwrap_or("?");
        let album = r.get("albumName").and_then(|v| v.as_str()).unwrap_or("?");
        eprintln!(
            "[lrclib] Picked \"{}\" from \"{}\" (duration {:.0}s, delta {:.1}s)",
            name, album, d, (d - song.duration_secs).abs()
        );
    }

    let Some(record) = record else {
        eprintln!("[lrclib] No lyrics found");
        return None;
    };

    let plain_str = record
        .get("plainLyrics")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());

    let Some(plain) = plain_str else {
        eprintln!("[lrclib] Record has no plainLyrics, skipping");
        return None;
    };

    let lines: Vec<String> = plain
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        eprintln!("[lrclib] Extracted 0 lines, skipping");
        return None;
    }

    eprintln!("[lrclib] Extracted {} lines", lines.len());
    let lyrics_json = serde_json::json!({"lines": lines});

    let out = cache.lyrics_path(&song.file_hash);
    match std::fs::write(&out, serde_json::to_string_pretty(&lyrics_json).unwrap()) {
        Ok(_) => {
            eprintln!("[lrclib] Lyrics saved to {}", out.display());
            Some(out)
        }
        Err(e) => {
            eprintln!("[lrclib] Failed to write lyrics: {e}");
            None
        }
    }
}

enum SongResult {
    Done,
    Oom,
    Error(String),
}

fn send_and_monitor(
    server: &mut ServerProcess,
    json_cmd: &str,
    progress: &Arc<Mutex<ProgressInfo>>,
) -> Result<SongResult, NightingaleError> {
    server.stdin.write_all(json_cmd.as_bytes())?;
    server.stdin.write_all(b"\n")?;
    server.stdin.flush()?;

    let mut line_buf = String::new();
    loop {
        line_buf.clear();
        let bytes = server.stdout.read_line(&mut line_buf)?;

        if bytes == 0 {
            return Err("Server process closed stdout unexpectedly".into());
        }

        let line = line_buf.trim_end();
        eprintln!("[analyzer] {line}");

        if line.contains("[nightingale:DONE]") {
            return Ok(SongResult::Done);
        }
        if line.contains("[nightingale:OOM]") {
            return Ok(SongResult::Oom);
        }
        if line.contains("[nightingale:ERROR]") {
            let msg = line
                .split("[nightingale:ERROR]")
                .nth(1)
                .unwrap_or("Unknown error")
                .trim()
                .to_string();
            return Ok(SongResult::Error(msg));
        }

        if let Some((pct, msg)) = parse_progress_line(line) {
            let mut p = progress.lock().unwrap();
            p.percent = pct;
            p.message = msg;
        }
    }
}

fn spawn_analyzer(
    song_path: PathBuf,
    cache_path: PathBuf,
    file_hash: String,
    song: Song,
    whisper_model: String,
    beam_size: u32,
    batch_size: u32,
    separator: String,
    language_override: Option<String>,
) -> (Arc<Mutex<ProgressInfo>>, Arc<AtomicU32>, std::thread::JoinHandle<()>) {
    let progress = Arc::new(Mutex::new(ProgressInfo {
        percent: 0,
        message: "Searching for lyrics...".into(),
        finished: None,
    }));
    let child_pid = Arc::new(AtomicU32::new(0));

    let progress_clone = Arc::clone(&progress);
    let pid_clone = Arc::clone(&child_pid);

    let thread_handle = std::thread::spawn(move || {
        let cache = CacheDir { path: cache_path.clone() };
        let lyrics_path = fetch_lrclib_lyrics(&song, &cache);

        {
            let mut p = progress_clone.lock().unwrap();
            p.message = "Starting analyzer...".into();
        }

        let mut cmd_json = serde_json::json!({
            "command": "analyze",
            "audio_path": song_path.to_string_lossy(),
            "cache_path": cache_path.to_string_lossy(),
            "hash": file_hash,
            "model": whisper_model,
            "beam_size": beam_size,
            "batch_size": batch_size,
            "separator": separator,
        });

        if let Some(ref lp) = lyrics_path {
            cmd_json["lyrics"] = serde_json::json!(lp.to_string_lossy());
        }
        if let Some(ref lang) = language_override {
            cmd_json["language"] = serde_json::json!(lang);
        }

        let json_str = serde_json::to_string(&cmd_json).unwrap();
        let mut retried = false;

        loop {
            let mut guard = ANALYZER_SERVER.lock().unwrap();

            if let Err(e) = ensure_server(&mut guard) {
                let mut p = progress_clone.lock().unwrap();
                p.finished = Some(false);
                p.message = e.to_string();
                return;
            }

            let server = guard.as_mut().unwrap();
            pid_clone.store(server.child.id(), Ordering::Relaxed);

            match send_and_monitor(server, &json_str, &progress_clone) {
                Ok(SongResult::Done) => {
                    let mut p = progress_clone.lock().unwrap();
                    p.finished = Some(true);
                    break;
                }
                Ok(SongResult::Oom) => {
                    eprintln!("[analyzer] CUDA OOM, killing server to free GPU memory");
                    *guard = None;

                    if !retried {
                        retried = true;
                        eprintln!("[analyzer] Respawning server and retrying with clean GPU");
                        let mut p = progress_clone.lock().unwrap();
                        p.percent = 0;
                        p.message = "CUDA OOM — retrying with fresh GPU...".into();
                        continue;
                    }
                    let mut p = progress_clone.lock().unwrap();
                    p.finished = Some(false);
                    p.message = "CUDA out of memory".into();
                    break;
                }
                Ok(SongResult::Error(msg)) => {
                    let mut p = progress_clone.lock().unwrap();
                    p.finished = Some(false);
                    p.message = msg;
                    break;
                }
                Err(e) => {
                    eprintln!("[analyzer] Server crashed: {e}");
                    *guard = None;

                    if !retried {
                        retried = true;
                        eprintln!("[analyzer] Respawning server and retrying");
                        let mut p = progress_clone.lock().unwrap();
                        p.percent = 0;
                        p.message = "Server crashed — retrying...".into();
                        continue;
                    }
                    let mut p = progress_clone.lock().unwrap();
                    p.finished = Some(false);
                    p.message = format!("Server crashed: {e}");
                    break;
                }
            }
        }
    });

    (progress, child_pid, thread_handle)
}

fn process_queue(
    mut queue: ResMut<AnalysisQueue>,
    library: Option<ResMut<SongLibrary>>,
    cache: Res<CacheDir>,
    config: Res<crate::config::AppConfig>,
) {
    let Some(mut library) = library else { return };
    if queue.active.is_some() || queue.queue.is_empty() {
        return;
    }

    let song_index = queue.queue.pop_front().unwrap();
    let song = &library.songs[song_index];

    info!(
        "Starting analysis of: {} (hash={})",
        song.path.display(),
        song.file_hash
    );

    let lang_override = config.language_override(&song.file_hash).map(|s| s.to_string());
    let (progress, child_pid, thread_handle) = spawn_analyzer(
        song.path.clone(),
        cache.path.clone(),
        song.file_hash.clone(),
        song.clone(),
        config.whisper_model().to_string(),
        config.beam_size(),
        config.batch_size(),
        config.separator().to_string(),
        lang_override,
    );

    library.songs[song_index].analysis_status = AnalysisStatus::Analyzing;

    queue.active = Some(ActiveJob {
        song_index,
        progress,
        child_pid,
        thread_handle: Some(thread_handle),
    });
}

fn poll_active_job(
    mut queue: ResMut<AnalysisQueue>,
    library: Option<ResMut<SongLibrary>>,
    cache: Res<CacheDir>,
) {
    let Some(mut library) = library else { return };
    let finished_info = {
        let Some(ref active) = queue.active else {
            return;
        };
        let info = active.progress.lock().unwrap().clone();
        if info.finished.is_none() {
            return;
        }
        info
    };

    let mut active = queue.active.take().unwrap();
    let song_index = active.song_index;
    let success = finished_info.finished.unwrap();

    if let Some(handle) = active.thread_handle.take() {
        let _ = handle.join();
    }

    if success && cache.transcript_exists(&library.songs[song_index].file_hash) {
        info!("Analysis complete for: {}", library.songs[song_index].path.display());
        let hash = &library.songs[song_index].file_hash;
        let transcript_path = cache.transcript_path(hash);
        match transcript::Transcript::load(&transcript_path) {
            Ok(t) => {
                let source = if t.source == "lyrics" {
                    TranscriptSource::Lyrics
                } else {
                    TranscriptSource::Generated
                };
                library.songs[song_index].analysis_status = AnalysisStatus::Ready(source);
                library.songs[song_index].language = if t.language.is_empty() {
                    None
                } else {
                    Some(t.language)
                };
            }
            _ => {
                library.songs[song_index].analysis_status =
                    AnalysisStatus::Ready(TranscriptSource::Generated);
            }
        }
    } else {
        error!("Analysis failed: {}", finished_info.message);
        library.songs[song_index].analysis_status =
            AnalysisStatus::Failed(finished_info.message);
    }
}

fn kill_analyzer_on_exit(
    mut exit_events: MessageReader<AppExit>,
    queue: Res<AnalysisQueue>,
) {
    if exit_events.read().next().is_none() {
        return;
    }

    if let Some(ref active) = queue.active {
        let pid = active.child_pid.load(Ordering::Relaxed);
        if pid != 0 {
            eprintln!("[analyzer] Killing server process during exit (pid={pid})");
            #[cfg(unix)]
            unsafe {
                libc::kill(pid as i32, libc::SIGTERM);
            }
        }
    }

    match ANALYZER_SERVER.try_lock() {
        Ok(mut guard) => {
            if let Some(ref mut server) = *guard {
                info!("Shutting down analyzer server");
                let _ = writeln!(server.stdin, r#"{{"command":"quit"}}"#);
                let _ = server.stdin.flush();
            }
            *guard = None;
        }
        Err(_) => {
            eprintln!("[analyzer] Server lock held by analysis thread, process already killed by signal");
        }
    }
}
