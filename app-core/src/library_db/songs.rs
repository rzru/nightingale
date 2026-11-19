//! Song row CRUD.

use std::collections::HashSet;

use diesel::QueryResult;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use crate::error::NightingaleError;
use crate::song::{Song, TranscriptSource};

use super::connection::{with_conn, with_conn_mut};
use super::scan_generation_is_current;
use super::schema::{analysis_queue, library_meta, songs};
use super::sql_functions::NoCase;

#[derive(Insertable)]
#[diesel(table_name = songs)]
struct NewSongRow {
    path: String,
    file_hash: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    duration_secs: f64,
    album_art_path: Option<String>,
    is_analyzed: bool,
    language: Option<String>,
    transcript_source: Option<String>,
    is_video: bool,
    payload: String,
}

impl NewSongRow {
    fn from_song(song: &Song) -> Result<Self, NightingaleError> {
        Ok(Self {
            path: song.path.to_string_lossy().into_owned(),
            file_hash: song.file_hash.clone(),
            title: song.title.clone(),
            artist: song.artist.clone(),
            album: song.album.clone(),
            genre: song.genre.clone(),
            duration_secs: song.duration_secs,
            album_art_path: song
                .album_art_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            is_analyzed: song.is_analyzed,
            language: song.language.clone(),
            transcript_source: transcript_source_to_db(song.transcript_source),
            is_video: song.is_video,
            payload: song_to_payload(song)?,
        })
    }
}

pub(crate) fn song_to_payload(song: &Song) -> Result<String, NightingaleError> {
    Ok(serde_json::to_string(song)?)
}

pub(crate) fn transcript_source_to_db(t: Option<TranscriptSource>) -> Option<String> {
    t.map(|source| match source {
        TranscriptSource::Lyrics => "lyrics".to_string(),
        TranscriptSource::Generated => "generated".to_string(),
        TranscriptSource::Usdx => "usdx".to_string(),
        TranscriptSource::Lrc => "lrc".to_string(),
    })
}

fn deserialize_songs(payloads: Vec<String>) -> Result<Vec<Song>, NightingaleError> {
    payloads
        .into_iter()
        .map(|payload| Ok(serde_json::from_str(&payload)?))
        .collect()
}

fn insert_song_row(conn: &mut SqliteConnection, row: &NewSongRow) -> QueryResult<()> {
    diesel::insert_into(songs::table)
        .values(row)
        .execute(conn)?;
    Ok(())
}

pub(crate) fn read_library_meta() -> Result<(String, usize), NightingaleError> {
    with_conn(|conn| {
        let (folder, scan_count) = library_meta::table
            .find(1_i64)
            .select((library_meta::folder, library_meta::scan_count))
            .first::<(String, i64)>(conn)?;
        Ok((folder, scan_count as usize))
    })
}

pub(crate) fn update_library_meta(folder: &str, scan_count: usize) -> Result<(), NightingaleError> {
    with_conn_mut(|conn| {
        diesel::update(library_meta::table.find(1_i64))
            .set((
                library_meta::folder.eq(folder),
                library_meta::scan_count.eq(scan_count as i64),
            ))
            .execute(conn)?;
        Ok(())
    })
}

pub(crate) fn load_song_path_strings() -> Result<HashSet<String>, NightingaleError> {
    with_conn(|conn| {
        Ok(songs::table
            .select(songs::path)
            .load::<String>(conn)?
            .into_iter()
            .collect())
    })
}

pub(super) fn append_songs(input: &[Song]) -> Result<(), NightingaleError> {
    if input.is_empty() {
        return Ok(());
    }
    let rows = input
        .iter()
        .map(NewSongRow::from_song)
        .collect::<Result<Vec<_>, _>>()?;
    with_conn_mut(|conn| {
        conn.transaction::<_, NightingaleError, _>(|conn| {
            for row in &rows {
                insert_song_row(conn, row)?;
            }
            Ok(())
        })
    })
}

pub(crate) fn append_songs_for_scan(
    input: &[Song],
    generation: u64,
) -> Result<(), NightingaleError> {
    if input.is_empty() || !scan_generation_is_current(generation) {
        return Ok(());
    }
    let rows = input
        .iter()
        .map(NewSongRow::from_song)
        .collect::<Result<Vec<_>, _>>()?;
    with_conn_mut(|conn| {
        let result = conn.transaction::<_, diesel::result::Error, _>(|conn| {
            for row in &rows {
                if !scan_generation_is_current(generation) {
                    return Err(diesel::result::Error::RollbackTransaction);
                }
                insert_song_row(conn, row)?;
            }
            if !scan_generation_is_current(generation) {
                return Err(diesel::result::Error::RollbackTransaction);
            }
            Ok(())
        });
        match result {
            Ok(()) | Err(diesel::result::Error::RollbackTransaction) => Ok(()),
            Err(error) => Err(error.into()),
        }
    })
}

pub(crate) fn replace_all_songs_sorted(input: &[Song]) -> Result<(), NightingaleError> {
    let rows = input
        .iter()
        .map(NewSongRow::from_song)
        .collect::<Result<Vec<_>, _>>()?;
    with_conn_mut(|conn| {
        conn.transaction::<_, NightingaleError, _>(|conn| {
            diesel::delete(songs::table).execute(conn)?;
            for row in &rows {
                insert_song_row(conn, row)?;
            }
            Ok(())
        })
    })
}

pub(crate) fn delete_songs_not_in_paths(paths: &[String]) -> Result<(), NightingaleError> {
    with_conn_mut(|conn| {
        if paths.is_empty() {
            diesel::delete(songs::table).execute(conn)?;
        } else {
            diesel::delete(songs::table.filter(songs::path.ne_all(paths))).execute(conn)?;
        }
        Ok(())
    })
}

pub(crate) fn load_song_by_hash(file_hash: &str) -> Result<Option<Song>, NightingaleError> {
    with_conn(|conn| {
        let payload = songs::table
            .filter(songs::file_hash.eq(file_hash))
            .select(songs::payload)
            .first::<String>(conn)
            .optional()?;
        payload
            .map(|payload| serde_json::from_str(&payload).map_err(NightingaleError::from))
            .transpose()
    })
}

pub(crate) fn load_songs_by_hashes(file_hashes: &[String]) -> Result<Vec<Song>, NightingaleError> {
    if file_hashes.is_empty() {
        return Ok(Vec::new());
    }
    with_conn(|conn| {
        let payloads = songs::table
            .filter(songs::file_hash.eq_any(file_hashes))
            .select(songs::payload)
            .load::<String>(conn)?;
        deserialize_songs(payloads)
    })
}

pub(crate) fn rekey_song(
    old_hash: &str,
    new_hash: &str,
    new_song: &Song,
) -> Result<(), NightingaleError> {
    let row = NewSongRow::from_song(new_song)?;
    with_conn_mut(|conn| {
        conn.transaction::<_, NightingaleError, _>(|conn| {
            diesel::update(songs::table.filter(songs::file_hash.eq(old_hash)))
                .set((
                    songs::file_hash.eq(new_hash),
                    songs::path.eq(&row.path),
                    songs::payload.eq(&row.payload),
                    songs::album_art_path.eq(&row.album_art_path),
                    songs::title.eq(&row.title),
                    songs::artist.eq(&row.artist),
                    songs::album.eq(&row.album),
                    songs::genre.eq(&row.genre),
                    songs::duration_secs.eq(row.duration_secs),
                    songs::is_analyzed.eq(row.is_analyzed),
                    songs::language.eq(&row.language),
                    songs::transcript_source.eq(&row.transcript_source),
                    songs::is_video.eq(row.is_video),
                ))
                .execute(conn)?;
            diesel::delete(analysis_queue::table.filter(analysis_queue::file_hash.eq(new_hash)))
                .execute(conn)?;
            diesel::update(analysis_queue::table.filter(analysis_queue::file_hash.eq(old_hash)))
                .set(analysis_queue::file_hash.eq(new_hash))
                .execute(conn)?;
            Ok(())
        })
    })
}

pub(crate) fn update_song_fields(file_hash: &str, song: &Song) -> Result<(), NightingaleError> {
    let row = NewSongRow::from_song(song)?;
    with_conn_mut(|conn| {
        diesel::update(songs::table.filter(songs::file_hash.eq(file_hash)))
            .set((
                songs::title.eq(&row.title),
                songs::artist.eq(&row.artist),
                songs::album.eq(&row.album),
                songs::genre.eq(&row.genre),
                songs::duration_secs.eq(row.duration_secs),
                songs::album_art_path.eq(&row.album_art_path),
                songs::is_analyzed.eq(row.is_analyzed),
                songs::language.eq(&row.language),
                songs::transcript_source.eq(&row.transcript_source),
                songs::is_video.eq(row.is_video),
                songs::payload.eq(&row.payload),
            ))
            .execute(conn)?;
        Ok(())
    })
}

pub(crate) fn load_all_songs() -> Result<Vec<Song>, NightingaleError> {
    with_conn(|conn| {
        let payloads = songs::table
            .select(songs::payload)
            .order((NoCase::new(songs::artist), NoCase::new(songs::title)))
            .load::<String>(conn)?;
        deserialize_songs(payloads)
    })
}
