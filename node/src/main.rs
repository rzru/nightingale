//! Nightingale co-op singing node: room coordination only.
//!
//! Nothing here serves media or touches the music library. Singers keep their
//! own copies of a track and the node coordinates room membership, the ready
//! gate, and the shared start time.

mod api;
mod proto;
mod rooms;
mod ws;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use clap::Parser;
use tracing_subscriber::EnvFilter;

use crate::{
    api::Node,
    rooms::{Limits, RoomStore},
};

/// Frequent enough that an abandoned room disappears shortly after its grace
/// window closes; the sweep itself is O(rooms) and allocates nothing.
const SWEEP_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Parser)]
#[command(name = "nightingale-node", about = "Nightingale co-op singing node.")]
struct Args {
    /// Address to bind the HTTP/WS listener to.
    #[arg(long, env = "NIGHTINGALE_BIND", default_value = "0.0.0.0:8080")]
    bind: SocketAddr,

    /// Name shown in node and room lists.
    #[arg(
        long,
        env = "NIGHTINGALE_NODE_NAME",
        default_value = "Nightingale node"
    )]
    name: String,

    /// Listing is the only thing this changes: private nodes stay reachable by
    /// URL, they just never appear in the shared node list.
    #[arg(long, env = "NIGHTINGALE_NODE_PUBLIC", default_value_t = false)]
    public: bool,

    #[arg(long, env = "NIGHTINGALE_NODE_MAX_ROOMS", default_value_t = 10)]
    max_rooms: usize,

    #[arg(long, env = "NIGHTINGALE_NODE_MAX_SLOTS", default_value_t = 16)]
    max_slots: usize,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<(), String> {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,nightingale_node=info")),
        )
        .init();

    let store = RoomStore::new(Limits {
        max_rooms: args.max_rooms.max(1),
        max_slots: args.max_slots.max(1),
    });
    let node = Arc::new(Node {
        name: args.name,
        public: args.public,
        started: std::time::Instant::now(),
        store,
    });

    let listener = tokio::net::TcpListener::bind(args.bind)
        .await
        .map_err(|error| format!("failed to bind {}: {error}", args.bind))?;

    tracing::info!(
        addr = %args.bind,
        public = node.public,
        "nightingale node listening"
    );

    if node.public {
        tracing::warn!(
            "public nodes are listed with https:// URLs only — put TLS in front of this listener"
        );
    }

    tokio::spawn(sweep(Arc::clone(&node)));

    axum::serve(
        listener,
        api::router(node).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|error| format!("server error: {error}"))
}

async fn sweep(node: Arc<Node>) {
    let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
    loop {
        ticker.tick().await;
        node.store.sweep().await;
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::warn!("ctrl_c install failed: {error}");
        }
    };

    #[cfg(unix)]
    let term = async {
        let mut signal =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(signal) => signal,
                Err(error) => {
                    tracing::warn!("SIGTERM listener failed: {error}");
                    return;
                }
            };
        signal.recv().await;
    };

    #[cfg(not(unix))]
    let term = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = term => {},
    }
}
