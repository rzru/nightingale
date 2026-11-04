use std::sync::{Arc, RwLock};

use app_api::CommandState;
use app_core::{RemoteControl, RemoteInfo};
use axum::http::HeaderMap;

use crate::events::EventBus;
use crate::jukebox::JukeboxStore;

/// Where phones can reach the queue page. Phones resolve plain IP addresses
/// far more reliably than mDNS names (`*.local` is unsupported on many
/// Android devices), so a hostname from the request is not reused as-is.
#[derive(Clone, Debug)]
pub struct RemoteAddress {
    port: u16,
    /// Operator-pinned base URL (`NIGHTINGALE_REMOTE_URL`). Wins over detection
    /// for deployments a LAN address cannot describe, e.g. a container port
    /// mapping or a reverse proxy forwarding to a loopback bind.
    base: Option<String>,
}

impl RemoteAddress {
    pub fn new(port: u16, base: Option<String>) -> Self {
        Self {
            port,
            base: base
                .map(|base| base.trim().trim_end_matches('/').to_string())
                .filter(|base| !base.is_empty()),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub commands: CommandState,
    pub events: Arc<EventBus>,
    pub(crate) jukebox: Arc<JukeboxStore>,
    remote: Arc<RwLock<RemoteControl>>,
    address: RemoteAddress,
    pub data_path_pinned: bool,
    pub library_pinned: bool,
}

impl AppState {
    /// The caller owns the [`CommandState`] and its runtime so several
    /// transports (e.g. Tauri IPC and this server) can share one playback
    /// queue and one event bus.
    pub fn new(
        commands: CommandState,
        events: Arc<EventBus>,
        remote: RemoteControl,
        address: RemoteAddress,
        data_path_pinned: bool,
        library_pinned: bool,
    ) -> Self {
        Self {
            commands,
            events,
            jukebox: Arc::new(JukeboxStore::new()),
            remote: Arc::new(RwLock::new(remote)),
            address,
            data_path_pinned,
            library_pinned,
        }
    }

    pub fn remote_token(&self) -> String {
        self.remote
            .read()
            .map(|control| control.token.clone())
            .unwrap_or_default()
    }

    pub fn remote_info(&self) -> RemoteInfo {
        self.remote
            .read()
            .map(|control| control.info())
            .unwrap_or(RemoteInfo {
                url: None,
                qr_svg: None,
            })
    }

    /// Builds the QR for the request that asked for it. An IP host is kept
    /// verbatim (that is how the operator reached the server, so a phone on
    /// the same network can use it too). A hostname such as `nightingale.local`
    /// is replaced with the machine's LAN address, and the operator pin wins
    /// over both.
    pub fn remote_info_for(&self, headers: &HeaderMap) -> RemoteInfo {
        let Some(base) = self.remote_base(headers) else {
            return RemoteInfo {
                url: None,
                qr_svg: None,
            };
        };

        self.remote
            .read()
            .map(|control| control.info_with_url(Some(control.url_with_base(&base))))
            .unwrap_or(RemoteInfo {
                url: None,
                qr_svg: None,
            })
    }

    fn remote_base(&self, headers: &HeaderMap) -> Option<String> {
        if let Some(base) = self.address.base.clone() {
            return Some(base);
        }

        let host = header(headers, "host");
        let scheme = header(headers, "x-forwarded-proto").unwrap_or_else(|| "http".to_string());
        let direct = || host.clone().map(|host| format!("{scheme}://{host}"));

        match host.as_deref() {
            Some(host) if is_ip_host(host) => Some(format!("{scheme}://{host}")),
            // `.local`, single-label, and `localhost` names are exactly the ones
            // phones fail to resolve, so swap in the LAN address.
            Some(host) if is_phone_unfriendly_name(host) => {
                app_core::lan_base(self.address.port).or_else(direct)
            }
            _ => direct(),
        }
    }
}

fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn is_ip_host(host: &str) -> bool {
    hostname(host)
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
        .is_ok()
}

/// mDNS and single-label names resolve on desktops but not on many phones, so
/// the QR prefers the LAN address for those. A real DNS name is kept as-is,
/// which is also what makes container deployments work.
fn is_phone_unfriendly_name(host: &str) -> bool {
    let name = hostname(host).to_ascii_lowercase();

    name == "localhost" || !name.contains('.') || name.ends_with(".local")
}

fn hostname(host: &str) -> &str {
    host.rsplit_once(':').map_or(host, |(name, _)| name)
}
