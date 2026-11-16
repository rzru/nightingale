use std::fmt::Write as _;

use serde::Deserialize;

use super::{VideoExportOptions, invalid};
use crate::error::NightingaleError;

#[derive(Deserialize)]
pub(super) struct Transcript {
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
    #[serde(default)]
    estimated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Timing {
    lyrics_lead: f64,
    word_highlight_lead: f64,
    segment_linger: f64,
    gap_threshold: f64,
    bubble_countdown: f64,
}

fn rgb(value: &str) -> Result<[u8; 3], NightingaleError> {
    let value = value.strip_prefix('#').unwrap_or(value);
    if value.len() != 6 || !value.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid("Choose a valid RGB color"));
    }
    let parse = |range| u8::from_str_radix(&value[range], 16).map_err(|_| invalid("Invalid color"));
    Ok([parse(0..2)?, parse(2..4)?, parse(4..6)?])
}

fn ass_color(value: [u8; 3]) -> String {
    format!("&H{:02X}{:02X}{:02X}&", value[2], value[1], value[0])
}

fn timestamp(seconds: f64) -> String {
    let value = (seconds.max(0.0) * 100.0).round() as u64;
    format!(
        "{}:{:02}:{:02}.{:02}",
        value / 360_000,
        value / 6_000 % 60,
        value / 100 % 60,
        value % 100
    )
}

fn escape(text: &str) -> String {
    text.replace('\\', "＼")
        .replace('{', "｛")
        .replace('}', "｝")
        .replace('\r', "")
        .replace('\n', "\\N")
}

fn validate(transcript: &Transcript) -> Result<(), NightingaleError> {
    if transcript.segments.is_empty() || transcript.segments.len() > 20_000 {
        return Err(invalid("No timed lyrics available; analyze the song first"));
    }
    let mut previous_start = 0.0;
    for segment in &transcript.segments {
        if !valid_time(segment.start, segment.end)
            || segment.start < previous_start
            || segment.text.len() > 65_536
        {
            return Err(invalid(
                "Lyrics contain invalid timestamps or text; realign them first",
            ));
        }
        previous_start = segment.start;
        let mut previous_word = segment.start;
        for word in &segment.words {
            if !valid_time(word.start, word.end)
                || word.start + 0.02 < previous_word
                || word.end > segment.end + 0.02
                || word.word.len() > 16_384
            {
                return Err(invalid(
                    "Word timing is inconsistent; realign the lyrics first",
                ));
            }
            previous_word = word.end;
        }
    }
    Ok(())
}

fn valid_time(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && end > start && end <= 14_400.0
}

fn selected_segment(segments: &[Segment], time: f64, hint: usize, timing: &Timing) -> usize {
    let start = if hint < segments.len() && time >= segments[hint].start - timing.lyrics_lead {
        hint
    } else {
        0
    };
    for index in start..segments.len() {
        let segment = &segments[index];
        let next = segments.get(index + 1);
        if time >= segment.end + timing.segment_linger {
            if next.is_some_and(|next| {
                next.start - segment.end < timing.gap_threshold
                    && time < next.start - timing.lyrics_lead
            }) {
                return index;
            }
            continue;
        }
        if next.is_some_and(|next| time >= next.start - timing.lyrics_lead) {
            return index + 1;
        }
        return index;
    }
    segments.len() - 1
}

fn event(
    ass: &mut String,
    start: f64,
    end: f64,
    style: &str,
    text: &str,
) -> Result<(), NightingaleError> {
    if end <= 0.0 || end <= start || timestamp(start) == timestamp(end) {
        return Ok(());
    }
    writeln!(
        ass,
        "Dialogue: 1,{},{},{style},,0,0,0,,{text}",
        timestamp(start),
        timestamp(end)
    )
    .map_err(|_| invalid("Cannot format lyric events"))
}

fn word_style(
    word: &Word,
    time: f64,
    options: &VideoExportOptions,
    timing: &Timing,
    preview: bool,
) -> Result<String, NightingaleError> {
    let source = if word.estimated {
        [255, 200, 100]
    } else {
        rgb(&options.text_color)?
    };
    if preview {
        let alpha = if word.estimated { "BF" } else { "A6" };
        return Ok(format!("{{\\1c{}\\1a&H{alpha}&}}", ass_color(source)));
    }
    let target = rgb(&options.highlight_color)?;
    let from = word.start - timing.word_highlight_lead;
    let until = word.end - timing.word_highlight_lead;
    let fraction = ((time - from) / (until - from)).clamp(0.0, 1.0);
    let current = std::array::from_fn(|index| {
        (f64::from(source[index])
            + (f64::from(target[index]) - f64::from(source[index])) * fraction)
            .round() as u8
    });
    let initial_alpha = if word.estimated { 153.0 } else { 128.0 };
    let alpha = (initial_alpha * (1.0 - fraction)).round() as u8;
    let begin_ms = ((from - time).max(0.0) * 1_000.0).round() as u64;
    let end_ms = ((until - time).max(0.0) * 1_000.0).round() as u64;
    Ok(format!(
        "{{\\1c{}\\1a&H{alpha:02X}&\\t({begin_ms},{end_ms},\\1c{}\\1a&H00&)}}",
        ass_color(current),
        ass_color(target)
    ))
}

fn line_text(
    segment: &Segment,
    time: f64,
    options: &VideoExportOptions,
    timing: &Timing,
    preview: bool,
) -> Result<String, NightingaleError> {
    if segment.words.is_empty() {
        return Ok(escape(&segment.text));
    }
    let mut result = String::new();
    for word in &segment.words {
        if !result.is_empty() && !word.word.starts_with(char::is_whitespace) {
            result.push(' ');
        }
        result.push_str(&word_style(word, time, options, timing, preview)?);
        result.push_str(&escape(&word.word));
    }
    Ok(result)
}

fn approximate_width(segment: &Segment, size: f64) -> f64 {
    let text = if segment.text.is_empty() {
        segment
            .words
            .iter()
            .map(|word| word.word.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        segment.text.clone()
    };
    let units: f64 = text
        .chars()
        .map(|ch| {
            if ch.is_whitespace() {
                0.3
            } else if ch.is_ascii() {
                0.5
            } else {
                1.0
            }
        })
        .sum();
    units * size
}

fn approximate_lines(segment: &Segment, size: f64, width: f64) -> f64 {
    (approximate_width(segment, size) / width).ceil().max(1.0)
}

struct Placement {
    current: String,
    next: String,
    bubble_x: f64,
    bubble_y: f64,
}

fn placement(options: &VideoExportOptions, current: &Segment, next: Option<&Segment>) -> Placement {
    let size = f64::from(options.font_size);
    let width = f64::from(options.width);
    let height = f64::from(options.height);
    let gap = size * 0.2;
    let current_height = approximate_lines(current, size, width - 120.0) * size * 1.2;
    let next_height = next.map_or(0.0, |segment| {
        approximate_lines(segment, size * 0.6, width - 120.0) * size * 0.78 + size * 0.3 + gap
    });
    let column = (options.position - 1) % 3;
    let x = match column {
        0 => 60.0,
        2 => width - 60.0,
        _ => width * 0.5,
    };
    let (alignment, current_y, next_alignment, next_y) = match (options.position - 1) / 3 {
        2 => (
            7 + column,
            60.0,
            7 + column,
            60.0 + current_height + gap + size * 0.2,
        ),
        1 => (
            4 + column,
            height * 0.5 - next_height * 0.5,
            7 + column,
            height * 0.5 - next_height * 0.5 + current_height * 0.5 + gap + size * 0.2,
        ),
        _ => (
            1 + column,
            height - 60.0 - next_height,
            1 + column,
            height - 60.0,
        ),
    };
    let bubble_y = if alignment >= 7 {
        current_y - size * 0.2
    } else {
        current_y - current_height - size * 0.4
    };
    let text_width = approximate_width(current, size).min(width - 120.0);
    let text_left = match column {
        0 => x,
        2 => x - text_width,
        _ => x - text_width * 0.5,
    };
    Placement {
        current: format!("{{\\an{alignment}\\pos({x},{current_y})}}"),
        next: format!("{{\\an{next_alignment}\\pos({x},{next_y})}}"),
        bubble_x: (text_left - size * 0.6).max(size * 0.6),
        bubble_y: bubble_y.max(size * 0.4),
    }
}

fn bubble(
    ass: &mut String,
    from: f64,
    until: f64,
    seconds: u32,
    place: &Placement,
    options: &VideoExportOptions,
) -> Result<(), NightingaleError> {
    let radius = f64::from(options.font_size) * 0.5;
    let diameter = radius * 2.0;
    let k = radius * 0.552_284_75;
    let path = format!(
        "m {radius} 0 b {} 0 {diameter} {} {diameter} {radius} b {diameter} {} {} {diameter} {radius} {diameter} b {} {diameter} 0 {} 0 {radius} b 0 {} {} 0 {radius} 0",
        radius + k,
        radius - k,
        radius + k,
        radius + k,
        radius - k,
        radius + k,
        radius - k,
        radius - k
    );
    event(
        ass,
        from,
        until,
        "Bubble",
        &format!(
            "{{\\an7\\pos({},{})\\p1}}{path}",
            place.bubble_x - radius,
            place.bubble_y - radius
        ),
    )?;
    event(
        ass,
        from,
        until,
        "Count",
        &format!(
            "{{\\an5\\pos({},{})}}{seconds}",
            place.bubble_x, place.bubble_y
        ),
    )
}

fn timeline(segments: &[Segment], timing: &Timing, offset: f64) -> Vec<i64> {
    let mut points = vec![(-offset * 100.0).round() as i64];
    for (index, segment) in segments.iter().enumerate() {
        points.extend(
            [
                segment.start - timing.lyrics_lead,
                segment.end + timing.segment_linger,
                segment.start - timing.bubble_countdown,
                segment.start,
            ]
            .map(|time| (time * 100.0).round() as i64),
        );
        let previous_end = index.checked_sub(1).map_or(0.0, |i| segments[i].end);
        let gap = segment.start - previous_end;
        if gap >= timing.gap_threshold {
            for second in 1..=timing.bubble_countdown.ceil() as u32 {
                points.push(((segment.start - f64::from(second)) * 100.0).round() as i64);
            }
        }
    }
    points.sort_unstable();
    points.dedup();
    points
}

fn render_interval(
    ass: &mut String,
    segments: &[Segment],
    index: usize,
    interval: [f64; 2],
    options: &VideoExportOptions,
    timing: &Timing,
) -> Result<(), NightingaleError> {
    let [from, until] = interval;
    let time = (from + until) * 0.5;
    let segment = &segments[index];
    let previous_end = index.checked_sub(1).map_or(0.0, |i| segments[i].end);
    let gap_before = segment.start - previous_end;
    let next = segments.get(index + 1);
    let next_continuous = next.is_some_and(|next| next.start - segment.end < timing.gap_threshold);
    let time_until = segment.start - time;
    let countdown = gap_before >= timing.gap_threshold
        && time_until > 0.0
        && time_until <= timing.bubble_countdown;
    let active =
        time >= segment.start - timing.lyrics_lead && time <= segment.end + timing.segment_linger;
    let bridge = time > segment.end + timing.segment_linger && next_continuous;
    let show_current = active || countdown || bridge;
    let long_gap = gap_before >= timing.gap_threshold && time_until > timing.lyrics_lead;
    let show_next = show_current && next_continuous && (!long_gap || countdown);
    let place = placement(options, segment, if show_next { next } else { None });
    let offset = f64::from(options.countdown_seconds) + options.lyrics_offset_seconds;
    let start = (from + offset).max(0.0);
    let end = until + offset;
    if show_current {
        event(
            ass,
            start,
            end,
            "Current",
            &format!(
                "{}{}",
                place.current,
                line_text(segment, from.max(-offset), options, timing, false)?
            ),
        )?;
    }
    if show_next && let Some(next) = next {
        event(
            ass,
            start,
            end,
            "Next",
            &format!(
                "{}{}",
                place.next,
                line_text(next, from, options, timing, true)?
            ),
        )?;
    }
    if countdown {
        bubble(ass, start, end, time_until.ceil() as u32, &place, options)?;
    }
    Ok(())
}

pub(super) fn subtitles(
    transcript: Transcript,
    options: &VideoExportOptions,
) -> Result<String, NightingaleError> {
    validate(&transcript)?;
    let timing: Timing = serde_json::from_str(include_str!(
        "../../../client/src/shared/config/lyrics-timing.json"
    ))?;
    let color = ass_color(rgb(&options.text_color)?);
    rgb(&options.highlight_color)?;
    let mut ass = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {}\nPlayResY: {}\nWrapStyle: 0\nScaledBorderAndShadow: yes\nCollisions: Normal\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n",
        options.width, options.height
    );
    for (name, size, alpha, box_alpha, bold, alignment) in [
        ("Current", 1.0, "80", "99", -1, options.position),
        ("Next", 0.6, "A6", "BF", 0, options.position),
        ("Count", 0.4, "00", "FF", -1, 5),
        ("Bubble", 0.4, "99", "FF", 0, 5),
    ] {
        let fill = if name == "Bubble" {
            format!("&H{alpha}000000")
        } else {
            format!("&H{alpha}{}", &color[2..8])
        };
        writeln!(ass,"Style: {name},{},{},{fill},&H00FFFFFF,&H{box_alpha}000000,&H{box_alpha}000000,{bold},0,0,0,100,100,0,0,4,0,{},{alignment},60,60,60,1",options.font,f64::from(options.font_size)*size,if name=="Current"||name=="Next" { f64::from(options.font_size)*0.2 }else{0.0}).map_err(|_| invalid("Cannot format lyric styles"))?;
    }
    ass.push_str("\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    for second in 0..options.countdown_seconds {
        event(
            &mut ass,
            f64::from(second),
            f64::from(second + 1),
            "Count",
            &format!(
                "{{\\an5\\pos({},{})\\fs{}}}{}",
                options.width / 2,
                options.height / 2,
                options.font_size,
                options.countdown_seconds - second
            ),
        )?;
    }
    let points = timeline(
        &transcript.segments,
        &timing,
        f64::from(options.countdown_seconds) + options.lyrics_offset_seconds,
    );
    let mut hint = 0;
    for interval in points.windows(2) {
        let from = interval[0] as f64 / 100.0;
        let until = interval[1] as f64 / 100.0;
        hint = selected_segment(&transcript.segments, (from + until) * 0.5, hint, &timing);
        render_interval(
            &mut ass,
            &transcript.segments,
            hint,
            [from, until],
            options,
            &timing,
        )?;
    }
    Ok(ass)
}
