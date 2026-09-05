mod analyzer;
mod cache;
mod config;
mod error;
mod library_db;
mod library_menu;
mod library_model;
mod lrc;
mod lyrics;
pub mod media_server;
mod playback;
mod playback_queue;
mod playback_session;
mod profile;
mod recording;
mod scanner;
mod secret;
mod song;
mod source;
mod usdx;
mod vendor;
mod vendor_scripts;

pub use analyzer::{
    AnalysisQueue, cancel_analysis, delete_cache, enqueue, realign, reanalyze_force_transcribe,
    reanalyze_full, reanalyze_transcript, refresh_metadata, shutdown_server,
};
pub use cache::{
    CacheDir, CachePaths, CacheStats, cache_roots, change_app_data_path, clear_models,
    clear_videos, default_nightingale_dir, nightingale_dir, normalized_target_path, same_path,
    set_default_data_path,
};
pub use config::{AppConfig, LibrarySource};
pub use library_db::{init_library, library_db_path};
pub use library_menu::{LibraryMenuItem, LibraryMenuItems, load_library_menu_items};
pub use library_model::{
    LibraryMenuFilters, LoadSongsParams, SongSort, SongSortColumn, SongTarget, SongsMeta,
    SongsStore, SortDirection,
};
pub use lyrics::{
    LrclibCandidate, LyricsFile, apply_timed_lyrics, load_lyrics_file, provide_lrc,
    save_lyrics_and_realign, search_lrclib_for_hash,
};
pub use media_server::MediaEndpoint;
pub use playback::{
    AudioPaths, PixabayVideoDownloaded, ShiftDone, ShiftResult, StemsReady,
    download_pixabay_videos, ensure_mp3_stems, ensure_mp3_stems_ready_payload,
    ensure_playable_source_video, get_audio_paths, get_cached_pixabay_videos, load_transcript,
    prefetch_one_per_flavor, shift_key, shift_key_done_payload, shift_tempo,
    shift_tempo_done_payload,
};
pub use playback_queue::{PlaybackQueue, PlaybackQueueEntry};
pub use playback_session::{PlaybackSession, PlaybackSessionStore};
pub use profile::ProfileStore;
pub use recording::save_recording;
pub use scanner::start_scan;
pub use song::{Song, SongOrigin};
pub use source::{
    JellyfinAuth, JellyfinSource, MediaSource, NavidromeAuth, NavidromeSource, PlexAuth,
    PlexSource, SourceKind, active_source,
    jellyfin::{
        JellyfinHealth, JellyfinLibrary, JellyfinLoginResult, login as jellyfin_login,
        ping as jellyfin_ping, ping_current as jellyfin_ping_current,
    },
    navidrome::{
        NavidromeHealth, NavidromeLoginResult, login as navidrome_login, ping as navidrome_ping,
        ping_current as navidrome_ping_current,
    },
    plex::{
        PlexHealth, PlexPinPollResult, PlexPinStart, PlexSection, PlexServer,
        begin_pin as plex_begin_pin, manual_login as plex_manual_login, ping as plex_ping,
        ping_current as plex_ping_current, poll_pin as plex_poll_pin,
    },
};
pub use vendor::{
    SetupFolders, SetupProgress, SetupStep, clear_vendor_dir, is_ready, mark_ready,
    refresh_analyzer_scripts_if_ready, resolve_data_path_input, run_vendor_setup, step_create_venv,
    step_download_ffmpeg, step_download_uv, step_extract_scripts, step_install_packages,
    step_install_python,
};

pub fn startup() -> Result<(), String> {
    init_library().map_err(|e| e.to_string())?;

    AnalysisQueue::clear();

    let cache = CacheDir::new();

    if let Err(e) = library_db::rewrite_legacy_jellyfin_paths(&cache.path) {
        tracing::warn!("Failed to migrate legacy Jellyfin paths: {e}");
    }

    if let Err(e) = refresh_analyzer_scripts_if_ready() {
        tracing::warn!("Failed to refresh analyzer scripts: {e}");
    }

    if AppConfig::load().auto_analyze() {
        let _ = enqueue(SongTarget::Filter {
            filters: LibraryMenuFilters::default(),
        });
    }

    Ok(())
}
