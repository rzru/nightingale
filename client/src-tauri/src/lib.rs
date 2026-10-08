mod backgrounds;
mod download;
mod logging;
mod microphones;
mod nge_export;

use std::{path::Path, sync::Arc};

use app_api::{CommandRuntime, CommandState};
use app_core::{AppConfig, SongsStore};
use backgrounds::import_custom_background;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use download::download_song;
use microphones::{list_microphones, set_monitor_gain, start_mic_capture, stop_mic_capture};
use nge_export::{export_library_nge, export_song_nge};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Clone)]
struct DesktopRuntime(AppHandle);

impl CommandRuntime for DesktopRuntime {
    fn emit(&self, name: &str, payload: Value) {
        let _ = self.0.emit(name, payload);
    }

    fn set_monitor_gain(&self, gain: f32) {
        set_monitor_gain(gain);
    }

    fn allow_directory(&self, path: &Path) -> Result<(), String> {
        self.0
            .asset_protocol_scope()
            .allow_directory(path, true)
            .map_err(|error| format!("failed to allow asset protocol for {path:?}: {error}"))
    }
}

/// Bring the main window to the foreground (used when a `nightingale://` deep
/// link arrives and the app is already running).
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
async fn dispatch_command(
    state: tauri::State<'_, CommandState>,
    name: String,
    payload: Value,
) -> Result<Value, String> {
    app_api::dispatch(state.inner().clone(), &name, payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_media_endpoint() -> app_core::MediaEndpoint {
    app_core::media_server::endpoint()
}

#[tauri::command]
fn frontend_ready(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

/// True for native fullscreen or macOS "simple" fullscreen (`set_simple_fullscreen`), where
/// `isFullscreen()` stays false but the window fills the screen.
#[tauri::command]
fn window_immersive(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.is_fullscreen().map_err(|e| e.to_string())? {
        return Ok(true);
    }
    #[cfg(target_os = "macos")]
    {
        let inner = window.inner_size().map_err(|e| e.to_string())?;
        if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
            let ms = monitor.size();
            let dw = (inner.width as i32 - ms.width as i32).abs();
            let dh = (inner.height as i32 - ms.height as i32).abs();
            if dw <= 2 && dh <= 2 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// macOS simple fullscreen clears `Miniaturizable`; exit that mode before minimizing.
#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_simple_fullscreen(false);
    }
    window.minimize().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    tauri::Builder::default()
        // Single-instance must be registered first: when a second
        // `nightingale://` launch happens while the app is open, it forwards the
        // argv here instead of starting a new process. We pull the deep-link URL
        // out of argv, focus the window, and hand it to the frontend.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = argv.iter().find(|arg| arg.starts_with("nightingale://")) {
                focus_main_window(app);
                let _ = app.emit("deep-link-download", url.clone());
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            dispatch_command,
            frontend_ready,
            window_immersive,
            minimize_window,
            import_custom_background,
            get_media_endpoint,
            list_microphones,
            start_mic_capture,
            stop_mic_capture,
            export_song_nge,
            export_library_nge,
            download_song,
        ])
        .setup(|app| {
            let _ = dotenvy::dotenv();
            app.manage(CommandState::new(Arc::new(DesktopRuntime(
                app.handle().clone(),
            ))));
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            app_core::startup()?;
            app_core::media_server::start()?;
            let media_endpoint = app_core::media_server::endpoint();

            // Register the `nightingale://` scheme (needed in dev; the installer
            // registers it for release builds) and forward warm-start opens
            // (macOS Apple events, already-running on any OS) to the frontend.
            let _ = app.deep_link().register("nightingale");
            {
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        focus_main_window(&handle);
                        let _ = handle.emit("deep-link-download", url.to_string());
                    }
                });
            }
            // Cold start: the URL that launched the app (if any), handed to the
            // webview via the init script below.
            let initial_deep_link: Option<String> = app
                .deep_link()
                .get_current()
                .ok()
                .flatten()
                .and_then(|urls| urls.into_iter().next())
                .map(|url| url.to_string());

            let config = AppConfig::load();
            set_monitor_gain(config.mic_monitor_gain());
            app.handle()
                .asset_protocol_scope()
                .allow_directory(config.effective_data_path(), true)
                .map_err(|e| format!("failed to allow asset protocol for data path: {e}"))?;
            app.handle()
                .asset_protocol_scope()
                .allow_directory(app_core::default_nightingale_dir(), true)
                .map_err(|e| format!("failed to allow asset protocol for default path: {e}"))?;
            for root in app_core::cache_roots() {
                app.handle()
                    .asset_protocol_scope()
                    .allow_directory(root, true)
                    .map_err(|e| format!("failed to allow asset protocol for cache path: {e}"))?;
            }
            let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
            let b64 = B64.encode(json.as_bytes());

            let songs_meta = SongsStore::load_meta();
            let meta_json = serde_json::to_string(&songs_meta).map_err(|e| e.to_string())?;
            let meta_b64 = B64.encode(meta_json.as_bytes());

            let endpoint_json =
                serde_json::to_string(&media_endpoint).map_err(|e| e.to_string())?;
            let endpoint_b64 = B64.encode(endpoint_json.as_bytes());

            let deep_link_json =
                serde_json::to_string(&initial_deep_link).map_err(|e| e.to_string())?;
            let deep_link_b64 = B64.encode(deep_link_json.as_bytes());

            let init_script = format!(
                "window.__NIGHTINGALE_APP_CONFIG__ = JSON.parse(atob('{b64}')); \
                 window.__NIGHTINGALE_SONGS_META__ = JSON.parse(atob('{meta_b64}')); \
                 window.__NIGHTINGALE_MEDIA_ENDPOINT__ = JSON.parse(atob('{endpoint_b64}'));                  window.__NIGHTINGALE_INITIAL_DEEP_LINK__ = JSON.parse(atob('{deep_link_b64}'));",
            );

            let window_config = app
                .config()
                .app
                .windows
                .first()
                .ok_or_else(|| "tauri.conf.json must define at least one window".to_string())?;

            let window = WebviewWindowBuilder::from_config(app.handle(), window_config)
                .map_err(|e| e.to_string())?
                .initialization_script(init_script)
                .build()
                .map_err(|e| e.to_string())?;

            if config.fullscreen == Some(true) {
                let _ = window.set_simple_fullscreen(true);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let RunEvent::Exit = event {
                app_core::shutdown_server();
            }
        });
}
