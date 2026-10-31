use std::io::SeekFrom;
use std::path::{Path, PathBuf};

use axum::{
    body::{Body, Bytes},
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, Request, Response, StatusCode},
};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
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
    #[serde(default)]
    download: bool,
}

/// Path-keyed route for regular media files and virtual entries inside `.nge`
/// bundles. Files are canonicalised against the allowed roots; bundle entries
/// are resolved by their library hash and validated manifest name.
pub(crate) async fn handle_asset(
    State(_state): State<AppState>,
    Query(query): Query<AssetQuery>,
    headers: HeaderMap,
    request: Request<Body>,
) -> Response<Body> {
    let response = if let Some(value) = query.path.strip_prefix("nge://") {
        let Some((hash, entry)) = value.split_once('/') else {
            return response(StatusCode::BAD_REQUEST, Body::from("invalid bundle path"));
        };
        serve_nge(hash, entry, headers).await
    } else {
        serve(query.path.as_ref(), headers, request).await
    };

    if query.download {
        as_attachment(response)
    } else {
        response
    }
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

async fn serve_nge(hash: &str, entry: &str, headers: HeaderMap) -> Response<Body> {
    let hash = hash.to_owned();
    let entry = entry.to_owned();
    let region = match tokio::task::spawn_blocking({
        let entry = entry.clone();
        move || app_core::nge_format::resolve_entry_region(&hash, &entry)
    })
    .await
    {
        Ok(Ok(Some(region))) => region,
        Ok(Ok(None)) => return not_found("song not found"),
        Ok(Err(error)) => {
            tracing::warn!("nge media resolve error: {error}");
            return not_found("bundle entry not found");
        }
        Err(error) => {
            tracing::warn!("nge media task failed: {error}");
            return response(StatusCode::INTERNAL_SERVER_ERROR, Body::empty());
        }
    };

    let range = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_range(value, region.length));
    let (status, start, end, length) = match range {
        Some((start, end)) => (
            StatusCode::PARTIAL_CONTENT,
            start,
            Some(end),
            end - start + 1,
        ),
        None => (StatusCode::OK, 0, None, region.length),
    };
    let Some(position) = region.offset.checked_add(start) else {
        return response(StatusCode::RANGE_NOT_SATISFIABLE, Body::empty());
    };

    let mut file = match tokio::fs::File::open(region.path).await {
        Ok(file) => file,
        Err(_) => return not_found("bundle not found"),
    };
    if file.seek(SeekFrom::Start(position)).await.is_err() {
        return response(StatusCode::INTERNAL_SERVER_ERROR, Body::empty());
    }

    let stream =
        futures_util::stream::try_unfold((file, length), |(mut file, remaining)| async move {
            if remaining == 0 {
                return Ok(None);
            }
            let mut bytes = vec![0; remaining.min(64 * 1024) as usize];
            let count = file.read(&mut bytes).await?;
            if count == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "bundle entry ended early",
                ));
            }
            bytes.truncate(count);
            Ok(Some((Bytes::from(bytes), (file, remaining - count as u64))))
        });
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    let response_headers = response.headers_mut();
    response_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(
            mime_guess::from_path(entry)
                .first_or_octet_stream()
                .as_ref(),
        )
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    if let Ok(value) = HeaderValue::from_str(&length.to_string()) {
        response_headers.insert(header::CONTENT_LENGTH, value);
    }
    response_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Some(end) = end {
        if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{}", region.length))
        {
            response_headers.insert(header::CONTENT_RANGE, value);
        }
    }
    annotate_audio(response)
}

fn parse_range(value: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        return (suffix > 0).then(|| (length.saturating_sub(suffix), length - 1));
    }

    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().ok()?.min(length - 1)
    };
    (start <= end).then_some((start, end))
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

fn as_attachment(mut response: Response<Body>) -> Response<Body> {
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment"),
    );
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
