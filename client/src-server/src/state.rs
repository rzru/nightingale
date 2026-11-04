use std::{
    net::{IpAddr, SocketAddr},
    sync::{Arc, RwLock},
};

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
    /// The listener only accepts loopback traffic, so no LAN address can reach
    /// it. Advertising one would hand phones a URL that cannot connect.
    loopback_only: bool,
    /// Operator-pinned base URL (`NIGHTINGALE_REMOTE_URL`). Wins over detection
    /// for deployments a LAN address cannot describe, e.g. a container port
    /// mapping or a reverse proxy forwarding to a loopback bind.
    base: Option<String>,
}

impl RemoteAddress {
    pub fn new(bind: SocketAddr, base: Option<String>) -> Self {
        Self {
            port: bind.port(),
            loopback_only: bind.ip().is_loopback(),
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

        let host = header(headers, "host")?;
        let scheme = header(headers, "x-forwarded-proto").unwrap_or_else(|| "http".to_string());
        // A proxy in front means the public scheme and port are the request's,
        // not this listener's (the shipped installer proxies :80/:443 into a
        // loopback-only backend).
        let proxied =
            headers.contains_key("x-forwarded-proto") || headers.contains_key("x-forwarded-for");

        if is_ip_host(&host) {
            // A loopback address is what the local browser used; a phone cannot
            // follow it, and a loopback-only listener has nothing else to offer.
            if self.address.loopback_only && !proxied && is_loopback_host(&host) {
                return None;
            }
            // Behind a proxy, hand the phone the plain-HTTP door: the TLS one
            // uses a local CA most phones flag as insecure.
            return Some(if proxied {
                plain_http_url(&host, &scheme)
            } else {
                format!("{scheme}://{host}")
            });
        }

        if is_phone_unfriendly_name(&host) {
            // `.local`, single-label, and `localhost` names are exactly the ones
            // phones fail to resolve. Keep the port the client used (that is
            // what a proxy or container publishes) and swap only the name.
            if proxied {
                return lan_url(http_port(&scheme, host_port(&host)));
            }
            // No proxy: the LAN address only works when something actually
            // listens on the LAN. Otherwise report nothing instead of handing
            // phones a URL that cannot connect.
            if self.address.loopback_only {
                return None;
            }
            // Prefer the port the client used: a container publishes its own
            // port (e.g. 64448 -> 8080), and that is the one phones must hit.
            return lan_url(host_port(&host).or(Some(self.address.port)));
        }

        Some(format!("{scheme}://{host}"))
    }
}

/// Phone links stay plain HTTP: self-hosted TLS usually comes from a local CA
/// that phones do not trust. Pin `NIGHTINGALE_REMOTE_URL` for a real HTTPS
/// deployment.
fn http_port(scheme: &str, port: Option<u16>) -> Option<u16> {
    if scheme == "http" {
        port
    } else {
        None
    }
}

fn plain_http_url(host: &str, scheme: &str) -> String {
    let name = hostname(host);

    match http_port(scheme, host_port(host)) {
        Some(port) => format!("http://{name}:{port}"),
        None => format!("http://{name}"),
    }
}

/// Swaps the hostname for the machine's LAN address, keeping the given port.
fn lan_url(port: Option<u16>) -> Option<String> {
    let ip = app_core::lan_ip()?;

    Some(match port {
        Some(port) => format!("http://{ip}:{port}"),
        None => format!("http://{ip}"),
    })
}

fn host_port(host: &str) -> Option<u16> {
    host.rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

fn header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn parse_ip(host: &str) -> Option<IpAddr> {
    hostname(host)
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
        .ok()
}

fn is_ip_host(host: &str) -> bool {
    parse_ip(host).is_some()
}

fn is_loopback_host(host: &str) -> bool {
    parse_ip(host).is_some_and(|ip| ip.is_loopback())
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
