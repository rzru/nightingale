use app_core::{
    AnalysisQueue, AppConfig, CacheReconcileSummary, JellyfinHealth, JellyfinLoginResult,
    LibraryMenuItems, LibrarySource, LoadSongsParams, NavidromeHealth, NavidromeLoginResult,
    PlexHealth, PlexPinPollResult, PlexPinStart, PlexServer, Song, SongsMeta, SongsStore,
};

#[tauri::command]
pub(crate) fn trigger_scan() {
    app_core::start_scan();
}

#[tauri::command]
pub(crate) async fn reconcile_cache() -> Result<CacheReconcileSummary, String> {
    tauri::async_runtime::spawn_blocking(app_core::reconcile_cache)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn set_library_source(source: LibrarySource) -> AppConfig {
    let mut config = AppConfig::load();
    config.library_source = Some(source);
    config.last_folder = None;
    config.save();
    app_core::start_scan();
    config
}

#[tauri::command]
pub(crate) fn clear_library_source() -> AppConfig {
    let mut config = AppConfig::load();
    config.library_source = None;
    config.last_folder = None;
    config.save();
    config
}

#[tauri::command]
pub(crate) fn jellyfin_login(
    base_url: String,
    username: String,
    password: String,
) -> Result<JellyfinLoginResult, String> {
    app_core::jellyfin_login(&base_url, &username, &password, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn jellyfin_ping() -> JellyfinHealth {
    app_core::jellyfin_ping_current()
}

#[tauri::command]
pub(crate) fn navidrome_login(
    base_url: String,
    username: String,
    password: String,
) -> Result<NavidromeLoginResult, String> {
    app_core::navidrome_login(&base_url, &username, &password).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn navidrome_ping() -> NavidromeHealth {
    app_core::navidrome_ping_current()
}

#[tauri::command]
pub(crate) fn plex_begin_pin(client_id: Option<String>) -> Result<PlexPinStart, String> {
    app_core::plex_begin_pin(client_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn plex_poll_pin(
    pin_id: String,
    client_id: String,
) -> Result<PlexPinPollResult, String> {
    app_core::plex_poll_pin(&pin_id, &client_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn plex_manual_login(
    base_url: String,
    access_token: String,
    client_id: Option<String>,
) -> Result<PlexServer, String> {
    app_core::plex_manual_login(&base_url, &access_token, client_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn plex_ping() -> PlexHealth {
    app_core::plex_ping_current()
}

#[tauri::command]
pub(crate) fn load_songs(params: LoadSongsParams) -> SongsStore {
    SongsStore::load(&params)
}

#[tauri::command]
pub(crate) fn load_songs_by_hashes(file_hashes: Vec<String>) -> Vec<Song> {
    SongsStore::load_by_hashes(&file_hashes)
}

#[tauri::command]
pub(crate) fn load_songs_meta() -> SongsMeta {
    SongsStore::load_meta()
}

#[tauri::command]
pub(crate) fn load_analysis_queue() -> AnalysisQueue {
    AnalysisQueue::load()
}

#[tauri::command]
pub(crate) fn load_library_menu_items() -> Result<LibraryMenuItems, String> {
    app_core::load_library_menu_items().map_err(|e| e.to_string())
}
