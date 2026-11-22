//! Navidrome media source (Subsonic API).
//!
//! Scan flow (audio-only — Navidrome does not serve video):
//!  1. Paginate `getAlbumList2?type=alphabeticalByName&size=500&offset=N` for
//!     stable enumeration. Each entry is an album summary.
//!  2. For each album, `getAlbum?id=<albumId>` returns the song list.
//!  3. Build a [`Song`] per song with `origin = SongOrigin::Navidrome
//!     { item_id, container: song.suffix, cover_tag: song.coverArt }` and a
//!     placeholder `file_hash = blake3("navidrome:" + id)`. Covers are
//!     fetched lazily and only refreshed when `cover_tag` changes (mirrors
//!     the Jellyfin tag-based dedupe).
//!  4. Stale rows whose item ids are no longer upstream get pruned via
//!     [`library_db::remote::delete_remote_songs_not_in_item_ids`].
//!
//! Audio bytes are materialised lazily by `ensure_local_media`: a one-off
//! `download?id=<id>` request writes the original file into
//! `cache/sources/<file_hash>.<container>`, then `analyzer::prepare_audio_for_analysis`
//! rekeys the row to the true Blake3 hash so the rest of the cache layout
//! (`<hash>_instrumental.mp3` etc.) stays consistent.

use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::cache::CacheDir;
use crate::config::{AppConfig, LibrarySource};
use crate::error::NightingaleError;
use crate::library_db::{self, PlaylistDefinition, PlaylistSongKeyKind};
use crate::song::{Song, SongOrigin};

use super::{
    MediaSource, SCAN_BATCH_SIZE, ScanContext, SourceKind, apply_refreshed_metadata, flush_batch,
    retained_cover,
};

pub(crate) mod client;

pub(crate) use client::{AuthCreds, SubsonicClient, trim_base_url};

const PAGE_SIZE: usize = 500;
const COVER_SIZE: u32 = 300;
/// `origin.kind` discriminator stored in each song's JSON payload. Shared
/// with `library_db::remote::*` so the SQL helpers can find our rows.
const ORIGIN_KIND: &str = "navidrome";

/// Decrypted Navidrome credentials. Built from `AppConfig`; never persisted
/// in this form.
#[derive(Debug, Clone)]
pub struct NavidromeAuth {
    pub base_url: String,
    pub username: String,
    pub password: String,
}

impl NavidromeAuth {
    pub fn from_source(src: &LibrarySource) -> Option<Self> {
        let LibrarySource::Navidrome {
            base_url,
            username,
            password,
        } = src
        else {
            return None;
        };
        Some(Self {
            base_url: base_url.clone(),
            username: username.clone(),
            password: password.clone(),
        })
    }

    pub fn from_config(cfg: &AppConfig) -> Option<Self> {
        cfg.library_source.as_ref().and_then(Self::from_source)
    }

    fn creds(&self) -> AuthCreds {
        AuthCreds::new(self.username.clone(), self.password.clone())
    }

    /// Client tuned for control-plane calls (list, login, ping).
    pub fn client(&self) -> SubsonicClient {
        SubsonicClient::new(&self.base_url, self.creds())
    }

    /// Client tuned for streaming downloads (no response-read timeout).
    pub fn download_client(&self) -> SubsonicClient {
        SubsonicClient::for_downloads(&self.base_url, self.creds())
    }
}

pub struct NavidromeSource {
    client: SubsonicClient,
    download_client: SubsonicClient,
}

impl NavidromeSource {
    pub fn new(auth: NavidromeAuth) -> Self {
        Self {
            client: auth.client(),
            download_client: auth.download_client(),
        }
    }

    fn fetch_album_page(&self, offset: usize) -> Result<Vec<AlbumSummary>, NightingaleError> {
        let size = PAGE_SIZE.to_string();
        let offset_str = offset.to_string();
        let result: AlbumList2Result = self.client.get_json(
            "list albums",
            "/rest/getAlbumList2",
            &[
                ("type", "alphabeticalByName"),
                ("size", &size),
                ("offset", &offset_str),
            ],
        )?;
        Ok(result.album_list2.album)
    }

    fn fetch_album(&self, album_id: &str) -> Result<AlbumDetail, NightingaleError> {
        let result: AlbumResult =
            self.client
                .get_json("list album songs", "/rest/getAlbum", &[("id", album_id)])?;
        Ok(result.album)
    }

    fn fetch_song(&self, item_id: &str) -> Result<SubsonicSong, NightingaleError> {
        let result: SongResult =
            self.client
                .get_json("get song", "/rest/getSong", &[("id", item_id)])?;
        Ok(result.song)
    }

    fn fetch_playlists(&self) -> Result<Vec<PlaylistDefinition>, NightingaleError> {
        let result: PlaylistsResult =
            self.client
                .get_json("list playlists", "/rest/getPlaylists", &[])?;
        let mut playlists = Vec::new();
        for playlist in result.playlists.playlist {
            if playlist.id.is_empty() {
                continue;
            }
            let detail: PlaylistResult = match self.client.get_json(
                "list playlist songs",
                "/rest/getPlaylist",
                &[("id", playlist.id.as_str())],
            ) {
                Ok(detail) => detail,
                Err(error) => {
                    warn!("[navidrome] skipping playlist {}: {error}", playlist.id);
                    continue;
                }
            };
            playlists.push(PlaylistDefinition {
                id: format!("navidrome:{}", playlist.id),
                name: pick_string(Some(&playlist.name), "Playlist"),
                song_keys: detail
                    .playlist
                    .entry
                    .into_iter()
                    .filter_map(|song| (!song.id.is_empty()).then_some(song.id))
                    .collect(),
            });
        }
        Ok(playlists)
    }

    fn build_song(
        &self,
        item: &SubsonicSong,
        cache: &CacheDir,
        retained_cover: Option<PathBuf>,
    ) -> Option<Song> {
        if item.id.is_empty() {
            return None;
        }
        let item_id = item.id.clone();

        let stable_id = format!("navidrome:{item_id}");
        let file_hash = blake3::hash(stable_id.as_bytes()).to_hex()[..32].to_string();

        let title = pick_string(item.title.as_deref(), "Unknown");
        let artist = pick_artist_or_album(item.artist.as_deref(), "Unknown Artist");
        let album = pick_artist_or_album(item.album.as_deref(), "Unknown Album");
        let genre = item
            .genre
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let duration_secs = item.duration.map(|d| d as f64).unwrap_or(0.0);

        let container = item.suffix.clone().filter(|s| !s.is_empty());
        let placeholder_path = source_cache_path(cache, &file_hash, container.as_deref());

        let cover_tag = item.cover_art.clone().filter(|s| !s.is_empty());
        let album_art_path = retained_cover.or_else(|| {
            cover_tag
                .as_deref()
                .and_then(|tag| self.fetch_cover(cache, tag))
        });

        Some(Song {
            path: placeholder_path,
            file_hash,
            title,
            artist,
            album,
            genre,
            duration_secs,
            album_art_path,
            is_analyzed: false,
            language: None,
            transcript_source: None,
            key: None,
            override_key: None,
            tempo: 1.0,
            key_offset: 0,
            is_video: false,
            usdx: None,
            origin: SongOrigin::Navidrome {
                item_id,
                container,
                cover_tag,
            },
            no_stems: false,
        })
    }

    fn fetch_cover(&self, cache: &CacheDir, cover_id: &str) -> Option<PathBuf> {
        let size = COVER_SIZE.to_string();
        let bytes = self
            .client
            .download_to_vec(
                "download cover",
                "/rest/getCoverArt",
                &[("id", cover_id), ("size", &size)],
            )
            .ok()?;
        if bytes.is_empty() {
            return None;
        }
        let cover_hash = blake3::hash(&bytes).to_hex()[..32].to_string();
        let cover_path = cache.cover_path(&cover_hash);
        if !cover_path.exists() {
            std::fs::write(&cover_path, &bytes).ok()?;
        }
        Some(cover_path)
    }

    fn download_source(&self, song: &Song, cache: &CacheDir) -> Result<PathBuf, NightingaleError> {
        let SongOrigin::Navidrome {
            item_id, container, ..
        } = &song.origin
        else {
            return Err(NightingaleError::Other(
                "download_source called on non-Navidrome song".into(),
            ));
        };

        let dest = source_cache_path(cache, &song.file_hash, container.as_deref());
        if dest.is_file() {
            return Ok(dest);
        }

        info!("[navidrome] Downloading source for {item_id}");
        let dest = self.download_client.download_to_file(
            "download source",
            "/rest/download",
            &[("id", item_id.as_str())],
            &dest,
        )?;
        info!("[navidrome] Saved source to {}", dest.display());
        Ok(dest)
    }
}

impl MediaSource for NavidromeSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Navidrome
    }

    fn label(&self) -> String {
        format!("Navidrome: {}", self.client.base_url())
    }

    fn scan(&self, ctx: &ScanContext<'_>) -> Result<(), NightingaleError> {
        let folder_label = self.label();
        let known: HashSet<String> =
            library_db::remote::load_remote_item_ids(ORIGIN_KIND).unwrap_or_default();
        let known_covers =
            library_db::remote::load_remote_cover_tags(ORIGIN_KIND).unwrap_or_default();

        let mut seen_ids: Vec<String> = Vec::new();
        let mut batch: Vec<Song> = Vec::new();
        let mut offset = 0usize;
        // Running upstream song-count target for the progress bar. We bump
        // it forward at the *start* of every album page using the
        // `songCount` Subsonic ships with each `getAlbumList2` entry, so
        // `count` always leads `processed_count` and the bar never divides
        // by zero. The final reconciliation below corrects for any albums
        // that failed to fetch.
        let mut song_count_target: usize = 0;

        loop {
            if !library_db::scan_generation_is_current(ctx.generation) {
                return Ok(());
            }
            let albums = self.fetch_album_page(offset)?;
            let received = albums.len();
            if received == 0 {
                break;
            }

            let page_song_count: usize = albums.iter().map(|a| a.song_count as usize).sum();
            if page_song_count > 0 {
                song_count_target += page_song_count;
                let _ = library_db::update_library_meta(&folder_label, song_count_target);
            }

            for album_summary in &albums {
                if !library_db::scan_generation_is_current(ctx.generation) {
                    return Ok(());
                }
                if album_summary.id.is_empty() {
                    continue;
                }
                let album_detail = match self.fetch_album(&album_summary.id) {
                    Ok(a) => a,
                    Err(e) => {
                        tracing::warn!("[navidrome] skipping album {}: {e}", album_summary.id);
                        continue;
                    }
                };

                for item in &album_detail.song {
                    if !library_db::scan_generation_is_current(ctx.generation) {
                        return Ok(());
                    }
                    if item.id.is_empty() {
                        continue;
                    }
                    seen_ids.push(item.id.clone());

                    if known.contains(&item.id) {
                        let upstream_tag = item.cover_art.clone().filter(|s| !s.is_empty());
                        let cached_tag = known_covers.get(&item.id).cloned().flatten();
                        if upstream_tag != cached_tag {
                            let _ = library_db::remote::refresh_remote_cover_for_item(
                                ORIGIN_KIND,
                                &item.id,
                                |_| {
                                    upstream_tag
                                        .as_deref()
                                        .and_then(|t| self.fetch_cover(ctx.cache, t))
                                },
                            );
                        }
                        continue;
                    }

                    if let Some(song) = self.build_song(item, ctx.cache, None) {
                        batch.push(song);
                    }

                    if batch.len() >= SCAN_BATCH_SIZE {
                        flush_batch(&mut batch, ctx.generation);
                    }
                }
            }

            offset += received;
            // `getAlbumList2` returns up to `size` rows; fewer means we've hit
            // the end and the next call would be empty.
            if received < PAGE_SIZE {
                break;
            }
        }

        flush_batch(&mut batch, ctx.generation);

        info!("[navidrome] Sync done — saw {} songs", seen_ids.len());

        let _ = library_db::update_library_meta(&folder_label, seen_ids.len());
        let _ = library_db::remote::delete_remote_songs_not_in_item_ids(ORIGIN_KIND, &seen_ids);

        match self.fetch_playlists() {
            Ok(playlists) => {
                if let Err(error) = library_db::replace_all_playlists(
                    &playlists,
                    PlaylistSongKeyKind::RemoteItemId {
                        origin_kind: ORIGIN_KIND,
                    },
                ) {
                    warn!("[navidrome] failed to store playlists: {error}");
                }
            }
            Err(error) => warn!("[navidrome] failed to sync playlists: {error}"),
        }

        Ok(())
    }

    fn refresh_metadata(&self, song: &mut Song, cache: &CacheDir) -> Result<(), NightingaleError> {
        let (item_id, current_tag) = match &song.origin {
            SongOrigin::Navidrome {
                item_id, cover_tag, ..
            } => (item_id.clone(), cover_tag.clone()),
            _ => {
                return Err(NightingaleError::Other(
                    "Navidrome source asked to refresh a non-Navidrome song".into(),
                ));
            }
        };
        let item = self.fetch_song(&item_id)?;
        let next_tag = item.cover_art.clone().filter(|tag| !tag.is_empty());
        let retained = retained_cover(song, next_tag == current_tag);
        let refreshed = self.build_song(&item, cache, retained).ok_or_else(|| {
            NightingaleError::Other(format!("Navidrome item {item_id} has no usable metadata"))
        })?;
        if next_tag.is_some() && refreshed.album_art_path.is_none() {
            return Err(NightingaleError::Other(format!(
                "failed fetching Navidrome cover for {item_id}"
            )));
        }
        apply_refreshed_metadata(song, refreshed);
        Ok(())
    }

    fn ensure_local_media(
        &self,
        song: &Song,
        cache: &CacheDir,
    ) -> Result<PathBuf, NightingaleError> {
        // Once `path` points at a real on-disk file (post-rekey, or a previous
        // download that didn't get rekeyed yet) hand it straight back.
        if song.path.is_file() {
            return Ok(song.path.clone());
        }
        self.download_source(song, cache)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn pick_string(value: Option<&str>, fallback: &str) -> String {
    value
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| fallback.to_string())
}

/// Same as [`pick_string`] but also folds Subsonic's `[Unknown Artist]` /
/// `[Unknown Album]` placeholder strings down to the canonical
/// `Unknown Artist` / `Unknown Album` Nightingale uses everywhere else.
/// Without this, those bracketed strings would slip through as if they
/// were real artist / album names and pollute the library menu's
/// alphabetical lists instead of rolling up into the "no metadata"
/// bucket.
fn pick_artist_or_album(value: Option<&str>, fallback: &str) -> String {
    let trimmed = value.map(str::trim).unwrap_or("");
    if trimmed.is_empty() || is_unknown_placeholder(trimmed) {
        return fallback.to_string();
    }
    trimmed.to_string()
}

fn is_unknown_placeholder(value: &str) -> bool {
    matches!(value, "[Unknown Artist]" | "[Unknown Album]")
}

pub(crate) fn source_cache_path(
    cache: &CacheDir,
    file_hash: &str,
    container: Option<&str>,
) -> PathBuf {
    let dir = cache.path.join("sources");
    let _ = std::fs::create_dir_all(&dir);
    let ext = container.unwrap_or("bin");
    dir.join(format!("{file_hash}.{ext}"))
}

// ─── Authentication ──────────────────────────────────────────────────

/// Public auth response surfaced to the UI after a successful login.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NavidromeLoginResult {
    pub server_url: String,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub username: String,
    pub password: String,
}

/// Authenticate against a Navidrome / Subsonic server. Since Subsonic auth
/// is stateless per-request we simply call `ping` with the supplied
/// credentials — a successful `subsonic-response.status == "ok"` proves the
/// credentials work. Returns the password back so the caller can chain into
/// `set_library_source` (the caller is the bridge command, never the disk
/// — `LibrarySource::Navidrome::password` is encrypted on persist).
pub fn login(
    base_url: &str,
    username: &str,
    password: &str,
) -> Result<NavidromeLoginResult, NightingaleError> {
    let server_url = trim_base_url(base_url);
    let creds = AuthCreds::new(username.to_string(), password.to_string());
    let client = SubsonicClient::new(&server_url, creds);
    let info: PingPayload = client.get_json("login", "/rest/ping", &[])?;
    Ok(NavidromeLoginResult {
        server_url,
        server_name: info.server_name(),
        server_version: info.version.filter(|s| !s.is_empty()),
        username: username.to_string(),
        password: password.to_string(),
    })
}

/// Public ping payload surfaced to the UI. Renders the small "online / offline"
/// pill next to the Navidrome source in the sidebar.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NavidromeHealth {
    pub reachable: bool,
    #[ts(optional)]
    pub server_name: Option<String>,
    #[ts(optional)]
    pub version: Option<String>,
    #[ts(optional)]
    pub error: Option<String>,
}

impl NavidromeHealth {
    pub fn offline(error: impl Into<String>) -> Self {
        Self {
            reachable: false,
            server_name: None,
            version: None,
            error: Some(error.into()),
        }
    }
}

/// One-shot `ping` against a configured server. Cheap enough for the UI to
/// poll on a slow interval and serves as a smoke test for "is the server up
/// and the credentials still valid".
pub fn ping(auth: &NavidromeAuth) -> NavidromeHealth {
    match auth
        .client()
        .get_json::<PingPayload>("ping", "/rest/ping", &[])
    {
        Ok(info) => NavidromeHealth {
            reachable: true,
            server_name: info.server_name(),
            version: info.version.filter(|s| !s.is_empty()),
            error: None,
        },
        Err(e) => NavidromeHealth::offline(e.to_string()),
    }
}

/// Convenience wrapper used by the bridge commands so neither transport has to
/// hand-roll the `LibrarySource::Navidrome { ... } -> NavidromeAuth` destructure.
pub fn ping_current() -> NavidromeHealth {
    let config = AppConfig::load();
    match NavidromeAuth::from_config(&config) {
        Some(auth) => ping(&auth),
        None => NavidromeHealth::offline("no navidrome source configured"),
    }
}

// ─── Subsonic DTOs ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct PingPayload {
    #[serde(default, rename = "type")]
    server_type: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default, rename = "serverVersion")]
    server_version: Option<String>,
    #[serde(default, rename = "openSubsonic")]
    _open_subsonic: Option<bool>,
}

impl PingPayload {
    fn server_name(&self) -> Option<String> {
        // OpenSubsonic exposes `serverVersion` separately from the API
        // version; `type` (e.g. "navidrome") is the closest thing to a
        // human-readable server identity we can rely on across forks.
        let label = self.server_type.as_deref()?.trim();
        if label.is_empty() {
            return None;
        }
        if let Some(v) = self.server_version.as_deref().filter(|s| !s.is_empty()) {
            Some(format!("{label} {v}"))
        } else {
            Some(label.to_string())
        }
    }
}

#[derive(Debug, Deserialize)]
struct PlaylistsResult {
    #[serde(default)]
    playlists: Playlists,
}

#[derive(Debug, Default, Deserialize)]
struct Playlists {
    #[serde(default)]
    playlist: Vec<PlaylistSummary>,
}

#[derive(Debug, Deserialize)]
struct PlaylistSummary {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
struct PlaylistResult {
    #[serde(default)]
    playlist: PlaylistDetail,
}

#[derive(Debug, Default, Deserialize)]
struct PlaylistDetail {
    #[serde(default)]
    entry: Vec<SubsonicSong>,
}

#[derive(Debug, Deserialize)]
struct SongResult {
    song: SubsonicSong,
}

#[derive(Debug, Deserialize)]
struct AlbumList2Result {
    #[serde(rename = "albumList2", default)]
    album_list2: AlbumList2,
}

#[derive(Debug, Default, Deserialize)]
struct AlbumList2 {
    #[serde(default)]
    album: Vec<AlbumSummary>,
}

#[derive(Debug, Deserialize)]
struct AlbumSummary {
    #[serde(default)]
    id: String,
    /// Subsonic ships this on every `getAlbumList2` entry; we use it to
    /// front-load the progress bar denominator before fetching each
    /// album's full song list. Defaulted so forks that omit it don't
    /// break the scan — they just lose the early count estimate.
    #[serde(default, rename = "songCount")]
    song_count: u64,
}

#[derive(Debug, Deserialize)]
struct AlbumResult {
    #[serde(default)]
    album: AlbumDetail,
}

#[derive(Debug, Default, Deserialize)]
struct AlbumDetail {
    #[serde(default)]
    song: Vec<SubsonicSong>,
}

#[derive(Debug, Deserialize)]
struct SubsonicSong {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    artist: Option<String>,
    #[serde(default)]
    album: Option<String>,
    #[serde(default)]
    genre: Option<String>,
    #[serde(default)]
    duration: Option<u64>,
    #[serde(default)]
    suffix: Option<String>,
    #[serde(default, rename = "coverArt")]
    cover_art: Option<String>,
}
