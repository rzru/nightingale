//! "Use my YouTube session": read the user's playlists with the YouTube
//! session of their everyday browser, through yt-dlp's
//! `--cookies-from-browser`.
//!
//! No OAuth client, no Google Cloud project, no token storage: the only thing
//! persisted is *which browser* to read. The user signs in to YouTube in that
//! browser as they normally would; Nightingale reads the cookies at the moment
//! it lists playlists and never copies them elsewhere. Downloads themselves
//! stay anonymous.
//!
//! Browser support follows yt-dlp: Firefox is the most reliable; Chromium
//! browsers on Windows encrypt cookies per application (Chrome 127+), which
//! blocks external readers.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::NightingaleError;
use crate::ytdlp;

use super::youtube::{
    LIKED_PLAYLIST_ID, MAX_TRACKS, RemoteTrack, YouTubePlaylist, YouTubePlaylistKind,
    split_artist_title,
};
use super::{AccountProvider, LinkedAccount, StoredAccount, now_secs};

/// Browsers yt-dlp can read cookies from, by its own names.
pub(crate) const SUPPORTED_BROWSERS: &[&str] = &[
    "firefox", "chrome", "chromium", "brave", "edge", "opera", "vivaldi", "safari",
];

/// Opened in the default browser so the user can sign in if needed.
const SIGN_IN_URL: &str = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
const LIKED_URL: &str = "https://www.youtube.com/playlist?list=LL";
const PLAYLISTS_FEED_URL: &str = "https://www.youtube.com/feed/playlists";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionStart {
    /// yt-dlp name of the system default browser, when it is supported.
    pub detected_browser: Option<String>,
    pub supported_browsers: Vec<String>,
    /// YouTube sign-in page to open in that browser.
    pub sign_in_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SessionConnectStatus {
    Connected,
    /// The browser has no YouTube session: sign in there, then retry.
    NotSignedIn,
    /// Cookies could not be read, or yt-dlp failed for another reason.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionConnectResult {
    pub status: SessionConnectStatus,
    pub account: Option<LinkedAccount>,
    pub error: Option<String>,
}

pub fn begin_session() -> SessionStart {
    SessionStart {
        detected_browser: detect_default_browser().map(str::to_owned),
        supported_browsers: SUPPORTED_BROWSERS.iter().map(|b| (*b).to_owned()).collect(),
        sign_in_url: SIGN_IN_URL.to_owned(),
    }
}

/// Check that `browser` holds a YouTube session and remember it. Installs
/// yt-dlp first if needed, so the first call can take a while.
pub fn connect_session(browser: &str) -> Result<SessionConnectResult, NightingaleError> {
    if !SUPPORTED_BROWSERS.contains(&browser) {
        return Err(NightingaleError::Other(format!(
            "unsupported browser: {browser}"
        )));
    }
    ytdlp::ensure_installed().map_err(NightingaleError::Other)?;

    // The liked-videos list only exists for a signed-in user: a cheap probe.
    let probe =
        ytdlp::fetch_json_with_browser_cookies(LIKED_URL, browser, &["--playlist-items", "1"]);
    let json = match probe {
        Ok(json) => json,
        Err(error) if looks_signed_out(&error) => {
            return Ok(SessionConnectResult {
                status: SessionConnectStatus::NotSignedIn,
                account: None,
                error: None,
            });
        }
        Err(error) => {
            return Ok(SessionConnectResult {
                status: SessionConnectStatus::Failed,
                account: None,
                error: Some(error),
            });
        }
    };

    let account = LinkedAccount {
        provider: AccountProvider::Youtube,
        account_id: string_field(&json, &["channel_id", "uploader_id"]).unwrap_or_default(),
        display_name: string_field(&json, &["channel", "uploader"])
            .unwrap_or_else(|| "YouTube".into()),
        linked_at: now_secs(),
        browser: Some(browser.to_owned()),
    };
    super::save_account(StoredAccount {
        account: account.clone(),
        refresh_token: String::new(),
        access_token: String::new(),
        access_expires_at: 0,
    })?;
    Ok(SessionConnectResult {
        status: SessionConnectStatus::Connected,
        account: Some(account),
        error: None,
    })
}

/// yt-dlp reports a missing session in a few ways depending on the page.
fn looks_signed_out(error: &str) -> bool {
    let lower = error.to_lowercase();
    [
        "playlist does not exist",
        "sign in",
        "login required",
        "unviewable",
        "this playlist is private",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub(crate) fn list_playlists(browser: &str) -> Result<Vec<YouTubePlaylist>, NightingaleError> {
    ytdlp::ensure_installed().map_err(NightingaleError::Other)?;
    let mut playlists = vec![YouTubePlaylist {
        id: LIKED_PLAYLIST_ID.into(),
        title: "Liked videos".into(),
        kind: YouTubePlaylistKind::Liked,
        item_count: None,
        thumbnail_url: None,
    }];
    // The feed may be empty or change shape; liked videos stay available.
    match ytdlp::fetch_json_with_browser_cookies(PLAYLISTS_FEED_URL, browser, &[]) {
        Ok(json) => playlists.extend(entries(&json).filter_map(playlist_from_entry)),
        Err(error) => tracing::warn!("[youtube] could not list playlists: {error}"),
    }
    Ok(playlists)
}

pub(crate) fn fetch_playlist_tracks(
    browser: &str,
    playlist_id: &str,
) -> Result<Vec<RemoteTrack>, NightingaleError> {
    ytdlp::ensure_installed().map_err(NightingaleError::Other)?;
    let url = if playlist_id == LIKED_PLAYLIST_ID {
        LIKED_URL.to_owned()
    } else {
        format!("https://www.youtube.com/playlist?list={playlist_id}")
    };
    let limit = format!("1:{MAX_TRACKS}");
    let json = ytdlp::fetch_json_with_browser_cookies(&url, browser, &["--playlist-items", &limit])
        .map_err(|error| NightingaleError::Other(format!("YouTube playlist: {error}")))?;
    Ok(entries(&json).filter_map(track_from_entry).collect())
}

fn entries(json: &Value) -> impl Iterator<Item = &Value> {
    json.get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn string_field(json: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| json.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn playlist_from_entry(entry: &Value) -> Option<YouTubePlaylist> {
    let id = string_field(entry, &["id"])?;
    // Only real playlists: the feed can also link channels or mixes.
    if !(id.starts_with("PL") || id.starts_with("OL") || id.starts_with("FL")) {
        return None;
    }
    let thumbnail_url = entry
        .get("thumbnails")
        .and_then(Value::as_array)
        .and_then(|thumbnails| thumbnails.last())
        .and_then(|thumbnail| string_field(thumbnail, &["url"]));
    Some(YouTubePlaylist {
        title: string_field(entry, &["title"]).unwrap_or_else(|| id.clone()),
        id,
        kind: YouTubePlaylistKind::Playlist,
        item_count: entry
            .get("playlist_count")
            .and_then(Value::as_u64)
            .and_then(|count| u32::try_from(count).ok()),
        thumbnail_url,
    })
}

fn track_from_entry(entry: &Value) -> Option<RemoteTrack> {
    let video_id = string_field(entry, &["id"])?;
    let raw_title = string_field(entry, &["title"])?;
    // Private and deleted videos come back as "[Private video]" with no channel.
    let channel = string_field(entry, &["channel", "uploader"])?;
    let (artist, title) = split_artist_title(&raw_title, &channel);
    Some(RemoteTrack {
        video_id,
        title,
        artist,
        duration_secs: entry
            .get("duration")
            .and_then(Value::as_f64)
            .filter(|seconds| *seconds > 0.0),
    })
}

// ─── Default browser detection ─────────────────────────────────────────────

/// Map a desktop-entry, bundle or ProgId name to a yt-dlp browser name.
fn browser_from_identifier(identifier: &str) -> Option<&'static str> {
    let lower = identifier.to_lowercase();
    // Order matters: "chromium" contains "chrome", "msedge" is Edge.
    [
        ("firefox", "firefox"),
        ("brave", "brave"),
        ("vivaldi", "vivaldi"),
        ("opera", "opera"),
        ("edge", "edge"),
        ("chromium", "chromium"),
        ("chrome", "chrome"),
        ("safari", "safari"),
    ]
    .iter()
    .find(|(needle, _)| lower.contains(needle))
    .map(|(_, browser)| *browser)
}

#[cfg(target_os = "linux")]
fn default_browser_identifier() -> Option<String> {
    let output = crate::vendor::silent_command("xdg-settings")
        .args(["get", "default-web-browser"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

#[cfg(target_os = "macos")]
fn default_browser_identifier() -> Option<String> {
    let output = crate::vendor::silent_command("defaults")
        .args([
            "read",
            "com.apple.LaunchServices/com.apple.launchservices.secure",
            "LSHandlers",
        ])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    // Each handler is a `{ … }` block; keep the one for the https scheme.
    let handler = text
        .split('}')
        .find(|block| block.contains("LSHandlerURLScheme = https;"));
    // Safari is the default when no handler was ever set.
    Some(
        handler
            .and_then(|block| {
                block
                    .lines()
                    .find(|line| line.contains("LSHandlerRoleAll"))
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "com.apple.safari".to_owned()),
    )
}

#[cfg(target_os = "windows")]
fn default_browser_identifier() -> Option<String> {
    let output = crate::vendor::silent_command("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
            "/v",
            "ProgId",
        ])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .find(|line| line.contains("ProgId"))
        .and_then(|line| line.split_whitespace().last())
        .map(str::to_owned)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn default_browser_identifier() -> Option<String> {
    None
}

pub(crate) fn detect_default_browser() -> Option<&'static str> {
    default_browser_identifier().and_then(|identifier| browser_from_identifier(&identifier))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_map_to_ytdlp_browsers() {
        assert_eq!(browser_from_identifier("firefox.desktop"), Some("firefox"));
        assert_eq!(
            browser_from_identifier("firefox_firefox.desktop"),
            Some("firefox")
        );
        assert_eq!(
            browser_from_identifier("google-chrome.desktop"),
            Some("chrome")
        );
        assert_eq!(
            browser_from_identifier("chromium-browser.desktop"),
            Some("chromium")
        );
        assert_eq!(
            browser_from_identifier("brave-browser.desktop"),
            Some("brave")
        );
        assert_eq!(browser_from_identifier("MSEdgeHTM"), Some("edge"));
        assert_eq!(browser_from_identifier("ChromeHTML"), Some("chrome"));
        assert_eq!(
            browser_from_identifier("FirefoxURL-308046B0AF4A39CB"),
            Some("firefox")
        );
        assert_eq!(
            browser_from_identifier("LSHandlerRoleAll = \"com.apple.safari\";"),
            Some("safari")
        );
        assert_eq!(browser_from_identifier("org.gnome.Epiphany.desktop"), None);
    }

    #[test]
    fn signed_out_errors_are_recognised() {
        assert!(looks_signed_out(
            "[youtube:tab] LL: The playlist does not exist."
        ));
        assert!(looks_signed_out("Sign in to confirm your age"));
        assert!(!looks_signed_out("could not find firefox cookies database"));
    }

    #[test]
    fn flat_entries_become_tracks() {
        let entry = serde_json::json!({
            "id": "abc123",
            "title": "Stromae - Alors on danse (Clip officiel)",
            "channel": "Stromae",
            "duration": 207.0
        });
        let track = track_from_entry(&entry);
        assert_eq!(track.as_ref().map(|t| t.artist.as_str()), Some("Stromae"));
        assert_eq!(
            track.as_ref().map(|t| t.title.as_str()),
            Some("Alors on danse")
        );
        assert_eq!(track.and_then(|t| t.duration_secs), Some(207.0));

        let private = serde_json::json!({ "id": "x", "title": "[Private video]" });
        assert!(track_from_entry(&private).is_none());
    }

    #[test]
    fn feed_entries_keep_only_playlists() {
        let playlist =
            serde_json::json!({ "id": "PLabc", "title": "Karaoké", "playlist_count": 12 });
        let channel = serde_json::json!({ "id": "UCxyz", "title": "Some channel" });
        let parsed = playlist_from_entry(&playlist);
        assert_eq!(parsed.as_ref().map(|p| p.title.as_str()), Some("Karaoké"));
        assert_eq!(parsed.and_then(|p| p.item_count), Some(12));
        assert!(playlist_from_entry(&channel).is_none());
    }
}
