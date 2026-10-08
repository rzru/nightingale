use app_core::DownloadProgress;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct DownloadProgressEvent {
    received: u64,
    total: Option<u64>,
}

#[derive(Clone, Serialize)]
struct DownloadDoneEvent {
    ok: bool,
    path: Option<String>,
    error: Option<String>,
}

/// Download a song (a `.nge` bundle or audio file) from `url` into the library
/// folder on a worker thread, emitting `download-progress` as it goes and
/// `download-done` at the end. Driven by the `nightingale://` deep link after
/// the UI has (optionally) confirmed the host.
#[tauri::command]
pub(crate) fn download_song(app: AppHandle, url: String, title: Option<String>) {
    std::thread::spawn(move || {
        let progress_app = app.clone();
        let result = app_core::download_song_to_library(
            &url,
            title.as_deref(),
            move |p: DownloadProgress| {
                let _ = progress_app.emit(
                    "download-progress",
                    DownloadProgressEvent {
                        received: p.received,
                        total: p.total,
                    },
                );
            },
        );

        let payload = match result {
            Ok(path) => DownloadDoneEvent {
                ok: true,
                path: Some(path.to_string_lossy().into_owned()),
                error: None,
            },
            Err(e) => DownloadDoneEvent {
                ok: false,
                path: None,
                error: Some(e.to_string()),
            },
        };
        let _ = app.emit("download-done", payload);
    });
}
