use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use crate::secret;
use crate::{
    cache::{CachePaths, config_path},
    library_model::SongSort,
};

/// Where the user wants Nightingale to source songs from. Persisted in
/// `config.json` and consumed by both the scanner and the analyzer.
#[derive(Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum LibrarySource {
    Folder {
        path: PathBuf,
    },
    Jellyfin {
        base_url: String,
        user_id: String,
        username: String,
        /// Access token returned by `/Users/AuthenticateByName`. At rest in
        /// `config.json` this value is an encrypted envelope; in-memory and
        /// over IPC it's the plaintext token. See `secret.rs` for the on-disk
        /// format + migration semantics.
        access_token: String,
        /// Stable per-install identifier we hand to Jellyfin in the
        /// `X-Emby-Authorization` header. Generated once at connect time.
        device_id: String,
        /// Ids of the Jellyfin libraries (user views) the scan is restricted
        /// to. Empty means "every library" — preserves the pre-selection
        /// behaviour for configs written before this field existed.
        #[serde(default)]
        library_ids: Vec<String>,
    },
    Navidrome {
        base_url: String,
        username: String,
        /// Subsonic user password. Same secret-at-rest envelope as the
        /// Jellyfin `access_token` (encrypted in `config.json`, plaintext
        /// in-memory). Required at request time because the Subsonic auth
        /// token is `MD5(password + salt)` with a fresh salt per call.
        password: String,
    },
    Plex {
        base_url: String,
        server_name: String,
        machine_id: String,
        username: String,
        /// PMS access token obtained through hosted PIN linking or entered in
        /// the advanced manual flow. It is encrypted in `config.json` and is
        /// never placed in provider/media URLs.
        access_token: String,
        /// Stable install identity sent in Plex request headers.
        client_id: String,
        /// One or more explicitly selected Plex music section keys.
        section_ids: Vec<String>,
    },
}

impl std::fmt::Debug for LibrarySource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Folder { path } => formatter
                .debug_struct("Folder")
                .field("path", path)
                .finish(),
            Self::Jellyfin {
                base_url,
                user_id,
                username,
                device_id,
                library_ids,
                ..
            } => formatter
                .debug_struct("Jellyfin")
                .field("base_url", base_url)
                .field("user_id", user_id)
                .field("username", username)
                .field("access_token", &"[REDACTED]")
                .field("device_id", device_id)
                .field("library_ids", library_ids)
                .finish(),
            Self::Navidrome {
                base_url, username, ..
            } => formatter
                .debug_struct("Navidrome")
                .field("base_url", base_url)
                .field("username", username)
                .field("password", &"[REDACTED]")
                .finish(),
            Self::Plex {
                base_url,
                server_name,
                machine_id,
                username,
                client_id,
                section_ids,
                ..
            } => formatter
                .debug_struct("Plex")
                .field("base_url", base_url)
                .field("server_name", server_name)
                .field("machine_id", machine_id)
                .field("username", username)
                .field("access_token", &"[REDACTED]")
                .field("client_id", client_id)
                .field("section_ids", section_ids)
                .finish(),
        }
    }
}

impl LibrarySource {
    /// Apply `transform` to every credential field that lives in the
    /// secret-at-rest envelope (Jellyfin's access token, Navidrome's
    /// password). New remote sources that carry secrets must extend this
    /// match.
    fn map_secret(self, transform: impl FnOnce(&str) -> String) -> Self {
        match self {
            Self::Folder { path } => Self::Folder { path },
            Self::Jellyfin {
                base_url,
                user_id,
                username,
                access_token,
                device_id,
                library_ids,
            } => Self::Jellyfin {
                base_url,
                user_id,
                username,
                access_token: transform(&access_token),
                device_id,
                library_ids,
            },
            Self::Navidrome {
                base_url,
                username,
                password,
            } => Self::Navidrome {
                base_url,
                username,
                password: transform(&password),
            },
            Self::Plex {
                base_url,
                server_name,
                machine_id,
                username,
                access_token,
                client_id,
                section_ids,
            } => Self::Plex {
                base_url,
                server_name,
                machine_id,
                username,
                access_token: transform(&access_token),
                client_id,
                section_ids,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppConfig {
    #[serde(default = "default_data_path_option")]
    pub data_path: Option<PathBuf>,
    #[serde(default)]
    pub cache_paths: Option<CachePaths>,
    /// Deprecated. Kept for one-shot migration into `library_source`; never
    /// written by code that has been through `with_defaults`.
    pub last_folder: Option<PathBuf>,
    #[serde(default)]
    pub library_source: Option<LibrarySource>,
    pub last_theme: Option<usize>,
    pub guide_volume: Option<f64>,
    pub fullscreen: Option<bool>,
    pub playback_mode: Option<String>,
    pub dark_mode: Option<bool>,
    pub mic_active: Option<bool>,
    /// `serde(alias = "mic_mirroring")` keeps configs written by builds that
    /// called this feature "mic mirroring" loading without a manual migration;
    /// the next `save` rewrites them under the new name.
    #[serde(alias = "mic_mirroring")]
    pub mic_monitoring: Option<bool>,
    #[serde(alias = "mic_mirror_gain")]
    pub mic_monitor_gain: Option<f64>,
    pub mic_latency_compensation_sec: Option<f64>,
    pub preferred_mic: Option<String>,
    pub whisper_model: Option<String>,
    pub beam_size: Option<u32>,
    pub batch_size: Option<u32>,
    pub last_video_flavor: Option<usize>,
    pub lyrics_vertical_position: Option<String>,
    pub lyrics_horizontal_position: Option<String>,
    pub lyrics_scale: Option<f64>,
    pub pitch_graph_scale: Option<f64>,
    pub recordings_path: Option<PathBuf>,
    pub separator: Option<String>,
    pub asr_engine: Option<String>,
    pub align_backend: Option<String>,
    pub vocal_detection_threshold_pct: Option<f64>,
    pub auto_analyze: Option<bool>,
    pub song_list_view: Option<String>,
    #[serde(default, deserialize_with = "deserialize_song_list_sort")]
    pub song_list_sort: Option<Vec<SongSort>>,
    pub language_overrides: Option<HashMap<String, String>>,
}

fn default_data_path_option() -> Option<PathBuf> {
    Some(AppConfig::default_data_path())
}

fn deserialize_song_list_sort<'de, D>(deserializer: D) -> Result<Option<Vec<SongSort>>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum PersistedSongSort {
        One(SongSort),
        Many(Vec<SongSort>),
    }

    Ok(
        Option::<PersistedSongSort>::deserialize(deserializer)?.map(|sort| match sort {
            PersistedSongSort::One(sort) => vec![sort],
            PersistedSongSort::Many(sorts) => sorts,
        }),
    )
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            data_path: default_data_path_option(),
            cache_paths: None,
            last_folder: None,
            library_source: None,
            last_theme: None,
            guide_volume: None,
            fullscreen: None,
            playback_mode: None,
            dark_mode: None,
            mic_active: None,
            mic_monitoring: None,
            mic_monitor_gain: None,
            mic_latency_compensation_sec: None,
            preferred_mic: None,
            whisper_model: None,
            beam_size: None,
            batch_size: None,
            last_video_flavor: None,
            lyrics_vertical_position: None,
            lyrics_horizontal_position: None,
            lyrics_scale: None,
            pitch_graph_scale: None,
            recordings_path: None,
            separator: None,
            asr_engine: None,
            align_backend: None,
            vocal_detection_threshold_pct: None,
            auto_analyze: None,
            song_list_view: None,
            song_list_sort: None,
            language_overrides: None,
        }
    }
}

impl AppConfig {
    pub fn default_data_path() -> PathBuf {
        crate::cache::default_nightingale_dir()
    }

    pub fn effective_data_path(&self) -> PathBuf {
        self.data_path
            .clone()
            .unwrap_or_else(Self::default_data_path)
    }

    fn with_defaults(mut self) -> Self {
        if self.data_path.is_none() {
            self.data_path = Some(Self::default_data_path());
        }
        // One-shot promotion of the legacy `last_folder` field into the new
        // `library_source` enum so old installs keep scanning the same folder.
        if self.library_source.is_none()
            && let Some(path) = self.last_folder.take()
        {
            self.library_source = Some(LibrarySource::Folder { path });
        }
        self
    }

    /// Pre-Jellyfin builds never wrote `last_folder` — the chosen folder lived
    /// only in `library_meta.folder` inside the DB. Recover it here so users
    /// upgrading with a pre-existing library don't lose their source (and the
    /// Rescan button doesn't get stuck disabled).
    fn migrate_from_library_db(&mut self) -> bool {
        if self.library_source.is_some() {
            return false;
        }

        let Ok((folder, count)) = crate::library_db::read_library_meta() else {
            return false;
        };

        if folder.is_empty() {
            return false;
        }

        let path = PathBuf::from(folder);
        if count == 0 || !path.is_dir() {
            return false;
        }

        self.library_source = Some(LibrarySource::Folder { path });

        true
    }

    pub fn load() -> Self {
        let path = config_path();

        let loaded = if path.is_file() {
            std::fs::read_to_string(&path).ok().and_then(|s| {
                let has_library_source_key = serde_json::from_str::<serde_json::Value>(&s)
                    .ok()
                    .and_then(|value| {
                        value
                            .as_object()
                            .map(|obj| obj.contains_key("library_source"))
                    })
                    .unwrap_or(false);

                serde_json::from_str::<Self>(&s)
                    .ok()
                    .map(|config| (config, has_library_source_key))
            })
        } else {
            None
        };

        let (mut config, mut should_save, allow_db_source_migration) = match loaded {
            Some((mut cfg, has_library_source_key)) => {
                let had_data_path = cfg.data_path.is_some();
                let had_library_source = cfg.library_source.is_some();
                let had_legacy_folder = cfg.last_folder.is_some();
                let had_plaintext_secret = cfg
                    .library_source
                    .as_ref()
                    .is_some_and(has_plaintext_secret);
                let needs_save = !had_data_path
                    || (!had_library_source && had_legacy_folder)
                    || had_plaintext_secret;
                if let Some(src) = cfg.library_source.take() {
                    cfg.library_source = Some(src.map_secret(secret::decrypt_string));
                }
                (cfg.with_defaults(), needs_save, !has_library_source_key)
            }
            None => (Self::default().with_defaults(), true, false),
        };

        if allow_db_source_migration && config.migrate_from_library_db() {
            should_save = true;
        }

        if should_save {
            config.save();
        }

        config
    }

    pub fn save(&self) {
        let path = config_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut for_disk = self.clone();
        if let Some(src) = for_disk.library_source.take() {
            for_disk.library_source = Some(src.map_secret(secret::encrypt_string));
        }
        if let Ok(json) = serde_json::to_string_pretty(&for_disk) {
            let _ = std::fs::write(&path, json);
        }
    }

    pub fn whisper_model(&self) -> &str {
        self.whisper_model.as_deref().unwrap_or("large-v3")
    }

    pub fn beam_size(&self) -> u32 {
        self.beam_size.unwrap_or(8)
    }

    pub fn batch_size(&self) -> u32 {
        self.batch_size.unwrap_or(8)
    }

    pub fn separator(&self) -> &str {
        self.separator.as_deref().unwrap_or("karaoke")
    }

    pub fn asr_engine(&self) -> &str {
        self.asr_engine.as_deref().unwrap_or("whisper")
    }

    pub fn align_backend(&self) -> &str {
        self.align_backend.as_deref().unwrap_or("whisperx")
    }

    pub fn vocal_detection_threshold_pct(&self) -> f64 {
        self.vocal_detection_threshold_pct
            .unwrap_or(0.15)
            .clamp(0.0, 1.0)
    }

    pub fn auto_analyze(&self) -> bool {
        self.auto_analyze.unwrap_or(false)
    }

    pub fn mic_monitor_gain(&self) -> f32 {
        self.mic_monitor_gain
            .map(|v| v as f32)
            .unwrap_or(0.65)
            .clamp(0.0, 2.0)
    }

    pub fn mic_latency_compensation_sec(&self) -> f32 {
        self.mic_latency_compensation_sec
            .map(|v| v as f32)
            .unwrap_or(0.08)
            .clamp(0.0, 0.5)
    }

    pub fn language_override(&self, file_hash: &str) -> Option<&str> {
        self.language_overrides
            .as_ref()
            .and_then(|m| m.get(file_hash))
            .map(|s| s.as_str())
    }

    pub fn set_language_override(&mut self, file_hash: String, lang: String) {
        self.language_overrides
            .get_or_insert_with(HashMap::new)
            .insert(file_hash, lang);
    }
}

/// Detects credentials still sitting on disk in plaintext (older builds or a
/// hand-edited `config.json`). `load` uses this to know whether to re-save
/// after decrypting, so the next write re-wraps the secret in the at-rest
/// envelope. Any new remote source that persists a secret must extend this.
fn has_plaintext_secret(src: &LibrarySource) -> bool {
    let secret = match src {
        LibrarySource::Folder { .. } => return false,
        LibrarySource::Jellyfin { access_token, .. } => access_token,
        LibrarySource::Navidrome { password, .. } => password,
        LibrarySource::Plex { access_token, .. } => access_token,
    };
    !secret.is_empty() && !secret::is_encrypted(secret)
}
