mod backgrounds;
mod bootstrap;
mod commands;
mod events;
mod jukebox;
mod media;
mod remote;
mod state;
mod static_files;
mod ws;

pub use events::EventBus;
pub use state::{AppState, RemoteAddress};

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{any, get, post},
    Json, Router,
};

/// Full self-hosted surface: every command, media, and the embedded frontend.
///
/// The desktop adapter does not mount this router — it only mounts the remote
/// (LAN) surface built in [`remote_router`], so no phone can reach `/api/cmd`
/// for commands the queue page does not need.
pub fn router(state: AppState) -> Router {
    let body_limit = app_core::MAX_BACKGROUND_UPLOAD_BYTES as usize + 64 * 1024;

    Router::new()
        .route("/api/bootstrap", get(bootstrap::handle))
        .route("/api/remote", get(handle_remote_info))
        .route("/api/cmd/:name", post(commands::handle_cmd))
        .route(
            "/api/backgrounds/upload",
            post(backgrounds::handle_upload).layer(DefaultBodyLimit::max(body_limit)),
        )
        .route("/api/asset", get(media::handle_asset))
        .route("/media/:hash/:kind", get(media::handle_hashed))
        .route("/ws", any(ws::handle_upgrade))
        .fallback(static_files::handle)
        .with_state(state)
}

/// LAN phone surface: the queue page plus the handful of commands it needs.
/// Every request must carry the pairing token as a cookie, header, or `?t=`.
pub fn remote_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(|| async { axum::response::Redirect::to("/q") }))
        .route("/api/cmd/:name", post(commands::handle_remote_cmd))
        .route("/api/asset", get(media::handle_asset))
        .route("/ws", any(ws::handle_upgrade))
        .fallback(static_files::handle)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            remote::require_token,
        ))
        .with_state(state)
}

/// Self-hosted answers from the request that asked, so a phone gets an address
/// it can actually resolve.
async fn handle_remote_info(
    axum::extract::State(state): axum::extract::State<AppState>,
    headers: axum::http::HeaderMap,
) -> Json<app_core::RemoteInfo> {
    Json(state.remote_info_for(&headers))
}
