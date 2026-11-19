//! Jellyfin media source. Talks to a Jellyfin server's REST API (see
//! [api.jellyfin.org](https://api.jellyfin.org/)).
//!
//! Scan flow:
//!  1. `GET /Items?Recursive=true&IncludeItemTypes=Audio,MusicVideo,Movie,Video,Episode`
//!     paginated by `StartIndex`/`Limit` and ordered by `SortName` for stable
//!     pagination. Each page is flushed straight into a batch and to the DB.
//!  2. For each item we synthesize a `Song` row with `origin = Jellyfin { item_id,
//!     container, cover_tag }` and a placeholder `file_hash` derived from
//!     `blake3("jellyfin:" + item_id)`. The cover is only re-fetched when the
//!     server-reported `ImageTags.Primary` changes.
//!  3. Stale rows (item ids no longer present upstream) are pruned at the end.
//!
//! Audio/video is materialised lazily by `ensure_local_media`: when something
//! needs to read the bytes we download `GET /Items/{Id}/Download` once into
//! `cache/sources/<file_hash>.<container>`, then rekey the row to the real
//! Blake3 hash so the rest of the cache layout (`<hash>_instrumental.mp3`
//! etc.) stays consistent.

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
    MediaSource, SCAN_BATCH_SIZE, ScanContext, SourceKind, StreamResponse,
    apply_refreshed_metadata, flush_batch, retained_cover,
};

pub(crate) mod client;

pub(crate) use client::{AuthHeaders, JellyfinClient, trim_base_url};

const PAGE_SIZE: usize = 200;
const COVER_FILL_WIDTH: u32 = 300;
const VIDEO_TYPES: &[&str] = &["MusicVideo", "Movie", "Episode"];
const ITEM_FIELDS: &str =
    "MediaSources,RunTimeTicks,Path,Container,ProductionYear,Genres,ImageTags";
const INCLUDE_ITEM_TYPES: &str = "Audio,MusicVideo,Movie,Video,Episode";
/// `origin.kind` discriminator stored in each song's JSON payload. Shared
/// with `library_db::remote::*` so the SQL helpers can find our rows.
const ORIGIN_KIND: &str = "jellyfin";

/// Decrypted Jellyfin credentials. Built from `AppConfig`; never persisted in
/// this form.
#[derive(Debug, Clone)]
pub struct JellyfinAuth {
    pub base_url: String,
    pub user_id: String,
    pub access_token: String,
    pub device_id: String,
    /// Libraries (user views) to restrict the scan to. Empty means every
    /// library.
    pub library_ids: Vec<String>,
}

impl JellyfinAuth {
    pub fn from_source(src: &LibrarySource) -> Option<Self> {
        let LibrarySource::Jellyfin {
            base_url,
            user_id,
            access_token,
            device_id,
            library_ids,
            ..
        } = src
        else {
            return None;
        };
        Some(Self {
            base_url: base_url.clone(),
            user_id: user_id.clone(),
            access_token: access_token.clone(),
            device_id: device_id.clone(),
            library_ids: library_ids.clone(),
        })
    }

    pub fn from_config(cfg: &AppConfig) -> Option<Self> {
        cfg.library_source.as_ref().and_then(Self::from_source)
    }

    /// Build a client suitable for control-plane calls (list, login, ping).
    pub fn client(&self) -> JellyfinClient {
        JellyfinClient::new(
            &self.base_url,
            AuthHeaders::for_token(self.access_token.clone(), self.device_id.clone()),
        )
    }

    /// Build a client tuned for streaming downloads (no response-read timeout).
    pub fn download_client(&self) -> JellyfinClient {
        JellyfinClient::for_downloads(
            &self.base_url,
            AuthHeaders::for_token(self.access_token.clone(), self.device_id.clone()),
        )
    }
}

pub struct JellyfinSource {
    auth: JellyfinAuth,
    client: JellyfinClient,
    download_client: JellyfinClient,
}

/// Mutable accumulator threaded through a scan so the per-library drain loops
/// share one dedupe set, batch buffer and progress total.
struct JellyfinScanState {
    known: HashSet<String>,
    known_covers: std::collections::HashMap<String, Option<String>>,
    seen_ids: Vec<String>,
    batch: Vec<Song>,
    expected_total: usize,
}

impl JellyfinSource {
    pub fn new(auth: JellyfinAuth) -> Self {
        let client = auth.client();
        let download_client = auth.download_client();
        Self {
            auth,
            client,
            download_client,
        }
    }

    fn fetch_page(
        &self,
        start_index: usize,
        parent_id: Option<&str>,
    ) -> Result<ItemQueryResult, NightingaleError> {
        let path = format!("/Users/{}/Items", self.auth.user_id);
        let limit = PAGE_SIZE.to_string();
        let start = start_index.to_string();
        let mut query = vec![
            ("Recursive", "true"),
            ("IncludeItemTypes", INCLUDE_ITEM_TYPES),
            ("Fields", ITEM_FIELDS),
            ("SortBy", "SortName"),
            ("SortOrder", "Ascending"),
            ("Limit", limit.as_str()),
            ("StartIndex", start.as_str()),
        ];
        if let Some(parent_id) = parent_id {
            query.push(("ParentId", parent_id));
        }
        self.client.get_json("list items", &path, &query)
    }

    fn fetch_item(&self, item_id: &str) -> Result<JellyfinItem, NightingaleError> {
        let path = format!(
            "/Users/{}/Items/{}",
            urlencoding::encode(&self.auth.user_id),
            urlencoding::encode(item_id)
        );
        self.client
            .get_json("get item", &path, &[("Fields", ITEM_FIELDS)])
    }

    /// Paginate one recursive item query — either the whole server
    /// (`parent_id == None`) or a single library — flushing songs into
    /// `state` as they arrive.
    fn drain_parent(
        &self,
        parent_id: Option<&str>,
        folder_label: &str,
        ctx: &ScanContext<'_>,
        state: &mut JellyfinScanState,
    ) -> Result<(), NightingaleError> {
        let mut start_index = 0usize;
        let mut parent_total = 0usize;

        loop {
            if !library_db::scan_generation_is_current(ctx.generation) {
                return Ok(());
            }
            let page = self.fetch_page(start_index, parent_id)?;
            let page_count = page.total_record_count.max(0) as usize;
            if page_count > 0 && page_count != parent_total {
                // Fold this library's reported size into the running total so
                // the progress-bar denominator grows as we discover libraries
                // instead of resetting per library. Final reconciliation in
                // `scan` corrects any divergence from actually-seen ids.
                state.expected_total = state.expected_total - parent_total + page_count;
                parent_total = page_count;
                let _ = library_db::update_library_meta(folder_label, state.expected_total);
            }
            let received = page.items.len();
            if received == 0 {
                break;
            }

            for item in page.items {
                if !library_db::scan_generation_is_current(ctx.generation) {
                    return Ok(());
                }
                if item.id.is_empty() {
                    continue;
                }
                state.seen_ids.push(item.id.clone());

                if state.known.contains(&item.id) {
                    let upstream_tag = item
                        .image_tags
                        .as_ref()
                        .and_then(|t| t.primary.clone())
                        .filter(|s| !s.is_empty());
                    let cached_tag = state.known_covers.get(&item.id).cloned().flatten();
                    if upstream_tag != cached_tag {
                        let _ = library_db::remote::refresh_remote_cover_for_item(
                            ORIGIN_KIND,
                            &item.id,
                            |item_id| {
                                upstream_tag
                                    .as_deref()
                                    .and_then(|t| self.fetch_cover(ctx.cache, item_id, t))
                            },
                        );
                    }
                    continue;
                }

                if let Some(song) = self.build_song(&item, ctx.cache, None) {
                    state.batch.push(song);
                }

                if state.batch.len() >= SCAN_BATCH_SIZE {
                    flush_batch(&mut state.batch, ctx.generation);
                }
            }

            start_index += received;
            if start_index >= parent_total {
                break;
            }
        }

        Ok(())
    }

    fn fetch_playlists(&self) -> Result<Vec<PlaylistDefinition>, NightingaleError> {
        let path = format!("/Users/{}/Items", self.auth.user_id);
        let result: ItemQueryResult = self.client.get_json(
            "list playlists",
            &path,
            &[
                ("Recursive", "true"),
                ("IncludeItemTypes", "Playlist"),
                ("SortBy", "SortName"),
                ("SortOrder", "Ascending"),
            ],
        )?;

        let mut playlists = Vec::new();
        for playlist in result.items {
            if playlist.id.is_empty() {
                continue;
            }
            let detail_path = format!("/Playlists/{}/Items", urlencoding::encode(&playlist.id));
            let detail: ItemQueryResult = match self.client.get_json(
                "list playlist items",
                &detail_path,
                &[("UserId", self.auth.user_id.as_str())],
            ) {
                Ok(detail) => detail,
                Err(error) => {
                    warn!("[jellyfin] skipping playlist {}: {error}", playlist.id);
                    continue;
                }
            };
            playlists.push(PlaylistDefinition {
                id: format!("jellyfin:{}", playlist.id),
                name: pick_string(playlist.name.as_deref(), "Playlist"),
                song_keys: detail
                    .items
                    .into_iter()
                    .filter_map(|item| (!item.id.is_empty()).then_some(item.id))
                    .collect(),
            });
        }
        Ok(playlists)
    }

    fn build_song(
        &self,
        item: &JellyfinItem,
        cache: &CacheDir,
        retained_cover: Option<PathBuf>,
    ) -> Option<Song> {
        if item.id.is_empty() {
            return None;
        }
        let item_id = item.id.clone();

        let stable_id = format!("jellyfin:{item_id}");
        let file_hash = blake3::hash(stable_id.as_bytes()).to_hex()[..32].to_string();

        let title = pick_string(item.name.as_deref(), "Unknown");
        let artist = pick_string(
            item.album_artist.as_deref().or_else(|| {
                item.artists
                    .as_ref()
                    .and_then(|v| v.first().map(|s| s.as_str()))
            }),
            "Unknown Artist",
        );
        let album = pick_string(item.album.as_deref(), "Unknown Album");
        let genre = item
            .genres
            .as_ref()
            .and_then(|g| g.first())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let duration_secs = item
            .run_time_ticks
            .map(|t| (t as f64) / 10_000_000.0)
            .unwrap_or(0.0);

        let media_type = item.media_type.as_deref().unwrap_or("");
        let item_type = item.item_type.as_deref().unwrap_or("");
        let is_video = media_type == "Video" || VIDEO_TYPES.contains(&item_type);

        let container = item.container.clone().or_else(|| {
            item.media_sources
                .as_ref()
                .and_then(|s| s.first())
                .and_then(|s| s.container.clone())
        });

        let placeholder_path = source_cache_path(cache, &file_hash, container.as_deref());

        let cover_tag = item
            .image_tags
            .as_ref()
            .and_then(|t| t.primary.clone())
            .filter(|s| !s.is_empty());
        let album_art_path = retained_cover.or_else(|| {
            cover_tag
                .as_deref()
                .and_then(|tag| self.fetch_cover(cache, &item_id, tag))
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
            is_video,
            usdx: None,
            origin: SongOrigin::Jellyfin {
                item_id,
                container,
                cover_tag,
            },
            no_stems: false,
        })
    }

    fn fetch_cover(&self, cache: &CacheDir, item_id: &str, tag: &str) -> Option<PathBuf> {
        let path = format!("/Items/{}/Images/Primary", urlencoding::encode(item_id));
        let width = COVER_FILL_WIDTH.to_string();
        let bytes = self
            .client
            .download_to_vec(
                "download cover",
                &path,
                &[("fillWidth", &width), ("fillHeight", &width), ("tag", tag)],
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
        let SongOrigin::Jellyfin {
            item_id, container, ..
        } = &song.origin
        else {
            return Err(NightingaleError::Other(
                "download_source called on non-Jellyfin song".into(),
            ));
        };

        let dest = source_cache_path(cache, &song.file_hash, container.as_deref());
        if dest.is_file() {
            return Ok(dest);
        }

        info!("[jellyfin] Downloading source for {item_id}");
        let path = format!("/Items/{}/Download", urlencoding::encode(item_id));
        let dest = self
            .download_client
            .download_to_file("download source", &path, &[], &dest)?;
        info!("[jellyfin] Saved source to {}", dest.display());
        Ok(dest)
    }

    fn open_video_stream(
        &self,
        item_id: &str,
        range: Option<&str>,
    ) -> Result<StreamResponse, NightingaleError> {
        let path = format!("/Videos/{}/stream", urlencoding::encode(item_id));
        self.download_client
            .open_stream("stream video", &path, &[("static", "true")], range)
    }
}

impl MediaSource for JellyfinSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Jellyfin
    }

    fn label(&self) -> String {
        format!("Jellyfin: {}", self.client.base_url())
    }

    fn scan(&self, ctx: &ScanContext<'_>) -> Result<(), NightingaleError> {
        let folder_label = self.label();
        let mut state = JellyfinScanState {
            known: library_db::remote::load_remote_item_ids(ORIGIN_KIND).unwrap_or_default(),
            known_covers: library_db::remote::load_remote_cover_tags(ORIGIN_KIND)
                .unwrap_or_default(),
            seen_ids: Vec::new(),
            batch: Vec::new(),
            expected_total: 0,
        };

        // An empty selection means "scan everything" (a single recursive query
        // with no `ParentId`), which also keeps configs written before library
        // selection existed working unchanged. Otherwise we run one paginated
        // recursive query per chosen library.
        if self.auth.library_ids.is_empty() {
            self.drain_parent(None, &folder_label, ctx, &mut state)?;
        } else {
            for library_id in &self.auth.library_ids {
                if !library_db::scan_generation_is_current(ctx.generation) {
                    return Ok(());
                }
                self.drain_parent(Some(library_id), &folder_label, ctx, &mut state)?;
            }
        }

        flush_batch(&mut state.batch, ctx.generation);

        if !library_db::scan_generation_is_current(ctx.generation) {
            return Ok(());
        }

        info!(
            "[jellyfin] Sync done — saw {} items, server reports {}",
            state.seen_ids.len(),
            state.expected_total
        );

        let _ = library_db::update_library_meta(
            &folder_label,
            state.expected_total.max(state.seen_ids.len()),
        );
        let _ =
            library_db::remote::delete_remote_songs_not_in_item_ids(ORIGIN_KIND, &state.seen_ids);

        match self.fetch_playlists() {
            Ok(playlists) => {
                if let Err(error) = library_db::replace_all_playlists(
                    &playlists,
                    PlaylistSongKeyKind::RemoteItemId {
                        origin_kind: ORIGIN_KIND,
                    },
                ) {
                    warn!("[jellyfin] failed to store playlists: {error}");
                }
            }
            Err(error) => warn!("[jellyfin] failed to sync playlists: {error}"),
        }

        Ok(())
    }

    fn refresh_metadata(&self, song: &mut Song, cache: &CacheDir) -> Result<(), NightingaleError> {
        let (item_id, current_tag) = match &song.origin {
            SongOrigin::Jellyfin {
                item_id, cover_tag, ..
            } => (item_id.clone(), cover_tag.clone()),
            _ => {
                return Err(NightingaleError::Other(
                    "Jellyfin source asked to refresh a non-Jellyfin song".into(),
                ));
            }
        };
        let item = self.fetch_item(&item_id)?;
        let next_tag = item
            .image_tags
            .as_ref()
            .and_then(|tags| tags.primary.clone())
            .filter(|tag| !tag.is_empty());
        let retained = retained_cover(song, next_tag == current_tag);
        let refreshed = self.build_song(&item, cache, retained).ok_or_else(|| {
            NightingaleError::Other(format!("Jellyfin item {item_id} has no usable metadata"))
        })?;
        if next_tag.is_some() && refreshed.album_art_path.is_none() {
            return Err(NightingaleError::Other(format!(
                "failed fetching Jellyfin cover for {item_id}"
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

    fn open_remote_stream(
        &self,
        song: &Song,
        range: Option<&str>,
    ) -> Result<Option<StreamResponse>, NightingaleError> {
        let SongOrigin::Jellyfin { item_id, .. } = &song.origin else {
            return Ok(None);
        };
        self.open_video_stream(item_id, range).map(Some)
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

/// Path of the on-disk cache file we materialise sources into. Also used as
/// the placeholder `Song.path` for unmaterialised Jellyfin rows — there is
/// only ever one representation.
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

/// A Jellyfin library (user view) the user can pick from at connect time.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct JellyfinLibrary {
    pub id: String,
    pub name: String,
    /// Jellyfin's `CollectionType` (e.g. `music`, `movies`, `tvshows`). Absent
    /// for mixed-content libraries.
    #[ts(optional)]
    pub collection_type: Option<String>,
}

/// Public auth response surfaced to the UI after a successful login.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct JellyfinLoginResult {
    pub server_url: String,
    pub server_name: Option<String>,
    pub user_id: String,
    pub username: String,
    pub access_token: String,
    pub device_id: String,
    /// Libraries the authenticated user can see, so the connect dialog can let
    /// them narrow the import. Empty if the listing call failed.
    pub libraries: Vec<JellyfinLibrary>,
}

/// Authenticate against a Jellyfin server. Generates a stable per-install
/// `device_id` if not supplied so this install shows up consistently in the
/// server's "Devices" UI.
pub fn login(
    base_url: &str,
    username: &str,
    password: &str,
    device_id: Option<String>,
) -> Result<JellyfinLoginResult, NightingaleError> {
    let server_url = trim_base_url(base_url);
    let device_id = device_id.unwrap_or_else(generate_device_id);

    let anon_client = JellyfinClient::new(&server_url, AuthHeaders::anonymous(device_id.clone()));

    #[derive(Serialize)]
    struct Body<'a> {
        #[serde(rename = "Username")]
        username: &'a str,
        #[serde(rename = "Pw")]
        pw: &'a str,
    }

    let auth: AuthByNameResponse = anon_client.post_json(
        "login",
        "/Users/AuthenticateByName",
        &Body {
            username,
            pw: password,
        },
    )?;

    let user_id = auth
        .user
        .as_ref()
        .map(|u| u.id.clone())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| NightingaleError::Other("Jellyfin login: missing user.Id".into()))?;
    let resolved_username = auth
        .user
        .as_ref()
        .map(|u| u.name.clone())
        .unwrap_or_else(|| username.to_string());

    let authed_client = JellyfinClient::new(
        &server_url,
        AuthHeaders::for_token(auth.access_token.clone(), device_id.clone()),
    );
    let server_name = fetch_public_info(&authed_client)
        .ok()
        .and_then(|i| i.server_name);
    let libraries = fetch_libraries(&authed_client, &user_id).unwrap_or_else(|error| {
        warn!("[jellyfin] failed to list libraries: {error}");
        Vec::new()
    });

    Ok(JellyfinLoginResult {
        server_url,
        server_name,
        user_id,
        username: resolved_username,
        access_token: auth.access_token,
        device_id,
        libraries,
    })
}

/// List the user's libraries (collection folders) via `/Users/{id}/Views`.
fn fetch_libraries(
    client: &JellyfinClient,
    user_id: &str,
) -> Result<Vec<JellyfinLibrary>, NightingaleError> {
    let path = format!("/Users/{}/Views", urlencoding::encode(user_id));
    let result: ItemQueryResult = client.get_json("list libraries", &path, &[])?;
    Ok(result
        .items
        .into_iter()
        .filter(|item| !item.id.is_empty())
        .map(|item| JellyfinLibrary {
            name: pick_string(item.name.as_deref(), "Library"),
            collection_type: item.collection_type.filter(|value| !value.is_empty()),
            id: item.id,
        })
        .collect())
}

#[derive(Debug, Clone, Deserialize)]
struct PublicInfo {
    #[serde(rename = "ServerName", default)]
    server_name: Option<String>,
    #[serde(rename = "Version", default)]
    version: Option<String>,
    #[serde(rename = "Id", default)]
    id: Option<String>,
}

fn fetch_public_info(client: &JellyfinClient) -> Result<PublicInfo, NightingaleError> {
    client.get_json("server info", "/System/Info/Public", &[])
}

/// Public ping payload surfaced to the UI. Renders the small "online / offline"
/// pill next to the Jellyfin source in the sidebar.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct JellyfinHealth {
    pub reachable: bool,
    #[ts(optional)]
    pub server_name: Option<String>,
    #[ts(optional)]
    pub version: Option<String>,
    #[ts(optional)]
    pub server_id: Option<String>,
    #[ts(optional)]
    pub error: Option<String>,
}

impl JellyfinHealth {
    pub fn offline(error: impl Into<String>) -> Self {
        Self {
            reachable: false,
            server_name: None,
            version: None,
            server_id: None,
            error: Some(error.into()),
        }
    }
}

/// Hit `/System/Info/Public` once. Cheap enough for the UI to poll on a slow
/// interval and serves as a smoke test for "is the server up and the
/// credentials still valid".
pub fn ping(auth: &JellyfinAuth) -> JellyfinHealth {
    match fetch_public_info(&auth.client()) {
        Ok(info) => JellyfinHealth {
            reachable: true,
            server_name: info.server_name,
            version: info.version,
            server_id: info.id,
            error: None,
        },
        Err(e) => JellyfinHealth::offline(e.to_string()),
    }
}

/// Convenience wrapper used by the bridge commands so neither transport has to
/// hand-roll the `LibrarySource::Jellyfin { ... } -> JellyfinAuth` destructure.
pub fn ping_current() -> JellyfinHealth {
    let config = AppConfig::load();
    match JellyfinAuth::from_config(&config) {
        Some(auth) => ping(&auth),
        None => JellyfinHealth::offline("no jellyfin source configured"),
    }
}

fn generate_device_id() -> String {
    // Cheap UUID-ish identifier — Blake3 over current time + os random is
    // plenty unique for a "this is the same Nightingale install" tag, and
    // saves us pulling in `uuid` for this one call site.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = blake3::Hasher::new();
    hasher.update(&nanos.to_le_bytes());
    hasher.update(&rand::random::<u128>().to_le_bytes());
    let hex = hasher.finalize().to_hex();
    hex[..24].to_string()
}

// ─── Jellyfin DTOs ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ItemQueryResult {
    #[serde(rename = "Items", default)]
    items: Vec<JellyfinItem>,
    #[serde(rename = "TotalRecordCount", default)]
    total_record_count: i64,
}

#[derive(Debug, Deserialize)]
struct JellyfinItem {
    #[serde(rename = "Id", default)]
    id: String,
    #[serde(rename = "Name", default)]
    name: Option<String>,
    #[serde(rename = "Album", default)]
    album: Option<String>,
    #[serde(rename = "AlbumArtist", default)]
    album_artist: Option<String>,
    #[serde(rename = "Artists", default)]
    artists: Option<Vec<String>>,
    #[serde(rename = "Genres", default)]
    genres: Option<Vec<String>>,
    #[serde(rename = "RunTimeTicks", default)]
    run_time_ticks: Option<u64>,
    #[serde(rename = "Container", default)]
    container: Option<String>,
    #[serde(rename = "MediaType", default)]
    media_type: Option<String>,
    #[serde(rename = "Type", default)]
    item_type: Option<String>,
    #[serde(rename = "MediaSources", default)]
    media_sources: Option<Vec<JellyfinMediaSource>>,
    #[serde(rename = "ImageTags", default)]
    image_tags: Option<ImageTags>,
    #[serde(rename = "CollectionType", default)]
    collection_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImageTags {
    #[serde(rename = "Primary", default)]
    primary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JellyfinMediaSource {
    #[serde(rename = "Container", default)]
    container: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthByNameResponse {
    #[serde(rename = "AccessToken")]
    access_token: String,
    #[serde(rename = "User", default)]
    user: Option<AuthUser>,
}

#[derive(Debug, Deserialize)]
struct AuthUser {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name", default)]
    name: String,
}
