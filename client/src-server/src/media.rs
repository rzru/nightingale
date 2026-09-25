use std::path::{Path, PathBuf};

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, Request, Response, StatusCode},
};
use serde::Deserialize;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::state::AppState;

/// Resolved-and-canonicalised view of a candidate media path. Constructing it
/// guarantees the final path lives inside one of the app's media roots, so
/// the caller can hand it to `ServeFile` without worrying about
/// path-traversal. The roots come from `app_core::local_media_roots()` rather
/// than a list kept here, so these routes and the desktop media server's
/// local-file route serve the same folders.
struct ResolvedPath(PathBuf);

impl ResolvedPath {
    fn resolve(input: &Path) -> Option<Self> {
        let canonical_input = std::fs::canonicalize(input).ok()?;
        for root in app_core::local_media_roots() {
            if let Ok(canon_root) = std::fs::canonicalize(&root) {
                if canonical_input.starts_with(&canon_root) {
                    return Some(Self(canonical_input));
                }
            }
        }
        None
    }
}

#[derive(Deserialize)]
pub(crate) struct AssetQuery {
    path: String,
}

/// Path-keyed file route used for media that does not have a stable hash key
/// (Pixabay backgrounds, ffmpeg-transcoded source videos, etc.). Every path
/// is canonicalised against the allowed roots before serving.
pub(crate) async fn handle_asset(
    State(_state): State<AppState>,
    Query(query): Query<AssetQuery>,
    headers: HeaderMap,
    request: Request<Body>,
) -> Response<Body> {
    serve(query.path.as_ref(), headers, request).await
}

/// Hash-keyed route for song stems and source video. The browser never sees
/// the underlying filesystem path; `kind` controls which `app-core` helper
/// resolves the path on the server.
pub(crate) async fn handle_hashed(
    State(_state): State<AppState>,
    AxumPath((hash, kind)): AxumPath<(String, String)>,
    headers: HeaderMap,
    request: Request<Body>,
) -> Response<Body> {
    let path = match kind.as_str() {
        "instrumental" => Some(app_core::get_audio_paths(&hash).instrumental),
        "vocals" => app_core::get_audio_paths(&hash).vocals,
        "source-video" | "video" => app_core::ensure_playable_source_video(&hash).ok().flatten(),
        _ => None,
    };

    let Some(path) = path else {
        return not_found("unknown media kind");
    };

    serve(Path::new(&path), headers, request).await
}

async fn serve(path: &Path, _headers: HeaderMap, request: Request<Body>) -> Response<Body> {
    let Some(resolved) = ResolvedPath::resolve(path) else {
        return not_found("media path not found or outside media roots");
    };

    let serve = ServeFile::new(&resolved.0);
    match serve.oneshot(request).await {
        Ok(response) => annotate_audio(response.map(Body::new)),
        Err(e) => {
            tracing::warn!("media serve error: {e}");
            response(
                StatusCode::INTERNAL_SERVER_ERROR,
                Body::from("failed to serve media"),
            )
        }
    }
}

/// `ServeFile` already sets `Accept-Ranges` and `Content-Range`, but it omits
/// `Cache-Control` and a no-sniff hint we want for browser-cached audio.
fn annotate_audio(mut response: Response<Body>) -> Response<Body> {
    let headers = response.headers_mut();
    headers
        .entry(header::CACHE_CONTROL)
        .or_insert_with(|| HeaderValue::from_static("private, max-age=300"));
    headers
        .entry(header::X_CONTENT_TYPE_OPTIONS)
        .or_insert_with(|| HeaderValue::from_static("nosniff"));
    response
}

fn response(status: StatusCode, body: Body) -> Response<Body> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
}

fn not_found(reason: &str) -> Response<Body> {
    response(StatusCode::NOT_FOUND, Body::from(reason.to_string()))
}
