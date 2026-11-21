//! Linked streaming accounts (YouTube today; Spotify / Deezer next).
//!
//! An account is not a library source. Sources (folder, Plex, …) own the
//! songs that are scanned and analysed; accounts only tell Nightingale what
//! the user *wants* to sing — their playlists — which `wishes` turns into
//! matches against the library or download candidates.
//!
//! Credentials live in `accounts.json` next to `config.json`, with refresh and
//! access tokens wrapped in the same at-rest envelope as source secrets (see
//! `secret.rs`). That keeps desktop, self-hosted and Docker installs on one
//! code path; the threat model is the one documented in `secret.rs`.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::cache::default_nightingale_dir;
use crate::error::NightingaleError;
use crate::secret;

mod oauth;
pub(crate) mod youtube;
pub(crate) mod youtube_session;

pub use oauth::{AuthPollResult, AuthStart, AuthStatus, cancel as cancel_auth, poll as poll_auth};

use oauth::TokenGrant;

/// Refresh the access token when it has less than this left.
const ACCESS_TOKEN_MARGIN_SECS: u64 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AccountProvider {
    Youtube,
}

impl AccountProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Youtube => "youtube",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "youtube" => Some(Self::Youtube),
            _ => None,
        }
    }
}

/// What the UI is allowed to see about a linked account: never tokens.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LinkedAccount {
    pub provider: AccountProvider,
    /// Provider-side account id (the YouTube channel id). Empty when the
    /// Google account has no YouTube channel.
    pub account_id: String,
    pub display_name: String,
    /// Unix seconds.
    #[ts(type = "number")]
    pub linked_at: u64,
    /// Set for "use my YouTube session" links: the browser (yt-dlp name)
    /// whose cookies are read. `None` for OAuth links.
    #[serde(default)]
    pub browser: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AccountsOverview {
    pub accounts: Vec<LinkedAccount>,
    /// False when this build has no OAuth client for YouTube, so the UI can
    /// explain the setup instead of offering a button that cannot work.
    pub youtube_configured: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredAccount {
    #[serde(flatten)]
    pub(crate) account: LinkedAccount,
    pub(crate) refresh_token: String,
    #[serde(default)]
    pub(crate) access_token: String,
    /// Unix seconds.
    #[serde(default)]
    pub(crate) access_expires_at: u64,
}

impl std::fmt::Debug for StoredAccount {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoredAccount")
            .field("account", &self.account)
            .field("refresh_token", &"[REDACTED]")
            .field("access_token", &"[REDACTED]")
            .field("access_expires_at", &self.access_expires_at)
            .finish()
    }
}

impl StoredAccount {
    fn map_secrets(mut self, transform: impl Fn(&str) -> String) -> Self {
        self.refresh_token = transform(&self.refresh_token);
        self.access_token = transform(&self.access_token);
        self
    }
}

#[derive(Default, Serialize, Deserialize)]
struct AccountsFile {
    #[serde(default)]
    accounts: Vec<StoredAccount>,
}

/// Serialises read-modify-write cycles on `accounts.json`, including token
/// refreshes, so two concurrent API calls never both spend the refresh token.
static STORE_LOCK: Mutex<()> = Mutex::new(());

fn accounts_path() -> PathBuf {
    default_nightingale_dir().join("accounts.json")
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, NightingaleError> {
    STORE_LOCK
        .lock()
        .map_err(|_| NightingaleError::from("accounts store lock poisoned"))
}

fn read_store() -> AccountsFile {
    let Ok(raw) = std::fs::read_to_string(accounts_path()) else {
        return AccountsFile::default();
    };
    let mut store = serde_json::from_str::<AccountsFile>(&raw).unwrap_or_default();
    store.accounts = store
        .accounts
        .into_iter()
        .map(|account| account.map_secrets(secret::decrypt_string))
        .collect();
    store
}

fn write_store(store: &AccountsFile) -> Result<(), NightingaleError> {
    let path = accounts_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let for_disk = AccountsFile {
        accounts: store
            .accounts
            .iter()
            .cloned()
            .map(|account| account.map_secrets(secret::encrypt_string))
            .collect(),
    };
    let json = serde_json::to_string_pretty(&for_disk)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn linked_accounts() -> Vec<LinkedAccount> {
    let Ok(_guard) = lock_store() else {
        return Vec::new();
    };
    read_store()
        .accounts
        .into_iter()
        .map(|stored| stored.account)
        .collect()
}

pub fn accounts_overview() -> AccountsOverview {
    AccountsOverview {
        accounts: linked_accounts(),
        youtube_configured: youtube::is_configured(),
    }
}

/// Forget the account locally, then ask the provider to revoke the grant.
/// Revocation is best effort: the local unlink stands even when offline.
pub fn unlink_account(provider: AccountProvider) -> Result<bool, NightingaleError> {
    let removed = {
        let _guard = lock_store()?;
        let mut store = read_store();
        let index = store
            .accounts
            .iter()
            .position(|stored| stored.account.provider == provider);
        let removed = index.map(|index| store.accounts.remove(index));
        if removed.is_some() {
            write_store(&store)?;
        }
        removed
    };
    let Some(removed) = removed else {
        return Ok(false);
    };
    match provider {
        AccountProvider::Youtube => youtube::revoke(&removed.refresh_token),
    }
    Ok(true)
}

/// Browser to read cookies from, when `provider` was linked through the
/// browser session rather than OAuth.
pub(crate) fn session_browser(provider: AccountProvider) -> Option<String> {
    let _guard = lock_store().ok()?;
    read_store()
        .accounts
        .into_iter()
        .find(|stored| stored.account.provider == provider)
        .and_then(|stored| stored.account.browser)
}

/// One account per provider: linking again replaces the previous one.
pub(crate) fn save_account(account: StoredAccount) -> Result<(), NightingaleError> {
    let _guard = lock_store()?;
    let mut store = read_store();
    store
        .accounts
        .retain(|stored| stored.account.provider != account.account.provider);
    store.accounts.push(account);
    write_store(&store)
}

/// A valid access token for `provider`, refreshed through `refresh` when the
/// cached one is missing or about to expire.
pub(crate) fn access_token(
    provider: AccountProvider,
    refresh: impl FnOnce(&str) -> Result<TokenGrant, NightingaleError>,
) -> Result<String, NightingaleError> {
    let _guard = lock_store()?;
    let mut store = read_store();
    let now = now_secs();
    let stored = store
        .accounts
        .iter_mut()
        .find(|stored| stored.account.provider == provider)
        .ok_or_else(|| {
            NightingaleError::Other(format!("no {} account is linked", provider.as_str()))
        })?;

    if !stored.access_token.is_empty()
        && stored.access_expires_at > now.saturating_add(ACCESS_TOKEN_MARGIN_SECS)
    {
        return Ok(stored.access_token.clone());
    }

    let grant = refresh(&stored.refresh_token)?;
    let access = grant.access_token;
    stored.access_token = access.clone();
    stored.access_expires_at = now.saturating_add(grant.expires_in.unwrap_or(3600));
    // Some providers rotate refresh tokens; keep the newest one.
    if let Some(rotated) = grant.refresh_token.filter(|token| !token.is_empty()) {
        stored.refresh_token = rotated;
    }
    write_store(&store)?;
    Ok(access)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_round_trips_through_its_string_form() {
        assert_eq!(
            AccountProvider::parse(AccountProvider::Youtube.as_str()),
            Some(AccountProvider::Youtube)
        );
        assert_eq!(AccountProvider::parse("myspace"), None);
    }

    #[test]
    fn stored_account_debug_redacts_tokens() {
        let stored = StoredAccount {
            account: LinkedAccount {
                provider: AccountProvider::Youtube,
                account_id: "UC123".into(),
                display_name: "Someone".into(),
                linked_at: 1,
                browser: None,
            },
            refresh_token: "refresh-secret".into(),
            access_token: "access-secret".into(),
            access_expires_at: 2,
        };
        let debug = format!("{stored:?}");
        assert!(!debug.contains("refresh-secret"));
        assert!(!debug.contains("access-secret"));
    }

    #[test]
    fn stored_account_flattens_public_fields() {
        let json = r#"{"provider":"youtube","account_id":"UC1","display_name":"Me","linked_at":5,"refresh_token":"r"}"#;
        let parsed = serde_json::from_str::<StoredAccount>(json);
        let stored = match parsed {
            Ok(stored) => stored,
            Err(error) => panic!("account should parse: {error}"),
        };
        assert_eq!(stored.account.display_name, "Me");
        assert!(stored.access_token.is_empty());
    }
}
