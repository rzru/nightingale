use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::NightingaleError;

const MANIFEST_NAME: &str = "manifest.json";
const FORMAT_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_MEMORY_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ENTRIES: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub name: String,
    pub length: u64,
    pub blake3: String,
}

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

fn short_blake3_file(path: &Path) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0; 16 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().to_hex()[..32].to_string())
}

fn zip_err(error: zip::result::ZipError) -> NightingaleError {
    NightingaleError::Other(format!("nge: {error}"))
}

fn nge_err(message: impl Into<String>) -> NightingaleError {
    NightingaleError::Other(format!("nge: {}", message.into()))
}

pub fn write_nge(
    output: &Path,
    file_hash: &str,
    metadata: serde_json::Value,
    entries: &[(String, PathBuf)],
) -> Result<(), NightingaleError> {
    let manifest = Manifest {
        version: FORMAT_VERSION,
        file_hash: file_hash.to_string(),
        metadata,
        entries: entries
            .iter()
            .map(|(name, path)| {
                Ok(ManifestEntry {
                    name: name.clone(),
                    length: path.metadata()?.len(),
                    blake3: short_blake3_file(path)?,
                })
            })
            .collect::<Result<_, std::io::Error>>()?,
    };

    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(
            manifest
                .entries
                .iter()
                .any(|entry| entry.length >= u32::MAX as u64),
        );
    let mut zip = ZipWriter::new(File::create(output)?);

    zip.start_file(MANIFEST_NAME, options).map_err(zip_err)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;

    for ((name, path), entry) in entries.iter().zip(&manifest.entries) {
        zip.start_file(name, options).map_err(zip_err)?;
        let copied = std::io::copy(&mut File::open(path)?, &mut zip)?;
        if copied != entry.length {
            return Err(nge_err(format!("{name} changed while it was exported")));
        }
    }

    zip.finish().map_err(zip_err)?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct NgeFile {
    pub path: PathBuf,
    pub manifest: Manifest,
}

fn open_archive(path: &Path) -> Result<ZipArchive<File>, NightingaleError> {
    ZipArchive::new(File::open(path)?).map_err(zip_err)
}

impl NgeFile {
    pub fn open(path: &Path) -> Result<Self, NightingaleError> {
        let mut archive = open_archive(path)?;
        let mut manifest_json = Vec::new();
        archive
            .by_name(MANIFEST_NAME)
            .map_err(zip_err)?
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut manifest_json)?;
        if manifest_json.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(nge_err("manifest is too large"));
        }

        let manifest: Manifest = serde_json::from_slice(&manifest_json)?;
        if manifest.version != FORMAT_VERSION {
            return Err(nge_err(format!(
                "unsupported manifest version {}",
                manifest.version
            )));
        }
        Ok(Self {
            path: path.to_path_buf(),
            manifest,
        })
    }

    pub fn validate(&self) -> Result<(), NightingaleError> {
        if self.manifest.entries.len() > MAX_ENTRIES {
            return Err(nge_err("too many entries"));
        }
        if self.manifest.file_hash.len() != 32
            || !self
                .manifest
                .file_hash
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err(nge_err("invalid source file hash"));
        }

        let mut names = HashSet::new();
        for entry in &self.manifest.entries {
            if entry.name.is_empty()
                || entry.name.len() > 64
                || !entry.name.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
                })
                || !names.insert(entry.name.as_str())
            {
                return Err(nge_err(format!(
                    "invalid or duplicate entry name {}",
                    entry.name
                )));
            }
            if entry.blake3.len() != 32
                || !entry
                    .blake3
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
            {
                return Err(nge_err(format!("invalid hash for {}", entry.name)));
            }
            self.entry_region(&entry.name)?;
            self.copy_entry(&entry.name, std::io::sink())?;
        }

        let mut archive = open_archive(&self.path)?;
        if archive.len() != self.manifest.entries.len() + 1 {
            return Err(nge_err("archive entries do not match the manifest"));
        }
        for index in 0..archive.len() {
            let name = archive.by_index(index).map_err(zip_err)?.name().to_string();
            if name != MANIFEST_NAME && !names.contains(name.as_str()) {
                return Err(nge_err(format!("unlisted archive entry {name}")));
            }
        }
        Ok(())
    }

    pub fn entry_region(&self, name: &str) -> Result<(u64, u64), NightingaleError> {
        let entry = self
            .manifest
            .entry(name)
            .ok_or_else(|| nge_err(format!("no entry named {name}")))?;
        let mut archive = open_archive(&self.path)?;
        let file = archive.by_name(name).map_err(zip_err)?;
        if file.compression() != CompressionMethod::Stored {
            return Err(nge_err(format!(
                "{name} must be stored without compression"
            )));
        }
        if file.size() != entry.length {
            return Err(nge_err(format!("length mismatch for {name}")));
        }

        let start = file.data_start();
        let end = start
            .checked_add(entry.length)
            .ok_or_else(|| nge_err(format!("invalid length for {name}")))?;
        if end > self.path.metadata()?.len() {
            return Err(nge_err(format!("invalid bounds for {name}")));
        }
        Ok((start, entry.length))
    }

    pub fn copy_entry(&self, name: &str, mut output: impl Write) -> Result<(), NightingaleError> {
        let entry = self
            .manifest
            .entry(name)
            .ok_or_else(|| nge_err(format!("no entry named {name}")))?;
        let mut archive = open_archive(&self.path)?;
        let mut file = archive.by_name(name).map_err(zip_err)?;
        if file.compression() != CompressionMethod::Stored {
            return Err(nge_err(format!(
                "{name} must be stored without compression"
            )));
        }
        if file.size() != entry.length {
            return Err(nge_err(format!("length mismatch for {name}")));
        }

        let mut hasher = blake3::Hasher::new();
        let mut copied = 0_u64;
        let mut buffer = [0; 16 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            copied += count as u64;
            if copied > entry.length {
                return Err(nge_err(format!("length mismatch for {name}")));
            }
            hasher.update(&buffer[..count]);
            output.write_all(&buffer[..count])?;
        }

        let hash = hasher.finalize().to_hex()[..32].to_string();
        if copied != entry.length || hash != entry.blake3 {
            return Err(nge_err(format!("content mismatch for {name}")));
        }
        Ok(())
    }

    pub fn read_entry(&self, name: &str) -> Result<Vec<u8>, NightingaleError> {
        let entry = self
            .manifest
            .entry(name)
            .ok_or_else(|| nge_err(format!("no entry named {name}")))?;
        if entry.length > MAX_MEMORY_ENTRY_BYTES {
            return Err(nge_err(format!("{name} is too large to load into memory")));
        }

        let mut bytes = Vec::with_capacity(entry.length as usize);
        self.copy_entry(name, &mut bytes)?;
        Ok(bytes)
    }
}
