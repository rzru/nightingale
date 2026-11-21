//! YouTube account linking and read-only access to the user's playlists.
//!
//! Uses the YouTube Data API v3 with the `youtube.readonly` scope only. The
//! OAuth client is a Google Cloud "Desktop app" client: Google treats its
//! secret as non-confidential for installed apps, and PKCE protects the code
//! exchange. Credentials come from `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`,
//! baked in at build time (process env or the workspace `.env`, see
//! `build.rs`) or read from the runtime environment.
//!
//! Quota: listing costs 1 unit per page of 50 items, so importing a
//! 500-track playlist is roughly 20 units out of the default 10 000/day.

use std::collections::HashMap;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use ureq::Agent;

use crate::error::NightingaleError;

use super::oauth::{self, AuthCallback, AuthStart, OAuthRequest};
use super::{AccountProvider, LinkedAccount, StoredAccount, now_secs};

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const API_BASE: &str = "https://www.googleapis.com/youtube/v3";
const SCOPES: &[&str] = &["https://www.googleapis.com/auth/youtube.readonly"];
/// `access_type=offline` + `prompt=consent` make Google return a refresh
/// token on every link, including a re-link after an unlink.
const AUTH_PARAMS: &[(&str, &str)] = &[("access_type", "offline"), ("prompt", "consent")];
const PAGE_SIZE: &str = "50";
/// Guard against runaway paging on huge "liked" lists.
const MAX_TRACKS: usize = 5000;

/// Pseudo playlist id for the user's liked videos (`videos?myRating=like`).
pub(crate) const LIKED_PLAYLIST_ID: &str = "liked";

struct ClientCredentials {
    client_id: String,
    client_secret: Option<String>,
}

fn configured_value(compiled: Option<&'static str>, key: &str) -> Option<String> {
    compiled
        .map(str::to_owned)
        .or_else(|| std::env::var(key).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn credentials() -> Result<ClientCredentials, NightingaleError> {
    let client_id = configured_value(option_env!("YOUTUBE_CLIENT_ID"), "YOUTUBE_CLIENT_ID")
        .ok_or_else(|| {
            NightingaleError::from(
                "YouTube is not configured: set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET",
            )
        })?;
    let client_secret = configured_value(
        option_env!("YOUTUBE_CLIENT_SECRET"),
        "YOUTUBE_CLIENT_SECRET",
    );
    Ok(ClientCredentials {
        client_id,
        client_secret,
    })
}

pub fn is_configured() -> bool {
    credentials().is_ok()
}

// ─── Linking ───────────────────────────────────────────────────────────────

/// Start the Google sign-in in the user's browser. Poll with `poll_auth`.
pub fn begin_link() -> Result<AuthStart, NightingaleError> {
    let creds = credentials()?;
    let request = OAuthRequest {
        auth_endpoint: AUTH_ENDPOINT,
        client_id: creds.client_id.clone(),
        scopes: SCOPES,
        extra_params: AUTH_PARAMS,
    };
    oauth::begin(
        request,
        Box::new(move |callback: AuthCallback| complete_link(&creds, &callback)),
    )
}

fn complete_link(
    creds: &ClientCredentials,
    callback: &AuthCallback,
) -> Result<LinkedAccount, NightingaleError> {
    let grant = oauth::exchange_code(
        TOKEN_ENDPOINT,
        &creds.client_id,
        creds.client_secret.as_deref(),
        callback,
    )?;
    let refresh_token = grant
        .refresh_token
        .clone()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| {
            NightingaleError::from(
                "Google did not return a refresh token; remove Nightingale from your Google \
                 account's third-party access and link again",
            )
        })?;

    let api = YouTubeApi::new(grant.access_token.clone());
    let channel = api.my_channel()?;
    let account = LinkedAccount {
        provider: AccountProvider::Youtube,
        account_id: channel.as_ref().map(|c| c.id.clone()).unwrap_or_default(),
        display_name: channel
            .and_then(|c| c.snippet)
            .map(|snippet| snippet.title)
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| "YouTube".into()),
        linked_at: now_secs(),
    };
    super::save_account(StoredAccount {
        account: account.clone(),
        refresh_token,
        access_expires_at: now_secs().saturating_add(grant.expires_in.unwrap_or(3600)),
        access_token: grant.access_token,
    })?;
    Ok(account)
}

/// Best-effort grant revocation after an unlink.
pub(crate) fn revoke(refresh_token: &str) {
    if refresh_token.is_empty() {
        return;
    }
    let config = Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build();
    let result = Agent::new_with_config(config)
        .post(REVOKE_ENDPOINT)
        .send_form([("token", refresh_token)]);
    if let Err(error) = result {
        tracing::warn!("YouTube token revocation failed: {error}");
    }
}

fn linked_api() -> Result<YouTubeApi, NightingaleError> {
    let creds = credentials()?;
    let token = super::access_token(AccountProvider::Youtube, |refresh_token| {
        oauth::refresh_access_token(
            TOKEN_ENDPOINT,
            &creds.client_id,
            creds.client_secret.as_deref(),
            refresh_token,
        )
    })?;
    Ok(YouTubeApi::new(token))
}

// ─── Public listing types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum YouTubePlaylistKind {
    /// The user's liked videos. The UI localises the title.
    Liked,
    Playlist,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct YouTubePlaylist {
    pub id: String,
    pub title: String,
    pub kind: YouTubePlaylistKind,
    pub item_count: Option<u32>,
    pub thumbnail_url: Option<String>,
}

/// One importable track, already split into artist / title.
#[derive(Debug, Clone)]
pub(crate) struct RemoteTrack {
    pub(crate) video_id: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) duration_secs: Option<f64>,
}

impl RemoteTrack {
    pub(crate) fn watch_url(&self) -> String {
        format!("https://www.youtube.com/watch?v={}", self.video_id)
    }
}

pub fn list_playlists() -> Result<Vec<YouTubePlaylist>, NightingaleError> {
    let api = linked_api()?;
    let mut playlists = vec![YouTubePlaylist {
        id: LIKED_PLAYLIST_ID.into(),
        title: "Liked videos".into(),
        kind: YouTubePlaylistKind::Liked,
        item_count: None,
        thumbnail_url: None,
    }];

    let mut page_token: Option<String> = None;
    loop {
        let mut query = vec![
            ("part", "snippet,contentDetails"),
            ("mine", "true"),
            ("maxResults", PAGE_SIZE),
        ];
        if let Some(token) = page_token.as_deref() {
            query.push(("pageToken", token));
        }
        let page: Page<PlaylistResource> = api.get("list playlists", "playlists", &query)?;
        playlists.extend(page.items.into_iter().map(PlaylistResource::into_playlist));
        match page.next_page_token {
            Some(token) if !token.is_empty() => page_token = Some(token),
            _ => break,
        }
    }
    Ok(playlists)
}

/// Fetch every playable track of a playlist (or of [`LIKED_PLAYLIST_ID`]).
/// Deleted and private videos are skipped.
pub(crate) fn fetch_playlist_tracks(
    playlist_id: &str,
) -> Result<Vec<RemoteTrack>, NightingaleError> {
    if !is_valid_playlist_id(playlist_id) {
        return Err(NightingaleError::from("invalid YouTube playlist id"));
    }
    let api = linked_api()?;
    if playlist_id == LIKED_PLAYLIST_ID {
        return fetch_liked(&api);
    }

    let mut entries: Vec<(String, String, String)> = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut query = vec![
            ("part", "snippet,contentDetails"),
            ("playlistId", playlist_id),
            ("maxResults", PAGE_SIZE),
        ];
        if let Some(token) = page_token.as_deref() {
            query.push(("pageToken", token));
        }
        let page: Page<PlaylistItemResource> =
            api.get("list playlist items", "playlistItems", &query)?;
        for item in page.items {
            let (Some(snippet), Some(details)) = (item.snippet, item.content_details) else {
                continue;
            };
            // Private / deleted entries have no owner channel.
            let Some(channel) = snippet.video_owner_channel_title else {
                continue;
            };
            if details.video_id.is_empty() {
                continue;
            }
            entries.push((details.video_id, snippet.title, channel));
        }
        if entries.len() >= MAX_TRACKS {
            entries.truncate(MAX_TRACKS);
            break;
        }
        match page.next_page_token {
            Some(token) if !token.is_empty() => page_token = Some(token),
            _ => break,
        }
    }

    let durations = api.durations(entries.iter().map(|(id, _, _)| id.as_str()))?;
    Ok(entries
        .into_iter()
        .map(|(video_id, raw_title, channel)| {
            let (artist, title) = split_artist_title(&raw_title, &channel);
            let duration_secs = durations.get(&video_id).copied();
            RemoteTrack {
                video_id,
                title,
                artist,
                duration_secs,
            }
        })
        .collect())
}

fn fetch_liked(api: &YouTubeApi) -> Result<Vec<RemoteTrack>, NightingaleError> {
    let mut tracks = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut query = vec![
            ("part", "snippet,contentDetails"),
            ("myRating", "like"),
            ("maxResults", PAGE_SIZE),
        ];
        if let Some(token) = page_token.as_deref() {
            query.push(("pageToken", token));
        }
        let page: Page<VideoResource> = api.get("list liked videos", "videos", &query)?;
        for video in page.items {
            let Some(snippet) = video.snippet else {
                continue;
            };
            let (artist, title) = split_artist_title(&snippet.title, &snippet.channel_title);
            tracks.push(RemoteTrack {
                duration_secs: video
                    .content_details
                    .and_then(|details| parse_iso8601_duration(&details.duration)),
                video_id: video.id,
                title,
                artist,
            });
        }
        if tracks.len() >= MAX_TRACKS {
            tracks.truncate(MAX_TRACKS);
            break;
        }
        match page.next_page_token {
            Some(token) if !token.is_empty() => page_token = Some(token),
            _ => break,
        }
    }
    Ok(tracks)
}

fn is_valid_playlist_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ─── API client ────────────────────────────────────────────────────────────

struct YouTubeApi {
    agent: Agent,
    access_token: String,
}

impl YouTubeApi {
    fn new(access_token: String) -> Self {
        let config = Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(10)))
            .timeout_recv_response(Some(Duration::from_secs(30)))
            .build();
        Self {
            agent: Agent::new_with_config(config),
            access_token,
        }
    }

    fn get<T: DeserializeOwned>(
        &self,
        stage: &'static str,
        resource: &str,
        query: &[(&str, &str)],
    ) -> Result<T, NightingaleError> {
        let mut request = self
            .agent
            .get(format!("{API_BASE}/{resource}"))
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", self.access_token));
        for (key, value) in query {
            request = request.query(*key, *value);
        }
        request
            .call()
            .map_err(|error| NightingaleError::youtube(stage, error))?
            .into_body()
            .read_json::<T>()
            .map_err(|error| NightingaleError::youtube(stage, error))
    }

    /// The signed-in user's channel, if the Google account has one.
    fn my_channel(&self) -> Result<Option<ChannelResource>, NightingaleError> {
        let page: Page<ChannelResource> = self.get(
            "load channel",
            "channels",
            &[("part", "snippet"), ("mine", "true")],
        )?;
        Ok(page.items.into_iter().next())
    }

    /// Durations in seconds, keyed by video id, 50 ids per request.
    fn durations<'a>(
        &self,
        ids: impl Iterator<Item = &'a str>,
    ) -> Result<HashMap<String, f64>, NightingaleError> {
        let ids: Vec<&str> = ids.collect();
        let mut durations = HashMap::with_capacity(ids.len());
        for chunk in ids.chunks(50) {
            let joined = chunk.join(",");
            let page: Page<VideoResource> = self.get(
                "load video durations",
                "videos",
                &[
                    ("part", "contentDetails"),
                    ("id", joined.as_str()),
                    ("maxResults", PAGE_SIZE),
                ],
            )?;
            for video in page.items {
                if let Some(seconds) = video
                    .content_details
                    .and_then(|details| parse_iso8601_duration(&details.duration))
                {
                    durations.insert(video.id, seconds);
                }
            }
        }
        Ok(durations)
    }
}

// ─── Wire types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page<T> {
    #[serde(default = "Vec::new")]
    items: Vec<T>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct ChannelResource {
    id: String,
    #[serde(default)]
    snippet: Option<ChannelSnippet>,
}

#[derive(Deserialize)]
struct ChannelSnippet {
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistResource {
    id: String,
    snippet: PlaylistSnippet,
    #[serde(default)]
    content_details: Option<PlaylistContentDetails>,
}

impl PlaylistResource {
    fn into_playlist(self) -> YouTubePlaylist {
        let thumbnail_url = self.snippet.thumbnails.and_then(|thumbnails| {
            thumbnails
                .medium
                .or(thumbnails.high)
                .or(thumbnails.default)
                .map(|thumbnail| thumbnail.url)
        });
        YouTubePlaylist {
            id: self.id,
            title: self.snippet.title,
            kind: YouTubePlaylistKind::Playlist,
            item_count: self.content_details.map(|details| details.item_count),
            thumbnail_url,
        }
    }
}

#[derive(Deserialize)]
struct PlaylistSnippet {
    title: String,
    #[serde(default)]
    thumbnails: Option<Thumbnails>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistContentDetails {
    #[serde(default)]
    item_count: u32,
}

#[derive(Deserialize)]
struct Thumbnails {
    #[serde(default)]
    default: Option<Thumbnail>,
    #[serde(default)]
    medium: Option<Thumbnail>,
    #[serde(default)]
    high: Option<Thumbnail>,
}

#[derive(Deserialize)]
struct Thumbnail {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistItemResource {
    #[serde(default)]
    snippet: Option<PlaylistItemSnippet>,
    #[serde(default)]
    content_details: Option<PlaylistItemDetails>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistItemSnippet {
    title: String,
    #[serde(default)]
    video_owner_channel_title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistItemDetails {
    #[serde(default)]
    video_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoResource {
    id: String,
    #[serde(default)]
    snippet: Option<VideoSnippet>,
    #[serde(default)]
    content_details: Option<VideoDetails>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoSnippet {
    title: String,
    #[serde(default)]
    channel_title: String,
}

#[derive(Deserialize)]
struct VideoDetails {
    #[serde(default)]
    duration: String,
}

// ─── Metadata heuristics ───────────────────────────────────────────────────

/// Bracketed groups containing one of these words are video noise, not part
/// of the song title: "(Official Video)", "[Lyrics]", "(Clip officiel)", …
const NOISE_WORDS: &[&str] = &[
    "official",
    "officiel",
    "officielle",
    "video",
    "vidéo",
    "audio",
    "lyric",
    "lyrics",
    "paroles",
    "clip",
    "visualizer",
    "visualiser",
    "hd",
    "hq",
    "4k",
    "mv",
];

const TITLE_SEPARATORS: &[&str] = &[" - ", " – ", " — ", " -- "];

/// Turn a YouTube title + channel into `(artist, title)`.
///
/// - YouTube Music auto-generated channels ("Artist - Topic") carry the
///   artist and a clean title.
/// - Otherwise "Artist - Title (Official Video)" is split on the first dash.
/// - Failing that, the channel name (minus a "VEVO" suffix) is the artist.
pub(crate) fn split_artist_title(raw_title: &str, channel: &str) -> (String, String) {
    let channel = channel.trim();
    if let Some(artist) = channel.strip_suffix(" - Topic") {
        return (artist.trim().to_owned(), clean_title(raw_title));
    }
    if let Some((artist, title)) = split_on_separator(raw_title) {
        let artist = artist.trim();
        let title = clean_title(title);
        if !artist.is_empty() && !title.is_empty() {
            return (artist.to_owned(), title);
        }
    }
    let artist = channel.strip_suffix("VEVO").unwrap_or(channel).trim();
    (artist.to_owned(), clean_title(raw_title))
}

fn split_on_separator(value: &str) -> Option<(&str, &str)> {
    TITLE_SEPARATORS
        .iter()
        .filter_map(|separator| value.find(separator).map(|index| (index, separator.len())))
        .min_by_key(|(index, _)| *index)
        .map(|(index, len)| (&value[..index], &value[index + len..]))
}

pub(crate) fn clean_title(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(open) = rest.find(['(', '[']) {
        let close_char = if rest[open..].starts_with('(') {
            ')'
        } else {
            ']'
        };
        let Some(relative_close) = rest[open + 1..].find(close_char) else {
            break;
        };
        let close = open + 1 + relative_close;
        result.push_str(&rest[..open]);
        if !is_noise_group(&rest[open + 1..close]) {
            result.push_str(&rest[open..=close]);
        }
        rest = &rest[close + 1..];
    }
    result.push_str(rest);
    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_noise_group(inner: &str) -> bool {
    inner
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| NOISE_WORDS.contains(&word))
}

/// Parse the ISO 8601 durations the Data API returns ("PT3M33S", "PT1H2M",
/// "P1DT2H"). Zero (live streams, premieres) reads as unknown.
pub(crate) fn parse_iso8601_duration(value: &str) -> Option<f64> {
    let rest = value.strip_prefix('P')?;
    let (date, time) = rest.split_once('T').unwrap_or((rest, ""));
    let total = sum_units(date, &[('W', 604_800.0), ('D', 86_400.0)])?
        + sum_units(time, &[('H', 3_600.0), ('M', 60.0), ('S', 1.0)])?;
    (total > 0.0).then_some(total)
}

fn sum_units(part: &str, units: &[(char, f64)]) -> Option<f64> {
    let mut total = 0.0;
    let mut number = String::new();
    for character in part.chars() {
        if character.is_ascii_digit() || character == '.' {
            number.push(character);
            continue;
        }
        let (_, factor) = units.iter().find(|(unit, _)| *unit == character)?;
        total += number.parse::<f64>().ok()? * factor;
        number.clear();
    }
    number.is_empty().then_some(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split(title: &str, channel: &str) -> (String, String) {
        split_artist_title(title, channel)
    }

    #[test]
    fn topic_channels_provide_the_artist() {
        assert_eq!(
            split("Bohemian Rhapsody (Remastered 2011)", "Queen - Topic"),
            ("Queen".into(), "Bohemian Rhapsody (Remastered 2011)".into())
        );
    }

    #[test]
    fn dash_titles_are_split_and_cleaned() {
        assert_eq!(
            split("Stromae - Alors on danse (Clip officiel)", "Stromae"),
            ("Stromae".into(), "Alors on danse".into())
        );
        assert_eq!(
            split(
                "Daft Punk – One More Time [Official Video] (HD)",
                "Daft Punk"
            ),
            ("Daft Punk".into(), "One More Time".into())
        );
    }

    #[test]
    fn vevo_channels_fall_back_to_channel_artist() {
        assert_eq!(
            split("Rolling in the Deep (Official Music Video)", "AdeleVEVO"),
            ("Adele".into(), "Rolling in the Deep".into())
        );
    }

    #[test]
    fn meaningful_brackets_are_kept() {
        assert_eq!(clean_title("Song (feat. Someone)"), "Song (feat. Someone)");
        assert_eq!(clean_title("Song (Live) [Lyrics]"), "Song (Live)");
        assert_eq!(clean_title("Unbalanced (bracket"), "Unbalanced (bracket");
    }

    #[test]
    fn iso_durations_parse() {
        assert_eq!(parse_iso8601_duration("PT3M33S"), Some(213.0));
        assert_eq!(parse_iso8601_duration("PT1H2M"), Some(3720.0));
        assert_eq!(parse_iso8601_duration("PT45S"), Some(45.0));
        assert_eq!(parse_iso8601_duration("P1DT1S"), Some(86_401.0));
        assert_eq!(parse_iso8601_duration("P0D"), None);
        assert_eq!(parse_iso8601_duration("3M"), None);
        assert_eq!(parse_iso8601_duration("PT3X"), None);
    }

    #[test]
    fn playlist_ids_are_validated() {
        assert!(is_valid_playlist_id("PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"));
        assert!(is_valid_playlist_id(LIKED_PLAYLIST_ID));
        assert!(!is_valid_playlist_id(""));
        assert!(!is_valid_playlist_id("PL&mine=true"));
    }

    #[test]
    fn pages_tolerate_missing_fields() {
        let parsed = serde_json::from_str::<Page<PlaylistItemResource>>(
            r#"{"items":[{"snippet":{"title":"Private video"},"contentDetails":{"videoId":"x"}}]}"#,
        );
        let page = match parsed {
            Ok(page) => page,
            Err(error) => panic!("page should parse: {error}"),
        };
        assert_eq!(page.items.len(), 1);
        assert!(page.next_page_token.is_none());
    }
}
