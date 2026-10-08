//! Download a song file — a `.nge` bundle or a plain audio file — from a URL
//! into the user's folder library, then trigger a rescan so it shows up. Backs
//! the `nightingale://download?url=…` deep link.
//!
//! Safety: this is reachable from a web link, so it is strict. Only `http(s)`
//! URLs are fetched, the response is size-capped, and the first bytes must match
//! a known signature (`.nge` or a common audio container) before anything is
//! written — arbitrary content is rejected. A `.nge` is also fully verified
//! (manifest and entry hashes) before it replaces the `.part` file. Host allowlisting / user
//! confirmation happens in the UI layer before this is called; this is the
//! last-line backend enforcement.

use std::io::{Read, Write};
use std::path::PathBuf;

use crate::config::{AppConfig, LibrarySource};
use crate::error::NightingaleError;
use crate::nge_format::{NGE_SNIFF_LEN, NgeFile, looks_like_nge};

/// Hard ceiling on a deep-link download (defense-in-depth against a hostile URL).
const MAX_DOWNLOAD_BYTES: u64 = 128 * 1024 * 1024;

/// Reported download progress: bytes received so far and the total if the server
/// sent a `Content-Length` (otherwise `None` → indeterminate bar).
#[derive(Debug, Clone, Copy)]
pub struct DownloadProgress {
    pub received: u64,
    pub total: Option<u64>,
}

/// Classify a file by its leading bytes. Returns the extension to use, or `None`
/// if the content isn't an accepted type. The scanner classifies by extension,
/// so the sniffed type drives the final filename.
fn sniff_extension(head: &[u8]) -> Option<&'static str> {
    if looks_like_nge(head) {
        return Some("nge");
    }
    if head.starts_with(b"ID3") {
        return Some("mp3");
    }
    // MP3 frame sync (no ID3 tag).
    if head.len() >= 2 && head[0] == 0xff && (head[1] & 0xe0) == 0xe0 {
        return Some("mp3");
    }
    if head.starts_with(b"fLaC") {
        return Some("flac");
    }
    if head.starts_with(b"OggS") {
        return Some("ogg");
    }
    if head.starts_with(b"RIFF") {
        return Some("wav");
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return Some("m4a");
    }
    None
}

fn kebab(field: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in field.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// A filesystem-safe stem for the downloaded file: the title (or the URL's last
/// path segment) kebab-cased, plus a short random suffix to avoid collisions.
fn download_slug(title: Option<&str>, parsed: &url::Url) -> String {
    let base = title
        .map(kebab)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            parsed
                .path_segments()
                .and_then(|mut segs| segs.next_back())
                .map(|seg| kebab(seg.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(seg)))
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "song".to_string());

    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let suffix: String = (0..6)
        .map(|_| ALPHABET[(rand::random::<u32>() as usize) % ALPHABET.len()] as char)
        .collect();
    format!("{base}-{suffix}")
}

/// Download `url` into the folder library and rescan. Calls `on_progress` as
/// bytes arrive. Returns the final path on success.
pub fn download_song_to_library(
    url: &str,
    title: Option<&str>,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, NightingaleError> {
    let parsed =
        url::Url::parse(url).map_err(|e| NightingaleError::Other(format!("invalid URL: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(NightingaleError::Other(
            "only http/https downloads are allowed".into(),
        ));
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err(NightingaleError::Other("URL has no host".into()));
    }

    let folder = match AppConfig::load().library_source {
        Some(LibrarySource::Folder { path }) => path,
        _ => {
            return Err(NightingaleError::Other(
                "set a music folder as your library source first".into(),
            ));
        }
    };
    std::fs::create_dir_all(&folder)?;

    let resp = ureq::get(url)
        .call()
        .map_err(|e| NightingaleError::Other(format!("download failed: {e}")))?;

    let total: Option<u64> = resp
        .headers()
        .get("Content-Length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());
    if total.is_some_and(|t| t > MAX_DOWNLOAD_BYTES) {
        return Err(NightingaleError::Other(
            "download exceeds the size limit".into(),
        ));
    }

    let mut reader = resp.into_body().into_reader();

    // Read the header, sniff the type, and reject early before writing anything.
    let mut head = [0u8; NGE_SNIFF_LEN];
    let mut head_len = 0usize;
    while head_len < head.len() {
        let n = reader.read(&mut head[head_len..])?;
        if n == 0 {
            break;
        }
        head_len += n;
    }
    let ext = sniff_extension(&head[..head_len]).ok_or_else(|| {
        NightingaleError::Other("downloaded file is not a .nge bundle or supported audio".into())
    })?;

    let slug = download_slug(title, &parsed);
    let part = folder.join(format!("{slug}.{ext}.part"));
    let final_path = folder.join(format!("{slug}.{ext}"));

    let mut file = std::fs::File::create(&part)?;
    file.write_all(&head[..head_len])?;
    let mut received = head_len as u64;
    on_progress(DownloadProgress { received, total });

    let mut buf = vec![0u8; 64 * 1024];
    let mut since_emit = 0u64;
    let result = (|| -> Result<(), NightingaleError> {
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            received += n as u64;
            if received > MAX_DOWNLOAD_BYTES {
                return Err(NightingaleError::Other(
                    "download exceeded the size limit".into(),
                ));
            }
            file.write_all(&buf[..n])?;
            since_emit += n as u64;
            if since_emit >= 256 * 1024 {
                on_progress(DownloadProgress { received, total });
                since_emit = 0;
            }
        }
        file.flush()?;
        Ok(())
    })();

    drop(file);
    let result = result.and_then(|()| {
        if ext == "nge" {
            NgeFile::open(&part)?.verify()
        } else {
            Ok(())
        }
    });
    if let Err(e) = result {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    on_progress(DownloadProgress { received, total });

    if final_path.exists() {
        let _ = std::fs::remove_file(&final_path);
    }
    std::fs::rename(&part, &final_path)?;
    crate::start_scan();

    Ok(final_path)
}
