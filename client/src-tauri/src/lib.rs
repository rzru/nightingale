mod backgrounds;
mod logging;
mod microphones;

use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

use app_api::{CommandRuntime, CommandState};
use app_core::{AppConfig, SongsStore, WindowState};
use backgrounds::import_custom_background;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use microphones::{
    list_microphones, set_mic_monitoring, set_monitor_gain, start_mic_capture, stop_mic_capture,
};
use serde_json::Value;
use server::{AppState as RemoteAppState, EventBus};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalSize, RunEvent, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

#[derive(Clone)]
struct DesktopRuntime {
    app: AppHandle,
    events: Arc<EventBus>,
}

/// Owns the LAN listener and the token phones present.
struct RemoteServer {
    commands: CommandState,
    events: Arc<EventBus>,
    control: Mutex<app_core::RemoteControl>,
    listener: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// Set when the listener could not bind, so the UI reports an unavailable
    /// link instead of showing a QR code no phone can open.
    failure: Mutex<Option<String>>,
}

impl RemoteServer {
    fn new(commands: CommandState, events: Arc<EventBus>) -> Self {
        Self {
            commands,
            events,
            control: Mutex::new(app_core::RemoteControl::load()),
            listener: Mutex::new(None),
            failure: Mutex::new(None),
        }
    }

    fn info(&self) -> app_core::RemoteInfo {
        if self
            .failure
            .lock()
            .map(|failure| failure.is_some())
            .unwrap_or(false)
        {
            return app_core::RemoteInfo {
                url: None,
                qr_svg: None,
            };
        }

        let control = self
            .control
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        control.info()
    }

    async fn start(&self) -> Result<(), String> {
        if self
            .listener
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some()
        {
            return Ok(());
        }

        let address = std::net::SocketAddr::from(([0, 0, 0, 0], app_core::REMOTE_PORT));
        let listener = match tokio::net::TcpListener::bind(address).await {
            Ok(listener) => listener,
            Err(error) => {
                let message = format!("cannot listen on port {}: {error}", app_core::REMOTE_PORT);
                *self
                    .failure
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(message.clone());
                return Err(message);
            }
        };

        let control = self
            .control
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        let state = RemoteAppState::new(
            self.commands.clone(),
            self.events.clone(),
            control,
            server::RemoteAddress::new(address, None),
            false,
            false,
        );

        tracing::info!(%address, "remote control listening");
        let handle = tauri::async_runtime::spawn(serve_remote(listener, state));
        *self
            .listener
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(handle);

        Ok(())
    }
}

async fn serve_remote(listener: tokio::net::TcpListener, state: RemoteAppState) {
    if let Err(error) =
        axum::serve(listener, server::remote_router(state).into_make_service()).await
    {
        tracing::error!("remote control server error: {error}");
    }
}

#[derive(Clone)]
struct TrackedWindowState {
    state: WindowState,
    latest_size: Option<PhysicalSize<u32>>,
}

#[derive(Default)]
struct WindowStates(Arc<Mutex<HashMap<String, TrackedWindowState>>>);

fn saved_window_state(config: &AppConfig, label: &str) -> WindowState {
    match label {
        "main" => config.desktop_window.clone(),
        "playback" => config.playback_window.clone(),
        _ => WindowState::default(),
    }
}

fn save_window_state(label: &str, state: WindowState) {
    let mut config = AppConfig::load();
    match label {
        "main" => config.desktop_window = state,
        "playback" => config.playback_window = state,
        _ => return,
    }
    config.save();
}

fn snapshot_window_state(
    states: &Arc<Mutex<HashMap<String, TrackedWindowState>>>,
    label: &str,
    maximized: bool,
) -> Option<WindowState> {
    let mut states = states.lock().ok()?;
    let tracked = states.get_mut(label)?;
    tracked.state.maximized = maximized;
    if !maximized {
        if let Some(size) = tracked.latest_size {
            tracked.state.width = Some(size.width);
            tracked.state.height = Some(size.height);
        }
    }
    Some(tracked.state.clone())
}

fn register_window_state(window: &WebviewWindow, state: WindowState) {
    let label = window.label().to_string();
    let states = window.state::<WindowStates>().inner().0.clone();
    if let Ok(mut states) = states.lock() {
        states.insert(
            label.clone(),
            TrackedWindowState {
                state,
                latest_size: None,
            },
        );
    }
    let app = window.app_handle().clone();
    let tracked_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(size) => {
            if let Ok(mut states) = states.lock() {
                if let Some(state) = states.get_mut(&label) {
                    state.latest_size = Some(*size);
                }
            }
        }
        WindowEvent::CloseRequested { .. } => {
            let maximized = tracked_window.is_maximized().unwrap_or(false);
            if let Some(state) = snapshot_window_state(&states, &label, maximized) {
                save_window_state(&label, state);
            }
        }
        WindowEvent::Destroyed if label == "main" => app.exit(0),
        _ => {}
    });
}

fn configure_window_state(window: &WebviewWindow, state: WindowState) {
    if let (Some(width), Some(height)) = (state.width, state.height) {
        let _ = window.set_size(PhysicalSize::new(width, height));
    }
    if state.maximized {
        let _ = window.maximize();
    }
    register_window_state(window, state);
}

fn save_open_window_states(app: &AppHandle) {
    let states = app.state::<WindowStates>().inner().0.clone();
    for (label, window) in app.webview_windows() {
        let maximized = window.is_maximized().unwrap_or(false);
        if let Some(state) = snapshot_window_state(&states, &label, maximized) {
            save_window_state(&label, state);
        }
    }
}

impl CommandRuntime for DesktopRuntime {
    fn emit(&self, name: &str, payload: Value) {
        let _ = self.app.emit(name, payload.clone());
        self.events.emit_value(name, payload);
    }

    fn set_monitor_gain(&self, gain: f32) {
        set_monitor_gain(gain);
    }

    fn allow_directory(&self, path: &Path) -> Result<(), String> {
        self.app
            .asset_protocol_scope()
            .allow_directory(path, true)
            .map_err(|error| format!("failed to allow asset protocol for {path:?}: {error}"))
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
fn remote_control_info(remote: tauri::State<'_, RemoteServer>) -> app_core::RemoteInfo {
    remote.info()
}

#[tauri::command]
fn frontend_ready(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

/// True for native fullscreen or macOS "simple" fullscreen (`set_simple_fullscreen`), where
/// `isFullscreen()` stays false but the window fills the screen.
#[tauri::command]
fn window_immersive(window: WebviewWindow) -> Result<bool, String> {
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
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_simple_fullscreen(false);
    }
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn load_window_state(label: String) -> Result<WindowState, String> {
    match label.as_str() {
        "main" | "playback" => Ok(saved_window_state(&AppConfig::load(), &label)),
        _ => Err("unsupported window label".into()),
    }
}

#[tauri::command]
fn track_window_state(app: AppHandle, label: String) -> Result<(), String> {
    if label != "main" && label != "playback" {
        return Err("unsupported window label".into());
    }
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "window not found".to_string())?;
    register_window_state(&window, saved_window_state(&AppConfig::load(), &label));
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            dispatch_command,
            frontend_ready,
            window_immersive,
            minimize_window,
            load_window_state,
            track_window_state,
            import_custom_background,
            get_media_endpoint,
            remote_control_info,
            list_microphones,
            start_mic_capture,
            set_mic_monitoring,
            stop_mic_capture,
        ])
        .setup(|app| {
            let _ = dotenvy::dotenv();
            let events = Arc::new(EventBus::new());
            let commands = CommandState::new(Arc::new(DesktopRuntime {
                app: app.handle().clone(),
                events: events.clone(),
            }));
            app.manage(commands.clone());
            app.manage(RemoteServer::new(commands, events));
            app.manage(WindowStates::default());
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            app_core::startup()?;
            app_core::media_server::start()?;
            let media_endpoint = app_core::media_server::endpoint();

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let remote = handle.state::<RemoteServer>();
                if let Err(error) = remote.start().await {
                    tracing::error!(%error, "failed to start remote control");
                }
            });

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

            let init_script = format!(
                "window.__NIGHTINGALE_APP_CONFIG__ = JSON.parse(atob('{b64}')); \
                 window.__NIGHTINGALE_SONGS_META__ = JSON.parse(atob('{meta_b64}')); \
                 window.__NIGHTINGALE_MEDIA_ENDPOINT__ = JSON.parse(atob('{endpoint_b64}'));",
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

            configure_window_state(&window, saved_window_state(&config, "main"));

            if config.fullscreen == Some(true) {
                let _ = window.set_simple_fullscreen(true);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } => save_open_window_states(app),
            RunEvent::Exit => app_core::shutdown_server(),
            _ => {}
        });
}
