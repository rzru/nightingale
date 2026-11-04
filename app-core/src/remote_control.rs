//! LAN queue control: the token phones present and the QR code the host shows.
//!
//! This is transport state, not a user preference, so it lives in its own file
//! next to `config.json` instead of `AppConfig`. The token is stable across
//! restarts on purpose — a QR the host printed earlier keeps working.

use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Port the phone surface listens on. Fixed so a previously printed QR keeps
/// resolving after a restart.
pub const REMOTE_PORT: u16 = 64449;

const TOKEN_BYTES: usize = 16;
const QR_QUIET_MODULES: i64 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteControl {
    #[serde(default)]
    pub token: String,
}

impl Default for RemoteControl {
    fn default() -> Self {
        Self { token: new_token() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    /// `None` when no LAN address could be detected; the UI then reports that
    /// instead of showing a code that would not resolve.
    pub url: Option<String>,
    pub qr_svg: Option<String>,
}

impl RemoteControl {
    pub fn load() -> Self {
        let mut control = std::fs::read_to_string(path())
            .ok()
            .and_then(|raw| serde_json::from_str::<Self>(&raw).ok())
            .unwrap_or_default();

        if control.token.is_empty() {
            control.token = new_token();
            control.save();
        }

        control
    }

    pub fn save(&self) {
        let path = path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        match serde_json::to_string_pretty(self) {
            Ok(json) => {
                if let Err(error) = std::fs::write(&path, json) {
                    tracing::warn!("failed writing remote control state: {error}");
                }
            }
            Err(error) => tracing::warn!("failed serialising remote control state: {error}"),
        }
    }

    pub fn url(&self) -> Option<String> {
        lan_base(REMOTE_PORT).map(|base| self.url_with_base(&base))
    }

    pub fn url_with_base(&self, base: &str) -> String {
        format!("{base}/q?t={}", self.token)
    }

    pub fn info(&self) -> RemoteInfo {
        self.info_with_url(self.url())
    }

    /// Builds the payload around a caller-supplied base URL. The self-hosted
    /// server knows the real scheme and host from the request, which the LAN
    /// address guess cannot see (reverse proxies, custom ports).
    pub fn info_with_url(&self, url: Option<String>) -> RemoteInfo {
        RemoteInfo {
            qr_svg: url.as_deref().and_then(|url| qr_svg(url).ok()),
            url,
        }
    }
}

fn path() -> PathBuf {
    crate::cache::default_nightingale_dir().join("remote-control.json")
}

fn new_token() -> String {
    rand::random::<[u8; TOKEN_BYTES]>()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `http://<lan-ip>:<port>` for the queue page, or `None` when the machine has
/// no LAN address. Plain IP on purpose: mDNS names are unreliable on phones.
pub fn lan_base(port: u16) -> Option<String> {
    lan_ip().map(|ip| format!("http://{ip}:{port}"))
}

/// Best-effort LAN address: connecting a UDP socket to a public address only
/// resolves a route, it sends nothing. Behind a VPN or with an unusual routing
/// table this can still be wrong, which is why the UI also shows the URL text
/// and lets the operator correct it.
pub fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).ok()?;
    let address = socket.local_addr().ok()?.ip();

    (!address.is_loopback() && !address.is_unspecified()).then_some(address)
}

fn qr_svg(data: &str) -> Result<String, String> {
    let code = qrcode::QrCode::new(data.as_bytes()).map_err(|error| error.to_string())?;
    let colors = code.to_colors();
    let width = code.width() as i64;
    let side = width + QR_QUIET_MODULES * 2;

    let mut path = String::new();
    for (index, color) in colors.iter().enumerate() {
        if *color != qrcode::types::Color::Dark {
            continue;
        }
        let x = (index as i64 % width) + QR_QUIET_MODULES;
        let y = (index as i64 / width) + QR_QUIET_MODULES;
        path.push_str(&format!("M{x} {y}h1v1h-1z"));
    }

    Ok(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" shape-rendering="crispEdges"><rect width="{side}" height="{side}" fill="#fff"/><path d="{path}" fill="#000"/></svg>"##
    ))
}
