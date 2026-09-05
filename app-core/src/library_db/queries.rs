//! Read-side queries used by the menu / song-list / analyzer enqueue paths.
//!
//! `load_meta_sql` is also here because it returns the same `SongsMeta`
//! flavour both during a live `songs.json` → SQL migration and afterwards;
//! the two branches share the per-category COUNT() probes so they live in
//! one place.

use rusqlite::params;

use crate::library_menu::{LibraryMenuItem, LibraryMenuItems};
use crate::library_model::{
    LibraryMenuFilters, LoadSongsParams, SongSort, SongSortColumn, SongsMeta, SongsStore,
    SortDirection,
};

use super::connection::with_conn;
use super::migrations::{is_song_migration_in_progress, song_migration_done, song_migration_total};
use super::songs::load_song_from_payload_column;

pub(crate) fn load_meta_sql() -> rusqlite::Result<SongsMeta> {
    if is_song_migration_in_progress() {
        return with_conn(|c| {
            let (folder, _scan_count): (String, i64) = c.query_row(
                "SELECT folder, scan_count FROM library_meta WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let songs_count: i64 =
                c.query_row("SELECT COUNT(*) FROM songs WHERE is_video = 0", [], |r| {
                    r.get(0)
                })?;
            let videos_count: i64 =
                c.query_row("SELECT COUNT(*) FROM songs WHERE is_video != 0", [], |r| {
                    r.get(0)
                })?;
            let analyzed_count: i64 = c.query_row(
                "SELECT COUNT(*) FROM songs WHERE is_analyzed != 0",
                [],
                |r| r.get(0),
            )?;
            Ok(SongsMeta {
                count: song_migration_total(),
                folder,
                processed_count: song_migration_done(),
                songs_count: songs_count as usize,
                videos_count: videos_count as usize,
                analyzed_count: analyzed_count as usize,
            })
        });
    }

    with_conn(|c| {
        let (folder, scan_count): (String, i64) = c.query_row(
            "SELECT folder, scan_count FROM library_meta WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let processed: i64 = c.query_row("SELECT COUNT(*) FROM songs", [], |r| r.get(0))?;
        let songs_count: i64 =
            c.query_row("SELECT COUNT(*) FROM songs WHERE is_video = 0", [], |r| {
                r.get(0)
            })?;
        let videos_count: i64 =
            c.query_row("SELECT COUNT(*) FROM songs WHERE is_video != 0", [], |r| {
                r.get(0)
            })?;
        let analyzed_count: i64 = c.query_row(
            "SELECT COUNT(*) FROM songs WHERE is_analyzed != 0",
            [],
            |r| r.get(0),
        )?;
        Ok(SongsMeta {
            count: scan_count as usize,
            folder,
            processed_count: processed as usize,
            songs_count: songs_count as usize,
            videos_count: videos_count as usize,
            analyzed_count: analyzed_count as usize,
        })
    })
}

fn escape_like_pattern(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '%' | '_' | '\\' => {
                out.push('\\');
                out.push(ch);
            }
            c => out.push(c),
        }
    }
    out
}

fn search_words_from_query(q: &str) -> Option<Vec<String>> {
    let t = q.trim();
    if t.is_empty() {
        return None;
    }
    let words: Vec<String> = t
        .split_whitespace()
        .map(escape_like_pattern)
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() { None } else { Some(words) }
}

fn songs_where_like_words(words: &[String]) -> (String, Vec<String>) {
    let mut flat = Vec::new();
    let mut parts = Vec::new();
    for w in words {
        parts.push(
            "(s.title LIKE ('%' || ? || '%') ESCAPE '\\' OR \
             s.artist LIKE ('%' || ? || '%') ESCAPE '\\' OR \
             s.album LIKE ('%' || ? || '%') ESCAPE '\\' OR \
             s.path LIKE ('%' || ? || '%') ESCAPE '\\')",
        );
        for _ in 0..4 {
            flat.push(w.clone());
        }
    }
    (parts.join(" AND "), flat)
}

fn append_structural_filters(
    filters: &LibraryMenuFilters,
    where_parts: &mut Vec<String>,
    bind_strings: &mut Vec<String>,
) {
    let artist = filters.artist.as_deref();
    let album = filters.album.as_deref();
    let playlist = filters.playlist.as_deref();
    let query = filters.query.as_deref();
    let status = filters.status.as_deref();
    let transcript_source = filters.transcript_source.as_deref();
    let search = filters.search.as_deref();

    // Keep playlist first: its bind is always ?1, allowing the same value to
    // drive both membership filtering and playlist-position ordering.
    if let Some(p) = playlist.filter(|s| !s.is_empty()) {
        where_parts.push(
            "EXISTS (SELECT 1 FROM playlist_songs ps WHERE ps.song_id = s.id AND ps.playlist_id = ?1)"
                .to_string(),
        );
        bind_strings.push(p.to_string());
    }
    if let Some(a) = artist.filter(|s| !s.is_empty()) {
        if a == "unknown_artist" {
            where_parts.push("s.artist = ?".to_string());
            bind_strings.push("Unknown Artist".to_string());
        } else {
            where_parts.push("s.artist = ?".to_string());
            bind_strings.push(a.to_string());
        }
    }
    if let Some(al) = album.filter(|s| !s.is_empty()) {
        if al == "unknown_album" {
            where_parts.push("s.album = ?".to_string());
            bind_strings.push("Unknown Album".to_string());
        } else if let Some((a, b)) = al.split_once('\u{001f}') {
            where_parts.push("s.artist = ? AND s.album = ?".to_string());
            bind_strings.push(a.to_string());
            bind_strings.push(b.to_string());
        } else {
            where_parts.push("s.album = ?".to_string());
            bind_strings.push(al.to_string());
        }
    }
    if let Some(q) = query.filter(|s| !s.is_empty()) {
        match q {
            "analysed" => where_parts.push("s.is_analyzed = 1".to_string()),
            "queued" => where_parts.push(
                "EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash AND aq.status IN ('queued', 'analyzing'))"
                    .to_string(),
            ),
            "videos" => where_parts.push("s.is_video = 1".to_string()),
            "usdx" => where_parts.push("s.transcript_source = 'usdx'".to_string()),
            _ => {}
        }
    }
    if let Some(value) = status.filter(|s| !s.is_empty()) {
        match value {
            "not_analyzed" => where_parts.push(
                "s.is_analyzed = 0 AND NOT EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash)"
                    .to_string(),
            ),
            "queued" | "analyzing" | "failed" => {
                where_parts.push(
                    "EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash AND aq.status = ?)"
                        .to_string(),
                );
                bind_strings.push(value.to_string());
            }
            "analyzed" => where_parts.push("s.is_analyzed = 1".to_string()),
            _ => {}
        }
    }
    if let Some(source) = transcript_source.filter(|s| !s.is_empty()) {
        where_parts.push("s.transcript_source = ?".to_string());
        bind_strings.push(source.to_string());
    }
    if let Some(words) = search.and_then(search_words_from_query) {
        let (where_sql, mut search_binds) = songs_where_like_words(&words);
        where_parts.push(format!("({where_sql})"));
        bind_strings.append(&mut search_binds);
    }
}

fn build_song_where_clause(
    search_words: Option<&[String]>,
    filters: &LibraryMenuFilters,
    extra_where_parts: &[&str],
) -> (Option<String>, Vec<String>) {
    let mut where_parts: Vec<String> = Vec::new();
    let mut bind_strings: Vec<String> = Vec::new();

    // Structural filters come first so a selected playlist owns bind ?1.
    // Playlist ordering reuses that same numbered bind below.
    append_structural_filters(filters, &mut where_parts, &mut bind_strings);

    if let Some(words) = search_words {
        let (w, mut b) = songs_where_like_words(words);
        where_parts.push(format!("({w})"));
        bind_strings.append(&mut b);
    }
    where_parts.extend(extra_where_parts.iter().map(|part| (*part).to_string()));

    if where_parts.is_empty() {
        (None, bind_strings)
    } else {
        (Some(where_parts.join(" AND ")), bind_strings)
    }
}

fn sort_direction(direction: SortDirection) -> &'static str {
    match direction {
        SortDirection::Ascending => "ASC",
        SortDirection::Descending => "DESC",
    }
}

fn sort_expression(column: SongSortColumn) -> &'static str {
    match column {
        SongSortColumn::Title => "s.title COLLATE NOCASE",
        SongSortColumn::Artist => "s.artist COLLATE NOCASE",
        SongSortColumn::Album => "s.album COLLATE NOCASE",
        SongSortColumn::Duration => "CAST(s.duration_secs AS INTEGER)",
        SongSortColumn::Status => {
            "CASE WHEN EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash AND aq.status = 'analyzing') THEN 0 \
             WHEN EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash AND aq.status = 'failed') THEN 10 \
             WHEN s.is_analyzed = 0 AND NOT EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash) THEN 20 \
             WHEN EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash AND aq.status = 'queued') THEN 30 \
             WHEN s.transcript_source = 'lyrics' THEN 40 \
             WHEN s.transcript_source = 'generated' OR s.transcript_source IS NULL THEN 41 \
             WHEN s.transcript_source = 'lrc' THEN 42 \
             WHEN s.transcript_source = 'usdx' THEN 43 \
             ELSE 44 END"
        }
    }
}

fn song_order(sorts: &[SongSort]) -> Option<String> {
    let last_sort = sorts.last()?;
    let mut clauses = sorts
        .iter()
        .map(|sort| {
            format!(
                "{} {}",
                sort_expression(sort.column),
                sort_direction(sort.direction)
            )
        })
        .collect::<Vec<_>>();
    clauses.push(format!("s.id {}", sort_direction(last_sort.direction)));

    Some(clauses.join(", "))
}

pub(crate) fn load_songs_page(params: &LoadSongsParams) -> rusqlite::Result<SongsStore> {
    let (folder, scan_count) = with_conn(|c| {
        c.query_row(
            "SELECT folder, scan_count FROM library_meta WHERE id = 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
    })?;

    let search_words = params.search.as_deref().and_then(search_words_from_query);
    let (where_sql, bind_strings) =
        build_song_where_clause(search_words.as_deref(), &params.filters, &[]);

    let playlist_order = if params
        .filters
        .playlist
        .as_deref()
        .is_some_and(|p| !p.is_empty())
    {
        "(SELECT ps.position FROM playlist_songs ps WHERE ps.song_id = s.id AND ps.playlist_id = ?1), "
    } else {
        ""
    };
    let queue_order = if params.filters.query.as_deref() == Some("queued") {
        "(SELECT CASE aq.status WHEN 'analyzing' THEN 0 ELSE 1 END FROM analysis_queue aq WHERE aq.file_hash = s.file_hash), (SELECT aq.rowid FROM analysis_queue aq WHERE aq.file_hash = s.file_hash), "
    } else {
        ""
    };
    let requested_order = params.sort.as_deref().and_then(song_order);
    let default_filtered_order =
        format!("{queue_order}{playlist_order}s.artist COLLATE NOCASE, s.title COLLATE NOCASE");
    let filtered_order = requested_order
        .as_deref()
        .unwrap_or(&default_filtered_order);
    let unfiltered_order = requested_order
        .as_deref()
        .unwrap_or("s.artist COLLATE NOCASE, s.title COLLATE NOCASE");

    let processed = if let Some(ref where_sql) = where_sql {
        let sql = format!(
            "SELECT payload FROM songs s
             WHERE {where_sql}
             ORDER BY {filtered_order}
             LIMIT {} OFFSET {}",
            params.take as i64, params.skip as i64
        );
        with_conn(|c| {
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(bind_strings.iter().map(|s| s.as_str())),
                load_song_from_payload_column,
            )?;
            rows.collect::<Result<Vec<_>, _>>()
        })?
    } else {
        with_conn(|c| {
            let sql = format!(
                "SELECT payload FROM songs s
                 ORDER BY {unfiltered_order}
                 LIMIT ?1 OFFSET ?2"
            );
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(
                params![params.take as i64, params.skip as i64],
                load_song_from_payload_column,
            )?;
            rows.collect::<Result<Vec<_>, _>>()
        })?
    };

    let (processed_count, analyzed_count, analysis_busy_count) =
        if let Some(ref where_sql) = where_sql {
            let sql = format!(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN s.is_analyzed = 1 THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN EXISTS (
                            SELECT 1 FROM analysis_queue aq
                            WHERE aq.file_hash = s.file_hash
                              AND aq.status IN ('queued', 'analyzing')
                        ) THEN 1 ELSE 0 END), 0)
                 FROM songs s WHERE {where_sql}"
            );
            with_conn(|c| {
                let (count, analyzed, analysis_busy): (i64, i64, i64) = c.query_row(
                    &sql,
                    rusqlite::params_from_iter(bind_strings.iter().map(|s| s.as_str())),
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?;
                Ok((count as usize, analyzed as usize, analysis_busy as usize))
            })?
        } else {
            with_conn(|c| {
                let (count, analyzed, analysis_busy): (i64, i64, i64) = c.query_row(
                    "SELECT COUNT(*),
                            COALESCE(SUM(CASE WHEN s.is_analyzed = 1 THEN 1 ELSE 0 END), 0),
                            COALESCE(SUM(CASE WHEN EXISTS (
                                SELECT 1 FROM analysis_queue aq
                                WHERE aq.file_hash = s.file_hash
                                  AND aq.status IN ('queued', 'analyzing')
                            ) THEN 1 ELSE 0 END), 0)
                     FROM songs s",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?;
                Ok((count as usize, analyzed as usize, analysis_busy as usize))
            })?
        };

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
    extra_where_parts: &[&str],
) -> rusqlite::Result<Vec<String>> {
    let (where_sql, bind_strings) = build_song_where_clause(None, filters, extra_where_parts);

    if let Some(where_sql) = where_sql {
        let playlist_order = if filters.playlist.as_deref().is_some_and(|p| !p.is_empty()) {
            "(SELECT ps.position FROM playlist_songs ps WHERE ps.song_id = s.id AND ps.playlist_id = ?1), "
        } else {
            ""
        };
        let sql = format!(
            "SELECT s.file_hash FROM songs s
             WHERE {where_sql}
             ORDER BY {playlist_order}s.artist COLLATE NOCASE, s.title COLLATE NOCASE"
        );
        with_conn(|c| {
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(bind_strings.iter().map(|s| s.as_str())),
                |r| r.get(0),
            )?;
            rows.collect()
        })
    } else {
        with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT file_hash FROM songs ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE",
            )?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect()
        })
    }
}

pub(crate) fn iter_file_hashes_filtered_not_analyzed(
    filters: &LibraryMenuFilters,
) -> rusqlite::Result<Vec<String>> {
    iter_file_hashes_filtered(filters, &["s.is_analyzed = 0"])
}

pub(crate) fn iter_file_hashes_filtered_analysis_busy(
    filters: &LibraryMenuFilters,
) -> rusqlite::Result<Vec<String>> {
    iter_file_hashes_filtered(
        filters,
        &[
            "EXISTS (SELECT 1 FROM analysis_queue aq WHERE aq.file_hash = s.file_hash AND aq.status IN ('queued', 'analyzing'))",
        ],
    )
}

pub(crate) fn iter_file_hashes_filtered_realignable(
    filters: &LibraryMenuFilters,
) -> rusqlite::Result<Vec<String>> {
    iter_file_hashes_filtered(
        filters,
        &[
            "s.is_analyzed = 1",
            "s.transcript_source NOT IN ('usdx', 'lrc')",
        ],
    )
}

/// Unlike `iter_file_hashes_filtered_realignable`, includes LRC-provided songs.
pub(crate) fn iter_file_hashes_filtered_full_reanalyzable(
    filters: &LibraryMenuFilters,
) -> rusqlite::Result<Vec<String>> {
    iter_file_hashes_filtered(
        filters,
        &["s.is_analyzed = 1", "s.transcript_source != 'usdx'"],
    )
}

pub(crate) fn iter_file_hashes_filtered_refreshable(
    filters: &LibraryMenuFilters,
) -> rusqlite::Result<Vec<String>> {
    iter_file_hashes_filtered(filters, &["json_extract(s.payload, '$.usdx') IS NULL"])
}

pub(crate) fn query_library_menu_items() -> rusqlite::Result<LibraryMenuItems> {
    with_conn(|c| {
        let (
            total,
            analysed_total,
            queued_total,
            analysing_total,
            video_total,
            video_analysed,
            video_queued,
            video_analysing,
            usdx_total,
            usdx_analysed,
            usdx_queued,
            usdx_analysing,
        ): (i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, i64) = c
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM songs),
                    (SELECT COUNT(*) FROM songs WHERE is_analyzed = 1),
                    (SELECT COUNT(*) FROM analysis_queue WHERE status = 'queued'),
                    (SELECT COUNT(*) FROM analysis_queue WHERE status = 'analyzing'),
                    (SELECT COUNT(*) FROM songs WHERE is_video = 1),
                    (SELECT COUNT(*) FROM songs WHERE is_video = 1 AND is_analyzed = 1),
                    (SELECT COUNT(*) FROM songs s JOIN analysis_queue aq ON aq.file_hash = s.file_hash WHERE s.is_video = 1 AND aq.status = 'queued'),
                    (SELECT COUNT(*) FROM songs s JOIN analysis_queue aq ON aq.file_hash = s.file_hash WHERE s.is_video = 1 AND aq.status = 'analyzing'),
                    (SELECT COUNT(*) FROM songs WHERE transcript_source = 'usdx'),
                    (SELECT COUNT(*) FROM songs WHERE transcript_source = 'usdx' AND is_analyzed = 1),
                    (SELECT COUNT(*) FROM songs s JOIN analysis_queue aq ON aq.file_hash = s.file_hash WHERE s.transcript_source = 'usdx' AND aq.status = 'queued'),
                    (SELECT COUNT(*) FROM songs s JOIN analysis_queue aq ON aq.file_hash = s.file_hash WHERE s.transcript_source = 'usdx' AND aq.status = 'analyzing')",
                [],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                        r.get(11)?,
                    ))
                },
            )?;

        let hot = vec![
            LibraryMenuItem {
                value: "all".into(),
                label: "All".into(),
                analysed_count: analysed_total as u64,
                queued_count: queued_total as u64,
                analysing_count: analysing_total as u64,
                count: total as u64,
            },
            LibraryMenuItem {
                value: "queued".into(),
                label: "Queued".into(),
                analysed_count: 0,
                queued_count: queued_total as u64,
                analysing_count: analysing_total as u64,
                count: (queued_total + analysing_total) as u64,
            },
            LibraryMenuItem {
                value: "analysed".into(),
                label: "Analysed".into(),
                analysed_count: analysed_total as u64,
                queued_count: 0,
                analysing_count: 0,
                count: analysed_total as u64,
            },
            LibraryMenuItem {
                value: "videos".into(),
                label: "Videos".into(),
                analysed_count: video_analysed as u64,
                queued_count: video_queued as u64,
                analysing_count: video_analysing as u64,
                count: video_total as u64,
            },
            LibraryMenuItem {
                value: "usdx".into(),
                label: "USDX".into(),
                analysed_count: usdx_analysed as u64,
                queued_count: usdx_queued as u64,
                analysing_count: usdx_analysing as u64,
                count: usdx_total as u64,
            },
        ];

        let (unknown_artist_cnt, unknown_artist_an, unknown_artist_q, unknown_artist_ing): (
            i64,
            i64,
            i64,
            i64,
        ) = c.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN s.is_analyzed = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN aq.status = 'queued' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN aq.status = 'analyzing' THEN 1 ELSE 0 END), 0)
             FROM songs s LEFT JOIN analysis_queue aq ON aq.file_hash = s.file_hash
             WHERE s.artist = 'Unknown Artist'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;

        let (unknown_album_cnt, unknown_album_an, unknown_album_q, unknown_album_ing): (
            i64,
            i64,
            i64,
            i64,
        ) = c.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN s.is_analyzed = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN aq.status = 'queued' THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN aq.status = 'analyzing' THEN 1 ELSE 0 END), 0)
             FROM songs s LEFT JOIN analysis_queue aq ON aq.file_hash = s.file_hash
             WHERE s.album = 'Unknown Album'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;

        let no_metadata = vec![
            LibraryMenuItem {
                value: "unknown_artist".into(),
                label: "Unknown Artist".into(),
                analysed_count: unknown_artist_an as u64,
                queued_count: unknown_artist_q as u64,
                analysing_count: unknown_artist_ing as u64,
                count: unknown_artist_cnt as u64,
            },
            LibraryMenuItem {
                value: "unknown_album".into(),
                label: "Unknown Album".into(),
                analysed_count: unknown_album_an as u64,
                queued_count: unknown_album_q as u64,
                analysing_count: unknown_album_ing as u64,
                count: unknown_album_cnt as u64,
            },
        ];

        let mut stmt = c.prepare(
            "SELECT s.artist, COUNT(*) AS cnt,
                    COALESCE(SUM(CASE WHEN s.is_analyzed = 1 THEN 1 ELSE 0 END), 0) AS analysed,
                    COALESCE(SUM(CASE WHEN aq.status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
                    COALESCE(SUM(CASE WHEN aq.status = 'analyzing' THEN 1 ELSE 0 END), 0) AS analysing
             FROM songs s LEFT JOIN analysis_queue aq ON aq.file_hash = s.file_hash
             GROUP BY s.artist
             ORDER BY s.artist COLLATE NOCASE",
        )?;
        let artists: Vec<LibraryMenuItem> = stmt
            .query_map([], |r| {
                let artist: String = r.get(0)?;
                let cnt: i64 = r.get(1)?;
                let analysed: i64 = r.get(2)?;
                let queued: i64 = r.get(3)?;
                let analysing: i64 = r.get(4)?;
                Ok(LibraryMenuItem {
                    value: artist.clone(),
                    label: artist,
                    analysed_count: analysed as u64,
                    queued_count: queued as u64,
                    analysing_count: analysing as u64,
                    count: cnt as u64,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut stmt = c.prepare(
            "SELECT s.artist, s.album, COUNT(*) AS cnt,
                    COALESCE(SUM(CASE WHEN s.is_analyzed = 1 THEN 1 ELSE 0 END), 0) AS analysed,
                    COALESCE(SUM(CASE WHEN aq.status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
                    COALESCE(SUM(CASE WHEN aq.status = 'analyzing' THEN 1 ELSE 0 END), 0) AS analysing
             FROM songs s LEFT JOIN analysis_queue aq ON aq.file_hash = s.file_hash
             GROUP BY s.artist, s.album
             ORDER BY s.artist COLLATE NOCASE, s.album COLLATE NOCASE",
        )?;
        let albums: Vec<LibraryMenuItem> = stmt
            .query_map([], |r| {
                let artist: String = r.get(0)?;
                let album: String = r.get(1)?;
                let cnt: i64 = r.get(2)?;
                let analysed: i64 = r.get(3)?;
                let queued: i64 = r.get(4)?;
                let analysing: i64 = r.get(5)?;
                Ok(LibraryMenuItem {
                    value: format!("{artist}\x1f{album}"),
                    label: format!("{album} — {artist}"),
                    analysed_count: analysed as u64,
                    queued_count: queued as u64,
                    analysing_count: analysing as u64,
                    count: cnt as u64,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut stmt = c.prepare(
            "SELECT p.id, p.name, COUNT(ps.song_id) AS cnt,
                    COALESCE(SUM(CASE WHEN s.is_analyzed = 1 THEN 1 ELSE 0 END), 0) AS analysed,
                    COALESCE(SUM(CASE WHEN aq.status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
                    COALESCE(SUM(CASE WHEN aq.status = 'analyzing' THEN 1 ELSE 0 END), 0) AS analysing
             FROM playlists p
             JOIN playlist_songs ps ON ps.playlist_id = p.id
             JOIN songs s ON s.id = ps.song_id
             LEFT JOIN analysis_queue aq ON aq.file_hash = s.file_hash
             GROUP BY p.id, p.name
             ORDER BY p.name COLLATE NOCASE",
        )?;
        let playlists: Vec<LibraryMenuItem> = stmt
            .query_map([], |r| {
                Ok(LibraryMenuItem {
                    value: r.get(0)?,
                    label: r.get(1)?,
                    count: r.get::<_, i64>(2)? as u64,
                    analysed_count: r.get::<_, i64>(3)? as u64,
                    queued_count: r.get::<_, i64>(4)? as u64,
                    analysing_count: r.get::<_, i64>(5)? as u64,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(LibraryMenuItems {
            hot,
            no_metadata,
            artists,
            albums,
            playlists,
        })
    })
}
