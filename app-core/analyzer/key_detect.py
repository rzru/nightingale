"""Lightweight key detection for pitch-class output (e.g. C, F#m)."""

import math

import numpy as np
import whisperx

from audio import ALIGNMENT_SAMPLE_RATE

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
KRUMHANSL_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KRUMHANSL_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _pc_profile(audio: np.ndarray, sr: int = ALIGNMENT_SAMPLE_RATE) -> np.ndarray:
    frame = 4096
    hop = 1024
    if len(audio) < frame:
        return np.zeros(12, dtype=np.float64)

    win = np.hanning(frame)
    freqs = np.fft.rfftfreq(frame, 1.0 / sr)
    min_hz = 40.0
    max_hz = 5000.0
    chroma = np.zeros(12, dtype=np.float64)

    for start in range(0, len(audio) - frame, hop):
        segment = audio[start : start + frame]
        mags = np.abs(np.fft.rfft(segment * win))
        if mags.size == 0:
            continue
        for idx, mag in enumerate(mags):
            hz = freqs[idx]
            if hz < min_hz or hz > max_hz:
                continue
            midi = int(round(69 + 12 * math.log2(hz / 440.0)))
            chroma[midi % 12] += float(mag)

    total = float(chroma.sum())
    if total > 0:
        chroma /= total
    return chroma


def detect_key(audio_path: str) -> str:
    try:
        audio = whisperx.load_audio(audio_path)
        if audio is None or len(audio) == 0:
            return "C"

        profile = _pc_profile(audio)
        if profile.sum() <= 0:
            return "C"

        best_score = float("-inf")
        best_key = "C"

        for i, note in enumerate(NOTE_NAMES):
            score_major = float(np.dot(profile, np.roll(KRUMHANSL_MAJOR, i)))
            if score_major > best_score:
                best_score = score_major
                best_key = note

            score_minor = float(np.dot(profile, np.roll(KRUMHANSL_MINOR, i)))
            if score_minor > best_score:
                best_score = score_minor
                best_key = f"{note}m"

        return best_key
    except Exception:
        return "C"
