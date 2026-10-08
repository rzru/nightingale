use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct LibraryExportDone {
    ok: bool,
    exported: usize,
    skipped: usize,
    failed: usize,
    error: Option<String>,
}

/// Export an analyzed local song to a shareable `.nge` bundle in `dest_dir`.
/// Returns the absolute path of the written file.
#[tauri::command]
pub(crate) fn export_song_nge(file_hash: String, dest_dir: String) -> Result<String, String> {
    app_core::export_song_nge(&file_hash, std::path::Path::new(&dest_dir))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// Export the whole library to `.nge` bundles in `dest_dir`. Runs on a worker
/// thread (a large library can take a while) and emits `library-export-done`
/// with the summary when finished.
#[tauri::command]
pub(crate) fn export_library_nge(app: AppHandle, dest_dir: String) {
    std::thread::spawn(move || {
        let payload = match app_core::export_library_nge(std::path::Path::new(&dest_dir)) {
            Ok(summary) => LibraryExportDone {
                ok: true,
                exported: summary.exported,
                skipped: summary.skipped,
                failed: summary.failed,
                error: None,
            },
            Err(e) => LibraryExportDone {
                ok: false,
                exported: 0,
                skipped: 0,
                failed: 0,
                error: Some(e.to_string()),
            },
        };
        let _ = app.emit("library-export-done", payload);
    });
}
