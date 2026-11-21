//! Provider-neutral OAuth 2.0 authorization-code flow for native apps.
//!
//! Follows RFC 8252: the user signs in through their regular browser, the
//! provider redirects to a one-shot loopback listener on `127.0.0.1` with a
//! random port, and PKCE (RFC 7636, `S256`) binds the authorization code to
//! this process. The UI drives the flow the same way it drives Plex PIN
//! linking: `begin` returns a URL to open plus an opaque `auth_id`, then the
//! UI polls until the listener thread reports a terminal status.
//!
//! In self-hosted mode the loopback listener runs on the server host, so the
//! browser doing the sign-in must run on that same machine.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tiny_http::{Header, Request, Response, Server, StatusCode};
use ts_rs::TS;
use ureq::Agent;
use url::Url;

use crate::error::NightingaleError;

use super::LinkedAccount;

/// How long the loopback listener waits for the provider redirect.
const AUTH_TIMEOUT: Duration = Duration::from_secs(300);
/// Granularity at which the listener notices a cancellation.
const LISTEN_SLICE: Duration = Duration::from_millis(500);
/// Terminal results nobody polled are dropped after this long.
const FINISHED_RETENTION: Duration = Duration::from_secs(600);

/// Message returned when a refresh token stopped working (revoked in the
/// provider's account settings, expired, or the OAuth client was rotated).
pub(crate) const REAUTH_REQUIRED: &str =
    "account authorization expired or was revoked; reconnect the account";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AuthStart {
    /// Opaque handle for `poll_auth` / `cancel_auth`. Unrelated to the OAuth
    /// `state`, which never leaves the backend.
    pub auth_id: String,
    /// Provider consent page to open in the user's browser.
    pub auth_url: String,
    pub expires_in: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AuthStatus {
    Pending,
    Authorized,
    Failed,
    Expired,
    Cancelled,
}

impl AuthStatus {
    fn is_terminal(self) -> bool {
        !matches!(self, Self::Pending)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AuthPollResult {
    pub status: AuthStatus,
    pub account: Option<LinkedAccount>,
    pub error: Option<String>,
}

impl AuthPollResult {
    fn with_status(status: AuthStatus) -> Self {
        Self {
            status,
            account: None,
            error: None,
        }
    }

    fn failed(error: impl Into<String>) -> Self {
        Self {
            status: AuthStatus::Failed,
            account: None,
            error: Some(error.into()),
        }
    }

    fn authorized(account: LinkedAccount) -> Self {
        Self {
            status: AuthStatus::Authorized,
            account: Some(account),
            error: None,
        }
    }
}

/// Static description of a provider's authorization endpoint.
pub(crate) struct OAuthRequest {
    pub(crate) auth_endpoint: &'static str,
    pub(crate) client_id: String,
    pub(crate) scopes: &'static [&'static str],
    pub(crate) extra_params: &'static [(&'static str, &'static str)],
}

/// Everything the provider-specific code needs to redeem the code.
pub(crate) struct AuthCallback {
    pub(crate) code: String,
    pub(crate) code_verifier: String,
    pub(crate) redirect_uri: String,
}

/// Redeems the code, fetches the account identity and persists the tokens.
pub(crate) type CompleteFn =
    Box<dyn FnOnce(AuthCallback) -> Result<LinkedAccount, NightingaleError> + Send + 'static>;

struct PendingAuth {
    result: AuthPollResult,
    cancelled: bool,
    updated: Instant,
}

fn registry() -> &'static Mutex<HashMap<String, PendingAuth>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, PendingAuth>>> = OnceLock::new();
    REGISTRY.get_or_init(Default::default)
}

fn with_registry<T>(f: impl FnOnce(&mut HashMap<String, PendingAuth>) -> T) -> Option<T> {
    registry().lock().ok().map(|mut guard| f(&mut guard))
}

/// Start the browser sign-in. The listener thread owns the rest of the flow.
pub(crate) fn begin(
    request: OAuthRequest,
    complete: CompleteFn,
) -> Result<AuthStart, NightingaleError> {
    let server = Server::http("127.0.0.1:0").map_err(|error| {
        NightingaleError::Other(format!("failed to start sign-in listener: {error}"))
    })?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .ok_or_else(|| NightingaleError::from("sign-in listener did not bind an IP socket"))?;

    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let state = random_token(32);
    let code_verifier = random_token(64);
    let code_challenge = code_challenge(&code_verifier);
    let scope = request.scopes.join(" ");

    let mut params: Vec<(&str, &str)> = vec![
        ("client_id", request.client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("response_type", "code"),
        ("scope", scope.as_str()),
        ("state", state.as_str()),
        ("code_challenge", code_challenge.as_str()),
        ("code_challenge_method", "S256"),
    ];
    params.extend_from_slice(request.extra_params);
    let auth_url = Url::parse_with_params(request.auth_endpoint, &params)
        .map_err(|error| NightingaleError::Other(format!("invalid authorization URL: {error}")))?
        .to_string();

    let auth_id = random_token(16);
    with_registry(|pending| {
        prune_finished(pending);
        pending.insert(
            auth_id.clone(),
            PendingAuth {
                result: AuthPollResult::with_status(AuthStatus::Pending),
                cancelled: false,
                updated: Instant::now(),
            },
        );
    })
    .ok_or_else(|| NightingaleError::from("sign-in registry lock poisoned"))?;

    let thread_auth_id = auth_id.clone();
    let spawned = thread::Builder::new()
        .name("oauth-callback".into())
        .spawn(move || {
            let result = match wait_for_callback(&server, &thread_auth_id, &state) {
                CallbackOutcome::Code { code, request } => {
                    let result = complete(AuthCallback {
                        code,
                        code_verifier,
                        redirect_uri,
                    });
                    match result {
                        Ok(account) => {
                            respond_html(request, 200, SUCCESS_PAGE);
                            AuthPollResult::authorized(account)
                        }
                        Err(error) => {
                            tracing::warn!("account sign-in failed: {error}");
                            respond_html(request, 200, FAILURE_PAGE);
                            AuthPollResult::failed(error.to_string())
                        }
                    }
                }
                CallbackOutcome::Denied { error, request } => {
                    respond_html(request, 200, DENIED_PAGE);
                    AuthPollResult::failed(error)
                }
                CallbackOutcome::Expired => AuthPollResult::with_status(AuthStatus::Expired),
                CallbackOutcome::Cancelled => AuthPollResult::with_status(AuthStatus::Cancelled),
                CallbackOutcome::ListenerFailed(error) => AuthPollResult::failed(error),
            };
            with_registry(|pending| {
                if let Some(entry) = pending.get_mut(&thread_auth_id) {
                    entry.result = result;
                    entry.updated = Instant::now();
                }
            });
        });

    if let Err(error) = spawned {
        with_registry(|pending| pending.remove(&auth_id));
        return Err(NightingaleError::Other(format!(
            "failed to start sign-in listener thread: {error}"
        )));
    }

    Ok(AuthStart {
        auth_id,
        auth_url,
        expires_in: AUTH_TIMEOUT.as_secs().min(u64::from(u32::MAX)) as u32,
    })
}

/// Report where a sign-in stands. Terminal results are handed out once.
/// Unknown ids (already consumed, pruned, or from a previous launch) read as
/// expired so the UI can simply offer to start again.
pub fn poll(auth_id: &str) -> AuthPollResult {
    with_registry(|pending| {
        let status = pending.get(auth_id).map(|entry| entry.result.status)?;
        if status.is_terminal() {
            pending.remove(auth_id).map(|entry| entry.result)
        } else {
            pending.get(auth_id).map(|entry| entry.result.clone())
        }
    })
    .flatten()
    .unwrap_or_else(|| AuthPollResult::with_status(AuthStatus::Expired))
}

/// Ask the listener to stop waiting. Returns `false` for unknown ids.
pub fn cancel(auth_id: &str) -> bool {
    with_registry(|pending| {
        pending.get_mut(auth_id).is_some_and(|entry| {
            entry.cancelled = true;
            true
        })
    })
    .unwrap_or(false)
}

fn is_cancelled(auth_id: &str) -> bool {
    with_registry(|pending| pending.get(auth_id).is_none_or(|entry| entry.cancelled))
        .unwrap_or(true)
}

fn prune_finished(pending: &mut HashMap<String, PendingAuth>) {
    pending.retain(|_, entry| {
        !entry.result.status.is_terminal() || entry.updated.elapsed() < FINISHED_RETENTION
    });
}

enum CallbackOutcome {
    Code { code: String, request: Request },
    Denied { error: String, request: Request },
    Expired,
    Cancelled,
    ListenerFailed(String),
}

fn wait_for_callback(server: &Server, auth_id: &str, state: &str) -> CallbackOutcome {
    let deadline = Instant::now() + AUTH_TIMEOUT;
    loop {
        if is_cancelled(auth_id) {
            return CallbackOutcome::Cancelled;
        }
        let now = Instant::now();
        if now >= deadline {
            return CallbackOutcome::Expired;
        }
        let request = match server.recv_timeout(LISTEN_SLICE.min(deadline - now)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(error) => return CallbackOutcome::ListenerFailed(error.to_string()),
        };

        let Some(params) = callback_params(request.url()) else {
            respond_html(request, 404, "Not found");
            continue;
        };
        // A redirect without our state is not ours (or is forged): ignore it
        // and keep waiting for the real one.
        if params.get("state").map(String::as_str) != Some(state) {
            respond_html(request, 400, "Invalid sign-in state");
            continue;
        }
        if let Some(error) = params.get("error") {
            return CallbackOutcome::Denied {
                error: format!("sign-in was not completed: {error}"),
                request,
            };
        }
        match params.get("code").filter(|code| !code.is_empty()) {
            Some(code) => {
                return CallbackOutcome::Code {
                    code: code.clone(),
                    request,
                };
            }
            None => respond_html(request, 400, "Missing authorization code"),
        }
    }
}

/// Query parameters of a request to `/callback`, or `None` for any other path
/// (browsers also ask for `/favicon.ico`).
fn callback_params(request_url: &str) -> Option<HashMap<String, String>> {
    let url = Url::parse(&format!("http://127.0.0.1{request_url}")).ok()?;
    (url.path() == "/callback").then(|| url.query_pairs().into_owned().collect())
}

fn respond_html(request: Request, status: u16, body: &str) {
    let mut response = Response::from_string(body).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes(
        "Content-Type".as_bytes(),
        "text/html; charset=utf-8".as_bytes(),
    ) {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

const SUCCESS_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Nightingale</title>\
<body style=\"font-family:sans-serif;text-align:center;padding:4em\">\
<h1>Nightingale is connected</h1><p>You can close this tab and return to Nightingale.</p>";

const FAILURE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Nightingale</title>\
<body style=\"font-family:sans-serif;text-align:center;padding:4em\">\
<h1>Sign-in failed</h1><p>Return to Nightingale for details and try again.</p>";

const DENIED_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Nightingale</title>\
<body style=\"font-family:sans-serif;text-align:center;padding:4em\">\
<h1>Sign-in cancelled</h1><p>You can close this tab.</p>";

// ─── Token endpoint ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub(crate) struct TokenGrant {
    pub(crate) access_token: String,
    #[serde(default)]
    pub(crate) expires_in: Option<u64>,
    #[serde(default)]
    pub(crate) refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

pub(crate) fn exchange_code(
    token_endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    callback: &AuthCallback,
) -> Result<TokenGrant, NightingaleError> {
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", callback.code.as_str()),
        ("code_verifier", callback.code_verifier.as_str()),
        ("redirect_uri", callback.redirect_uri.as_str()),
        ("client_id", client_id),
    ];
    if let Some(secret) = client_secret {
        form.push(("client_secret", secret));
    }
    token_request(token_endpoint, &form)
}

pub(crate) fn refresh_access_token(
    token_endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    refresh_token: &str,
) -> Result<TokenGrant, NightingaleError> {
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ];
    if let Some(secret) = client_secret {
        form.push(("client_secret", secret));
    }
    token_request(token_endpoint, &form)
}

fn token_request(endpoint: &str, form: &[(&str, &str)]) -> Result<TokenGrant, NightingaleError> {
    let config = Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .http_status_as_error(false)
        .build();
    let agent = Agent::new_with_config(config);
    let response = agent
        .post(endpoint)
        .header("Accept", "application/json")
        .send_form(form.iter().copied())
        .map_err(|error| NightingaleError::Other(format!("token request failed: {error}")))?;
    let status = response.status();
    let body = response
        .into_body()
        .read_to_string()
        .map_err(|error| NightingaleError::Other(format!("token response unreadable: {error}")))?;

    if status.is_success() {
        let grant = serde_json::from_str::<TokenGrant>(&body)?;
        if grant.access_token.is_empty() {
            return Err(NightingaleError::from("token response had no access token"));
        }
        return Ok(grant);
    }

    // Never echo the raw body: some providers include the submitted values.
    match serde_json::from_str::<TokenError>(&body) {
        Ok(detail) if detail.error == "invalid_grant" => {
            Err(NightingaleError::from(REAUTH_REQUIRED))
        }
        Ok(detail) => Err(NightingaleError::Other(format!(
            "token request rejected ({}): {}",
            detail.error,
            detail.error_description.unwrap_or_default()
        ))),
        Err(_) => Err(NightingaleError::Other(format!(
            "token request rejected with HTTP {}",
            status.as_u16()
        ))),
    }
}

// ─── PKCE helpers ──────────────────────────────────────────────────────────

/// URL-safe random string from `bytes` bytes of entropy. 64 bytes yield an
/// 86-character PKCE verifier, inside the 43..=128 range RFC 7636 requires.
fn random_token(bytes: usize) -> String {
    let raw: Vec<u8> = (0..bytes).map(|_| rand::random::<u8>()).collect();
    B64URL.encode(raw)
}

fn code_challenge(verifier: &str) -> String {
    B64URL.encode(Sha256::digest(verifier.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_challenge_matches_rfc_7636_appendix_b() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_length_is_within_pkce_bounds() {
        let verifier = random_token(64);
        assert!((43..=128).contains(&verifier.len()));
        assert!(
            verifier
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
    }

    #[test]
    fn callback_params_only_accepts_callback_path() {
        assert!(callback_params("/favicon.ico").is_none());
        let params = callback_params("/callback?code=abc&state=xyz");
        assert_eq!(
            params
                .as_ref()
                .and_then(|p| p.get("code"))
                .map(String::as_str),
            Some("abc")
        );
        assert_eq!(
            params
                .as_ref()
                .and_then(|p| p.get("state"))
                .map(String::as_str),
            Some("xyz")
        );
    }

    #[test]
    fn unknown_auth_id_polls_as_expired() {
        assert_eq!(poll("does-not-exist").status, AuthStatus::Expired);
        assert!(!cancel("does-not-exist"));
    }
}
