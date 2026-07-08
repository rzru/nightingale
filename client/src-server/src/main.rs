mod bootstrap;
mod commands;
mod events;
mod jukebox;
mod media;
mod state;
mod static_files;
mod ws;

use std::net::SocketAddr;

use axum::routing::{any, get, post};
use axum::Router;
use clap::Parser;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

#[derive(Debug, Parser)]
#[command(name = "server", about = "Nightingale self-hosted web server.")]
struct Args {
    /// Address to bind the HTTP/WS listener to.
    #[arg(long, env = "NIGHTINGALE_BIND", default_value = "0.0.0.0:8080")]
    bind: SocketAddr,

    /// Override the data folder. Equivalent to `NIGHTINGALE_DATA_PATH=...`.
    #[arg(long, env = "NIGHTINGALE_DATA_PATH")]
    data: Option<String>,

    /// Pin the library to a folder at this server-visible path. Equivalent to
    /// `NIGHTINGALE_LIBRARY_PATH=...`. When set, Nightingale configures a folder
    /// library source pointing here on startup, so the music folder never has to
    /// be picked in the browser (ideal for Docker / headless installs).
    #[arg(long, env = "NIGHTINGALE_LIBRARY_PATH")]
    library: Option<String>,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let args = Args::parse();

    if let Some(data) = args.data.as_deref() {
        // Setting at process start lets `app_core::default_nightingale_dir`
        // pick it up for both the config seed and every later `step_*` call.
        // Safety: must happen before any thread reads the env.
        unsafe { std::env::set_var("NIGHTINGALE_DATA_PATH", data) };
    }

    if let Some(library) = args.library.as_deref() {
        // Mirror the data path: persist to the env so `/api/bootstrap` can
        // report the library as env-pinned regardless of whether the value
        // arrived via `--library` or the env var.
        // Safety: must happen before any thread reads the env.
        unsafe { std::env::set_var("NIGHTINGALE_LIBRARY_PATH", library) };
    }

    let _ = dotenvy_quiet();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,server=info")),
        )
        .init();

    // Apply the configured proxy before any downloads run.
    app_core::apply_proxy_env(&app_core::AppConfig::load());

    if let Err(e) = app_core::startup() {
        tracing::error!("startup failed: {e}");
        std::process::exit(1);
    }

    if let Some(library) = args.library.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        pin_folder_library(library);
    }

    let state = AppState::new();

    let app = Router::new()
        .route("/api/bootstrap", get(bootstrap::handle))
        .route("/api/cmd/:name", post(commands::handle_cmd))
        .route("/api/asset", get(media::handle_asset))
        .route("/media/:hash/:kind", get(media::handle_hashed))
        .route("/ws", any(ws::handle_upgrade))
        .fallback(static_files::handle)
        .with_state(state.clone());

    let listener = match tokio::net::TcpListener::bind(args.bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!("failed to bind {}: {e}", args.bind);
            std::process::exit(1);
        }
    };

    tracing::info!(addr = %args.bind, "Nightingale self-hosted server listening");

    let server =
        axum::serve(listener, app.into_make_service()).with_graceful_shutdown(shutdown_signal());

    if let Err(e) = server.await {
        tracing::error!("server error: {e}");
    }

    tracing::info!("shutting down analyzer / vendor processes");
    app_core::shutdown_server();
}

/// Force the library source to a folder at `path`, declaratively. Running with
/// `NIGHTINGALE_LIBRARY_PATH` set means the operator owns the library choice, so
/// this overrides whatever was previously configured (including a remote source)
/// and kicks off a scan. It no-ops when the folder source is already pinned here
/// to avoid a needless rescan on every restart.
fn pin_folder_library(path: &str) {
    use app_core::{AppConfig, LibrarySource};

    let desired = LibrarySource::Folder {
        path: std::path::PathBuf::from(path),
    };

    let mut config = AppConfig::load();
    if config.library_source.as_ref() == Some(&desired) {
        tracing::info!(path, "library already pinned to folder; not rescanning");
        return;
    }

    config.library_source = Some(desired);
    config.last_folder = None;
    config.save();

    tracing::info!(path, "pinned library to folder from NIGHTINGALE_LIBRARY_PATH");
    app_core::start_scan();
}

fn dotenvy_quiet() -> std::io::Result<()> {
    match dotenvy::dotenv() {
        Ok(_) => Ok(()),
        Err(dotenvy::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(std::io::Error::other(e.to_string())),
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::warn!("ctrl_c install failed: {e}");
        }
    };

    #[cfg(unix)]
    let term = async {
        let mut s = match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("SIGTERM listener failed: {e}");
                return;
            }
        };
        s.recv().await;
    };

    #[cfg(not(unix))]
    let term = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = term => {},
    }
}
