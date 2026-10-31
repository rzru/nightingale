use std::path::{Path, PathBuf};

use crate::cache::CacheDir;
use crate::error::NightingaleError;
use crate::library_db;
use crate::nge_format::write_nge;
use crate::song::{NgeSongMeta, Song, SongOrigin, compute_file_hash};

fn resolve_stem_files(song: &Song, cache: &CacheDir) -> Option<(PathBuf, PathBuf)> {
    let hash = &song.file_hash;
    if let Some(key) = song.key.as_deref() {
        let instrumental = cache.variant_instrumental_path(hash, key, 1.0);
        let vocals = cache.variant_vocals_path(hash, key, 1.0);
        if instrumental.is_file() && vocals.is_file() {
            return Some((instrumental, vocals));
        }
    }

    for (instrumental, vocals) in [
        (cache.instrumental_path(hash), cache.vocals_path(hash)),
        (
            cache.legacy_instrumental_path(hash),
            cache.legacy_vocals_path(hash),
        ),
    ] {
        if instrumental.is_file() && vocals.is_file() {
            return Some((instrumental, vocals));
        }
    }

    None
}

fn stem_entry_name(base: &str, path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_else(|| "mp3".to_string());
    format!("{base}.{ext}")
}

fn nge_entries(song: &Song, cache: &CacheDir) -> Result<Vec<(String, PathBuf)>, NightingaleError> {
    if !matches!(song.origin, SongOrigin::LocalFile) {
        return Err(NightingaleError::Other(
            "only local songs can be exported to .nge".into(),
        ));
    }

    let hash = &song.file_hash;
    let mut entries = Vec::new();

    if song.no_stems {
        if compute_file_hash(&song.path)? != song.file_hash {
            return Err(NightingaleError::Other(
                "audio file hash does not match the library record".into(),
            ));
        }
        entries.push((stem_entry_name("audio", &song.path), song.path.clone()));
    } else if let Some((inst, voc)) = resolve_stem_files(song, cache) {
        entries.push((stem_entry_name("instrumental", &inst), inst));
        entries.push((stem_entry_name("vocals", &voc), voc));
    } else {
        return Err(NightingaleError::Other(
            "original stems are missing; re-analyze before creating a bundle".into(),
        ));
    }

    if let Some(cover) = song.album_art_path.as_ref()
        && cover.is_file()
    {
        entries.push(("cover.jpg".to_string(), cover.clone()));
    }

    for (name, path) in [
        ("transcript.json", cache.transcript_path(hash)),
        ("lyrics.json", cache.lyrics_path(hash)),
        ("video.mp4", cache.playable_video_path(hash)),
    ] {
        if path.is_file() {
            entries.push((name.to_string(), path));
        }
    }
    Ok(entries)
}

pub fn export_song_nge(file_hash: &str, dest_dir: &Path) -> Result<PathBuf, NightingaleError> {
    let song = library_db::load_song_by_hash(file_hash)?
        .ok_or_else(|| NightingaleError::Other("song not found".into()))?;
    let cache = CacheDir::new();
    let entries = nge_entries(&song, &cache)?;
    let mut metadata = NgeSongMeta::from_song(&song);
    metadata.override_key = None;
    metadata.tempo = 1.0;
    metadata.key_offset = 0;
    let metadata = serde_json::to_value(metadata)?;

    std::fs::create_dir_all(dest_dir)?;
    let path = dest_dir.join(format!("{}.nge", slug_name(&song.title, &song.artist)));
    let temporary = path.with_extension("nge.part");
    let result = write_nge(&temporary, file_hash, metadata, &entries)
        .and_then(|()| std::fs::rename(&temporary, &path).map_err(NightingaleError::from));
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result.map(|()| path)
}

fn kebab(field: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in field.chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn slug_name(title: &str, artist: &str) -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let suffix: String = (0..6)
        .map(|_| ALPHABET[(rand::random::<u32>() as usize) % ALPHABET.len()] as char)
        .collect();

    let mut parts: Vec<String> = [kebab(artist), kebab(title)]
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        parts.push("song".to_string());
    }
    parts.push(suffix);
    parts.join("_")
}
