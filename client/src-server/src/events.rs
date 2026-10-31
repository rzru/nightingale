use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::sync::broadcast;

const CAPACITY: usize = 256;

/// Mirrors the Tauri `app.emit("name", payload)` envelope so the web frontend
/// can listen for the same event names via the runtime shim.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct EventEnvelope {
    pub r#type: String,
    pub payload: serde_json::Value,
}

/// Broadcast bus that replaces `tauri::AppHandle::emit` for the web target.
/// Cloning the bus is cheap; senders go through `broadcast::Sender`, receivers
/// are spawned per-WebSocket.
#[derive(Clone)]
pub(crate) struct EventBus {
    tx: broadcast::Sender<EventEnvelope>,
}

impl app_api::CommandRuntime for EventBus {
    fn emit(&self, name: &str, payload: serde_json::Value) {
        self.emit_value(name, payload);
    }

    fn resolve_export_directory(&self, requested: Option<&Path>) -> Result<PathBuf, String> {
        if requested.is_some() {
            return Err("custom export destinations are unavailable in web mode".to_string());
        }
        Ok(app_core::AppConfig::load()
            .effective_data_path()
            .join("exports"))
    }
}

impl EventBus {
    pub(crate) fn new() -> Self {
        let (tx, _) = broadcast::channel(CAPACITY);
        Self { tx }
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<EventEnvelope> {
        self.tx.subscribe()
    }

    pub(crate) fn emit_value(&self, name: &str, payload: serde_json::Value) {
        let envelope = EventEnvelope {
            r#type: name.to_string(),
            payload,
        };
        // A `SendError` here only means no clients are currently listening,
        // which is a normal state for an empty broadcast bus.
        let _ = self.tx.send(envelope);
    }

    pub(crate) fn emit<T: Serialize>(&self, name: &str, payload: &T) {
        match serde_json::to_value(payload) {
            Ok(value) => self.emit_value(name, value),
            Err(e) => tracing::warn!("failed to serialise event {name}: {e}"),
        }
    }
}
