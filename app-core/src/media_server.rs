//! Local-only media server used by the Tauri webview to fetch song stems,
//! source videos, and authenticated remote-provider streams.
//!
//! Security model:
//!  - The server binds on `127.0.0.1`, so only same-host processes can reach
//!    it. To stop other local processes (or any web page that can hit
//!    `127.0.0.1:<port>`) from enumerating files, every URL is prefixed with
//!    `/s/<random session token>/`. The token is generated once per process,
//!    handed to the renderer through the same init-script channel as
//!    `__NIGHTINGALE_APP_CONFIG__`, and never logged.
//!  - The local-file route (`/s/<token>/local/<urlencoded-path>`) resolves the
//!    requested path against [`local_media_roots`] — the same list the
//!    self-hosted media routes use — and refuses anything outside.
//!  - The provider-neutral proxy route (`/s/<token>/remote/<file_hash>`)
//!    looks up the active source server-side, opens an authenticated stream,
//!    and proxies bytes. **Provider credentials never appear in a URL or log
//!    line** — adapters add them as upstream request headers inside this
//!    process.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU16, Ordering};
use std::thread;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use serde::Serialize;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use tracing::warn;
use ts_rs::TS;

use crate::config::{AppConfig, LibrarySource};
use crate::library_db;
use crate::source::{StreamResponse, active_source};

/// What the renderer needs to talk to the local media server. The session
/// token is unguessable per-process so a webpage / co-tenant process cannot
/// fish files off the local-file route by enumerating localhost ports.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct MediaEndpoint {
    pub port: u16,
    pub session_token: String,
}

pub fn endpoint() -> MediaEndpoint {
    MediaEndpoint {
        port: port(),
        session_token: session_token(),
    }
}

static PORT: AtomicU16 = AtomicU16::new(0);
static SESSION: OnceLock<String> = OnceLock::new();

fn port() -> u16 {
    PORT.load(Ordering::SeqCst)
}

fn session_token() -> String {
    SESSION.get_or_init(generate_session_token).clone()
}

fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    bytes.iter_mut().for_each(|b| *b = rand::random::<u8>());
    B64.encode(bytes)
}

pub fn start() -> Result<u16, String> {
    let session = session_token();
    let server = Server::http("127.0.0.1:0")
        .map_err(|error| format!("failed to start media server: {error}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .ok_or_else(|| "media server did not bind an IP socket".to_string())?;
    PORT.store(port, Ordering::SeqCst);

    thread::spawn(move || {
        for request in server.incoming_requests() {
            let session = session.clone();
            thread::spawn(move || handle_request(request, &session));
        }
    });

    Ok(port)
}

fn handle_request(request: Request, session: &str) {
    if request.method() == &Method::Options {
        let _ = request.respond(with_cors(Response::empty(StatusCode(204))));
        return;
    }

    let url = request.url().to_string();
    let Some(rest) = strip_session_prefix(&url, session) else {
        let _ = request.respond(with_cors(unauthorized()));
        return;
    };

    if let Some(file_hash) = rest.strip_prefix("/remote/") {
        handle_remote_song(request, file_hash);
        return;
    }

    if let Some(path_str) = rest.strip_prefix("/local/") {
        handle_local_file(request, path_str);
        return;
    }

    let _ = request.respond(with_cors(not_found("unknown media route")));
}

fn request_header(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

// ─── CORS ────────────────────────────────────────────────────────────
//
// Access control is the session token in the URL — without it every request
// returns 401, with it every request is honoured. CORS adds nothing on top,
// so we just open it up: any frontend (Tauri webview, Vite dev server,
// self-hosted reverse proxy at an arbitrary origin) gets the response. No
// credentials are used, so the wildcard is safe.

fn header(name: &str, value: impl AsRef<[u8]>) -> Option<Header> {
    Header::from_bytes(name.as_bytes(), value.as_ref().to_vec()).ok()
}

fn with_cors<R: Read>(response: Response<R>) -> Response<R> {
    [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, OPTIONS"),
        ("Access-Control-Allow-Headers", "Range"),
        (
            "Access-Control-Expose-Headers",
            "Content-Range, Accept-Ranges, Content-Length",
        ),
    ]
    .into_iter()
    .filter_map(|(name, value)| header(name, value))
    .fold(response, Response::with_header)
}

fn strip_session_prefix<'a>(url: &'a str, session: &str) -> Option<&'a str> {
    let prefix = url.strip_prefix("/s/")?;
    let (token, _) = prefix.split_once('/')?;
    if constant_time_eq(token.as_bytes(), session.as_bytes()) {
        Some(&prefix[token.len()..])
    } else {
        None
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ─── Local files ─────────────────────────────────────────────────────

fn handle_local_file(request: Request, path_segment: &str) {
    let decoded = urlencoding::decode(path_segment)
        .map(|d| d.into_owned())
        .unwrap_or_else(|_| path_segment.to_string());

    let cleaned = if cfg!(windows)
        && decoded
            .get(1..3)
            .is_some_and(|s| s.as_bytes()[0].is_ascii_alphabetic() && s.as_bytes()[1] == b':')
    {
        decoded[1..].to_string()
    } else {
        decoded
    };

    let candidate = PathBuf::from(&cleaned);
    let Some(resolved) = resolve_within_allowed_roots(&candidate) else {
        let _ = request.respond(with_cors(not_found("file not in allowed roots")));
        return;
    };

    serve_file(request, &resolved);
}

fn resolve_within_allowed_roots(input: &Path) -> Option<PathBuf> {
    let canonical_input = std::fs::canonicalize(input).ok()?;
    for root in local_media_roots() {
        let Ok(canon_root) = std::fs::canonicalize(&root) else {
            continue;
        };
        if canonical_input.starts_with(&canon_root) {
            return Some(canonical_input);
        }
    }
    None
}

/// Directories a local-file media request may resolve into. The desktop
/// server's `/local/` route and the self-hosted `/api/asset` and `/media`
/// routes all check against this one list, so the media routes cannot drift
/// apart on which folders they serve. (Album art on desktop goes through the
/// Tauri asset protocol instead, whose scope is configured separately.)
///
/// The songs and videos caches default to subfolders of the data folder, but
/// `cache_paths` in the config relocates each one independently, so a
/// relocated cache sits outside every other root and needs its own entry.
/// Nothing under the model or vendor caches is requested through these media
/// routes, so they are not listed.
pub fn local_media_roots() -> Vec<PathBuf> {
    let config = AppConfig::load();
    let mut roots = vec![
        crate::cache::nightingale_dir(),
        // Default location, kept even when `data_path` points elsewhere.
        crate::cache::default_nightingale_dir(),
        config.effective_data_path(),
        // Stems, transcripts, lyrics, covers, key/tempo variants, and
        // transcoded source video.
        crate::cache::songs_cache_dir(),
        // Downloaded background videos.
        crate::cache::videos_dir(),
    ];
    // Folder-library songs are streamed from wherever they were scanned.
    if let Some(LibrarySource::Folder { path }) = config.library_source.as_ref() {
        roots.push(path.clone());
    }
    roots
}

fn serve_file(request: Request, file_path: &Path) {
    let file_len = match std::fs::metadata(file_path) {
        Ok(m) => m.len(),
        Err(_) => {
            let _ = request.respond(with_cors(server_error("metadata")));
            return;
        }
    };

    let mime = mime_for_path(file_path);
    let Some(content_type) = header("Content-Type", mime) else {
        let _ = request.respond(with_cors(server_error("content type")));
        return;
    };
    let Some(accept_ranges) = header("Accept-Ranges", "bytes") else {
        let _ = request.respond(with_cors(server_error("accept ranges")));
        return;
    };
    let Some(no_sniff) = header("X-Content-Type-Options", "nosniff") else {
        let _ = request.respond(with_cors(server_error("content options")));
        return;
    };

    let range_val = request_header(&request, "Range");

    if let Some((start, end)) = range_val.as_deref().and_then(|r| parse_range(r, file_len)) {
        let mut file = match std::fs::File::open(file_path) {
            Ok(f) => f,
            Err(_) => {
                let _ = request.respond(with_cors(server_error("open")));
                return;
            }
        };
        let chunk_len = (end - start + 1) as usize;
        let mut buf = vec![0u8; chunk_len];
        let _ = file.seek(SeekFrom::Start(start));
        if file.read_exact(&mut buf).is_err() {
            let _ = request.respond(with_cors(server_error("read range")));
            return;
        }
        let Some(content_range) =
            header("Content-Range", format!("bytes {start}-{end}/{file_len}"))
        else {
            let _ = request.respond(with_cors(server_error("content range")));
            return;
        };
        let resp = Response::from_data(buf)
            .with_status_code(StatusCode(206))
            .with_header(content_type)
            .with_header(accept_ranges)
            .with_header(no_sniff)
            .with_header(content_range);
        let _ = request.respond(with_cors(resp));
        return;
    }

    match std::fs::read(file_path) {
        Ok(data) => {
            let resp = Response::from_data(data)
                .with_header(content_type)
                .with_header(accept_ranges)
                .with_header(no_sniff);
            let _ = request.respond(with_cors(resp));
        }
        Err(_) => {
            let _ = request.respond(with_cors(server_error("read")));
        }
    }
}

fn mime_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "ogg" | "oga" | "opus" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "m4a" | "aac" => "audio/mp4",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

fn parse_range(range_header: &str, file_len: u64) -> Option<(u64, u64)> {
    let spec = range_header.strip_prefix("bytes=")?;
    let mut parts = spec.splitn(2, '-');
    let start_str = parts.next().unwrap_or("");
    let end_str = parts.next().unwrap_or("");

    if start_str.is_empty() {
        let suffix: u64 = end_str.parse().ok()?;
        Some((file_len.saturating_sub(suffix), file_len.saturating_sub(1)))
    } else {
        let start: u64 = start_str.parse().ok()?;
        let end = if end_str.is_empty() {
            file_len.saturating_sub(1)
        } else {
            end_str.parse::<u64>().ok()?.min(file_len.saturating_sub(1))
        };
        Some((start, end))
    }
}

// ─── Source-agnostic remote song proxy ───────────────────────────────
//
// The URL carries only the song's local `file_hash`. The active
// `MediaSource` decides whether/how to open a stream — so swapping
// Jellyfin for Navidrome later does not touch this route at all.

fn handle_remote_song(request: Request, file_hash: &str) {
    if !request.method().eq(&Method::Get) {
        let _ = request.respond(with_cors(
            Response::from_string("method not allowed").with_status_code(StatusCode(405)),
        ));
        return;
    }

    let Some(file_hash) = sanitize_file_hash(file_hash) else {
        let _ = request.respond(with_cors(bad_request("invalid file hash")));
        return;
    };

    let song = match library_db::load_song_by_hash(&file_hash) {
        Ok(Some(s)) => s,
        Ok(None) => {
            let _ = request.respond(with_cors(not_found("song not found")));
            return;
        }
        Err(e) => {
            warn!("[media_server] song lookup failed: {e}");
            let _ = request.respond(with_cors(server_error("lookup")));
            return;
        }
    };

    let source = match active_source() {
        Ok(Some(s)) => s,
        Ok(None) => {
            let _ = request.respond(with_cors(not_found("no library source configured")));
            return;
        }
        Err(e) => {
            warn!("[media_server] active source resolution failed: {e}");
            let _ = request.respond(with_cors(server_error("active source")));
            return;
        }
    };

    let range = request_header(&request, "Range");

    let stream = match source.open_remote_stream(&song, range.as_deref()) {
        Ok(Some(s)) => s,
        Ok(None) => {
            let _ = request.respond(with_cors(not_found("source does not stream this song")));
            return;
        }
        Err(e) => {
            warn!("[media_server] remote stream failed: {e}");
            let _ = request.respond(with_cors(
                Response::from_string("upstream request failed").with_status_code(StatusCode(502)),
            ));
            return;
        }
    };

    let writer = request.into_writer();
    if let Err(e) = write_stream_response(writer, stream) {
        warn!("[media_server] proxy write failed: {e}");
    }
}

/// File hashes are blake3 prefixes — strictly hex. Enforcing that here means
/// a malicious renderer can't smuggle a path segment or query string into
/// the lookup.
fn sanitize_file_hash(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > 64 {
        return None;
    }
    if raw.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(raw.to_ascii_lowercase())
    } else {
        None
    }
}

fn write_stream_response<W: Write>(mut writer: W, stream: StreamResponse) -> std::io::Result<()> {
    let status_line = format!("HTTP/1.1 {} OK\r\n", stream.status);
    writer.write_all(status_line.as_bytes())?;
    if let Some(ct) = stream.content_type {
        writer.write_all(format!("Content-Type: {ct}\r\n").as_bytes())?;
    }
    if let Some(cr) = stream.content_range {
        writer.write_all(format!("Content-Range: {cr}\r\n").as_bytes())?;
    }
    if let Some(ar) = stream.accept_ranges {
        writer.write_all(format!("Accept-Ranges: {ar}\r\n").as_bytes())?;
    } else {
        writer.write_all(b"Accept-Ranges: bytes\r\n")?;
    }
    if let Some(len) = stream.content_length {
        writer.write_all(format!("Content-Length: {len}\r\n").as_bytes())?;
    }
    writer.write_all(b"Access-Control-Allow-Origin: *\r\n")?;
    writer.write_all(
        b"Access-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\n",
    )?;
    writer.write_all(b"X-Content-Type-Options: nosniff\r\n")?;
    writer.write_all(b"Connection: close\r\n")?;
    writer.write_all(b"\r\n")?;

    let mut body = stream.body;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = body.read(&mut buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
    }
    writer.flush()?;
    Ok(())
}

// ─── Response helpers ────────────────────────────────────────────────

fn not_found(reason: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(reason.to_string()).with_status_code(StatusCode(404))
}

fn bad_request(reason: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(reason.to_string()).with_status_code(StatusCode(400))
}

fn unauthorized() -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string("unauthorized").with_status_code(StatusCode(401))
}

fn server_error(stage: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(format!("server error: {stage}")).with_status_code(StatusCode(500))
}
