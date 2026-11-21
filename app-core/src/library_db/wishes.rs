//! Storage for "wishes": tracks imported from a linked account's playlists
//! that the user wants to sing, whether or not they are in the library yet.
//!
//! Wishes are keyed by `(provider, external_id)` so the same video imported
//! through two playlists is one row. They deliberately carry no foreign key to
//! `songs`: library rescans rebuild `songs` freely, and the matcher re-links
//! wishes by `matched_file_hash` afterwards.

use std::collections::HashSet;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::error::NightingaleError;

use super::connection::{with_conn, with_conn_mut};
use super::schema::{songs, wish_playlist_items, wish_playlists, wishes};
use super::sql_functions::normalize_search;

/// Accent- and case-insensitive form shared with library search.
pub(crate) fn normalize_for_match(input: &str) -> String {
    normalize_search(input)
}

pub(crate) struct NewWish<'a> {
    pub(crate) external_id: &'a str,
    pub(crate) title: &'a str,
    pub(crate) artist: &'a str,
    pub(crate) duration_secs: Option<f64>,
    pub(crate) source_url: &'a str,
}

pub(crate) struct WishPlaylistInput<'a> {
    pub(crate) id: &'a str,
    pub(crate) provider: &'a str,
    pub(crate) external_id: &'a str,
    pub(crate) name: &'a str,
    pub(crate) imported_at: i64,
}

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = wishes)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub(crate) struct WishRow {
    pub(crate) id: i64,
    pub(crate) provider: String,
    pub(crate) external_id: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) duration_secs: Option<f64>,
    pub(crate) source_url: String,
    pub(crate) status: String,
    pub(crate) matched_file_hash: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = wish_playlists)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub(crate) struct WishPlaylistRow {
    pub(crate) id: String,
    pub(crate) provider: String,
    pub(crate) external_id: String,
    pub(crate) name: String,
    pub(crate) imported_at: i64,
}

/// Library rows the matcher compares wishes against.
#[derive(Debug, Clone, Queryable)]
pub(crate) struct SongMatchCandidate {
    pub(crate) file_hash: String,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) duration_secs: f64,
    pub(crate) is_analyzed: bool,
}

/// Create or re-import a playlist: its track list is replaced wholesale, its
/// wishes are upserted (keeping their status), and wishes no playlist
/// references any more are dropped.
pub(crate) fn replace_wish_playlist(
    playlist: &WishPlaylistInput<'_>,
    tracks: &[NewWish<'_>],
) -> Result<(), NightingaleError> {
    with_conn_mut(|conn| {
        conn.transaction::<_, NightingaleError, _>(|conn| {
            diesel::insert_into(wish_playlists::table)
                .values((
                    wish_playlists::id.eq(playlist.id),
                    wish_playlists::provider.eq(playlist.provider),
                    wish_playlists::external_id.eq(playlist.external_id),
                    wish_playlists::name.eq(playlist.name),
                    wish_playlists::imported_at.eq(playlist.imported_at),
                ))
                .on_conflict(wish_playlists::id)
                .do_update()
                .set((
                    wish_playlists::name.eq(playlist.name),
                    wish_playlists::imported_at.eq(playlist.imported_at),
                ))
                .execute(conn)?;

            diesel::delete(
                wish_playlist_items::table.filter(wish_playlist_items::playlist_id.eq(playlist.id)),
            )
            .execute(conn)?;

            let mut seen = HashSet::new();
            for (position, track) in tracks.iter().enumerate() {
                if track.external_id.is_empty() {
                    continue;
                }
                diesel::insert_into(wishes::table)
                    .values((
                        wishes::provider.eq(playlist.provider),
                        wishes::external_id.eq(track.external_id),
                        wishes::title.eq(track.title),
                        wishes::artist.eq(track.artist),
                        wishes::duration_secs.eq(track.duration_secs),
                        wishes::source_url.eq(track.source_url),
                        wishes::status.eq("missing"),
                        wishes::added_at.eq(playlist.imported_at),
                    ))
                    .on_conflict((wishes::provider, wishes::external_id))
                    .do_update()
                    .set((
                        wishes::title.eq(track.title),
                        wishes::artist.eq(track.artist),
                        wishes::duration_secs.eq(track.duration_secs),
                        wishes::source_url.eq(track.source_url),
                    ))
                    .execute(conn)?;

                let wish_id = wishes::table
                    .filter(wishes::provider.eq(playlist.provider))
                    .filter(wishes::external_id.eq(track.external_id))
                    .select(wishes::id)
                    .first::<i64>(conn)?;
                if !seen.insert(wish_id) {
                    continue;
                }
                diesel::insert_into(wish_playlist_items::table)
                    .values((
                        wish_playlist_items::playlist_id.eq(playlist.id),
                        wish_playlist_items::wish_id.eq(wish_id),
                        wish_playlist_items::position.eq(position as i64),
                    ))
                    .execute(conn)?;
            }

            delete_orphan_wishes(conn)?;
            Ok(())
        })
    })
}

pub(crate) fn delete_wish_playlist(id: &str) -> Result<bool, NightingaleError> {
    with_conn_mut(|conn| {
        conn.transaction::<_, NightingaleError, _>(|conn| {
            // Explicit item delete: does not rely on `PRAGMA foreign_keys`.
            diesel::delete(
                wish_playlist_items::table.filter(wish_playlist_items::playlist_id.eq(id)),
            )
            .execute(conn)?;
            let removed = diesel::delete(wish_playlists::table.filter(wish_playlists::id.eq(id)))
                .execute(conn)?;
            delete_orphan_wishes(conn)?;
            Ok(removed > 0)
        })
    })
}

fn delete_orphan_wishes(conn: &mut SqliteConnection) -> Result<usize, NightingaleError> {
    let referenced = wish_playlist_items::table.select(wish_playlist_items::wish_id);
    Ok(
        diesel::delete(wishes::table.filter(diesel::dsl::not(wishes::id.eq_any(referenced))))
            .execute(conn)?,
    )
}

pub(crate) fn load_wish_playlists() -> Result<Vec<WishPlaylistRow>, NightingaleError> {
    with_conn(|conn| {
        Ok(wish_playlists::table
            .order(wish_playlists::imported_at.desc())
            .select(WishPlaylistRow::as_select())
            .load(conn)?)
    })
}

pub(crate) fn load_wish_playlist_row(
    id: &str,
) -> Result<Option<WishPlaylistRow>, NightingaleError> {
    with_conn(|conn| {
        Ok(wish_playlists::table
            .filter(wish_playlists::id.eq(id))
            .select(WishPlaylistRow::as_select())
            .first(conn)
            .optional()?)
    })
}

/// Wishes of one playlist, in playlist order.
pub(crate) fn load_playlist_wishes(playlist_id: &str) -> Result<Vec<WishRow>, NightingaleError> {
    with_conn(|conn| {
        Ok(wish_playlist_items::table
            .inner_join(wishes::table)
            .filter(wish_playlist_items::playlist_id.eq(playlist_id))
            .order(wish_playlist_items::position.asc())
            .select(WishRow::as_select())
            .load(conn)?)
    })
}

pub(crate) fn load_all_wishes() -> Result<Vec<WishRow>, NightingaleError> {
    with_conn(|conn| {
        Ok(wishes::table
            .order(wishes::id.asc())
            .select(WishRow::as_select())
            .load(conn)?)
    })
}

pub(crate) fn set_wish_match(
    id: i64,
    status: &str,
    matched_file_hash: Option<&str>,
) -> Result<(), NightingaleError> {
    with_conn_mut(|conn| {
        diesel::update(wishes::table.filter(wishes::id.eq(id)))
            .set((
                wishes::status.eq(status),
                wishes::matched_file_hash.eq(matched_file_hash),
                wishes::error.eq(None::<String>),
            ))
            .execute(conn)?;
        Ok(())
    })
}

pub(crate) fn load_song_match_candidates() -> Result<Vec<SongMatchCandidate>, NightingaleError> {
    with_conn(|conn| {
        Ok(songs::table
            .select((
                songs::file_hash,
                songs::title,
                songs::artist,
                songs::duration_secs,
                songs::is_analyzed,
            ))
            .load::<SongMatchCandidate>(conn)?)
    })
}
