use std::fmt::Write as _;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::error::NightingaleError;
use crate::vendor::{ffmpeg_path, silent_command};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoExportOptions {
    pub file_hash: String,
    pub background_path: String,
    pub destination_directory: String,
    pub width: u32,
    pub height: u32,
    pub font: String,
    pub font_size: u32,
    pub text_color: String,
    pub highlight_color: String,
    pub position: u8,
    pub guide_volume: u8,
    #[serde(default)]
    pub countdown_seconds: u8,
    #[serde(default)]
    pub lyrics_offset_seconds: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoExportProgress {
    pub percent: u8,
    pub elapsed_seconds: u64,
}

#[derive(Deserialize)]
struct Transcript {
    segments: Vec<Segment>,
}

#[derive(Deserialize)]
struct Segment {
    start: f64,
    end: f64,
    text: String,
    #[serde(default)]
    words: Vec<Word>,
}

#[derive(Deserialize)]
struct Word {
    start: f64,
    end: f64,
    word: String,
}

fn invalid(message: &str) -> NightingaleError {
    NightingaleError::Other(message.into())
}

fn color(value: &str) -> Result<String, NightingaleError> {
    let hex = value.strip_prefix('#').unwrap_or(value);
    if hex.len() != 6 || !hex.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid("Choose a valid RGB color"));
    }
    Ok(format!("&H00{}{}{}", &hex[4..6], &hex[2..4], &hex[0..2]))
}

fn timestamp(seconds: f64) -> String {
    let centiseconds = (seconds * 100.0).round() as u64;
    format!(
        "{}:{:02}:{:02}.{:02}",
        centiseconds / 360_000,
        centiseconds / 6_000 % 60,
        centiseconds / 100 % 60,
        centiseconds % 100
    )
}

fn escape(text: &str) -> String {
    text.replace('\\', "＼")
        .replace('{', "｛")
        .replace('}', "｝")
        .replace(['\r', '\n'], " ")
}

fn valid_time(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && end > start && end <= 14_400.0
}

fn subtitles(
    transcript: Transcript,
    options: &VideoExportOptions,
) -> Result<String, NightingaleError> {
    let primary = color(&options.highlight_color)?;
    let secondary = color(&options.text_color)?;
    let mut ass = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {}\nPlayResY: {}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,{},{},{},{},&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,{},60,60,60,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        options.width,
        options.height,
        options.font,
        options.font_size,
        primary,
        secondary,
        options.position
    );
    if transcript.segments.is_empty() || transcript.segments.len() > 20_000 {
        return Err(invalid("No timed lyrics available; analyze the song first"));
    }
    for second in 0..options.countdown_seconds {
        writeln!(
            ass,
            "Dialogue: 0,{},{},Default,,0,0,0,,{{\\an5}}{}",
            timestamp(f64::from(second)),
            timestamp(f64::from(second + 1)),
            options.countdown_seconds - second
        )
        .map_err(|_| invalid("Cannot format countdown"))?;
    }
    let offset = f64::from(options.countdown_seconds) + options.lyrics_offset_seconds;
    let mut previous_end = 0.0;
    for mut segment in transcript.segments {
        if !valid_time(segment.start, segment.end) {
            return Err(invalid(
                "Lyrics contain invalid timestamps; realign them first",
            ));
        }
        if segment.end + offset <= 0.0 {
            continue;
        }
        let mut text = String::new();
        let mut cursor = (segment.start + offset).max(0.0);
        for word in &segment.words {
            if !valid_time(word.start, word.end)
                || word.start + offset + 0.02 < cursor
                    && word.end + offset > 0.0
                    && word.start + offset >= 0.0
                || word.end > segment.end + 0.02
                || word.word.len() > 16_384
            {
                return Err(invalid(
                    "Word timing is inconsistent; realign the lyrics first",
                ));
            }
            if word.end + offset <= 0.0 {
                continue;
            }
            let start = (word.start + offset).max(0.0);
            let end = word.end + offset;
            let gap = ((start - cursor).max(0.0) * 100.0).round() as u64;
            let duration = ((end - start) * 100.0).round() as u64;
            if !text.is_empty() && !word.word.starts_with(char::is_whitespace) {
                text.push(' ');
            }
            if gap > 0 {
                write!(text, "{{\\k{gap}}}").map_err(|_| invalid("Cannot format lyrics"))?;
            }
            write!(text, "{{\\kf{duration}}}{}", escape(&word.word))
                .map_err(|_| invalid("Cannot format lyrics"))?;
            cursor = end;
        }
        segment.start = (segment.start + offset).max(0.0);
        segment.end += offset;
        if segment.words.is_empty() {
            text = escape(&segment.text);
        }
        if text.len() > 65_536 {
            return Err(invalid("A lyric line is too long"));
        }
        // Simultaneous source lines remain simultaneous, on distinct ASS layers.
        let layer = u8::from(segment.start < previous_end);
        writeln!(
            ass,
            "Dialogue: {layer},{},{},Default,,0,0,0,,{text}",
            timestamp(segment.start),
            timestamp(segment.end)
        )
        .map_err(|_| invalid("Cannot format lyrics"))?;
        previous_end = segment.end;
    }
    Ok(ass)
}

pub fn export_song_mp4(
    options: VideoExportOptions,
    mut on_progress: impl FnMut(VideoExportProgress),
) -> Result<PathBuf, NightingaleError> {
    if !matches!(
        (options.width, options.height),
        (1280, 720) | (1920, 1080) | (1080, 1920)
    ) || !(20..=120).contains(&options.font_size)
        || !matches!(
            options.font.as_str(),
            "Arial" | "Verdana" | "Georgia" | "Tahoma"
        )
        || !matches!(options.position, 2 | 5 | 8)
        || options.guide_volume > 100
        || options.countdown_seconds > 10
        || !options.lyrics_offset_seconds.is_finite()
        || !(-30.0..=30.0).contains(&options.lyrics_offset_seconds)
    {
        return Err(invalid("Invalid video export settings"));
    }
    let background = Path::new(&options.background_path).canonicalize()?;
    let ext = background
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp");
    if !background.is_file() || (!image && !matches!(ext.as_str(), "mp4" | "webm" | "mov" | "mkv"))
    {
        return Err(invalid("Choose a supported image or video background"));
    }
    let destination = Path::new(&options.destination_directory).canonicalize()?;
    if !destination.is_dir() {
        return Err(invalid("Choose an existing output folder"));
    }
    let song = crate::library_db::load_song_by_hash(&options.file_hash)?
        .ok_or_else(|| invalid("Song not found"))?;
    let total_seconds = song.duration_secs / crate::cache::normalize_tempo(song.tempo)
        + f64::from(options.countdown_seconds);
    if !total_seconds.is_finite() || total_seconds <= 0.0 {
        return Err(invalid(
            "Song duration is unavailable; refresh its metadata first",
        ));
    }
    let started = Instant::now();
    on_progress(VideoExportProgress {
        percent: 0,
        elapsed_seconds: 0,
    });
    let transcript: Transcript = serde_json::from_value(crate::load_transcript(&song.file_hash)?)?;
    let ass = subtitles(transcript, &options)?;
    let audio = crate::get_audio_paths(&song.file_hash);
    if !Path::new(&audio.instrumental).is_file() {
        return Err(invalid("Audio is missing; analyze the song first"));
    }
    let name = format!("nightingale-{:016x}", rand::random::<u64>());
    let work = destination.join(format!(".{name}"));
    std::fs::create_dir(&work)?;
    let subtitle_path = work.join("lyrics.ass");
    let partial = work.join("video.mp4");
    let output = destination.join(format!("{name}.mp4"));
    let result = (|| {
        std::fs::write(&subtitle_path, ass)?;
        let mut command = silent_command(ffmpeg_path());
        command
            .current_dir(&work)
            .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-n"]);
        if image {
            command.args(["-loop", "1"]);
        } else {
            command.args(["-stream_loop", "-1"]);
        }
        command
            .arg("-i")
            .arg(&background)
            .arg("-i")
            .arg(&audio.instrumental);
        let mix = options.guide_volume > 0 && audio.vocals.is_some();
        if mix && let Some(vocals) = &audio.vocals {
            command.arg("-i").arg(vocals);
        }
        let mut filters = format!(
            "[0:v]scale={}:{}:force_original_aspect_ratio=increase,crop={}:{},setsar=1,ass=lyrics.ass[v]",
            options.width, options.height, options.width, options.height
        );
        if mix {
            write!(
                filters,
                ";[2:a]volume={}[guide];[1:a][guide]amix=inputs=2:duration=first:normalize=0[mixed]",
                f64::from(options.guide_volume) / 100.0
            )
            .map_err(|_| invalid("Cannot prepare audio mix"))?;
        }
        let audio_source = if mix { "mixed" } else { "1:a" };
        write!(
            filters,
            ";[{audio_source}]adelay={}:all=1[a]",
            u32::from(options.countdown_seconds) * 1_000
        )
        .map_err(|_| invalid("Cannot prepare countdown audio"))?;
        command.args([
            "-filter_complex",
            &filters,
            "-map",
            "[v]",
            "-map",
            "[a]",
            "-shortest",
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-stats_period",
            "0.5",
        ]);
        let mut child = command
            .arg(&partial)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines() {
                let line = match line {
                    Ok(line) => line,
                    Err(error) => {
                        if let Err(cleanup) = child.kill() {
                            tracing::warn!(kind = ?cleanup.kind(), "video export worker cleanup failed");
                        }
                        child.wait()?;
                        return Err(error.into());
                    }
                };
                if let Some(value) = line.strip_prefix("out_time_us=")
                    && let Ok(microseconds) = value.parse::<u64>()
                {
                    let percent = (microseconds as f64 / 1_000_000.0 / total_seconds * 100.0)
                        .clamp(0.0, 99.0) as u8;
                    on_progress(VideoExportProgress {
                        percent,
                        elapsed_seconds: started.elapsed().as_secs(),
                    });
                }
            }
        }
        let status = child.wait()?;
        if !status.success() {
            return Err(invalid(
                "Video encoding failed. Check the background file, available disk space, and FFmpeg subtitle support.",
            ));
        }
        std::fs::rename(&partial, &output)?;
        on_progress(VideoExportProgress {
            percent: 100,
            elapsed_seconds: started.elapsed().as_secs(),
        });
        Ok(output)
    })();
    for path in [&subtitle_path, &partial] {
        if path.exists()
            && let Err(error) = std::fs::remove_file(path)
        {
            tracing::warn!(kind = ?error.kind(), "video export temporary file cleanup failed");
        }
    }
    if let Err(error) = std::fs::remove_dir(&work) {
        tracing::warn!(kind = ?error.kind(), "video export temporary directory cleanup failed");
    }
    result
}
