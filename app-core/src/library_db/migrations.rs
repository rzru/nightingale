//! Schema migrations + one-shot data migrations.
//!
//! Schema DDL and connection PRAGMAs remain SQL because Diesel migrations are SQL too.
//! Runtime reads and writes use Diesel's typed query builder.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sql_types::Integer;
use diesel::sqlite::SqliteConnection;

use crate::cache::songs_path;
use crate::error::NightingaleError;
use crate::library_model::SongsStore;
use crate::song::{Song, SongOrigin};

use super::connection::{with_conn, with_conn_mut};
use super::schema::songs;
use super::songs::{append_songs, update_library_meta};
use super::sql_functions::json_extract_text;

const SCHEMA_VERSION: i32 = 3;

static MIGRATING: AtomicBool = AtomicBool::new(false);
static MIGRATION_TOTAL: AtomicUsize = AtomicUsize::new(0);
static MIGRATION_DONE: AtomicUsize = AtomicUsize::new(0);

#[derive(QueryableByName)]
struct UserVersion {
    #[diesel(sql_type = Integer)]
    user_version: i32,
}

pub(super) fn is_song_migration_in_progress() -> bool {
    MIGRATING.load(Ordering::Acquire)
}

pub(super) fn song_migration_total() -> usize {
    MIGRATION_TOTAL.load(Ordering::Acquire)
}

pub(super) fn song_migration_done() -> usize {
    MIGRATION_DONE.load(Ordering::Acquire)
}

pub(super) fn configure(conn: &mut SqliteConnection) -> Result<(), NightingaleError> {
    conn.batch_execute(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA cache_size = -64000;
        PRAGMA mmap_size = 268435456;
    ",
    )?;
    Ok(())
}

pub(super) fn run_migrations(conn: &mut SqliteConnection) -> Result<(), NightingaleError> {
    let version = diesel::sql_query("PRAGMA user_version")
        .get_result::<UserVersion>(conn)?
        .user_version;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    if version == 0 {
        conn.batch_execute(
            "
            CREATE TABLE library_meta (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                folder TEXT NOT NULL DEFAULT '',
                scan_count INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO library_meta (id, folder, scan_count) VALUES (1, '', 0);

            CREATE TABLE songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                file_hash TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                genre TEXT NOT NULL DEFAULT 'Unknown Genre',
                duration_secs REAL NOT NULL,
                album_art_path TEXT,
                is_analyzed INTEGER NOT NULL,
                language TEXT,
                transcript_source TEXT,
                is_video INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX idx_songs_file_hash ON songs(file_hash);
            CREATE INDEX idx_songs_artist_title ON songs(artist COLLATE NOCASE, title COLLATE NOCASE);
            CREATE INDEX idx_songs_album ON songs(album COLLATE NOCASE);

            CREATE VIRTUAL TABLE songs_fts USING fts5(
                title,
                artist,
                album,
                content = 'songs',
                content_rowid = 'id'
            );

            CREATE TABLE analysis_queue (
                file_hash TEXT PRIMARY KEY,
                status TEXT NOT NULL CHECK (status IN ('queued', 'analyzing', 'failed')),
                analyzing_pct INTEGER,
                failed_message TEXT
            );
        ",
        )?;
    }
    if version < 2 {
        conn.batch_execute(
            "
            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, song_id)
            );
            CREATE INDEX IF NOT EXISTS idx_playlist_songs_order
                ON playlist_songs(playlist_id, position);
            CREATE INDEX IF NOT EXISTS idx_playlist_songs_song
                ON playlist_songs(song_id);
        ",
        )?;
    }
    if version < 3 {
        conn.batch_execute(
            "
            ALTER TABLE songs ADD COLUMN genre TEXT NOT NULL DEFAULT 'Unknown Genre';
        ",
        )?;
    }
    conn.batch_execute(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
    Ok(())
}

pub(super) fn maybe_start_songs_json_migration() {
    let json_path = songs_path();
    if !json_path.is_file() {
        return;
    }
    let count = match with_conn(|conn| Ok(songs::table.count().get_result::<i64>(conn)?)) {
        Ok(count) => count,
        Err(_) => return,
    };
    if count > 0 {
        return;
    }

    let Ok(data) = std::fs::read_to_string(&json_path) else {
        return;
    };
    let Ok(store) = serde_json::from_str::<SongsStore>(&data) else {
        return;
    };
    let total = store.processed.len();
    if total == 0 {
        let _ = update_library_meta(&store.folder, store.count);
        let _ = std::fs::rename(&json_path, json_path.with_extension("json.bak"));
        return;
    }

    MIGRATING.store(true, Ordering::Release);
    MIGRATION_TOTAL.store(total, Ordering::Release);
    MIGRATION_DONE.store(0, Ordering::Release);

    let folder = store.folder.clone();
    let scan_count = store.count;
    let processed = store.processed;

    std::thread::spawn(move || {
        const BATCH: usize = 50;
        let _ = update_library_meta(&folder, scan_count);
        let success = migrate_song_batches(&processed, BATCH, append_songs);
        MIGRATING.store(false, Ordering::Release);
        if success {
            let _ = std::fs::rename(&json_path, json_path.with_extension("json.bak"));
        }
    });
}

fn migrate_song_batches<F>(processed: &[Song], batch: usize, mut append_fn: F) -> bool
where
    F: FnMut(&[Song]) -> Result<(), NightingaleError>,
{
    for chunk in processed.chunks(batch) {
        if append_fn(chunk).is_err() {
            return false;
        }
        MIGRATION_DONE.fetch_add(chunk.len(), Ordering::AcqRel);
    }
    true
}

/// One-shot startup migration for legacy Jellyfin pseudo paths.
pub(crate) fn rewrite_legacy_jellyfin_paths(cache_dir: &Path) -> Result<(), NightingaleError> {
    let candidates = with_conn(|conn| {
        Ok(songs::table
            .filter(json_extract_text(songs::payload, "$.origin.kind").eq("jellyfin"))
            .filter(songs::path.like("jellyfin://%"))
            .select((songs::file_hash, songs::payload))
            .load::<(String, String)>(conn)?)
    })?;

    if candidates.is_empty() {
        return Ok(());
    }

    let sources_dir = cache_dir.join("sources");

    with_conn_mut(|conn| {
        conn.transaction::<_, NightingaleError, _>(|conn| {
            for (file_hash, payload) in candidates {
                let Ok(mut song) = serde_json::from_str::<Song>(&payload) else {
                    continue;
                };
                let container = match &song.origin {
                    SongOrigin::Jellyfin { container, .. } => container.clone(),
                    _ => None,
                };
                let ext = container.as_deref().unwrap_or("bin");
                let new_path = sources_dir.join(format!("{file_hash}.{ext}"));
                song.path = new_path.clone();
                let Ok(new_payload) = serde_json::to_string(&song) else {
                    continue;
                };
                diesel::update(songs::table.filter(songs::file_hash.eq(&file_hash)))
                    .set((
                        songs::path.eq(new_path.to_string_lossy().as_ref()),
                        songs::payload.eq(new_payload),
                    ))
                    .execute(conn)?;
            }
            Ok(())
        })
    })
}
