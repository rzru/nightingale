//! Read-side queries used by library navigation and analyzer enqueue paths.

use std::collections::{BTreeMap, HashMap};

use diesel::dsl::{case_when, exists};
use diesel::prelude::*;
use diesel::sqlite::Sqlite;

use crate::error::NightingaleError;
use crate::library_menu::{LibraryMenuItem, LibraryMenuItems};
use crate::library_model::{
    LibraryMenuFilters, LoadSongsParams, SongSort, SongSortColumn, SongsMeta, SongsStore,
    SortDirection,
};
use crate::song::Song;

use super::connection::with_conn;
use super::migrations::{is_song_migration_in_progress, song_migration_done, song_migration_total};
use super::schema::{analysis_queue, library_meta, playlist_songs, playlists, songs};
use super::sql_functions::{
    CastInteger, CastOpen, NoCase, instr, json_extract_text, normalize_search, search_normalize,
};
type SongQuery = songs::BoxedQuery<'static, Sqlite>;

#[derive(Clone, Copy)]
enum ExtraFilter {
    None,
    NotAnalyzed,
    Reconciliable,
    AnalysisBusy,
    Realignable,
    FullReanalyzable,
    Refreshable,
}

pub(crate) fn load_meta_sql() -> Result<SongsMeta, NightingaleError> {
    with_conn(|conn| {
        let (folder, scan_count) = library_meta::table
            .find(1_i64)
            .select((library_meta::folder, library_meta::scan_count))
            .first::<(String, i64)>(conn)?;
        let processed = songs::table.count().get_result::<i64>(conn)?;
        let songs_count = songs::table
            .filter(songs::is_video.eq(false))
            .count()
            .get_result::<i64>(conn)?;
        let videos_count = songs::table
            .filter(songs::is_video.eq(true))
            .count()
            .get_result::<i64>(conn)?;
        let analyzed_count = songs::table
            .filter(songs::is_analyzed.eq(true))
            .count()
            .get_result::<i64>(conn)?;
        Ok(SongsMeta {
            count: if is_song_migration_in_progress() {
                song_migration_total()
            } else {
                scan_count as usize
            },
            folder,
            processed_count: if is_song_migration_in_progress() {
                song_migration_done()
            } else {
                processed as usize
            },
            songs_count: songs_count as usize,
            videos_count: videos_count as usize,
            analyzed_count: analyzed_count as usize,
        })
    })
}

fn escape_like_pattern(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for character in input.chars() {
        match character {
            '%' | '_' | '\\' => {
                output.push('\\');
                output.push(character);
            }
            character => output.push(character),
        }
    }
    output
}

fn search_words_from_query(query: &str) -> Option<Vec<String>> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }
    let words = query
        .split_whitespace()
        .map(|word| escape_like_pattern(&normalize_search(word)))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    (!words.is_empty()).then_some(words)
}

macro_rules! analysis_exists {
    ($statuses:expr) => {
        exists(
            analysis_queue::table
                .filter(analysis_queue::file_hash.eq(songs::file_hash))
                .filter(analysis_queue::status.eq_any($statuses)),
        )
    };
}

macro_rules! any_analysis_exists {
    () => {
        exists(analysis_queue::table.filter(analysis_queue::file_hash.eq(songs::file_hash)))
    };
}

fn apply_search(mut query: SongQuery, words: &[String]) -> SongQuery {
    for word in words {
        let pattern = format!("%{word}%");
        query = query.filter(
            search_normalize(songs::title)
                .like(pattern.clone())
                .escape('\\')
                .or(search_normalize(songs::artist)
                    .like(pattern.clone())
                    .escape('\\'))
                .or(search_normalize(songs::album)
                    .like(pattern.clone())
                    .escape('\\'))
                .or(search_normalize(songs::path).like(pattern).escape('\\')),
        );
    }
    query
}

fn filtered_songs(
    filters: &LibraryMenuFilters,
    search_words: Option<&[String]>,
    extra: ExtraFilter,
) -> SongQuery {
    let mut query = songs::table.into_boxed::<Sqlite>();

    if let Some(playlist_id) = filters
        .playlist
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        query = query.filter(exists(
            playlist_songs::table
                .filter(playlist_songs::song_id.eq(songs::id))
                .filter(playlist_songs::playlist_id.eq(playlist_id.to_string())),
        ));
    }
    if let Some(artist) = filters.artist.as_deref().filter(|value| !value.is_empty()) {
        query = query.filter(songs::artist.eq(if artist == "unknown_artist" {
            "Unknown Artist".to_string()
        } else {
            artist.to_string()
        }));
    }
    if let Some(album) = filters.album.as_deref().filter(|value| !value.is_empty()) {
        if album == "unknown_album" {
            query = query.filter(songs::album.eq("Unknown Album"));
        } else if let Some((artist, album)) = album.split_once('\u{001f}') {
            query = query
                .filter(songs::artist.eq(artist.to_string()))
                .filter(songs::album.eq(album.to_string()));
        } else {
            query = query.filter(songs::album.eq(album.to_string()));
        }
    }
    if let Some(folder) = filters.folder.as_deref().filter(|value| !value.is_empty()) {
        query = query.filter(instr(songs::path, folder.to_string()).eq(1));
    }
    match filters.query.as_deref() {
        Some("analysed") => query = query.filter(songs::is_analyzed.eq(true)),
        Some("queued") => query = query.filter(analysis_exists!(["queued", "analyzing"])),
        Some("videos") => query = query.filter(songs::is_video.eq(true)),
        Some("usdx") => query = query.filter(songs::transcript_source.eq("usdx")),
        _ => {}
    }
    match filters.status.as_deref() {
        Some("not_analyzed") => {
            query = query
                .filter(songs::is_analyzed.eq(false))
                .filter(diesel::dsl::not(any_analysis_exists!()));
        }
        Some(status @ ("queued" | "analyzing" | "failed")) => {
            query = query.filter(analysis_exists!([status.to_string()]));
        }
        Some("analyzed") => query = query.filter(songs::is_analyzed.eq(true)),
        _ => {}
    }
    if let Some(source) = filters
        .transcript_source
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        query = query.filter(songs::transcript_source.eq(source.to_string()));
    }
    if let Some(words) = filters.search.as_deref().and_then(search_words_from_query) {
        query = apply_search(query, &words);
    }
    if let Some(words) = search_words {
        query = apply_search(query, words);
    }

    match extra {
        ExtraFilter::None => {}
        ExtraFilter::NotAnalyzed => query = query.filter(songs::is_analyzed.eq(false)),
        ExtraFilter::Reconciliable => {
            query = query
                .filter(songs::is_analyzed.eq(false))
                .filter(json_extract_text(songs::payload, "$.usdx").is_null())
                .filter(diesel::dsl::not(analysis_exists!(["queued", "analyzing"])));
        }
        ExtraFilter::AnalysisBusy => {
            query = query.filter(analysis_exists!(["queued", "analyzing"]))
        }
        ExtraFilter::Realignable => {
            query = query
                .filter(songs::is_analyzed.eq(true))
                .filter(songs::transcript_source.ne_all(["usdx", "lrc"]));
        }
        ExtraFilter::FullReanalyzable => {
            query = query
                .filter(songs::is_analyzed.eq(true))
                .filter(songs::transcript_source.ne("usdx"));
        }
        ExtraFilter::Refreshable => {
            query = query.filter(json_extract_text(songs::payload, "$.usdx").is_null())
        }
    }

    query
}

fn order_by_sort(mut query: SongQuery, sorts: &[SongSort]) -> SongQuery {
    for (index, sort) in sorts.iter().enumerate() {
        let first = index == 0;
        macro_rules! order {
            ($expression:expr) => {
                if first {
                    query = match sort.direction {
                        SortDirection::Ascending => query.order_by($expression.asc()),
                        SortDirection::Descending => query.order_by($expression.desc()),
                    };
                } else {
                    query = match sort.direction {
                        SortDirection::Ascending => query.then_order_by($expression.asc()),
                        SortDirection::Descending => query.then_order_by($expression.desc()),
                    };
                }
            };
        }
        match sort.column {
            SongSortColumn::Title => order!(NoCase::new(songs::title)),
            SongSortColumn::Artist => order!(NoCase::new(songs::artist)),
            SongSortColumn::Album => order!(NoCase::new(songs::album)),
            SongSortColumn::Duration => {
                order!(CastInteger::new(CastOpen::new(songs::duration_secs)))
            }
            SongSortColumn::Status => {
                let status = case_when(
                    analysis_exists!(["analyzing"]),
                    0_i32.into_sql::<diesel::sql_types::Integer>(),
                )
                .when(analysis_exists!(["failed"]), 10_i32)
                .when(
                    songs::is_analyzed
                        .eq(false)
                        .and(diesel::dsl::not(any_analysis_exists!())),
                    20_i32,
                )
                .when(analysis_exists!(["queued"]), 30_i32)
                .when(songs::transcript_source.eq("lyrics"), 40_i32)
                .when(
                    songs::transcript_source
                        .eq("generated")
                        .or(songs::transcript_source.is_null()),
                    41_i32,
                )
                .when(songs::transcript_source.eq("lrc"), 42_i32)
                .when(songs::transcript_source.eq("usdx"), 43_i32)
                .otherwise(44_i32);
                order!(status);
            }
        }
    }
    if let Some(last) = sorts.last() {
        query = match last.direction {
            SortDirection::Ascending => query.then_order_by(songs::id.asc()),
            SortDirection::Descending => query.then_order_by(songs::id.desc()),
        };
    }
    query
}

fn default_order(mut query: SongQuery, filters: &LibraryMenuFilters) -> SongQuery {
    if filters.query.as_deref() == Some("queued") {
        let queue_status = analysis_queue::table
            .filter(analysis_queue::file_hash.eq(songs::file_hash))
            .select(
                case_when(
                    analysis_queue::status.eq("analyzing"),
                    0_i32.into_sql::<diesel::sql_types::Integer>(),
                )
                .otherwise(1_i32),
            )
            .single_value();
        let queue_rowid = analysis_queue::table
            .filter(analysis_queue::file_hash.eq(songs::file_hash))
            .select(analysis_queue::rowid)
            .single_value();
        query = query
            .order_by(queue_status.asc())
            .then_order_by(queue_rowid.asc());
    }
    if let Some(playlist_id) = filters
        .playlist
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let position = playlist_songs::table
            .filter(playlist_songs::song_id.eq(songs::id))
            .filter(playlist_songs::playlist_id.eq(playlist_id.to_string()))
            .select(playlist_songs::position)
            .single_value();
        query = if filters.query.as_deref() == Some("queued") {
            query.then_order_by(position.asc())
        } else {
            query.order_by(position.asc())
        };
    }
    if filters.query.as_deref() == Some("queued")
        || filters
            .playlist
            .as_deref()
            .is_some_and(|value| !value.is_empty())
    {
        query
            .then_order_by(NoCase::new(songs::artist).asc())
            .then_order_by(NoCase::new(songs::title).asc())
    } else {
        query
            .order_by(NoCase::new(songs::artist).asc())
            .then_order_by(NoCase::new(songs::title).asc())
    }
}

fn iteration_order(mut query: SongQuery, filters: &LibraryMenuFilters) -> SongQuery {
    if let Some(playlist_id) = filters
        .playlist
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let position = playlist_songs::table
            .filter(playlist_songs::song_id.eq(songs::id))
            .filter(playlist_songs::playlist_id.eq(playlist_id.to_string()))
            .select(playlist_songs::position)
            .single_value();
        query = query.order_by(position.asc());
        query
            .then_order_by(NoCase::new(songs::artist).asc())
            .then_order_by(NoCase::new(songs::title).asc())
    } else {
        query
            .order_by(NoCase::new(songs::artist).asc())
            .then_order_by(NoCase::new(songs::title).asc())
    }
}

fn deserialize_payloads(payloads: Vec<String>) -> Result<Vec<Song>, NightingaleError> {
    payloads
        .into_iter()
        .map(|payload| Ok(serde_json::from_str(&payload)?))
        .collect()
}

pub(crate) fn load_songs_page(params: &LoadSongsParams) -> Result<SongsStore, NightingaleError> {
    let (folder, scan_count) = with_conn(|conn| {
        Ok(library_meta::table
            .find(1_i64)
            .select((library_meta::folder, library_meta::scan_count))
            .first::<(String, i64)>(conn)?)
    })?;
    let search_words = params.search.as_deref().and_then(search_words_from_query);

    let processed = with_conn(|conn| {
        let query = filtered_songs(&params.filters, search_words.as_deref(), ExtraFilter::None);
        let query = if let Some(sorts) = params.sort.as_deref().filter(|sorts| !sorts.is_empty()) {
            order_by_sort(query, sorts)
        } else {
            default_order(query, &params.filters)
        };
        let payloads = query
            .select(songs::payload)
            .limit(params.take as i64)
            .offset(params.skip as i64)
            .load::<String>(conn)?;
        deserialize_payloads(payloads)
    })?;

    let (processed_count, analyzed_count, analysis_busy_count) = with_conn(|conn| {
        let processed = filtered_songs(&params.filters, search_words.as_deref(), ExtraFilter::None)
            .count()
            .get_result::<i64>(conn)?;
        let analyzed = filtered_songs(&params.filters, search_words.as_deref(), ExtraFilter::None)
            .filter(songs::is_analyzed.eq(true))
            .count()
            .get_result::<i64>(conn)?;
        let analysis_busy =
            filtered_songs(&params.filters, search_words.as_deref(), ExtraFilter::None)
                .filter(analysis_exists!(["queued", "analyzing"]))
                .count()
                .get_result::<i64>(conn)?;
        Ok((
            processed as usize,
            analyzed as usize,
            analysis_busy as usize,
        ))
    })?;

    Ok(SongsStore {
        count: scan_count as usize,
        folder,
        processed,
        processed_count,
        analyzed_count,
        analysis_busy_count,
    })
}

fn iter_file_hashes_filtered(
    filters: &LibraryMenuFilters,
    extra: ExtraFilter,
) -> Result<Vec<String>, NightingaleError> {
    with_conn(|conn| {
        let query = filtered_songs(filters, None, extra);
        Ok(iteration_order(query, filters)
            .select(songs::file_hash)
            .load(conn)?)
    })
}

pub(crate) fn iter_file_hashes_filtered_not_analyzed(
    filters: &LibraryMenuFilters,
) -> Result<Vec<String>, NightingaleError> {
    iter_file_hashes_filtered(filters, ExtraFilter::NotAnalyzed)
}

pub(crate) fn iter_file_hashes_reconcilable() -> Result<Vec<String>, NightingaleError> {
    iter_file_hashes_filtered(&LibraryMenuFilters::default(), ExtraFilter::Reconciliable)
}

pub(crate) fn iter_file_hashes_filtered_analysis_busy(
    filters: &LibraryMenuFilters,
) -> Result<Vec<String>, NightingaleError> {
    iter_file_hashes_filtered(filters, ExtraFilter::AnalysisBusy)
}

pub(crate) fn iter_file_hashes_filtered_realignable(
    filters: &LibraryMenuFilters,
) -> Result<Vec<String>, NightingaleError> {
    iter_file_hashes_filtered(filters, ExtraFilter::Realignable)
}

pub(crate) fn iter_file_hashes_filtered_full_reanalyzable(
    filters: &LibraryMenuFilters,
) -> Result<Vec<String>, NightingaleError> {
    iter_file_hashes_filtered(filters, ExtraFilter::FullReanalyzable)
}

pub(crate) fn iter_file_hashes_filtered_refreshable(
    filters: &LibraryMenuFilters,
) -> Result<Vec<String>, NightingaleError> {
    iter_file_hashes_filtered(filters, ExtraFilter::Refreshable)
}

#[derive(Default)]
struct MenuCounts {
    count: u64,
    analyzed: u64,
    queued: u64,
    analyzing: u64,
}

impl MenuCounts {
    fn add(&mut self, analyzed: bool, status: Option<&str>) {
        self.count += 1;
        self.analyzed += u64::from(analyzed);
        self.queued += u64::from(status == Some("queued"));
        self.analyzing += u64::from(status == Some("analyzing"));
    }

    fn item(&self, value: String, label: String) -> LibraryMenuItem {
        LibraryMenuItem {
            value,
            label,
            analysed_count: self.analyzed,
            queued_count: self.queued,
            analysing_count: self.analyzing,
            count: self.count,
            depth: None,
        }
    }
}

const PATH_SEPARATORS: [char; 2] = ['/', '\\'];

struct FolderEntry {
    prefix: String,
    name: String,
    depth: u32,
    counts: MenuCounts,
}

/// Folders containing `path` below the library `root`, outermost first, as
/// `(path prefix ending in its separator, folder name)`. The prefix is cut from
/// `path` itself so it matches the stored paths' exact separators and casing.
fn folder_prefixes<'a>(path: &'a str, root: &str) -> Vec<(&'a str, &'a str)> {
    let root = root.trim_end_matches(PATH_SEPARATORS);
    let Some(rest) = path.strip_prefix(root).filter(|_| !root.is_empty()) else {
        return Vec::new();
    };
    if !rest.starts_with(PATH_SEPARATORS) {
        return Vec::new();
    }
    let offset = path.len() - rest.len() + 1;
    let mut folders = Vec::new();
    let mut start = offset;
    for (index, ch) in path[offset..].char_indices() {
        if PATH_SEPARATORS.contains(&ch) {
            let end = offset + index;
            if end > start {
                folders.push((&path[..=end], &path[start..end]));
            }
            start = end + 1;
        }
    }
    folders
}

pub(crate) fn query_library_menu_items() -> Result<LibraryMenuItems, NightingaleError> {
    with_conn(|conn| {
        let song_rows = songs::table
            .left_join(analysis_queue::table.on(analysis_queue::file_hash.eq(songs::file_hash)))
            .select((
                songs::path,
                songs::artist,
                songs::album,
                songs::is_analyzed,
                songs::is_video,
                songs::transcript_source,
                analysis_queue::status.nullable(),
            ))
            .order((NoCase::new(songs::artist), NoCase::new(songs::album)))
            .load::<(
                String,
                String,
                String,
                bool,
                bool,
                Option<String>,
                Option<String>,
            )>(conn)?;
        let queue_statuses = analysis_queue::table
            .select(analysis_queue::status)
            .load::<String>(conn)?;
        let root = library_meta::table
            .find(1_i64)
            .select(library_meta::folder)
            .first::<String>(conn)
            .optional()?
            .unwrap_or_default();

        let mut all = MenuCounts::default();
        let mut videos = MenuCounts::default();
        let mut usdx = MenuCounts::default();
        let mut unknown_artist = MenuCounts::default();
        let mut unknown_album = MenuCounts::default();
        let mut artist_order = Vec::new();
        let mut artist_counts = HashMap::<String, MenuCounts>::new();
        let mut album_order = Vec::new();
        let mut album_counts = HashMap::<(String, String), MenuCounts>::new();
        let mut folder_counts = BTreeMap::<Vec<(String, String)>, FolderEntry>::new();

        for (path, artist, album, analyzed, is_video, transcript_source, status) in song_rows {
            all.add(analyzed, status.as_deref());
            let mut folder_key = Vec::new();
            for (depth, (prefix, name)) in folder_prefixes(&path, &root).into_iter().enumerate() {
                folder_key.push((name.to_lowercase(), name.to_string()));
                folder_counts
                    .entry(folder_key.clone())
                    .or_insert_with(|| FolderEntry {
                        prefix: prefix.to_string(),
                        name: name.to_string(),
                        depth: u32::try_from(depth).unwrap_or(u32::MAX),
                        counts: MenuCounts::default(),
                    })
                    .counts
                    .add(analyzed, status.as_deref());
            }
            if is_video {
                videos.add(analyzed, status.as_deref());
            }
            if transcript_source.as_deref() == Some("usdx") {
                usdx.add(analyzed, status.as_deref());
            }
            if artist == "Unknown Artist" {
                unknown_artist.add(analyzed, status.as_deref());
            }
            if album == "Unknown Album" {
                unknown_album.add(analyzed, status.as_deref());
            }
            if !artist_counts.contains_key(&artist) {
                artist_order.push(artist.clone());
            }
            artist_counts
                .entry(artist.clone())
                .or_default()
                .add(analyzed, status.as_deref());

            let album_key = (artist, album);
            if !album_counts.contains_key(&album_key) {
                album_order.push(album_key.clone());
            }
            album_counts
                .entry(album_key)
                .or_default()
                .add(analyzed, status.as_deref());
        }

        let queued_total = queue_statuses
            .iter()
            .filter(|status| status.as_str() == "queued")
            .count() as u64;
        let analyzing_total = queue_statuses
            .iter()
            .filter(|status| status.as_str() == "analyzing")
            .count() as u64;
        let hot = vec![
            LibraryMenuItem {
                value: "all".into(),
                label: "All".into(),
                analysed_count: all.analyzed,
                queued_count: queued_total,
                analysing_count: analyzing_total,
                count: all.count,
                depth: None,
            },
            LibraryMenuItem {
                value: "queued".into(),
                label: "Queued".into(),
                analysed_count: 0,
                queued_count: queued_total,
                analysing_count: analyzing_total,
                count: queued_total + analyzing_total,
                depth: None,
            },
            LibraryMenuItem {
                value: "analysed".into(),
                label: "Analysed".into(),
                analysed_count: all.analyzed,
                queued_count: 0,
                analysing_count: 0,
                count: all.analyzed,
                depth: None,
            },
            videos.item("videos".into(), "Videos".into()),
            usdx.item("usdx".into(), "USDX".into()),
        ];
        let no_metadata = vec![
            unknown_artist.item("unknown_artist".into(), "Unknown Artist".into()),
            unknown_album.item("unknown_album".into(), "Unknown Album".into()),
        ];
        let artists = artist_order
            .into_iter()
            .map(|artist| {
                artist_counts
                    .remove(&artist)
                    .unwrap_or_default()
                    .item(artist.clone(), artist)
            })
            .collect();
        let albums = album_order
            .into_iter()
            .map(|(artist, album)| {
                album_counts
                    .remove(&(artist.clone(), album.clone()))
                    .unwrap_or_default()
                    .item(
                        format!("{artist}\x1f{album}"),
                        format!("{album} — {artist}"),
                    )
            })
            .collect();

        let playlist_rows = playlists::table
            .inner_join(playlist_songs::table.on(playlist_songs::playlist_id.eq(playlists::id)))
            .inner_join(songs::table.on(songs::id.eq(playlist_songs::song_id)))
            .left_join(analysis_queue::table.on(analysis_queue::file_hash.eq(songs::file_hash)))
            .select((
                playlists::id,
                playlists::name,
                songs::is_analyzed,
                analysis_queue::status.nullable(),
            ))
            .order(NoCase::new(playlists::name))
            .load::<(String, String, bool, Option<String>)>(conn)?;
        let mut playlist_order = Vec::new();
        let mut playlist_counts = HashMap::<String, (String, MenuCounts)>::new();
        for (id, name, analyzed, status) in playlist_rows {
            if !playlist_counts.contains_key(&id) {
                playlist_order.push(id.clone());
            }
            playlist_counts
                .entry(id)
                .or_insert_with(|| (name, MenuCounts::default()))
                .1
                .add(analyzed, status.as_deref());
        }
        let playlists = playlist_order
            .into_iter()
            .filter_map(|id| {
                playlist_counts
                    .remove(&id)
                    .map(|(name, counts)| counts.item(id, name))
            })
            .collect();

        let folders = folder_counts
            .into_values()
            .map(|entry| LibraryMenuItem {
                depth: Some(entry.depth),
                ..entry.counts.item(entry.prefix, entry.name)
            })
            .collect();

        Ok(LibraryMenuItems {
            hot,
            no_metadata,
            artists,
            albums,
            playlists,
            folders,
        })
    })
}
