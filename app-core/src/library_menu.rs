use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LibraryMenuItem {
    pub value: String,
    pub label: String,
    #[serde(rename = "analysedCount")]
    pub analysed_count: u64,
    #[serde(rename = "queuedCount")]
    pub queued_count: u64,
    #[serde(rename = "analysingCount")]
    pub analysing_count: u64,
    pub count: u64,
    /// Nesting level of a folder item below the library root (0 = top level).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub depth: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LibraryMenuItems {
    pub hot: Vec<LibraryMenuItem>,
    pub no_metadata: Vec<LibraryMenuItem>,
    pub artists: Vec<LibraryMenuItem>,
    pub albums: Vec<LibraryMenuItem>,
    pub playlists: Vec<LibraryMenuItem>,
    pub folders: Vec<LibraryMenuItem>,
}

pub fn load_library_menu_items() -> Result<LibraryMenuItems, crate::error::NightingaleError> {
    crate::library_db::query_library_menu_items()
}
