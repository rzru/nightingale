"""Melody extraction: vocal pitch curve and per-word notes.

The pitch curve is the fundamental frequency of the vocal stem sampled every
10 ms, stored as fractional MIDI numbers (``None`` where there is no voice).
Notes are cut inside each word's time span; a word without a stable pitch gets
a single ``rap`` note so that every timed word carries at least one note.
"""

import json
import math
import time

import numpy as np

# 2: per-word notes and the pitch range. 3: adds `quality.uncovered_voice`.
TRANSCRIPT_VERSION = 3

# A word "covers" the voice this long before its start and after its end.
COVERAGE_PAD_SEC = 0.3

CURVE_SR = 16000
CURVE_HOP_SEC = 0.01
CURVE_FMIN_HZ = 65.0
CURVE_FMAX_HZ = 1100.0
CURVE_FRAME = 1024
# 20-cent pitch bins: 3x faster than librosa's default 10 cents, same notes.
CURVE_RESOLUTION = 0.2

NOTE_SPLIT_SEMITONES = 0.8
NOTE_SPLIT_MIN_SEC = 0.08
NOTE_MIN_SEC = 0.06
WORD_MIN_VOICED_SEC = 0.05
WORD_MIN_VOICED_RATIO = 0.25

NOTE_NORMAL = "normal"
NOTE_RAP = "rap"
NOTE_FREE = "free"


def hz_to_midi(hz):
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def extract_pitch_curve(vocals_path):
    """Return fractional MIDI per 10 ms frame, NaN where unvoiced."""
    import librosa

    audio, _ = librosa.load(vocals_path, sr=CURVE_SR, mono=True)
    if audio.size < CURVE_FRAME:
        return np.zeros(0, dtype=np.float32)

    hop = int(round(CURVE_SR * CURVE_HOP_SEC))
    f0, voiced, _ = librosa.pyin(
        audio,
        fmin=CURVE_FMIN_HZ,
        fmax=CURVE_FMAX_HZ,
        sr=CURVE_SR,
        frame_length=CURVE_FRAME,
        hop_length=hop,
        resolution=CURVE_RESOLUTION,
        center=True,
    )
    midi = np.full(f0.shape, np.nan, dtype=np.float32)
    mask = voiced & np.isfinite(f0) & (f0 > 0)
    midi[mask] = 69.0 + 12.0 * np.log2(f0[mask] / 440.0)
    return midi


def save_pitch_curve(path, midi):
    values = [None if np.isnan(v) else round(float(v), 2) for v in midi]
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"hop": CURVE_HOP_SEC, "midi": values}, f, separators=(",", ":"))


def load_pitch_curve(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return np.array(
        [np.nan if v is None else v for v in data.get("midi", [])], dtype=np.float32
    )


def _rap_note(start, end):
    return {"start": round(start, 3), "end": round(end, 3), "pitch": None, "type": NOTE_RAP}


def _runs(frames, split_frames):
    """Split voiced (index, midi) frames into runs of stable pitch.

    A new run starts once the pitch has stayed more than NOTE_SPLIT_SEMITONES
    away from the running median of the current run for ``split_frames`` frames.
    """
    runs = []
    current = []
    away = []
    for item in frames:
        if not current:
            current = [item]
            continue
        center = float(np.median([m for _, m in current]))
        if abs(item[1] - center) > NOTE_SPLIT_SEMITONES:
            # Frames that drift in different directions are not one new note.
            if away and abs(item[1] - away[-1][1]) > NOTE_SPLIT_SEMITONES:
                current.extend(away)
                away = []
            away.append(item)
            if len(away) >= split_frames:
                runs.append(current)
                current = away
                away = []
        else:
            current.extend(away)
            away = []
            current.append(item)
    current.extend(away)
    if current:
        runs.append(current)
    return runs


def word_notes(midi, start, end, hop=CURVE_HOP_SEC):
    """Notes for one word spanning [start, end] seconds."""
    if end <= start:
        return [_rap_note(start, end)]

    first = max(0, int(math.floor(start / hop)))
    last = min(len(midi), int(math.ceil(end / hop)))
    frames = [(i, float(midi[i])) for i in range(first, last) if not np.isnan(midi[i])]

    voiced_sec = len(frames) * hop
    if voiced_sec < WORD_MIN_VOICED_SEC or voiced_sec < (end - start) * WORD_MIN_VOICED_RATIO:
        return [_rap_note(start, end)]

    split_frames = max(1, int(round(NOTE_SPLIT_MIN_SEC / hop)))
    min_frames = max(1, int(round(NOTE_MIN_SEC / hop)))

    runs = _runs(frames, split_frames)
    # Fold runs that are too short to be a note into their neighbour.
    merged = []
    for run in runs:
        if merged and len(run) < min_frames:
            merged[-1].extend(run)
        elif merged and len(merged[-1]) < min_frames:
            merged[-1].extend(run)
        else:
            merged.append(run)

    notes = []
    for run in merged:
        pitch = int(round(float(np.median([m for _, m in run]))))
        if notes and notes[-1]["pitch"] == pitch:
            continue
        notes.append({"start": run[0][0] * hop, "pitch": pitch, "type": NOTE_NORMAL})

    # Notes tile the word: the first starts with the word, each ends where the
    # next begins, the last ends with the word.
    for i, note in enumerate(notes):
        note_start = start if i == 0 else min(max(note["start"], start), end)
        note_end = end if i == len(notes) - 1 else min(max(notes[i + 1]["start"], start), end)
        note["start"] = round(note_start, 3)
        note["end"] = round(note_end, 3)
    return [
        {"start": n["start"], "end": n["end"], "pitch": n["pitch"], "type": n["type"]}
        for n in notes
        if n["end"] > n["start"]
    ] or [_rap_note(start, end)]


def uncovered_voice_share(transcript, midi, hop=CURVE_HOP_SEC):
    """Share of the sung time that no word of the lyrics accounts for.

    Recognition that skips lines leaves voice with no text under it. Measured
    on songs with known lyrics this stays under 6 %, and reaches 20-30 % when
    whole lines are missing; alignment scores do not show that at all.
    """
    voiced = ~np.isnan(midi)
    total = int(np.count_nonzero(voiced))
    if total == 0:
        return None
    covered = np.zeros(len(midi), dtype=bool)
    for segment in transcript.get("segments", []):
        for word in segment.get("words", []):
            start = word.get("start")
            end = word.get("end")
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                continue
            first = max(0, int((start - COVERAGE_PAD_SEC) / hop))
            last = min(len(midi), int((end + COVERAGE_PAD_SEC) / hop) + 1)
            covered[first:last] = True
    return round(float(np.count_nonzero(voiced & ~covered)) / total, 3)


def annotate_transcript(transcript, midi, hop=CURVE_HOP_SEC):
    """Attach notes to every timed word and stamp the pitch range.

    Words that already carry notes edited by hand or imported (``pitch`` from
    UltraStar) are left untouched.
    """
    low = None
    high = None
    for segment in transcript.get("segments", []):
        for word in segment.get("words", []):
            start = word.get("start")
            end = word.get("end")
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                continue
            if isinstance(word.get("pitch"), (int, float)):
                notes = [{
                    "start": round(start, 3),
                    "end": round(end, 3),
                    "pitch": int(word["pitch"]),
                    "type": NOTE_NORMAL,
                }]
            else:
                notes = word_notes(midi, float(start), float(end), hop)
            if word.get("no_sing"):
                # Marked in the editor: shown on screen, never scored.
                for note in notes:
                    note["type"] = NOTE_FREE
            word["notes"] = notes
            for note in notes:
                pitch = note["pitch"]
                if pitch is None:
                    continue
                low = pitch if low is None else min(low, pitch)
                high = pitch if high is None else max(high, pitch)

    transcript["version"] = TRANSCRIPT_VERSION
    transcript["range"] = None if low is None else {"low": low, "high": high}
    transcript["quality"] = {"uncovered_voice": uncovered_voice_share(transcript, midi, hop)}
    return transcript


def add_melody(transcript, vocals_path, curve_path):
    """Extract the curve from the vocal stem, cache it, annotate the transcript."""
    started = time.time()
    midi = extract_pitch_curve(vocals_path)
    save_pitch_curve(curve_path, midi)
    annotate_transcript(transcript, midi)
    voiced = int(np.count_nonzero(~np.isnan(midi)))
    print(
        f"[nightingale:LOG] Melody: {len(midi)} frames, {voiced} voiced, "
        f"range={transcript.get('range')}, {time.time() - started:.1f}s",
        flush=True,
    )
    return transcript


def backfill_melody(output_dir, file_hash):
    """Add notes to a transcript analyzed before notes existed.

    Returns True when the transcript was updated. Reuses the cached pitch curve
    when present, so re-cutting notes after a timing edit is instant.
    """
    import glob
    import os

    transcript_path = os.path.join(output_dir, f"{file_hash}_transcript.json")
    if not os.path.isfile(transcript_path):
        return False
    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript = json.load(f)

    curve_path = os.path.join(output_dir, f"{file_hash}_pitch.json")
    if os.path.isfile(curve_path):
        midi = load_pitch_curve(curve_path)
    else:
        # Tempo 1.0 stems match the base transcript's timestamps.
        stems = sorted(glob.glob(os.path.join(output_dir, f"{file_hash}_vocals_*_1.0.mp3")))
        stems += [os.path.join(output_dir, f"{file_hash}_vocals.mp3")]
        vocals = next((p for p in stems if os.path.isfile(p)), None)
        if vocals is None:
            return False
        midi = extract_pitch_curve(vocals)
        save_pitch_curve(curve_path, midi)

    annotate_transcript(transcript, midi)
    tmp_path = transcript_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(transcript, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, transcript_path)
    return True


if __name__ == "__main__":
    import sys

    if sys.argv[1] == "--backfill":
        for song_hash in sys.argv[3:]:
            print(song_hash, backfill_melody(sys.argv[2], song_hash), flush=True)
        sys.exit(0)

    vocals, transcript_in = sys.argv[1], sys.argv[2]
    with open(transcript_in, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    t0 = time.time()
    curve = extract_pitch_curve(vocals)
    elapsed = time.time() - t0
    annotate_transcript(data, curve)
    words = [w for s in data["segments"] for w in s["words"]]
    notes = [n for w in words for n in w.get("notes", [])]
    rap = sum(1 for n in notes if n["type"] == NOTE_RAP)
    lens = [n["end"] - n["start"] for n in notes]
    print(json.dumps({
        "seconds": round(len(curve) * CURVE_HOP_SEC, 1),
        "pyin_sec": round(elapsed, 1),
        "voiced_pct": round(100 * float(np.mean(~np.isnan(curve))), 1),
        "words": len(words),
        "notes": len(notes),
        "rap_notes": rap,
        "median_note_sec": round(float(np.median(lens)), 3),
        "range": data["range"],
    }))
    if len(sys.argv) > 3:
        for w in words[: int(sys.argv[3])]:
            print(w["word"], [(n["pitch"], round(n["end"] - n["start"], 2)) for n in w["notes"]])
