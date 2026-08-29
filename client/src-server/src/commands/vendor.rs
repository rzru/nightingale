use std::sync::Arc;

use app_core::{CachePaths, SetupFolders};
use serde::Deserialize;
use serde_json::Value;

use crate::commands::{ApiError, CmdResult};
use crate::events::EventBus;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TriggerSetupArgs {
    #[serde(default)]
    data_path: Option<String>,
    #[serde(default)]
    cache_paths: Option<CachePaths>,
}

pub(crate) fn trigger_setup(events: Arc<EventBus>, payload: Value) -> CmdResult {
    let args: TriggerSetupArgs = if payload.is_null() {
        TriggerSetupArgs {
            data_path: None,
            cache_paths: None,
        }
    } else {
        serde_json::from_value(payload)
            .map_err(|e| ApiError::bad_request(format!("invalid trigger_setup args: {e}")))?
    };

    // A setup run may already be in flight (e.g. started before a page
    // refresh). Ignore the extra trigger instead of racing it — the running
    // setup keeps emitting progress events for the UI.
    if app_core::is_setup_running() {
        return Ok(Value::Null);
    }

    let events_clone = events.clone();
    std::thread::spawn(move || {
        let events_for_progress = events_clone.clone();
        if let Err(e) = app_core::run_vendor_setup(
            SetupFolders {
                data_path: args.data_path,
                cache_paths: args.cache_paths,
            },
            move |progress| {
                events_for_progress.emit("setup-progress", &progress);
            },
            |_| Ok(()),
        ) {
            events_clone.emit_value("setup-error", Value::String(e));
        }
    });
    Ok(Value::Null)
}
