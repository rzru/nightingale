use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufWriter, Write};
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

use app_core::{
    LrclibCandidate, apply_timed_lyrics, init_library, library_db_path, search_lrclib_for_hash,
};
use rusqlite::Connection;

struct SongSummary {
    file_hash: String,
    title: String,
    artist: String,
    duration_secs: f64,
}

enum Confirmation {
    Yes,
    No,
    Always,
    Quit,
}

#[derive(Default)]
struct Summary {
    inspected: usize,
    updated: usize,
    skipped: usize,
    no_lrc: usize,
    failed: usize,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "Error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut arguments = std::env::args().skip(1);
    if let Some(argument) = arguments.next() {
        if (argument == "--help" || argument == "-h") && arguments.next().is_none() {
            writeln!(
                io::stdout().lock(),
                "Usage: cargo run -p app-core --bin apply_closest_lrclib_lrc --locked\n\nApplies the closest-duration synchronized LRCLIB result to analyzed songs that are not already using timed LRC.\nClose Nightingale and back up its data directory before running this utility."
            )
            .map_err(|error| error.to_string())?;
            return Ok(());
        }

        return Err(format!(
            "unknown argument: {argument}. Use --help for usage."
        ));
    }

    init_library().map_err(|error| format!("failed to open the Nightingale library: {error}"))?;

    let songs = load_songs()?;
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    let (log_path, mut log) = create_log()?;
    let mut always = false;
    let mut summary = Summary::default();

    writeln!(
        stdout,
        "Found {} analyzed songs not already using timed LRC. Nightingale must remain closed while this utility runs.\nUpdate log: {}",
        songs.len(),
        log_path.display()
    )
    .map_err(|error| error.to_string())?;

    for song in songs {
        summary.inspected += 1;

        let candidate = search_lrclib_for_hash(&song.file_hash)
            .into_iter()
            .filter(|candidate| {
                candidate.duration_secs.is_finite()
                    && candidate
                        .synced_lyrics
                        .as_deref()
                        .is_some_and(|lyrics| !lyrics.trim().is_empty())
            })
            .min_by(|left, right| {
                let left_delta = (left.duration_secs - song.duration_secs).abs();
                let right_delta = (right.duration_secs - song.duration_secs).abs();
                left_delta.total_cmp(&right_delta)
            });

        let Some(candidate) = candidate else {
            summary.no_lrc += 1;
            writeln!(
                stdout,
                "No synchronized LRC found: {} — {}",
                song.artist, song.title
            )
            .map_err(|error| error.to_string())?;
            continue;
        };

        let delta = (candidate.duration_secs - song.duration_secs).abs();
        writeln!(stdout)
            .and_then(|()| {
                writeln!(
                    stdout,
                    "Song:      {} — {} ({:.1}s)",
                    song.artist, song.title, song.duration_secs
                )
            })
            .and_then(|()| {
                writeln!(
                    stdout,
                    "LRCLIB:    {} — {} [{}] ({:.1}s, delta {:.1}s)",
                    candidate.artist_name,
                    candidate.track_name,
                    candidate.album_name,
                    candidate.duration_secs,
                    delta
                )
            })
            .map_err(|error| error.to_string())?;

        let confirmation = if always {
            Confirmation::Yes
        } else {
            ask_for_confirmation(&mut stdin, &mut stdout)?
        };

        match confirmation {
            Confirmation::No => {
                summary.skipped += 1;
                continue;
            }
            Confirmation::Quit => break,
            Confirmation::Always => always = true,
            Confirmation::Yes => {}
        }

        let Some(lrc_text) = candidate.synced_lyrics.as_deref() else {
            summary.failed += 1;
            continue;
        };

        match apply_timed_lyrics(&song.file_hash, lrc_text) {
            Ok(()) => {
                log_update(&mut log, &song, &candidate, delta)?;
                summary.updated += 1;
                writeln!(stdout, "Applied synchronized LRC.").map_err(|error| error.to_string())?;
            }
            Err(error) => {
                summary.failed += 1;
                writeln!(stdout, "Failed to apply synchronized LRC: {error}")
                    .map_err(|write_error| write_error.to_string())?;
            }
        }
    }

    writeln!(
        stdout,
        "\nFinished. Inspected: {}, updated: {}, skipped: {}, no LRC: {}, failed: {}",
        summary.inspected, summary.updated, summary.skipped, summary.no_lrc, summary.failed
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

fn load_songs() -> Result<Vec<SongSummary>, String> {
    let path = library_db_path();
    let connection = Connection::open(&path)
        .map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let mut statement = connection
        .prepare(
            "SELECT file_hash, title, artist, duration_secs
             FROM songs
             WHERE is_analyzed = 1
               AND (transcript_source IS NULL OR transcript_source NOT IN ('usdx', 'lrc'))
             ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(SongSummary {
                file_hash: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                duration_secs: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn create_log() -> Result<(std::path::PathBuf, BufWriter<File>), String> {
    let timestamp = unix_timestamp()?;
    let file_name = format!(
        "apply_closest_lrclib_lrc_{timestamp}_{}.jsonl",
        std::process::id()
    );
    let path = std::env::current_dir()
        .map_err(|error| format!("failed to resolve the current directory: {error}"))?
        .join(file_name);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("failed to create update log {}: {error}", path.display()))?;

    Ok((path, BufWriter::new(file)))
}

fn log_update(
    log: &mut BufWriter<File>,
    song: &SongSummary,
    candidate: &LrclibCandidate,
    duration_delta_secs: f64,
) -> Result<(), String> {
    let entry = serde_json::json!({
        "updated_at_unix_secs": unix_timestamp()?,
        "file_hash": song.file_hash,
        "song": {
            "title": song.title,
            "artist": song.artist,
            "duration_secs": song.duration_secs,
        },
        "lrclib": {
            "track_name": candidate.track_name,
            "artist_name": candidate.artist_name,
            "album_name": candidate.album_name,
            "duration_secs": candidate.duration_secs,
            "duration_delta_secs": duration_delta_secs,
        },
    });

    serde_json::to_writer(&mut *log, &entry)
        .map_err(|error| format!("failed to write update log: {error}"))?;
    writeln!(log).map_err(|error| format!("failed to write update log: {error}"))?;
    log.flush()
        .map_err(|error| format!("failed to flush update log: {error}"))
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| format!("system clock is before the Unix epoch: {error}"))
}

fn ask_for_confirmation(
    stdin: &mut impl BufRead,
    stdout: &mut impl Write,
) -> Result<Confirmation, String> {
    loop {
        write!(stdout, "Apply this LRC? [y]es / [n]o / [a]lways / [q]uit: ")
            .and_then(|()| stdout.flush())
            .map_err(|error| error.to_string())?;

        let mut answer = String::new();
        let bytes_read = stdin
            .read_line(&mut answer)
            .map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            return Ok(Confirmation::Quit);
        }

        match answer.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => return Ok(Confirmation::Yes),
            "n" | "no" | "" => return Ok(Confirmation::No),
            "a" | "always" => return Ok(Confirmation::Always),
            "q" | "quit" => return Ok(Confirmation::Quit),
            _ => writeln!(stdout, "Please enter yes, no, always, or quit.")
                .map_err(|error| error.to_string())?,
        }
    }
}
