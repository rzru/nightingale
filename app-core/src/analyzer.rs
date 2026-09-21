use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::cache::{CacheDir, models_dir};
use crate::config::AppConfig;
use crate::error::NightingaleError;
use crate::library_db;
use crate::library_model::{LibraryMenuFilters, SongTarget};
use crate::lyrics::{fetch_lrclib_lyrics, write_lyrics_file};
use crate::song::{Song, SongOrigin, TranscriptSource, compute_file_hash, read_transcript_meta};
use crate::source::{MediaSource, active_source};

// ─── Analysis queue (persisted to disk) ──────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum QueuedStatus {
    Queued,
    Analyzing(usize),
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export)]
pub struct AnalysisQueue {
    pub entries: HashMap<String, QueuedStatus>,
}

impl AnalysisQueue {
    pub fn load() -> Self {
        let entries = library_db::analysis_queue_load_rows()
            .map(|rows| {
                rows.into_iter()
                    .map(|(h, st, pct, msg)| {
                        let status = match st.as_str() {
                            "queued" => QueuedStatus::Queued,
                            "analyzing" => QueuedStatus::Analyzing(pct.unwrap_or(0) as usize),
                            "failed" => QueuedStatus::Failed(msg.unwrap_or_default()),
                            _ => QueuedStatus::Queued,
                        };
                        (h, status)
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { entries }
    }

    pub fn save(&self) {
        let rows: Vec<_> = self
            .entries
            .iter()
            .map(|(k, v)| match v {
                QueuedStatus::Queued => (k.clone(), "queued".to_string(), None, None),
                QueuedStatus::Analyzing(p) => {
                    (k.clone(), "analyzing".to_string(), Some(*p as i64), None)
                }
                QueuedStatus::Failed(s) => (k.clone(), "failed".to_string(), None, Some(s.clone())),
            })
            .collect();
        let _ = library_db::analysis_queue_save_rows(&rows);
    }

    pub fn clear() {
        let _ = library_db::analysis_queue_clear();
    }
}
use crate::vendor::{analyzer_dir, ffmpeg_path, python_path, silent_command};

// ─── Server process ──────────────────────────────────────────────────

static SERVER_PID: AtomicU32 = AtomicU32::new(0);

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(60);

struct ServerProcess {
    child: Child,
    reader: BufReader<TcpStream>,
    writer: BufWriter<TcpStream>,
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let pid = self.child.id();
        info!("[analyzer] Killing server process (pid={pid})");
        SERVER_PID.store(0, Ordering::SeqCst);
        lock_unpoisoned(&SERVER_INTERRUPT).take();
        if let Ok(stream) = self.writer.get_ref().try_clone() {
            let _ = stream.shutdown(Shutdown::Both);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static ANALYZER_SERVER: LazyLock<Mutex<Option<ServerProcess>>> = LazyLock::new(|| Mutex::new(None));
static SERVER_INTERRUPT: LazyLock<Mutex<Option<TcpStream>>> = LazyLock::new(|| Mutex::new(None));

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Debug, Deserialize)]
struct ReadyHandshake {
    port: u16,
    token: String,
    #[serde(default)]
    device: Option<String>,
}

fn drain_lines_to_log<R: BufRead + Send + 'static>(mut reader: R, label: &'static str) {
    std::thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => return,
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        info!("[analyzer {label}] {trimmed}");
                    }
                }
            }
        }
    });
}

fn read_ready_handshake<R: BufRead>(reader: &mut R) -> Result<ReadyHandshake, NightingaleError> {
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line)?;
        if bytes == 0 {
            return Err(NightingaleError::Other(
                "Analyzer server exited before handshake".into(),
            ));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) if value.get("event").and_then(|v| v.as_str()) == Some("ready") => {
                return serde_json::from_value::<ReadyHandshake>(value).map_err(|e| {
                    NightingaleError::Other(format!("Malformed ready handshake: {e}"))
                });
            }
            _ => {
                info!("[analyzer stdout] {trimmed}");
            }
        }
    }
}

fn connect_and_authenticate(
    port: u16,
    token: &str,
) -> Result<(BufReader<TcpStream>, BufWriter<TcpStream>), NightingaleError> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = TcpStream::connect_timeout(&addr, HANDSHAKE_TIMEOUT).map_err(|e| {
        NightingaleError::Other(format!("Failed to connect to analyzer server: {e}"))
    })?;
    stream.set_nodelay(true).ok();
    stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT))?;
    stream.set_write_timeout(Some(HANDSHAKE_TIMEOUT))?;

    let writer_stream = stream
        .try_clone()
        .map_err(|e| NightingaleError::Other(format!("Failed to clone analyzer socket: {e}")))?;
    let mut reader = BufReader::new(stream);
    let mut writer = BufWriter::new(writer_stream);

    let hello = serde_json::json!({"type": "hello", "token": token});
    serde_json::to_writer(&mut writer, &hello)?;
    writer.write_all(b"\n")?;
    writer.flush()?;

    let mut line = String::new();
    let bytes = reader.read_line(&mut line)?;
    if bytes == 0 {
        return Err(NightingaleError::Other(
            "Analyzer server closed connection during handshake".into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_str(line.trim())?;
    if value.get("type").and_then(|v| v.as_str()) != Some("hello_ack") {
        return Err(NightingaleError::Other(format!(
            "Analyzer auth failed: {}",
            line.trim()
        )));
    }

    reader.get_ref().set_read_timeout(None)?;
    reader.get_ref().set_write_timeout(None)?;

    Ok((reader, writer))
}

fn spawn_server() -> Result<ServerProcess, NightingaleError> {
    let python = python_path();
    let script = analyzer_dir().join("server.py");
    let models = models_dir();
    let ffmpeg = ffmpeg_path();
    let ffmpeg_dir = ffmpeg.parent().unwrap_or(Path::new("."));
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
        .env("NEMO_CACHE_DIR", models.join("nemo"))
        .env("ONNX_ASR_CACHE_DIR", models.join("onnx_asr"))
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| NightingaleError::Other(format!("Failed to start analyzer server: {e}")))?;
    let pid = child.id();
    SERVER_PID.store(pid, Ordering::SeqCst);
    info!("[analyzer] Server process spawned (pid={pid})");

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            SERVER_PID.store(0, Ordering::SeqCst);
            return Err(NightingaleError::Other(
                "Failed to capture server stdout".into(),
            ));
        }
    };
    let mut stdout_reader = BufReader::new(stdout);

    let handshake = match read_ready_handshake(&mut stdout_reader) {
        Ok(h) => h,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            SERVER_PID.store(0, Ordering::SeqCst);
            return Err(e);
        }
    };
    if let Some(device) = handshake.device.as_deref() {
        info!(
            "[analyzer] Handshake ok: device={device} port={}",
            handshake.port
        );
    } else {
        info!("[analyzer] Handshake ok: port={}", handshake.port);
    }

    let (reader, writer) = match connect_and_authenticate(handshake.port, &handshake.token) {
        Ok(pair) => pair,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            SERVER_PID.store(0, Ordering::SeqCst);
            return Err(e);
        }
    };

    let interrupt = match writer.get_ref().try_clone() {
        Ok(stream) => stream,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            SERVER_PID.store(0, Ordering::SeqCst);
            return Err(error.into());
        }
    };
    *lock_unpoisoned(&SERVER_INTERRUPT) = Some(interrupt);

    drain_lines_to_log(stdout_reader, "stdout");
    if let Some(stderr) = child.stderr.take() {
        drain_lines_to_log(BufReader::new(stderr), "stderr");
    }

    Ok(ServerProcess {
        child,
        reader,
        writer,
    })
}

fn ensure_server(
    guard: &mut MutexGuard<'_, Option<ServerProcess>>,
) -> Result<(), NightingaleError> {
    if guard.is_some() {
        return Ok(());
    }
    let server = spawn_server()?;
    **guard = Some(server);
    Ok(())
}

// ─── Queue state ─────────────────────────────────────────────────────

struct AnalyzerState {
    queue: VecDeque<String>,
    active_hash: Option<String>,
    cancelled: HashSet<String>,
    worker_running: bool,
}

static ANALYZER: LazyLock<Mutex<AnalyzerState>> = LazyLock::new(|| {
    Mutex::new(AnalyzerState {
        queue: VecDeque::new(),
        active_hash: None,
        cancelled: HashSet::new(),
        worker_running: false,
    })
});

static FORCE_TRANSCRIBE: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Hashes whose queued job should only run stem separation (key detect +
/// separation) and keep the already-written LRC-provided transcript.
static STEMS_ONLY: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Mark a hash so its next analysis pass separates stems without transcribing,
/// preserving the transcript built from provided LRC.
pub(crate) fn mark_stems_only(file_hash: &str) {
    lock_unpoisoned(&STEMS_ONLY).insert(file_hash.to_string());
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn update_queue_status(file_hash: &str, status: QueuedStatus) {
    let (st, pct, msg) = match &status {
        QueuedStatus::Queued => ("queued", None, None::<String>),
        QueuedStatus::Analyzing(p) => ("analyzing", Some(*p as i64), None::<String>),
        QueuedStatus::Failed(s) => ("failed", None, Some(s.clone())),
    };
    let _ = library_db::analysis_queue_upsert_row(file_hash, st, pct, msg.as_deref());
}

fn remove_from_queue(file_hash: &str) {
    let _ = library_db::analysis_queue_delete(file_hash);
}

fn take_cancelled(initial_hash: &str, file_hash: &str) -> bool {
    let mut state = lock_unpoisoned(&ANALYZER);
    state.cancelled.remove(initial_hash) | state.cancelled.remove(file_hash)
}

fn discard_cancelled_job(initial_hash: &str, file_hash: &str) -> bool {
    if !take_cancelled(initial_hash, file_hash) {
        return false;
    }

    remove_from_queue(initial_hash);
    remove_from_queue(file_hash);
    lock_unpoisoned(&FORCE_TRANSCRIBE).remove(initial_hash);
    lock_unpoisoned(&FORCE_TRANSCRIBE).remove(file_hash);
    lock_unpoisoned(&STEMS_ONLY).remove(initial_hash);
    lock_unpoisoned(&STEMS_ONLY).remove(file_hash);
    info!("[analyzer] Analysis cancelled for {file_hash}");
    true
}

/// Returns whether a library row was written; `false` when the song is gone.
pub(crate) fn update_song_analyzed(
    file_hash: &str,
    is_analyzed: bool,
    language: Option<String>,
    transcript_source: Option<TranscriptSource>,
    key: Option<String>,
    tempo: Option<f64>,
) -> bool {
    let Some(mut song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return false;
    };
    song.is_analyzed = is_analyzed;
    song.language = language;
    song.transcript_source = transcript_source;
    if is_analyzed {
        song.key = key;
        if let Some(value) = tempo {
            song.tempo = value;
        }
        // LRC-provided songs without stem separation are flagged in the
        // transcript; mirror that onto the song so playback hides the guide.
        song.no_stems = read_transcript_meta(&CacheDir::new(), file_hash).no_stems;
    } else {
        song.key = None;
        song.override_key = None;
        song.tempo = 1.0;
        song.key_offset = 0;
        song.no_stems = false;
    }
    library_db::update_song_fields(file_hash, &song).is_ok()
}

// ─── Public API ──────────────────────────────────────────────────────

pub(crate) fn is_usdx_song(file_hash: &str) -> bool {
    library_db::load_song_by_hash(file_hash)
        .ok()
        .flatten()
        .map(|s| s.usdx.is_some())
        .unwrap_or(false)
}

fn resolve_target<F>(target: SongTarget, filtered: F) -> Result<Vec<String>, String>
where
    F: FnOnce(&LibraryMenuFilters) -> rusqlite::Result<Vec<String>>,
{
    let mut hashes = match target {
        SongTarget::Hashes { hashes } => hashes,
        SongTarget::Filter { filters } => filtered(&filters).map_err(|e| e.to_string())?,
    };
    let mut seen = HashSet::new();
    hashes.retain(|hash| seen.insert(hash.clone()));
    Ok(hashes)
}

fn run_for_target<Q, A>(target: SongTarget, filtered: Q, mut action: A) -> Result<usize, String>
where
    Q: FnOnce(&LibraryMenuFilters) -> rusqlite::Result<Vec<String>>,
    A: FnMut(&str) -> Result<bool, String>,
{
    let hashes = resolve_target(target, filtered)?;
    let mut affected = 0;
    let mut failures = Vec::new();

    for hash in &hashes {
        match action(hash) {
            Ok(true) => affected += 1,
            Ok(false) => {}
            Err(error) => failures.push(format!("{hash}: {error}")),
        }
    }

    if failures.is_empty() {
        Ok(affected)
    } else {
        Err(format!(
            "Updated {affected} song(s); {} failed: {}",
            failures.len(),
            failures.join("; ")
        ))
    }
}

fn enqueue_hashes(mut hashes: Vec<String>, skip_persisted: bool) -> usize {
    hashes.retain(|hash| !is_usdx_song(hash));
    let persisted = skip_persisted.then(AnalysisQueue::load);
    let mut state = lock_unpoisoned(&ANALYZER);
    let mut newly_queued = Vec::new();

    for file_hash in hashes {
        if persisted
            .as_ref()
            .is_some_and(|queue| queue.entries.contains_key(&file_hash))
        {
            continue;
        }
        if state.active_hash.as_deref() != Some(&file_hash)
            && !state.queue.iter().any(|hash| hash == &file_hash)
        {
            state.queue.push_back(file_hash.clone());
            newly_queued.push(file_hash);
        }
    }

    let should_start = !state.worker_running && !state.queue.is_empty();
    if should_start {
        state.worker_running = true;
    }
    drop(state);

    for hash in &newly_queued {
        let _ = library_db::analysis_queue_upsert_row(hash, "queued", None, None);
    }

    if should_start {
        spawn_worker();
    }

    newly_queued.len()
}

pub(crate) fn enqueue_one(file_hash: &str) {
    enqueue_hashes(vec![file_hash.to_string()], false);
}

pub fn enqueue(target: SongTarget) -> Result<usize, String> {
    let (hashes, skip_persisted) = match target {
        SongTarget::Hashes { hashes } => (hashes, false),
        SongTarget::Filter { filters } => (
            library_db::iter_file_hashes_filtered_not_analyzed(&filters)
                .map_err(|e| e.to_string())?,
            true,
        ),
    };
    Ok(enqueue_hashes(hashes, skip_persisted))
}

pub fn cancel_analysis(target: SongTarget) -> Result<usize, String> {
    let hashes = resolve_target(target, library_db::iter_file_hashes_filtered_analysis_busy)?;
    let persisted = AnalysisQueue::load();
    let has_active_row = persisted
        .entries
        .values()
        .any(|status| matches!(status, QueuedStatus::Analyzing(_)));
    let mut state = lock_unpoisoned(&ANALYZER);
    let mut affected = Vec::new();
    let mut interrupt = false;

    for hash in hashes {
        let persisted_busy = persisted.entries.get(&hash).is_some_and(|status| {
            matches!(status, QueuedStatus::Queued | QueuedStatus::Analyzing(_))
        });
        let active =
            state.active_hash.as_deref() == Some(&hash) && (persisted_busy || has_active_row);
        let queued = state.queue.iter().any(|queued_hash| queued_hash == &hash);

        if !persisted_busy && !active && !queued {
            continue;
        }

        state.queue.retain(|queued_hash| queued_hash != &hash);
        let persisted_analyzing = matches!(
            persisted.entries.get(&hash),
            Some(QueuedStatus::Analyzing(_))
        );
        if active || persisted_analyzing {
            state.cancelled.insert(hash.clone());
        }
        if persisted_analyzing || (active && has_active_row) {
            interrupt = true;
        }
        affected.push(hash);
    }
    drop(state);

    for hash in &affected {
        remove_from_queue(hash);
        lock_unpoisoned(&FORCE_TRANSCRIBE).remove(hash);
        lock_unpoisoned(&STEMS_ONLY).remove(hash);
    }

    if interrupt && let Some(stream) = lock_unpoisoned(&SERVER_INTERRUPT).as_ref() {
        let _ = stream.shutdown(Shutdown::Both);
    }

    Ok(affected.len())
}

pub fn shutdown_server() {
    let pid = SERVER_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        info!("[analyzer] Graceful shutdown of server (pid={pid})");
        if let Ok(mut guard) = ANALYZER_SERVER.try_lock()
            && let Some(server) = guard.as_mut()
        {
            let _ = server.writer.write_all(b"{\"type\":\"quit\"}\n");
            let _ = server.writer.flush();
        }
        std::thread::spawn(move || {
            let _ = Command::new("kill").args([&pid.to_string()]).status();
            std::thread::sleep(Duration::from_secs(3));
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
        });
    }
}

fn delete_cache_one(file_hash: &str) -> bool {
    if is_usdx_song(file_hash) {
        return false;
    }
    let cache = CacheDir::new();
    cache.delete_song_cache(file_hash);
    update_song_analyzed(file_hash, false, None, None, None, None);
    true
}

pub fn delete_cache(target: SongTarget) -> Result<usize, String> {
    run_for_target(
        target,
        library_db::iter_file_hashes_filtered_full_reanalyzable,
        |hash| Ok(delete_cache_one(hash)),
    )
}

fn reanalyze_transcript_one(file_hash: &str, language: Option<String>) -> bool {
    if is_usdx_song(file_hash) {
        return false;
    }

    if let Some(lang) = language
        && !lang.is_empty()
    {
        let mut config = AppConfig::load();
        config.set_language_override(file_hash.to_string(), lang);
        config.save();
    }
    reanalyze(file_hash, false);
    true
}

pub fn reanalyze_transcript(target: SongTarget, language: Option<String>) -> Result<usize, String> {
    run_for_target(
        target,
        library_db::iter_file_hashes_filtered_realignable,
        |hash| Ok(reanalyze_transcript_one(hash, language.clone())),
    )
}

fn reanalyze_full_one(file_hash: &str) -> bool {
    if is_usdx_song(file_hash) {
        return false;
    }

    reanalyze(file_hash, true);
    true
}

pub fn reanalyze_full(target: SongTarget) -> Result<usize, String> {
    run_for_target(
        target,
        library_db::iter_file_hashes_filtered_full_reanalyzable,
        |hash| Ok(reanalyze_full_one(hash)),
    )
}

fn realign_one(file_hash: &str, language: Option<String>) -> bool {
    if is_usdx_song(file_hash) {
        return false;
    }

    if let Some(lang) = language.as_ref().filter(|lang| !lang.is_empty()) {
        let mut config = AppConfig::load();
        config.set_language_override(file_hash.to_string(), lang.clone());
        config.save();
    }

    let cache = CacheDir::new();
    let previous_language = library_db::load_song_by_hash(file_hash)
        .ok()
        .flatten()
        .and_then(|song| song.language);
    materialize_lyrics_from_transcript(&cache, file_hash);
    let _ = std::fs::remove_file(cache.transcript_path(file_hash));
    cache.delete_transcript_variants(file_hash);
    update_song_analyzed(
        file_hash,
        false,
        language.or(previous_language),
        None,
        None,
        None,
    );
    enqueue_one(file_hash);
    true
}

pub fn realign(target: SongTarget, language: Option<String>) -> Result<usize, String> {
    run_for_target(
        target,
        library_db::iter_file_hashes_filtered_realignable,
        |hash| Ok(realign_one(hash, language.clone())),
    )
}

fn reanalyze_force_transcribe_one(file_hash: &str) -> bool {
    if is_usdx_song(file_hash) {
        return false;
    }

    lock_unpoisoned(&FORCE_TRANSCRIBE).insert(file_hash.to_string());

    reanalyze(file_hash, false);
    true
}

pub fn reanalyze_force_transcribe(target: SongTarget) -> Result<usize, String> {
    run_for_target(
        target,
        library_db::iter_file_hashes_filtered_realignable,
        |hash| Ok(reanalyze_force_transcribe_one(hash)),
    )
}

// Refresh metadata such as artist and cover art without touching analysis-derived fields.
fn refresh_metadata_one(
    file_hash: &str,
    source: &dyn MediaSource,
    cache: &CacheDir,
) -> Result<bool, String> {
    let Some(mut song) = library_db::load_song_by_hash(file_hash).map_err(|e| e.to_string())?
    else {
        return Ok(false);
    };
    if song.usdx.is_some() {
        return Ok(false);
    }
    source
        .refresh_metadata(&mut song, cache)
        .map_err(|e| e.to_string())?;
    library_db::update_song_fields(file_hash, &song).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn refresh_metadata(target: SongTarget) -> Result<usize, String> {
    let source = active_source()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no active library source".to_string())?;
    let cache = CacheDir::new();
    run_for_target(
        target,
        library_db::iter_file_hashes_filtered_refreshable,
        |hash| refresh_metadata_one(hash, source.as_ref(), &cache),
    )
}

fn reanalyze(file_hash: &str, full: bool) {
    let cache = CacheDir::new();
    if full {
        cache.delete_song_cache(file_hash);
    } else {
        let _ = std::fs::remove_file(cache.transcript_path(file_hash));
        cache.delete_transcript_variants(file_hash);
        let _ = std::fs::remove_file(cache.lyrics_path(file_hash));
    }
    update_song_analyzed(file_hash, false, None, None, None, None);
    enqueue_one(file_hash);
}

fn materialize_lyrics_from_transcript(cache: &CacheDir, file_hash: &str) {
    if cache.lyrics_path(file_hash).is_file() {
        return;
    }

    let transcript_path = cache.transcript_path(file_hash);
    let Ok(data) = std::fs::read_to_string(&transcript_path) else {
        return;
    };

    #[derive(Deserialize)]
    struct Segment {
        #[serde(default)]
        text: String,
    }

    #[derive(Deserialize)]
    struct TranscriptShape {
        #[serde(default)]
        segments: Vec<Segment>,
    }

    let Ok(parsed) = serde_json::from_str::<TranscriptShape>(&data) else {
        return;
    };

    let lines: Vec<String> = parsed
        .segments
        .into_iter()
        .map(|s| s.text.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        return;
    }

    if let Err(e) = write_lyrics_file(cache, file_hash, &lines) {
        warn!("[analyzer] Failed to materialize lyrics from transcript for {file_hash}: {e}");
    }
}

// ─── Worker ──────────────────────────────────────────────────────────

fn spawn_worker() {
    std::thread::spawn(|| {
        let cache = CacheDir::new();

        loop {
            let file_hash = {
                let mut state = lock_unpoisoned(&ANALYZER);
                match state.queue.pop_front() {
                    Some(hash) => {
                        state.active_hash = Some(hash.clone());
                        hash
                    }
                    None => {
                        state.worker_running = false;
                        state.active_hash = None;
                        return;
                    }
                }
            };

            process_song(&file_hash, &cache);

            let mut state = lock_unpoisoned(&ANALYZER);
            state.active_hash = None;
        }
    });
}

fn process_song(initial_hash: &str, cache: &CacheDir) {
    let Some(song) = library_db::load_song_by_hash(initial_hash).ok().flatten() else {
        if !discard_cancelled_job(initial_hash, initial_hash) {
            warn!("[analyzer] Song with hash {initial_hash} not found in store, skipping");
        }
        return;
    };

    let (song, local_path, file_hash_owned) = match prepare_audio_for_analysis(&song, cache) {
        Ok(out) => out,
        Err(e) => {
            if !discard_cancelled_job(initial_hash, initial_hash) {
                warn!("[analyzer] Failed to prepare audio for analysis: {e}");
                update_queue_status(
                    initial_hash,
                    QueuedStatus::Failed(format!("audio prep failed: {e}")),
                );
            }
            return;
        }
    };
    let file_hash = file_hash_owned.as_str();

    if discard_cancelled_job(initial_hash, file_hash) {
        return;
    }

    info!(
        "[analyzer] Starting analysis: {} (hash={})",
        local_path.display(),
        file_hash
    );

    update_queue_status(file_hash, QueuedStatus::Analyzing(0));

    // Stems-only: keep the LRC-provided transcript and just separate stems.
    // The intent may have been keyed by the pre-rekey hash for remote songs.
    let stems_only = {
        let mut set = lock_unpoisoned(&STEMS_ONLY);
        set.remove(file_hash) || set.remove(initial_hash)
    };
    if stems_only && file_hash != initial_hash {
        // Move the pre-written transcript to the rekeyed hash so the pass can
        // patch it in place.
        let _ = std::fs::rename(
            cache.transcript_path(initial_hash),
            cache.transcript_path(file_hash),
        );
    }

    let config = AppConfig::load();
    let skip_lrclib = stems_only || lock_unpoisoned(&FORCE_TRANSCRIBE).remove(file_hash);
    let lyrics_path = if skip_lrclib {
        None
    } else {
        fetch_lrclib_lyrics(&song, cache)
    };

    let mut cmd_json = serde_json::json!({
        "type": "analyze",
        "audio_path": local_path.to_string_lossy(),
        "cache_path": cache.path.to_string_lossy(),
        "hash": file_hash,
        "model": config.whisper_model(),
        "beam_size": config.beam_size(),
        "batch_size": config.batch_size(),
        "separator": config.separator(),
        "engine": config.asr_engine(),
        "align_backend": config.align_backend(),
        "vocal_detection_threshold_pct": config.vocal_detection_threshold_pct(),
    });

    if stems_only {
        cmd_json["skip_transcription"] = serde_json::json!(true);
    }

    if let Some(ref lp) = lyrics_path {
        cmd_json["lyrics"] = serde_json::json!(lp.to_string_lossy());
    }
    let language_hint = config
        .language_override(file_hash)
        .map(str::to_string)
        .or_else(|| lyrics_path.as_ref().and_then(|_| song.language.clone()))
        .filter(|lang| {
            // "unknown"/empty is not a real language: passing it as a forced
            // alignment language crashes whisperx, so let the worker detect it.
            let normalized = lang.trim().to_ascii_lowercase();
            !normalized.is_empty() && normalized != "unknown" && normalized != "und"
        });
    if let Some(lang) = language_hint {
        cmd_json["language"] = serde_json::json!(lang);
    }

    if discard_cancelled_job(initial_hash, file_hash) {
        return;
    }

    let json_str = match serde_json::to_string(&cmd_json) {
        Ok(json) => json,
        Err(error) => {
            if !discard_cancelled_job(initial_hash, file_hash) {
                update_queue_status(file_hash, QueuedStatus::Failed(error.to_string()));
            }
            return;
        }
    };
    let mut retried = false;

    loop {
        let mut guard = lock_unpoisoned(&ANALYZER_SERVER);

        if let Err(e) = ensure_server(&mut guard) {
            if !discard_cancelled_job(initial_hash, file_hash) {
                warn!("[analyzer] Failed to start server: {e}");
                update_queue_status(file_hash, QueuedStatus::Failed(e.to_string()));
            }
            return;
        }

        if discard_cancelled_job(initial_hash, file_hash) {
            *guard = None;
            return;
        }

        let Some(server) = guard.as_mut() else {
            update_queue_status(
                file_hash,
                QueuedStatus::Failed("analyzer server unavailable".into()),
            );
            return;
        };
        match send_and_monitor(server, &json_str, Some(file_hash), Some(initial_hash)) {
            Ok(SongResult::Done) => {
                let mut state = lock_unpoisoned(&ANALYZER);
                let cancelled =
                    state.cancelled.remove(initial_hash) | state.cancelled.remove(file_hash);
                if cancelled {
                    drop(state);
                    remove_from_queue(initial_hash);
                    remove_from_queue(file_hash);
                    lock_unpoisoned(&FORCE_TRANSCRIBE).remove(initial_hash);
                    lock_unpoisoned(&FORCE_TRANSCRIBE).remove(file_hash);
                    lock_unpoisoned(&STEMS_ONLY).remove(initial_hash);
                    lock_unpoisoned(&STEMS_ONLY).remove(file_hash);
                    *guard = None;
                } else {
                    finalize_song(file_hash, cache);
                }
                return;
            }
            Ok(SongResult::Cancelled) => {
                let _ = discard_cancelled_job(initial_hash, file_hash);
                *guard = None;
                return;
            }
            Ok(SongResult::Oom) => {
                warn!("[analyzer] CUDA OOM, killing server to free GPU memory");
                *guard = None;

                if !retried {
                    retried = true;
                    info!("[analyzer] Respawning server and retrying with clean GPU");
                    update_queue_status(file_hash, QueuedStatus::Analyzing(0));
                    continue;
                }
                update_queue_status(file_hash, QueuedStatus::Failed("CUDA out of memory".into()));
                return;
            }
            Ok(SongResult::Error(msg)) => {
                update_queue_status(file_hash, QueuedStatus::Failed(msg));
                return;
            }
            Err(e) => {
                if discard_cancelled_job(initial_hash, file_hash) {
                    *guard = None;
                    return;
                }

                warn!("[analyzer] Server crashed: {e}");
                *guard = None;

                if !retried {
                    retried = true;
                    info!("[analyzer] Respawning server and retrying");
                    update_queue_status(file_hash, QueuedStatus::Analyzing(0));
                    continue;
                }
                update_queue_status(
                    file_hash,
                    QueuedStatus::Failed(format!("Server crashed: {e}")),
                );
                return;
            }
        }
    }
}

fn finalize_song(file_hash: &str, cache: &CacheDir) {
    if cache.transcript_exists(file_hash) {
        if let Err(err) = crate::playback::ensure_playable_source_video(file_hash) {
            warn!("[analyzer] Playable source-video conversion failed for {file_hash}: {err}");
        }
        let meta = read_transcript_meta(cache, file_hash);
        remove_from_queue(file_hash);
        update_song_analyzed(
            file_hash,
            true,
            meta.language,
            Some(meta.source),
            meta.key,
            Some(meta.tempo),
        );
        info!("[analyzer] Analysis complete for {file_hash}");
    } else {
        update_queue_status(
            file_hash,
            QueuedStatus::Failed("Transcript file not found after analysis".into()),
        );
    }
}

// ─── LRC (play-original) preparation ─────────────────────────────────

/// Prepare an LRC-provided song that plays over its original mix, without
/// routing it through the analysis status queue.
///
/// The analyzer-free work runs synchronously so the song is immediately
/// playable: materialize the audio, rekey remote rows to the content hash, and
/// mark the song ready (source=Lrc, no_stems). None of this touches the
/// analyzer server, so it never stalls behind a running analysis.
///
/// The musical key is then detected on a background thread (which contends on
/// the analyzer server) and patched in once it lands, so the key/tempo controls
/// unlock later without blocking playback.
pub(crate) fn prepare_lrc_no_stems(file_hash: &str) -> Result<(), NightingaleError> {
    let cache = CacheDir::new();
    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Err(NightingaleError::Other("Song not found".into()));
    };

    // Materialize the audio and, for remote sources, rekey the row to the
    // content hash so all downstream cache files follow the usual layout.
    let (mut song, local_path, real_hash) = prepare_audio_for_analysis(&song, &cache)?;
    let real_hash = real_hash.to_string();

    // A rekey moves the row — carry the transcript we wrote under the original
    // hash across so the key pass can patch it in place.
    if real_hash != file_hash {
        let _ = std::fs::rename(
            cache.transcript_path(file_hash),
            cache.transcript_path(&real_hash),
        );
    }

    // Mark ready right away (key still unknown) so playback over the original
    // mix is available immediately, before the key detection runs.
    song.is_analyzed = true;
    song.transcript_source = Some(TranscriptSource::Lrc);
    song.key = None;
    song.override_key = None;
    song.tempo = 1.0;
    song.key_offset = 0;
    song.no_stems = true;
    library_db::update_song_fields(&real_hash, &song)
        .map_err(|e| NightingaleError::Other(e.to_string()))?;
    let _ = crate::playback::ensure_playable_source_video(&real_hash);

    // Detect the key off-queue in the background; patch it onto the row once it
    // lands so the key/tempo shift controls unlock without blocking playback.
    std::thread::spawn(move || {
        let cache = CacheDir::new();
        if let Err(e) = run_key_pass(&cache, &local_path, &real_hash) {
            warn!("[analyzer] LRC key detection failed for {real_hash}: {e}");
            return;
        }
        let meta = read_transcript_meta(&cache, &real_hash);
        if let Some(mut updated) = library_db::load_song_by_hash(&real_hash).ok().flatten() {
            updated.key = meta.key;
            let _ = library_db::update_song_fields(&real_hash, &updated);
        }
        info!("[analyzer] LRC key detection complete for {real_hash}");
    });
    Ok(())
}

/// Run a key-only analysis pass (no transcription, no stem separation) against
/// the running analyzer server, keeping it off the status queue. On success the
/// detected key is patched into the existing transcript by the pipeline.
fn run_key_pass(
    cache: &CacheDir,
    local_path: &Path,
    file_hash: &str,
) -> Result<(), NightingaleError> {
    let config = AppConfig::load();
    let cmd_json = serde_json::json!({
        "type": "analyze",
        "audio_path": local_path.to_string_lossy(),
        "cache_path": cache.path.to_string_lossy(),
        "hash": file_hash,
        "model": config.whisper_model(),
        "beam_size": config.beam_size(),
        "batch_size": config.batch_size(),
        "separator": config.separator(),
        "engine": config.asr_engine(),
        "align_backend": config.align_backend(),
        "vocal_detection_threshold_pct": config.vocal_detection_threshold_pct(),
        // Key only: keep the provided LRC transcript and the original mix.
        "skip_transcription": true,
        "skip_separation": true,
    });
    let json_str = serde_json::to_string(&cmd_json)?;

    let mut retried = false;
    loop {
        let mut guard = lock_unpoisoned(&ANALYZER_SERVER);
        ensure_server(&mut guard)?;
        let server = guard
            .as_mut()
            .ok_or_else(|| NightingaleError::Other("analyzer server unavailable".into()))?;
        // `None` progress hash keeps this off the status pipe (no queue rows).
        match send_and_monitor(server, &json_str, None, None) {
            Ok(SongResult::Done) => return Ok(()),
            Ok(SongResult::Cancelled) => {
                return Err(NightingaleError::Other("key detection cancelled".into()));
            }
            Ok(SongResult::Oom) | Err(_) => {
                *guard = None;
                if !retried {
                    retried = true;
                    continue;
                }
                return Err(NightingaleError::Other("key detection failed".into()));
            }
            Ok(SongResult::Error(msg)) => {
                return Err(NightingaleError::Other(msg));
            }
        }
    }
}

// ─── Audio materialization for non-local sources ─────────────────────

/// Make sure the song's audio is present on disk and the row is keyed by the
/// true Blake3 hash before analysis kicks off. For `LocalFile` songs this is a
/// no-op. For Jellyfin songs we download once into `cache/sources/<hash>.<ext>`
/// then rekey the DB row + analysis queue from the placeholder id-hash to the
/// content hash so all downstream cache files (`<hash>_instrumental.mp3` etc.)
/// follow the existing convention.
fn prepare_audio_for_analysis(
    song: &Song,
    cache: &CacheDir,
) -> Result<(Song, PathBuf, String), NightingaleError> {
    match &song.origin {
        SongOrigin::LocalFile => Ok((song.clone(), song.path.clone(), song.file_hash.clone())),
        // Both remote origins go through the active source's
        // `ensure_local_media` and then get rekeyed to the true Blake3 hash.
        SongOrigin::Jellyfin { .. } | SongOrigin::Navidrome { .. } | SongOrigin::Plex { .. } => {
            let source = active_source()?
                .ok_or_else(|| NightingaleError::Other("no active library source".into()))?;
            let downloaded_path = source.ensure_local_media(song, cache)?;

            let real_hash = compute_file_hash(&downloaded_path)?;
            if real_hash == song.file_hash {
                return Ok((song.clone(), downloaded_path, song.file_hash.clone()));
            }

            let ext = downloaded_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("bin");
            let new_source_path = cache
                .path
                .join("sources")
                .join(format!("{real_hash}.{ext}"));

            if new_source_path != downloaded_path {
                if let Some(parent) = new_source_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if new_source_path.is_file() {
                    let _ = std::fs::remove_file(&downloaded_path);
                } else {
                    std::fs::rename(&downloaded_path, &new_source_path)?;
                }
            }

            let mut updated = song.clone();
            updated.file_hash = real_hash.clone();
            updated.path = new_source_path.clone();

            library_db::rekey_song(&song.file_hash, &real_hash, &updated).map_err(|e| {
                NightingaleError::Other(format!("failed to rekey remote song: {e}"))
            })?;

            Ok((updated, new_source_path, real_hash))
        }
    }
}

// ─── Server communication ────────────────────────────────────────────

enum SongResult {
    Done,
    Cancelled,
    Oom,
    Error(String),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerEvent {
    Progress {
        pct: u32,
        #[serde(default)]
        msg: String,
    },
    Done,
    Error {
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        msg: String,
    },
    #[serde(other)]
    Unknown,
}

fn send_and_monitor(
    server: &mut ServerProcess,
    json_cmd: &str,
    progress_hash: Option<&str>,
    initial_hash: Option<&str>,
) -> Result<SongResult, NightingaleError> {
    server.writer.write_all(json_cmd.as_bytes())?;
    server.writer.write_all(b"\n")?;
    server.writer.flush()?;

    let mut line_buf = String::new();
    loop {
        if progress_hash.is_some_and(|hash| {
            let state = lock_unpoisoned(&ANALYZER);
            state.cancelled.contains(hash)
                || initial_hash.is_some_and(|initial| state.cancelled.contains(initial))
        }) {
            return Ok(SongResult::Cancelled);
        }

        line_buf.clear();
        let bytes = server.reader.read_line(&mut line_buf)?;

        if bytes == 0 {
            return Err("Server closed connection unexpectedly".into());
        }

        if progress_hash.is_some_and(|hash| {
            let state = lock_unpoisoned(&ANALYZER);
            state.cancelled.contains(hash)
                || initial_hash.is_some_and(|initial| state.cancelled.contains(initial))
        }) {
            return Ok(SongResult::Cancelled);
        }

        let line = line_buf.trim();
        if line.is_empty() {
            continue;
        }

        let event: ServerEvent = match serde_json::from_str(line) {
            Ok(ev) => ev,
            Err(e) => {
                warn!("[analyzer] Skipping unparseable event: {e}; line={line:?}");
                continue;
            }
        };

        match event {
            ServerEvent::Progress { pct, msg } => {
                if !msg.is_empty() {
                    info!("[analyzer] progress {pct}% {msg}");
                }
                if let Some(hash) = progress_hash {
                    update_queue_status(hash, QueuedStatus::Analyzing(pct as usize));
                }
            }
            ServerEvent::Done => return Ok(SongResult::Done),
            ServerEvent::Error { kind, msg } => {
                let kind_s = kind.as_deref().unwrap_or("generic");
                if kind_s == "oom" {
                    return Ok(SongResult::Oom);
                }
                let msg = if msg.is_empty() {
                    "Unknown error".to_string()
                } else {
                    msg
                };
                return Ok(SongResult::Error(msg));
            }
            ServerEvent::Unknown => {
                warn!("[analyzer] Ignoring unknown event: {line}");
            }
        }
    }
}
