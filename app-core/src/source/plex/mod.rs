//! Plex music-library source.
//!
//! Authentication uses Plex's hosted PIN v2 flow and account resource
//! discovery. A manual PMS URL + token path is also exposed for advanced
//! setups. The cloud endpoints stop at authorization/discovery: all identity,
//! health, library, artwork, playlist, download, and streaming requests target
//! the selected PMS base URL (including direct LAN-only URLs). Tokens are
//! persisted through Nightingale's encrypted config envelope and are only sent
//! to Plex in the `X-Plex-Token` header.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;
use url::Url;

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

pub(crate) use client::PlexClient;

const ACCOUNT_BASE_URL: &str = "https://plex.tv";
const PRODUCT: &str = "Nightingale";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const PAGE_SIZE: usize = 200;
const ORIGIN_KIND: &str = "plex";
const TRACK_TYPE: &str = "10";
const CLIP_TYPE: &str = "12";

#[derive(Clone)]
pub struct PlexAuth {
    pub base_url: String,
    pub server_name: String,
    pub machine_id: String,
    pub username: String,
    pub access_token: String,
    pub client_id: String,
    pub section_ids: Vec<String>,
}

impl std::fmt::Debug for PlexAuth {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PlexAuth")
            .field("base_url", &self.base_url)
            .field("server_name", &self.server_name)
            .field("machine_id", &self.machine_id)
            .field("username", &self.username)
            .field("access_token", &"[REDACTED]")
            .field("client_id", &self.client_id)
            .field("section_ids", &self.section_ids)
            .finish()
    }
}

impl PlexAuth {
    pub fn from_source(source: &LibrarySource) -> Option<Self> {
        let LibrarySource::Plex {
            base_url,
            server_name,
            machine_id,
            username,
            access_token,
            client_id,
            section_ids,
        } = source
        else {
            return None;
        };
        Some(Self {
            base_url: base_url.clone(),
            server_name: server_name.clone(),
            machine_id: machine_id.clone(),
            username: username.clone(),
            access_token: access_token.clone(),
            client_id: client_id.clone(),
            section_ids: section_ids.clone(),
        })
    }

    pub fn from_config(config: &AppConfig) -> Option<Self> {
        config.library_source.as_ref().and_then(Self::from_source)
    }

    pub fn client(&self) -> PlexClient {
        PlexClient::new(&self.base_url, &self.access_token, &self.client_id)
    }

    pub fn download_client(&self) -> PlexClient {
        PlexClient::for_downloads(&self.base_url, &self.access_token, &self.client_id)
    }
}

pub struct PlexSource {
    auth: PlexAuth,
    client: PlexClient,
    download_client: PlexClient,
}

struct PlexScanState {
    known: HashSet<String>,
    known_covers: HashMap<String, Option<String>>,
    seen_ids: HashSet<String>,
    batch: Vec<Song>,
    expected_total: usize,
}

impl PlexSource {
    pub fn new(auth: PlexAuth) -> Self {
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
        section_id: &str,
        media_type: &str,
        offset: usize,
    ) -> Result<MetadataContainer, NightingaleError> {
        let path = format!("/library/sections/{}/all", urlencoding::encode(section_id));
        let start = offset.to_string();
        let size = PAGE_SIZE.to_string();
        let envelope: MetadataEnvelope = self.client.get_json(
            "list section items",
            &path,
            &[
                ("type", media_type),
                ("sort", "titleSort:asc"),
                ("X-Plex-Container-Start", &start),
                ("X-Plex-Container-Size", &size),
            ],
        )?;
        Ok(envelope.media_container)
    }

    fn fetch_item(&self, item_id: &str) -> Result<PlexMetadata, NightingaleError> {
        let path = format!("/library/metadata/{}", urlencoding::encode(item_id));
        let envelope: MetadataEnvelope = self.client.get_json("get item", &path, &[])?;
        envelope
            .media_container
            .metadata
            .into_iter()
            .next()
            .ok_or_else(|| NightingaleError::Other(format!("Plex item {item_id} not found")))
    }

    fn build_song(
        &self,
        item: &PlexMetadata,
        cache: &CacheDir,
        retained_cover: Option<PathBuf>,
    ) -> Option<Song> {
        if item.rating_key.is_empty() {
            return None;
        }
        let item_type = item.item_type.as_deref().unwrap_or_default();
        if item_type != "track" && item_type != "clip" {
            return None;
        }

        let part = item
            .media
            .iter()
            .flat_map(|media| media.parts.iter())
            .find(|part| !part.key.is_empty())?;
        if !safe_server_path(&part.key) {
            warn!("[plex] skipping item with unsafe media path");
            return None;
        }

        let item_id = item.rating_key.clone();
        let stable_id = format!("plex:{item_id}");
        let file_hash = blake3::hash(stable_id.as_bytes()).to_hex()[..32].to_owned();
        let container = part
            .container
            .clone()
            .or_else(|| item.media.first().and_then(|media| media.container.clone()));
        let cover_tag = item.thumb.clone().filter(|path| safe_server_path(path));
        let album_art_path = retained_cover.or_else(|| {
            cover_tag
                .as_deref()
                .and_then(|path| self.fetch_cover(cache, path))
        });

        Some(Song {
            path: source_cache_path(cache, &file_hash, container.as_deref()),
            file_hash,
            title: pick_string(item.title.as_deref(), "Unknown"),
            artist: pick_string(
                item.grandparent_title
                    .as_deref()
                    .or(item.original_title.as_deref()),
                "Unknown Artist",
            ),
            album: pick_string(item.parent_title.as_deref(), "Unknown Album"),
            genre: item
                .genre
                .first()
                .and_then(|t| t.tag.as_deref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string()),
            duration_secs: item
                .duration
                .map(|value| value as f64 / 1000.0)
                .unwrap_or(0.0),
            album_art_path,
            is_analyzed: false,
            language: None,
            transcript_source: None,
            key: None,
            override_key: None,
            tempo: 1.0,
            key_offset: 0,
            is_video: item_type == "clip",
            usdx: None,
            origin: SongOrigin::Plex {
                item_id,
                part_key: part.key.clone(),
                container,
                cover_tag,
            },
            no_stems: false,
        })
    }

    fn fetch_cover(&self, cache: &CacheDir, path: &str) -> Option<PathBuf> {
        if !safe_server_path(path) {
            return None;
        }
        let bytes = self.client.download_to_vec("download cover", path).ok()?;
        if bytes.is_empty() {
            return None;
        }
        let cover_hash = blake3::hash(&bytes).to_hex()[..32].to_owned();
        let cover_path = cache.cover_path(&cover_hash);
        if !cover_path.exists() {
            std::fs::write(&cover_path, bytes).ok()?;
        }
        Some(cover_path)
    }

    fn scan_media_type(
        &self,
        section_id: &str,
        media_type: &str,
        ctx: &ScanContext<'_>,
        state: &mut PlexScanState,
    ) -> Result<(), NightingaleError> {
        let mut offset = 0usize;
        let mut first_page = true;
        loop {
            if !library_db::scan_generation_is_current(ctx.generation) {
                return Ok(());
            }
            let page = self.fetch_page(section_id, media_type, offset)?;
            if first_page {
                state.expected_total += page.total_size.unwrap_or(page.metadata.len());
                let _ = library_db::update_library_meta(&self.label(), state.expected_total);
                first_page = false;
            }
            let received = page.metadata.len();
            if received == 0 {
                break;
            }

            for item in page.metadata {
                if item.rating_key.is_empty() || !state.seen_ids.insert(item.rating_key.clone()) {
                    continue;
                }
                if state.known.contains(&item.rating_key) {
                    let upstream_tag = item.thumb.clone().filter(|path| safe_server_path(path));
                    let cached_tag = state.known_covers.get(&item.rating_key).cloned().flatten();
                    if upstream_tag != cached_tag {
                        let _ = library_db::remote::refresh_remote_cover_for_item(
                            ORIGIN_KIND,
                            &item.rating_key,
                            |_| {
                                upstream_tag
                                    .as_deref()
                                    .and_then(|path| self.fetch_cover(ctx.cache, path))
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

            offset += received;
            if offset >= page.total_size.unwrap_or(offset) {
                break;
            }
        }
        Ok(())
    }

    fn fetch_playlists(&self) -> Result<Vec<PlaylistDefinition>, NightingaleError> {
        let envelope: MetadataEnvelope =
            self.client
                .get_json("list playlists", "/playlists", &[("playlistType", "audio")])?;
        let mut playlists = Vec::new();
        for playlist in envelope.media_container.metadata {
            if playlist.rating_key.is_empty() {
                continue;
            }
            let path = playlist
                .key
                .filter(|key| safe_server_path(key))
                .unwrap_or_else(|| format!("/playlists/{}/items", playlist.rating_key));
            let detail: MetadataEnvelope = match self.client.get_json(
                "list playlist items",
                &path,
                &[("X-Plex-Container-Size", "10000")],
            ) {
                Ok(detail) => detail,
                Err(error) => {
                    warn!("[plex] skipping playlist {}: {error}", playlist.rating_key);
                    continue;
                }
            };
            playlists.push(PlaylistDefinition {
                id: format!("plex:{}", playlist.rating_key),
                name: pick_string(playlist.title.as_deref(), "Playlist"),
                song_keys: detail
                    .media_container
                    .metadata
                    .into_iter()
                    .filter_map(|item| (!item.rating_key.is_empty()).then_some(item.rating_key))
                    .collect(),
            });
        }
        Ok(playlists)
    }
}

impl MediaSource for PlexSource {
    fn kind(&self) -> SourceKind {
        SourceKind::Plex
    }

    fn label(&self) -> String {
        let identity = if self.auth.machine_id.is_empty() {
            &self.auth.base_url
        } else {
            &self.auth.machine_id
        };
        format!("Plex: {} ({identity})", self.auth.server_name)
    }

    fn scan(&self, ctx: &ScanContext<'_>) -> Result<(), NightingaleError> {
        if self.auth.section_ids.is_empty() {
            return Err(NightingaleError::Other(
                "Plex source has no selected music libraries".into(),
            ));
        }
        let mut state = PlexScanState {
            known: library_db::remote::load_remote_item_ids(ORIGIN_KIND).unwrap_or_default(),
            known_covers: library_db::remote::load_remote_cover_tags(ORIGIN_KIND)
                .unwrap_or_default(),
            seen_ids: HashSet::new(),
            batch: Vec::new(),
            expected_total: 0,
        };
        let mut complete_catalogue = true;

        for section_id in &self.auth.section_ids {
            if !library_db::scan_generation_is_current(ctx.generation) {
                return Ok(());
            }
            self.scan_media_type(section_id, TRACK_TYPE, ctx, &mut state)?;
            if !library_db::scan_generation_is_current(ctx.generation) {
                return Ok(());
            }
            // Clips returned by a selected music section are associated video
            // items. Failure here must not make an otherwise valid music
            // library unusable on older PMS versions that reject type=12.
            if let Err(error) = self.scan_media_type(section_id, CLIP_TYPE, ctx, &mut state) {
                // Do not prune against a partial catalogue. This covers both
                // older PMS versions without clip enumeration and transient
                // failures after one or more clip pages.
                complete_catalogue = false;
                warn!("[plex] associated video scan unavailable for section {section_id}: {error}");
            }
        }

        if !library_db::scan_generation_is_current(ctx.generation) {
            return Ok(());
        }
        flush_batch(&mut state.batch, ctx.generation);
        let seen_ids: Vec<String> = state.seen_ids.into_iter().collect();
        let _ = library_db::update_library_meta(&self.label(), seen_ids.len());
        if complete_catalogue {
            let _ = library_db::remote::delete_remote_songs_not_in_item_ids(ORIGIN_KIND, &seen_ids);
        }
        info!("[plex] Sync done — saw {} items", seen_ids.len());

        match self.fetch_playlists() {
            Ok(playlists) => {
                if !library_db::scan_generation_is_current(ctx.generation) {
                    return Ok(());
                }
                if let Err(error) = library_db::replace_all_playlists(
                    &playlists,
                    PlaylistSongKeyKind::RemoteItemId {
                        origin_kind: ORIGIN_KIND,
                    },
                ) {
                    warn!("[plex] failed to store playlists: {error}");
                }
            }
            Err(error) => warn!("[plex] failed to sync playlists: {error}"),
        }
        Ok(())
    }

    fn refresh_metadata(&self, song: &mut Song, cache: &CacheDir) -> Result<(), NightingaleError> {
        let (item_id, current_tag) = match &song.origin {
            SongOrigin::Plex {
                item_id, cover_tag, ..
            } => (item_id.clone(), cover_tag.clone()),
            _ => {
                return Err(NightingaleError::Other(
                    "Plex source asked to refresh a non-Plex song".into(),
                ));
            }
        };
        let item = self.fetch_item(&item_id)?;
        let next_tag = item.thumb.clone().filter(|path| safe_server_path(path));
        let retained = retained_cover(song, next_tag == current_tag);
        let refreshed = self.build_song(&item, cache, retained).ok_or_else(|| {
            NightingaleError::Other(format!("Plex item {item_id} has no usable metadata"))
        })?;
        if next_tag.is_some() && refreshed.album_art_path.is_none() {
            return Err(NightingaleError::Other(format!(
                "failed fetching Plex cover for {item_id}"
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
        if song.path.is_file() {
            return Ok(song.path.clone());
        }
        let SongOrigin::Plex {
            item_id,
            part_key,
            container,
            ..
        } = &song.origin
        else {
            return Err(NightingaleError::Other(
                "Plex source asked to download a non-Plex song".into(),
            ));
        };
        if !safe_server_path(part_key) {
            return Err(NightingaleError::Other(
                "Plex returned an unsafe media path".into(),
            ));
        }
        let destination = source_cache_path(cache, &song.file_hash, container.as_deref());
        info!("[plex] Downloading source for {item_id}");
        self.download_client
            .download_to_file("download source", part_key, &destination)
    }

    fn open_remote_stream(
        &self,
        song: &Song,
        range: Option<&str>,
    ) -> Result<Option<StreamResponse>, NightingaleError> {
        if !song.is_video {
            return Ok(None);
        }
        let SongOrigin::Plex { part_key, .. } = &song.origin else {
            return Ok(None);
        };
        self.download_client
            .open_stream("stream video", part_key, range)
            .map(Some)
    }
}

fn source_cache_path(cache: &CacheDir, file_hash: &str, container: Option<&str>) -> PathBuf {
    let directory = cache.path.join("sources");
    let _ = std::fs::create_dir_all(&directory);
    let extension = container
        .filter(|value| value.chars().all(|ch| ch.is_ascii_alphanumeric()))
        .unwrap_or("bin");
    directory.join(format!("{file_hash}.{extension}"))
}

fn safe_server_path(path: &str) -> bool {
    if !path.starts_with('/') || path.starts_with("//") {
        return false;
    }
    let Ok(parsed) = Url::parse(&format!("http://nightingale.invalid{path}")) else {
        return false;
    };
    parsed.fragment().is_none()
        && !parsed
            .query_pairs()
            .any(|(key, _)| key.eq_ignore_ascii_case("X-Plex-Token"))
}

fn pick_string(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_owned()
}

// ─── Hosted PIN authentication and discovery ───────────────────────

#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlexPinStart {
    pub pin_id: String,
    pub code: String,
    pub client_id: String,
    pub auth_url: String,
    pub expires_in: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlexSection {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlexServer {
    pub server_url: String,
    pub server_name: String,
    pub server_id: String,
    pub username: String,
    pub access_token: String,
    pub client_id: String,
    pub sections: Vec<PlexSection>,
    pub owned: bool,
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlexPinPollResult {
    pub authorized: bool,
    pub servers: Vec<PlexServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlexHealth {
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

pub fn begin_pin(client_id: Option<String>) -> Result<PlexPinStart, NightingaleError> {
    let client_id = client_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(generate_client_id);
    let agent = account_agent();
    let endpoint = format!("{ACCOUNT_BASE_URL}/api/v2/pins");
    let response = agent
        .post(endpoint)
        .header("Accept", "application/json")
        .header("X-Plex-Client-Identifier", &client_id)
        .header("X-Plex-Product", PRODUCT)
        .header("X-Plex-Version", VERSION)
        .query("strong", "true")
        .send_empty()
        .map_err(|error| NightingaleError::plex("start hosted sign-in", error))?;
    let pin: AccountPin = response
        .into_body()
        .read_json()
        .map_err(|error| NightingaleError::plex("read hosted sign-in", error))?;
    if pin.id == 0 || pin.code.is_empty() {
        return Err(NightingaleError::Other(
            "Plex hosted sign-in returned an invalid PIN".into(),
        ));
    }
    let context = urlencoding::encode("Nightingale");
    let auth_url = format!(
        "https://app.plex.tv/auth#?clientID={}&code={}&context%5Bdevice%5D%5Bproduct%5D={context}",
        urlencoding::encode(&client_id),
        urlencoding::encode(&pin.code),
    );
    Ok(PlexPinStart {
        pin_id: pin.id.to_string(),
        code: pin.code,
        client_id,
        auth_url,
        expires_in: pin.expires_in.unwrap_or(300).min(u32::MAX as u64) as u32,
    })
}

pub fn poll_pin(pin_id: &str, client_id: &str) -> Result<PlexPinPollResult, NightingaleError> {
    if pin_id.is_empty()
        || !pin_id.chars().all(|character| character.is_ascii_digit())
        || client_id.trim().is_empty()
    {
        return Err(NightingaleError::Other("invalid Plex PIN request".into()));
    }
    let agent = account_agent();
    let endpoint = format!("{ACCOUNT_BASE_URL}/api/v2/pins/{pin_id}");
    let response = account_headers(agent.get(endpoint), client_id, None)
        .call()
        .map_err(|error| NightingaleError::plex("check hosted sign-in", error))?;
    let pin: AccountPin = response
        .into_body()
        .read_json()
        .map_err(|error| NightingaleError::plex("read hosted sign-in", error))?;
    let Some(account_token) = pin.auth_token.filter(|token| !token.is_empty()) else {
        return Ok(PlexPinPollResult {
            authorized: false,
            servers: Vec::new(),
        });
    };

    let username = fetch_account_username(&agent, client_id, &account_token)
        .unwrap_or_else(|| "Plex account".into());
    let servers = discover_servers(&agent, client_id, &account_token, &username)?;
    Ok(PlexPinPollResult {
        authorized: true,
        servers,
    })
}

pub fn manual_login(
    base_url: &str,
    access_token: &str,
    client_id: Option<String>,
) -> Result<PlexServer, NightingaleError> {
    if access_token.trim().is_empty() {
        return Err(NightingaleError::Other("Plex token is required".into()));
    }
    let server_url = normalize_server_url(base_url)?;
    let client_id = client_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(generate_client_id);
    probe_server(
        &server_url,
        access_token,
        &client_id,
        "Plex account",
        true,
        None,
        false,
    )
}

pub fn ping(auth: &PlexAuth) -> PlexHealth {
    let identity: Result<IdentityEnvelope, _> =
        auth.client().get_json("health check", "/identity", &[]);
    match identity {
        Ok(identity) => PlexHealth {
            reachable: true,
            server_name: Some(auth.server_name.clone()),
            version: identity.media_container.version,
            server_id: identity
                .media_container
                .machine_identifier
                .or_else(|| Some(auth.machine_id.clone())),
            error: None,
        },
        Err(error) => PlexHealth {
            reachable: false,
            server_name: Some(auth.server_name.clone()),
            version: None,
            server_id: Some(auth.machine_id.clone()),
            error: Some(error.to_string()),
        },
    }
}

pub fn ping_current() -> PlexHealth {
    match PlexAuth::from_config(&AppConfig::load()) {
        Some(auth) => ping(&auth),
        None => PlexHealth {
            reachable: false,
            server_name: None,
            version: None,
            server_id: None,
            error: Some("no Plex source configured".into()),
        },
    }
}

fn account_agent() -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(10)))
        .timeout_recv_response(Some(std::time::Duration::from_secs(30)))
        .build();
    ureq::Agent::new_with_config(config)
}

fn account_headers(
    request: ureq::RequestBuilder<ureq::typestate::WithoutBody>,
    client_id: &str,
    token: Option<&str>,
) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
    let request = request
        .header("Accept", "application/json")
        .header("X-Plex-Client-Identifier", client_id)
        .header("X-Plex-Product", PRODUCT)
        .header("X-Plex-Version", VERSION);
    match token {
        Some(token) => request.header("X-Plex-Token", token),
        None => request,
    }
}

fn fetch_account_username(agent: &ureq::Agent, client_id: &str, token: &str) -> Option<String> {
    let response = account_headers(
        agent.get(format!("{ACCOUNT_BASE_URL}/api/v2/user")),
        client_id,
        Some(token),
    )
    .call()
    .ok()?;
    let account: AccountUser = response.into_body().read_json().ok()?;
    account
        .username
        .or(account.title)
        .filter(|value| !value.is_empty())
}

fn discover_servers(
    agent: &ureq::Agent,
    client_id: &str,
    account_token: &str,
    username: &str,
) -> Result<Vec<PlexServer>, NightingaleError> {
    let response = account_headers(
        agent.get(format!("{ACCOUNT_BASE_URL}/api/v2/resources")),
        client_id,
        Some(account_token),
    )
    .query("includeHttps", "1")
    .query("includeRelay", "1")
    .call()
    .map_err(|error| NightingaleError::plex("discover servers", error))?;
    let resources: Vec<AccountResource> = response
        .into_body()
        .read_json()
        .map_err(|error| NightingaleError::plex("read discovered servers", error))?;

    let mut servers = Vec::new();
    for resource in resources {
        if !resource.product.eq_ignore_ascii_case("Plex Media Server") {
            continue;
        }
        let token = resource
            .access_token
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or(account_token);
        let mut connections = resource.connections;
        connections.sort_by_key(connection_rank);
        for connection in connections {
            let Ok(url) = normalize_server_url(&connection.uri) else {
                continue;
            };
            match probe_server(
                &url,
                token,
                client_id,
                username,
                resource.owned,
                Some((&resource.name, &resource.client_identifier)),
                true,
            ) {
                Ok(server) => {
                    servers.push(server);
                    break;
                }
                Err(error) => warn!("[plex] advertised connection unavailable: {error}"),
            }
        }
    }
    Ok(servers)
}

fn connection_rank(connection: &AccountConnection) -> u8 {
    let https =
        connection.protocol.eq_ignore_ascii_case("https") || connection.uri.starts_with("https://");
    match (https, connection.local, connection.relay) {
        (true, true, false) => 0,
        (false, true, false) => 1,
        (true, false, false) => 2,
        (_, _, true) => 4,
        _ => 3,
    }
}

fn probe_server(
    base_url: &str,
    token: &str,
    client_id: &str,
    username: &str,
    owned: bool,
    resource_identity: Option<(&str, &str)>,
    advertised: bool,
) -> Result<PlexServer, NightingaleError> {
    let client = if advertised {
        PlexClient::for_discovery(base_url, token, client_id)
    } else {
        PlexClient::new(base_url, token, client_id)
    };
    let identity: IdentityEnvelope = client.get_json("verify server", "/identity", &[])?;
    let root: Option<IdentityEnvelope> = client.get_json("read server info", "/", &[]).ok();
    let machine_id = identity
        .media_container
        .machine_identifier
        .or_else(|| {
            root.as_ref()
                .and_then(|value| value.media_container.machine_identifier.clone())
        })
        .or_else(|| resource_identity.map(|(_, id)| id.to_owned()))
        .unwrap_or_default();
    let server_name = root
        .and_then(|value| value.media_container.friendly_name)
        .or_else(|| resource_identity.map(|(name, _)| name.to_owned()))
        .unwrap_or_else(|| "Plex Media Server".into());
    let sections = fetch_sections(&client)?;
    Ok(PlexServer {
        server_url: base_url.to_owned(),
        server_name,
        server_id: machine_id,
        username: username.to_owned(),
        access_token: token.to_owned(),
        client_id: client_id.to_owned(),
        sections,
        owned,
    })
}

fn fetch_sections(client: &PlexClient) -> Result<Vec<PlexSection>, NightingaleError> {
    let envelope: SectionEnvelope = client.get_json("list libraries", "/library/sections", &[])?;
    Ok(envelope
        .media_container
        .directories
        .into_iter()
        .filter(|section| section.section_type == "artist" && !section.key.is_empty())
        .map(|section| PlexSection {
            id: section.key,
            title: pick_string(section.title.as_deref(), "Music"),
        })
        .collect())
}

fn normalize_server_url(raw: &str) -> Result<String, NightingaleError> {
    let trimmed = raw.trim().trim_end_matches('/');
    let parsed = Url::parse(trimmed)
        .map_err(|_| NightingaleError::Other("Enter a valid Plex server URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(NightingaleError::Other(
            "Plex server URL must be an http(s) URL without credentials or query parameters".into(),
        ));
    }
    Ok(trimmed.to_owned())
}

fn generate_client_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let mut hasher = blake3::Hasher::new();
    hasher.update(&nanos.to_le_bytes());
    hasher.update(&rand::random::<u128>().to_le_bytes());
    hasher.finalize().to_hex()[..24].to_owned()
}

// ─── API DTOs ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AccountPin {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    code: String,
    #[serde(rename = "authToken", default)]
    auth_token: Option<String>,
    #[serde(rename = "expiresIn", default)]
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct AccountUser {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize)]
struct AccountResource {
    #[serde(default, alias = "Product")]
    product: String,
    #[serde(default, alias = "Name")]
    name: String,
    #[serde(rename = "clientIdentifier", default, alias = "ClientIdentifier")]
    client_identifier: String,
    #[serde(rename = "accessToken", default, alias = "AccessToken")]
    access_token: Option<String>,
    #[serde(default)]
    owned: bool,
    #[serde(default)]
    connections: Vec<AccountConnection>,
}

#[derive(Deserialize)]
struct AccountConnection {
    #[serde(default)]
    uri: String,
    #[serde(default)]
    protocol: String,
    #[serde(default)]
    local: bool,
    #[serde(default)]
    relay: bool,
}

#[derive(Deserialize)]
struct IdentityEnvelope {
    #[serde(rename = "MediaContainer")]
    media_container: IdentityContainer,
}

#[derive(Deserialize)]
struct IdentityContainer {
    #[serde(rename = "machineIdentifier", default)]
    machine_identifier: Option<String>,
    #[serde(rename = "friendlyName", default)]
    friendly_name: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Deserialize)]
struct SectionEnvelope {
    #[serde(rename = "MediaContainer")]
    media_container: SectionContainer,
}

#[derive(Deserialize)]
struct SectionContainer {
    #[serde(rename = "Directory", default)]
    directories: Vec<PlexDirectory>,
}

#[derive(Deserialize)]
struct PlexDirectory {
    #[serde(default)]
    key: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(rename = "type", default)]
    section_type: String,
}

#[derive(Deserialize)]
struct MetadataEnvelope {
    #[serde(rename = "MediaContainer")]
    media_container: MetadataContainer,
}

#[derive(Deserialize)]
struct MetadataContainer {
    #[serde(rename = "Metadata", default)]
    metadata: Vec<PlexMetadata>,
    #[serde(rename = "totalSize", default)]
    total_size: Option<usize>,
}

#[derive(Deserialize)]
struct PlexMetadata {
    #[serde(rename = "ratingKey", default)]
    rating_key: String,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(rename = "parentTitle", default)]
    parent_title: Option<String>,
    #[serde(rename = "grandparentTitle", default)]
    grandparent_title: Option<String>,
    #[serde(rename = "originalTitle", default)]
    original_title: Option<String>,
    #[serde(default)]
    duration: Option<u64>,
    #[serde(rename = "type", default)]
    item_type: Option<String>,
    #[serde(default)]
    thumb: Option<String>,
    #[serde(rename = "Media", default)]
    media: Vec<PlexMedia>,
    #[serde(rename = "Genre", default)]
    genre: Vec<PlexTag>,
}

#[derive(Deserialize)]
struct PlexMedia {
    #[serde(default)]
    container: Option<String>,
    #[serde(rename = "Part", default)]
    parts: Vec<PlexPart>,
}

#[derive(Deserialize)]
struct PlexPart {
    #[serde(default)]
    key: String,
    #[serde(default)]
    container: Option<String>,
}

#[derive(Deserialize)]
struct PlexTag {
    #[serde(default)]
    tag: Option<String>,
}
