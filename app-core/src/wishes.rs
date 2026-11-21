//! "Envies" — tracks from a linked account's playlists that the user wants
//! to sing.
//!
//! Importing a playlist stores its tracks as wishes; the matcher then looks
//! for each wish in the local library (artist + title, duration as a
//! tie-breaker) and records whether it is already there (`available`),
//! already analysed (`ready`), or still `missing`.
//!
//! "Prepare" (Tout préparer) drives wishes the rest of the way: missing ones
//! go to the yt-dlp downloader, the library scan that follows links them by
//! path, and the matcher queues the analysis of every prepared wish that is
//! in the library but not analysed. Analysis progress is read back from the
//! analyzer queue, so `analyzing` / `failed` always mirror it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::accounts::{self, AccountProvider};
use crate::analyzer::{self, AnalysisQueue, QueuedStatus};
use crate::error::NightingaleError;
use crate::library_db::{
    self, NewWish, SongMatchCandidate, WishPlaylistInput, WishPlaylistRow, WishRow,
};
use crate::library_model::SongTarget;

/// A library song whose duration differs by more than this is a different
/// recording (radio edit vs. extended mix, live version, …).
const DURATION_TOLERANCE_SECS: f64 = 10.0;

/// Serialises matcher runs: scans, imports, the downloader and analysis
/// completions all trigger one.
static REFRESH_LOCK: Mutex<()> = Mutex::new(());
static REFRESH_SCHEDULED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum WishStatus {
    /// Not in the library: has to be downloaded.
    Missing,
    /// In the library, not analysed yet.
    Available,
    Downloading,
    Analyzing,
    /// In the library and analysed: ready to sing.
    Ready,
    Failed,
}

impl WishStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Available => "available",
            Self::Downloading => "downloading",
            Self::Analyzing => "analyzing",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "available" => Self::Available,
            "downloading" => Self::Downloading,
            "analyzing" => Self::Analyzing,
            "ready" => Self::Ready,
            "failed" => Self::Failed,
            _ => Self::Missing,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Wish {
    #[ts(type = "number")]
    pub id: i64,
    pub provider: AccountProvider,
    pub external_id: String,
    pub title: String,
    pub artist: String,
    pub duration_secs: Option<f64>,
    pub source_url: String,
    pub status: WishStatus,
    /// `songs.file_hash` of the matched library song.
    pub matched_file_hash: Option<String>,
    pub error: Option<String>,
    /// Where the downloader saved this track, for wishes it fetched.
    pub downloaded_path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PrepareSummary {
    /// Wishes sent to the downloader.
    pub downloads: u32,
    /// Wishes already in the library whose analysis was queued.
    pub analyses: u32,
    /// Wishes that needed nothing (ready, or already in progress).
    pub unchanged: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WishCounts {
    pub total: u32,
    pub ready: u32,
    pub available: u32,
    pub missing: u32,
    pub in_progress: u32,
    pub failed: u32,
}

impl WishCounts {
    fn tally(wishes: &[Wish]) -> Self {
        let mut counts = Self::default();
        for wish in wishes {
            counts.total += 1;
            match wish.status {
                WishStatus::Ready => counts.ready += 1,
                WishStatus::Available => counts.available += 1,
                WishStatus::Missing => counts.missing += 1,
                WishStatus::Downloading | WishStatus::Analyzing => counts.in_progress += 1,
                WishStatus::Failed => counts.failed += 1,
            }
        }
        counts
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WishPlaylist {
    /// Local id: `<provider>:<external_id>`.
    pub id: String,
    pub provider: AccountProvider,
    pub external_id: String,
    pub name: String,
    /// Unix seconds of the last import.
    #[ts(type = "number")]
    pub imported_at: i64,
    pub counts: WishCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WishPlaylistDetail {
    pub playlist: WishPlaylist,
    pub wishes: Vec<Wish>,
}

fn wish_from_row(row: WishRow) -> Option<Wish> {
    Some(Wish {
        id: row.id,
        provider: AccountProvider::parse(&row.provider)?,
        external_id: row.external_id,
        title: row.title,
        artist: row.artist,
        duration_secs: row.duration_secs,
        source_url: row.source_url,
        status: WishStatus::parse(&row.status),
        matched_file_hash: row.matched_file_hash,
        error: row.error,
        downloaded_path: row.downloaded_path,
    })
}

fn playlist_from_row(row: WishPlaylistRow, wishes: &[Wish]) -> Option<WishPlaylist> {
    Some(WishPlaylist {
        provider: AccountProvider::parse(&row.provider)?,
        id: row.id,
        external_id: row.external_id,
        name: row.name,
        imported_at: row.imported_at,
        counts: WishCounts::tally(wishes),
    })
}

fn playlist_wishes(id: &str) -> Result<Vec<Wish>, NightingaleError> {
    Ok(library_db::load_playlist_wishes(id)?
        .into_iter()
        .filter_map(wish_from_row)
        .collect())
}

// ─── Public API ────────────────────────────────────────────────────────────

/// Import (or re-import) a YouTube playlist as wishes, then match it against
/// the library. `playlist_id` may be the liked-videos pseudo id.
pub fn import_youtube_playlist(
    playlist_id: &str,
    name: &str,
) -> Result<WishPlaylistDetail, NightingaleError> {
    let tracks = accounts::youtube::fetch_playlist_tracks(playlist_id)?;
    let urls: Vec<String> = tracks.iter().map(|track| track.watch_url()).collect();
    let new_wishes: Vec<NewWish<'_>> = tracks
        .iter()
        .zip(&urls)
        .filter(|(track, _)| !track.title.is_empty())
        .map(|(track, url)| NewWish {
            external_id: &track.video_id,
            title: &track.title,
            artist: &track.artist,
            duration_secs: track.duration_secs,
            source_url: url,
        })
        .collect();

    let provider = AccountProvider::Youtube;
    let local_id = format!("{}:{playlist_id}", provider.as_str());
    let name = match name.trim() {
        "" => "YouTube",
        trimmed => trimmed,
    };
    let imported_at = i64::try_from(accounts::now_secs()).unwrap_or(i64::MAX);
    library_db::replace_wish_playlist(
        &WishPlaylistInput {
            id: &local_id,
            provider: provider.as_str(),
            external_id: playlist_id,
            name,
            imported_at,
        },
        &new_wishes,
    )?;

    refresh_wish_matches()?;
    load_wish_playlist(&local_id)?
        .ok_or_else(|| NightingaleError::from("imported playlist disappeared"))
}

pub fn list_wish_playlists() -> Result<Vec<WishPlaylist>, NightingaleError> {
    let mut playlists = Vec::new();
    for row in library_db::load_wish_playlists()? {
        let wishes = playlist_wishes(&row.id)?;
        if let Some(playlist) = playlist_from_row(row, &wishes) {
            playlists.push(playlist);
        }
    }
    Ok(playlists)
}

pub fn load_wish_playlist(id: &str) -> Result<Option<WishPlaylistDetail>, NightingaleError> {
    let Some(row) = library_db::load_wish_playlist_row(id)? else {
        return Ok(None);
    };
    let wishes = playlist_wishes(&row.id)?;
    Ok(playlist_from_row(row, &wishes).map(|playlist| WishPlaylistDetail { playlist, wishes }))
}

pub fn delete_wish_playlist(id: &str) -> Result<bool, NightingaleError> {
    library_db::delete_wish_playlist(id)
}

/// Get wishes ready to sing: download the missing ones, queue the analysis
/// of the ones already in the library. `failed` wishes are retried.
pub fn prepare_wishes(ids: &[i64]) -> Result<PrepareSummary, NightingaleError> {
    refresh_wish_matches()?;
    let rows = library_db::load_wishes_by_ids(ids)?;

    let mut summary = PrepareSummary::default();
    let mut to_download = Vec::new();
    let mut to_analyze = Vec::new();
    let mut prepared = Vec::new();
    for row in rows {
        let status = WishStatus::parse(&row.status);
        match (status, row.matched_file_hash) {
            (WishStatus::Ready | WishStatus::Downloading | WishStatus::Analyzing, _) => {
                summary.unchanged += 1;
            }
            (WishStatus::Available | WishStatus::Failed, Some(hash)) => {
                to_analyze.push((row.id, hash));
                prepared.push(row.id);
            }
            _ => {
                to_download.push(row.id);
                prepared.push(row.id);
            }
        }
    }

    // Fail fast on a library that cannot receive files, before touching state.
    if !to_download.is_empty() {
        crate::wish_downloader::download_dir()?;
    }
    library_db::set_prepare_requested(&prepared, true)?;

    if !to_analyze.is_empty() {
        let hashes = to_analyze.iter().map(|(_, hash)| hash.clone()).collect();
        analyzer::enqueue(SongTarget::Hashes { hashes }).map_err(NightingaleError::Other)?;
        for (id, _) in &to_analyze {
            library_db::set_wish_status(*id, WishStatus::Analyzing.as_str())?;
        }
        summary.analyses = count(to_analyze.len());
    }
    if !to_download.is_empty() {
        summary.downloads = count(crate::wish_downloader::enqueue(&to_download)?);
    }
    Ok(summary)
}

/// [`prepare_wishes`] for every wish of a playlist.
pub fn prepare_wish_playlist(id: &str) -> Result<PrepareSummary, NightingaleError> {
    let ids: Vec<i64> = library_db::load_playlist_wishes(id)?
        .into_iter()
        .map(|row| row.id)
        .collect();
    prepare_wishes(&ids)
}

/// Startup hook: downloads do not survive a restart.
pub(crate) fn recover_interrupted_downloads() {
    match library_db::reset_interrupted_downloads() {
        Ok(0) => {}
        Ok(count) => tracing::info!("[wishes] reset {count} interrupted downloads"),
        Err(error) => tracing::warn!("[wishes] could not reset interrupted downloads: {error}"),
    }
}

/// Coalesce bursts of analyzer queue changes into one refresh a moment later.
pub(crate) fn schedule_refresh() {
    if REFRESH_SCHEDULED.swap(true, Ordering::AcqRel) {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("wish-refresh".into())
        .spawn(|| {
            std::thread::sleep(Duration::from_millis(750));
            REFRESH_SCHEDULED.store(false, Ordering::Release);
            if let Err(error) = refresh_wish_matches() {
                tracing::warn!("[wishes] refresh failed: {error}");
            }
        });
    if spawned.is_err() {
        REFRESH_SCHEDULED.store(false, Ordering::Release);
    }
}

fn count(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// Re-link every wish to the library and mirror the analyzer queue. Cheap
/// enough to run after each import, scan and analysis. Returns how many
/// wishes changed.
pub fn refresh_wish_matches() -> Result<u32, NightingaleError> {
    let _guard = REFRESH_LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let index = LibraryIndex::build(library_db::load_song_match_candidates()?);
    let queue = AnalysisQueue::load();
    let mut changed = 0;
    let mut to_analyze: Vec<String> = Vec::new();
    let mut now_ready: Vec<i64> = Vec::new();

    for row in library_db::load_all_wishes()? {
        let prepare_requested = row.prepare_requested;
        let Some(wish) = wish_from_row(row) else {
            continue;
        };
        // The downloader owns the wish until the file exists.
        if wish.status == WishStatus::Downloading && wish.downloaded_path.is_none() {
            continue;
        }

        let found = wish
            .downloaded_path
            .as_deref()
            .and_then(|path| index.by_path(path))
            .or_else(|| index.find(&wish.artist, &wish.title, wish.duration_secs));

        let (status, error) = match found {
            Some(song) if song.is_analyzed => (WishStatus::Ready, None),
            Some(song) => match queue.entries.get(&song.file_hash) {
                Some(QueuedStatus::Queued | QueuedStatus::Analyzing(_)) => {
                    (WishStatus::Analyzing, None)
                }
                Some(QueuedStatus::Failed(message)) => (WishStatus::Failed, Some(message.clone())),
                None if prepare_requested => {
                    to_analyze.push(song.file_hash.clone());
                    (WishStatus::Analyzing, None)
                }
                None => (WishStatus::Available, None),
            },
            // Downloaded, waiting for the scan to pick the file up.
            None if wish.status == WishStatus::Downloading => continue,
            // A download error stays visible until the user retries.
            None if wish.status == WishStatus::Failed && wish.matched_file_hash.is_none() => {
                continue;
            }
            None => (WishStatus::Missing, None),
        };
        let file_hash = found.map(|song| song.file_hash.as_str());

        if status == WishStatus::Ready && prepare_requested {
            now_ready.push(wish.id);
        }
        if status != wish.status
            || file_hash != wish.matched_file_hash.as_deref()
            || error.as_deref() != wish.error.as_deref()
        {
            library_db::set_wish_state(wish.id, status.as_str(), file_hash, error.as_deref())?;
            changed += 1;
        }
    }

    library_db::set_prepare_requested(&now_ready, false)?;
    if !to_analyze.is_empty() {
        to_analyze.sort();
        to_analyze.dedup();
        analyzer::enqueue(SongTarget::Hashes { hashes: to_analyze })
            .map_err(NightingaleError::Other)?;
    }
    Ok(changed)
}

// ─── Matching ──────────────────────────────────────────────────────────────

struct LibraryIndex {
    songs: Vec<SongMatchCandidate>,
    by_key: HashMap<(String, String), Vec<usize>>,
    by_path: HashMap<String, usize>,
}

impl LibraryIndex {
    fn build(songs: Vec<SongMatchCandidate>) -> Self {
        let mut by_key: HashMap<(String, String), Vec<usize>> = HashMap::new();
        let mut by_path = HashMap::with_capacity(songs.len());
        for (position, song) in songs.iter().enumerate() {
            by_path.insert(song.path.clone(), position);
            let artist = primary_artist_key(&song.artist);
            for title in title_keys(&song.title) {
                by_key
                    .entry((artist.clone(), title))
                    .or_default()
                    .push(position);
            }
        }
        Self {
            songs,
            by_key,
            by_path,
        }
    }

    fn by_path(&self, path: &str) -> Option<&SongMatchCandidate> {
        self.by_path
            .get(path)
            .and_then(|position| self.songs.get(*position))
    }

    /// Best library song for a wish: same primary artist and title (exact or
    /// without parentheticals), closest duration within tolerance. Analysed
    /// songs win ties so a wish never points at a duplicate still in queue.
    fn find(
        &self,
        artist: &str,
        title: &str,
        duration_secs: Option<f64>,
    ) -> Option<&SongMatchCandidate> {
        let artist = primary_artist_key(artist);
        title_keys(title)
            .into_iter()
            .filter_map(|title| self.by_key.get(&(artist.clone(), title)))
            .flatten()
            .filter_map(|position| self.songs.get(*position))
            .filter_map(|song| {
                let distance = match duration_secs {
                    Some(wanted) if song.duration_secs > 0.0 => {
                        let distance = (song.duration_secs - wanted).abs();
                        if distance > DURATION_TOLERANCE_SECS {
                            return None;
                        }
                        distance
                    }
                    _ => DURATION_TOLERANCE_SECS,
                };
                Some((song, distance))
            })
            .min_by(|(a, da), (b, db)| b.is_analyzed.cmp(&a.is_analyzed).then(da.total_cmp(db)))
            .map(|(song, _)| song)
    }
}

/// Lowercase, accent-free, punctuation collapsed to single spaces.
fn match_key(value: &str) -> String {
    library_db::normalize_for_match(value)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The full title, plus the title without bracketed parts ("Song (feat. X)",
/// "Song [Remastered]") when that differs.
fn title_keys(title: &str) -> Vec<String> {
    let full = match_key(title);
    let mut keys = vec![full.clone()];
    let bare = match_key(&strip_brackets(title));
    if !bare.is_empty() && bare != full {
        keys.push(bare);
    }
    keys.retain(|key| !key.is_empty());
    keys
}

fn strip_brackets(value: &str) -> String {
    let mut depth = 0usize;
    value
        .chars()
        .filter(|character| match character {
            '(' | '[' => {
                depth += 1;
                false
            }
            ')' | ']' => {
                depth = depth.saturating_sub(1);
                false
            }
            _ => depth == 0,
        })
        .collect()
}

/// "Artist feat. Other", "Artist, Other", "Artist & Other" → "artist".
fn primary_artist_key(artist: &str) -> String {
    let lowered = artist.to_lowercase();
    let cut = [
        ",",
        " & ",
        " feat.",
        " feat ",
        " ft.",
        " ft ",
        " featuring ",
        " x ",
        ";",
        " / ",
    ]
    .iter()
    .filter_map(|separator| lowered.find(separator))
    .min()
    .unwrap_or(lowered.len());
    match_key(&lowered[..cut])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(
        hash: &str,
        title: &str,
        artist: &str,
        duration: f64,
        analyzed: bool,
    ) -> SongMatchCandidate {
        SongMatchCandidate {
            path: format!("/music/{hash}.m4a"),
            file_hash: hash.into(),
            title: title.into(),
            artist: artist.into(),
            duration_secs: duration,
            is_analyzed: analyzed,
        }
    }

    #[test]
    fn keys_ignore_case_accents_and_punctuation() {
        assert_eq!(match_key("Alors On Danse!"), "alors on danse");
        assert_eq!(match_key("Édith Piaf"), "edith piaf");
        assert_eq!(primary_artist_key("Daft Punk feat. Pharrell"), "daft punk");
        assert_eq!(primary_artist_key("Simon & Garfunkel"), "simon");
    }

    #[test]
    fn matches_title_without_parentheticals() {
        let index = LibraryIndex::build(vec![song("a", "Get Lucky", "Daft Punk", 248.0, false)]);
        let found = index.find(
            "Daft Punk",
            "Get Lucky (feat. Pharrell Williams)",
            Some(250.0),
        );
        assert_eq!(found.map(|s| s.file_hash.as_str()), Some("a"));
    }

    #[test]
    fn rejects_far_durations_and_prefers_analysed() {
        let index = LibraryIndex::build(vec![
            song("extended", "Song", "Artist", 420.0, true),
            song("plain", "Song", "Artist", 200.0, false),
            song("plain-ready", "Song", "Artist", 205.0, true),
        ]);
        let found = index.find("Artist", "Song", Some(201.0));
        assert_eq!(found.map(|s| s.file_hash.as_str()), Some("plain-ready"));
        assert!(index.find("Artist", "Song", Some(600.0)).is_none());
        assert!(index.find("Other", "Song", None).is_none());
    }

    #[test]
    fn downloaded_files_match_by_path_even_with_odd_tags() {
        let index = LibraryIndex::build(vec![song("dl", "", "", 0.0, false)]);
        assert_eq!(
            index.by_path("/music/dl.m4a").map(|s| s.file_hash.as_str()),
            Some("dl")
        );
        assert!(index.by_path("/music/other.m4a").is_none());
    }

    #[test]
    fn counts_tally_by_status() {
        let wish = |status| Wish {
            id: 1,
            provider: AccountProvider::Youtube,
            external_id: "x".into(),
            title: "t".into(),
            artist: "a".into(),
            duration_secs: None,
            source_url: String::new(),
            status,
            matched_file_hash: None,
            error: None,
            downloaded_path: None,
        };
        let counts = WishCounts::tally(&[
            wish(WishStatus::Ready),
            wish(WishStatus::Missing),
            wish(WishStatus::Downloading),
        ]);
        assert_eq!(
            (
                counts.total,
                counts.ready,
                counts.missing,
                counts.in_progress
            ),
            (3, 1, 1, 1)
        );
    }
}
