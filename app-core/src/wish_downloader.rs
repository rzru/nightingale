//! Background queue that downloads missing wishes with yt-dlp.
//!
//! One download runs at a time (YouTube throttles parallel fetches from one
//! address, and the analyzer is the real bottleneck anyway). Files land in
//! `<music folder>/YouTube/`; a library scan after the batch — and every
//! [`RESCAN_EVERY`] files during long batches — adds them to the library, and
//! the scan's wish refresh links them and queues their analysis.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::config::{AppConfig, LibrarySource};
use crate::error::NightingaleError;
use crate::{library_db, scanner, ytdlp};

/// Sub-folder of the music folder that receives downloads.
const DOWNLOAD_SUBFOLDER: &str = "YouTube";
const RESCAN_EVERY: usize = 10;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DownloaderStatus {
    pub running: bool,
    /// yt-dlp is being installed or updated before the batch starts.
    pub installing_tools: bool,
    pub queued: u32,
    #[ts(type = "number | null")]
    pub current_wish_id: Option<i64>,
    /// 0–100 for the current download, when yt-dlp reports it.
    pub current_progress: Option<f64>,
    /// Why the last batch stopped early (tool install failure, …).
    pub last_error: Option<String>,
}

struct State {
    queue: VecDeque<i64>,
    running: bool,
    installing: bool,
    current: Option<i64>,
    progress: Option<f64>,
    cancel: bool,
    last_error: Option<String>,
}

static STATE: Mutex<State> = Mutex::new(State {
    queue: VecDeque::new(),
    running: false,
    installing: false,
    current: None,
    progress: None,
    cancel: false,
    last_error: None,
});

fn state() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Where downloads go. Only a folder library can receive files: Plex,
/// Jellyfin and Navidrome libraries live on a server Nightingale does not
/// write to.
pub(crate) fn download_dir() -> Result<PathBuf, NightingaleError> {
    match AppConfig::load().library_source {
        Some(LibrarySource::Folder { path }) => Ok(path.join(DOWNLOAD_SUBFOLDER)),
        _ => Err(NightingaleError::from(
            "downloading songs needs a local folder library: choose a music folder as the \
             library source",
        )),
    }
}

/// Queue wishes for download and start the worker if needed. Returns how
/// many were newly queued.
pub(crate) fn enqueue(ids: &[i64]) -> Result<usize, NightingaleError> {
    if ids.is_empty() {
        return Ok(0);
    }
    download_dir()?;

    // Mark first, queue second: a running worker must never pick up a wish
    // whose `downloading` status has not been written yet.
    let candidates: Vec<i64> = {
        let state = state();
        ids.iter()
            .copied()
            .filter(|id| state.current != Some(*id) && !state.queue.contains(id))
            .collect()
    };
    for &id in &candidates {
        library_db::set_wish_status(id, "downloading")?;
    }

    let (added, spawn) = {
        let mut state = state();
        state.cancel = false;
        let mut added = 0usize;
        for &id in &candidates {
            if state.current != Some(id) && !state.queue.contains(&id) {
                state.queue.push_back(id);
                added += 1;
            }
        }
        let spawn = !state.running && !state.queue.is_empty();
        if spawn {
            state.running = true;
            state.last_error = None;
        }
        (added, spawn)
    };

    if spawn
        && let Err(error) = thread::Builder::new()
            .name("wish-downloader".into())
            .spawn(worker)
    {
        state().running = false;
        return Err(NightingaleError::Other(format!(
            "failed to start the download worker: {error}"
        )));
    }
    Ok(added)
}

/// Stop the current download and drop the queue. Returns how many queued
/// wishes went back to `missing`.
pub fn cancel_downloads() -> u32 {
    let dropped: Vec<i64> = {
        let mut state = state();
        if state.running {
            state.cancel = true;
        }
        state.queue.drain(..).collect()
    };
    for &id in &dropped {
        let _ = library_db::set_wish_status(id, "missing");
    }
    u32::try_from(dropped.len()).unwrap_or(u32::MAX)
}

pub fn downloader_status() -> DownloaderStatus {
    let state = state();
    DownloaderStatus {
        running: state.running,
        installing_tools: state.installing,
        queued: u32::try_from(state.queue.len()).unwrap_or(u32::MAX),
        current_wish_id: state.current,
        current_progress: state.progress,
        last_error: state.last_error.clone(),
    }
}

fn worker() {
    state().installing = true;
    let tools = ytdlp::ensure_installed();
    state().installing = false;
    if let Err(error) = tools {
        tracing::warn!("[downloader] yt-dlp unavailable: {error}");
        let dropped: Vec<i64> = {
            let mut state = state();
            state.running = false;
            state.last_error = Some(error.clone());
            state.queue.drain(..).collect()
        };
        for id in dropped {
            let _ = library_db::set_wish_failed(id, &error);
        }
        return;
    }

    let mut since_scan = 0usize;
    let mut downloaded_any = false;
    loop {
        let next = {
            let mut state = state();
            if state.cancel {
                state.cancel = false;
                state.queue.clear();
            }
            let next = state.queue.pop_front();
            state.current = next;
            state.progress = None;
            if next.is_none() {
                state.running = false;
            }
            next
        };
        let Some(id) = next else {
            break;
        };

        match download_one(id) {
            Ok(path) => {
                let _ = library_db::set_wish_downloaded(id, &path.to_string_lossy());
                since_scan += 1;
                downloaded_any = true;
            }
            Err(error) if error == ytdlp::CANCELLED => {
                let _ = library_db::set_wish_status(id, "missing");
            }
            Err(error) => {
                tracing::warn!("[downloader] wish {id} failed: {error}");
                let _ = library_db::set_wish_failed(id, &error);
            }
        }
        {
            let mut state = state();
            state.current = None;
            state.progress = None;
        }
        if since_scan >= RESCAN_EVERY {
            scanner::start_scan();
            since_scan = 0;
        }
    }

    if downloaded_any {
        scanner::start_scan();
    }
}

fn download_one(id: i64) -> Result<PathBuf, String> {
    let row = library_db::load_wish_by_id(id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "this wish no longer exists".to_string())?;

    // Already fetched (e.g. a scan never picked it up): reuse the file.
    if let Some(existing) = row
        .downloaded_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        return Ok(existing);
    }

    let dir = download_dir().map_err(|error| error.to_string())?;
    let base_name = ytdlp::sanitize_file_name(&format!(
        "{} - {} [{}]",
        row.artist, row.title, row.external_id
    ));
    let path = ytdlp::download_audio(
        &row.source_url,
        &dir,
        &base_name,
        |percent| state().progress = Some(percent),
        || state().cancel,
    )?;
    write_tags(&path, &row.artist, &row.title);
    Ok(path)
}

/// Replace the raw video title / channel that `--embed-metadata` wrote with
/// the cleaned artist and title, so the library lists the song properly.
/// Failure only costs cosmetics: the wish is linked by path, not by tags.
fn write_tags(path: &Path, artist: &str, title: &str) {
    if let Err(error) = try_write_tags(path, artist, title) {
        tracing::warn!("[downloader] could not tag {}: {error}", path.display());
    }
}

fn try_write_tags(path: &Path, artist: &str, title: &str) -> Result<(), lofty::error::LoftyError> {
    use lofty::config::WriteOptions;
    use lofty::file::TaggedFileExt;
    use lofty::tag::{Accessor, Tag, TagExt};

    let mut tagged = lofty::read_from_path(path)?;
    if tagged.primary_tag().is_none() {
        let tag_type = tagged.primary_tag_type();
        let _ = tagged.insert_tag(Tag::new(tag_type));
    }
    let Some(tag) = tagged.primary_tag_mut() else {
        return Ok(());
    };
    if !artist.trim().is_empty() {
        tag.set_artist(artist.trim().to_owned());
    }
    if !title.trim().is_empty() {
        tag.set_title(title.trim().to_owned());
    }
    tag.save_to_path(path, WriteOptions::default())
}
