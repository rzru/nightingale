//! The `.nge` bundle format: Nightingale's canonical library file.
//!
//! A `.nge` is a single file that carries a song's audio plus every analysis
//! artifact (stems, cover, transcript, optional playable video). It becomes the
//! source of truth for a library entry: the scanner recognises it, registers
//! one row that points at it, and the media server reads individual entries
//! *in memory* at playback time — nothing is ever unpacked to disk.
//!
//! # Layout
//!
//! A `.nge` is a plain ZIP archive with a different extension — no encryption,
//! no key. Any archiver (7-Zip, `unzip`) can open it. Entries are *stored*
//! (not deflated): audio, video and the cover are already compressed, so
//! deflating them would only cost CPU.
//!
//! ```text
//! manifest.json       Manifest (file_hash, song metadata, entry index)
//! instrumental.mp3    …one ZIP entry per bundle entry, named as in the manifest
//! vocals.mp3
//! cover.jpg
//! ```

use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::NightingaleError;

/// Name of the index entry inside the archive. Not a valid bundle entry name.
const MANIFEST_NAME: &str = "manifest.json";

/// Manifest version written by [`build_nge`] and the only one readers accept.
const FORMAT_VERSION: u32 = 1;

/// ZIP local file header signature.
const ZIP_LOCAL_HEADER: &[u8; 4] = b"PK\x03\x04";

/// Offset of the file name inside a ZIP local file header.
const ZIP_NAME_OFFSET: usize = 30;

/// Bytes needed by [`looks_like_nge`] to classify a file.
pub(crate) const NGE_SNIFF_LEN: usize = ZIP_NAME_OFFSET + MANIFEST_NAME.len();

/// Whether `head` starts like a bundle written by [`build_nge`]: a ZIP whose
/// first entry is the manifest. A cheap pre-check only; a generic ZIP fails it,
/// but passing it does not prove the bundle is valid — use [`NgeFile::verify`].
pub(crate) fn looks_like_nge(head: &[u8]) -> bool {
    head.len() >= NGE_SNIFF_LEN
        && head.starts_with(ZIP_LOCAL_HEADER)
        && u16::from_le_bytes([head[26], head[27]]) as usize == MANIFEST_NAME.len()
        && &head[ZIP_NAME_OFFSET..NGE_SNIFF_LEN] == MANIFEST_NAME.as_bytes()
}

/// One file inside the bundle. `length` is its size in bytes; `blake3` is the
/// first 32 hex chars of its BLAKE3 hash (same convention as `Song::file_hash`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub name: String,
    pub length: u64,
    pub blake3: String,
}

/// The index of a bundle. `metadata` is the song's metadata verbatim
/// (title/artist/album/key/tempo/duration/…), kept as a free-form JSON object
/// so the format doesn't have to track every `Song` field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub file_hash: String,
    pub metadata: serde_json::Value,
    pub entries: Vec<ManifestEntry>,
}

impl Manifest {
    pub fn entry(&self, name: &str) -> Option<&ManifestEntry> {
        self.entries.iter().find(|e| e.name == name)
    }
}

fn short_blake3(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex()[..32].to_string()
}

fn zip_err(e: zip::result::ZipError) -> NightingaleError {
    NightingaleError::Other(format!("nge: {e}"))
}

// ─── Building ────────────────────────────────────────────────────────────────

/// Build a `.nge` from a song's `file_hash`, its metadata, and its named
/// entries (e.g. `("instrumental.mp3", bytes)`).
pub fn build_nge(
    file_hash: &str,
    metadata: serde_json::Value,
    entries: &[(String, Vec<u8>)],
) -> Result<Vec<u8>, NightingaleError> {
    let manifest = Manifest {
        version: FORMAT_VERSION,
        file_hash: file_hash.to_string(),
        metadata,
        entries: entries
            .iter()
            .map(|(name, bytes)| ManifestEntry {
                name: name.clone(),
                length: bytes.len() as u64,
                blake3: short_blake3(bytes),
            })
            .collect(),
    };

    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(
            entries
                .iter()
                .any(|(_, b)| b.len() as u64 >= u32::MAX as u64),
        );
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));

    zip.start_file(MANIFEST_NAME, options).map_err(zip_err)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;

    for (name, bytes) in entries {
        zip.start_file(name.as_str(), options).map_err(zip_err)?;
        zip.write_all(bytes)?;
    }

    Ok(zip.finish().map_err(zip_err)?.into_inner())
}

// ─── Reading ───────────────────────────────────────────────────────────────

/// An opened `.nge` with its manifest already parsed. Entries are read on
/// demand by name.
#[derive(Debug, Clone)]
pub struct NgeFile {
    pub path: PathBuf,
    pub manifest: Manifest,
}

fn open_archive(path: &Path) -> Result<ZipArchive<std::fs::File>, NightingaleError> {
    ZipArchive::new(std::fs::File::open(path)?).map_err(zip_err)
}

impl NgeFile {
    /// Open a `.nge` and parse its manifest. Reads only the ZIP central
    /// directory plus the (small) manifest entry.
    pub fn open(path: &Path) -> Result<Self, NightingaleError> {
        let mut archive = open_archive(path)?;
        let mut manifest_json = Vec::new();
        archive
            .by_name(MANIFEST_NAME)
            .map_err(zip_err)?
            .read_to_end(&mut manifest_json)?;
        let manifest: Manifest = serde_json::from_slice(&manifest_json)?;
        Ok(Self {
            path: path.to_path_buf(),
            manifest,
        })
    }

    /// Read a single entry fully into memory and verify its BLAKE3.
    pub fn read_entry(&self, name: &str) -> Result<Vec<u8>, NightingaleError> {
        let entry = self
            .manifest
            .entry(name)
            .ok_or_else(|| NightingaleError::Other(format!("nge: no entry named {name}")))?;

        let mut archive = open_archive(&self.path)?;
        let mut file = archive.by_name(name).map_err(zip_err)?;
        let mut bytes = Vec::with_capacity(entry.length as usize);
        file.read_to_end(&mut bytes)?;

        if short_blake3(&bytes) != entry.blake3 {
            return Err(NightingaleError::Other(format!(
                "nge: blake3 mismatch for {name}"
            )));
        }
        Ok(bytes)
    }

    /// Check that this is a complete bundle: a supported manifest version and
    /// every listed entry present with a matching BLAKE3.
    pub(crate) fn verify(&self) -> Result<(), NightingaleError> {
        if self.manifest.version != FORMAT_VERSION {
            return Err(NightingaleError::Other(format!(
                "nge: unsupported manifest version {}",
                self.manifest.version
            )));
        }
        for entry in &self.manifest.entries {
            self.read_entry(&entry.name)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn sample() -> (serde_json::Value, Vec<(String, Vec<u8>)>) {
        let metadata = serde_json::json!({
            "title": "Test", "artist": "Nobody", "album": "Demo",
            "duration_secs": 3.0, "is_analyzed": true,
        });
        let entries = vec![
            ("instrumental.mp3".to_string(), vec![1u8; 5000]),
            ("vocals.mp3".to_string(), vec![2u8; 4096]),
            ("cover.jpg".to_string(), vec![3u8; 1234]),
        ];
        (metadata, entries)
    }

    fn write_tmp(bytes: &[u8]) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("nge-test-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("x.nge");
        std::fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn roundtrip_manifest_and_entries() {
        let (metadata, entries) = sample();
        let bytes = build_nge("abc123", metadata, &entries).unwrap();
        // It's a plain ZIP.
        assert_eq!(&bytes[..4], b"PK\x03\x04");
        let (dir, path) = write_tmp(&bytes);

        let nge = NgeFile::open(&path).unwrap();
        assert_eq!(nge.manifest.file_hash, "abc123");
        assert_eq!(nge.manifest.entries.len(), 3);

        for (name, data) in &entries {
            let got = nge.read_entry(name).unwrap();
            assert_eq!(&got, data, "entry {name} mismatch");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unknown_entry_errors() {
        let (metadata, entries) = sample();
        let bytes = build_nge("h", metadata, &entries).unwrap();
        let (dir, path) = write_tmp(&bytes);
        let nge = NgeFile::open(&path).unwrap();
        assert!(nge.read_entry("missing.mp3").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn not_a_zip_is_rejected() {
        let (dir, path) = write_tmp(b"not a real archive at all");
        assert!(NgeFile::open(&path).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
