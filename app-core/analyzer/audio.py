"""Audio analysis utilities: vocal region detection, silence splitting, normalization."""

import numpy as np

DEFAULT_VOCAL_THRESHOLD_PCT = 0.15
_vocal_threshold_pct = DEFAULT_VOCAL_THRESHOLD_PCT


def set_vocal_threshold_pct(pct) -> None:
    """Set the RMS threshold (fraction of peak) used to detect the vocal region.

    Lower values keep more quiet audio at the song's edges (less aggressive
    trimming); higher values trim harder. Invalid/None values are ignored so the
    default stays in effect.
    """
    global _vocal_threshold_pct
    if pct is None:
        return
    try:
        pct = float(pct)
    except (TypeError, ValueError):
        return
    _vocal_threshold_pct = min(max(pct, 0.0), 1.0)


def get_vocal_threshold_pct() -> float:
    return _vocal_threshold_pct


def detect_vocal_region(audio, sr: int = 16000, win_secs: float = 0.5,
                        threshold_pct=None, min_consecutive: int = 4,
                        padding: float = 1.0) -> tuple[float, float]:
    """Detect where vocals start and end using RMS energy analysis.

    Returns (vocal_start, vocal_end) in seconds. When ``threshold_pct`` is
    ``None`` the module-level configurable threshold is used.
    """
    if threshold_pct is None:
        threshold_pct = _vocal_threshold_pct
    window_samples = int(win_secs * sr)
    rms_values = []
    for start_idx in range(0, len(audio), window_samples):
        chunk = audio[start_idx : start_idx + window_samples]
        rms_values.append(float(np.sqrt(np.mean(chunk ** 2))))

    duration_secs = len(audio) / sr

    if not rms_values:
        return 0.0, duration_secs

    peak_rms = max(rms_values)
    threshold = peak_rms * threshold_pct
    active = [rms >= threshold for rms in rms_values]
    active_count = sum(active)
    print(f"[nightingale:LOG] Vocal detection: peak_rms={peak_rms:.5f}, threshold({threshold_pct*100:.0f}%)={threshold:.5f}, windows={len(rms_values)}, active={active_count}", flush=True)

    top_windows = sorted(enumerate(rms_values), key=lambda x: x[1], reverse=True)[:10]
    for rank, (idx, rms) in enumerate(top_windows):
        t = idx * win_secs
        print(f"[nightingale:LOG]   RMS top {rank+1}: t={t:.1f}s rms={rms:.5f} {'<<ACTIVE>>' if active[idx] else ''}", flush=True)

    vocal_start_win = 0
    for i in range(len(active) - min_consecutive + 1):
        if all(active[i : i + min_consecutive]):
            vocal_start_win = i
            break

    vocal_end_win = len(rms_values) - 1
    for i in range(len(active) - 1, min_consecutive - 2, -1):
        start_check = max(i - min_consecutive + 1, 0)
        if all(active[start_check : start_check + min_consecutive]):
            vocal_end_win = i
            break

    vocal_start = vocal_start_win * win_secs
    vocal_end = min((vocal_end_win + 1) * win_secs, duration_secs)
    print(f"[nightingale:LOG] Sustained activity (>={min_consecutive} consecutive): first at win={vocal_start_win} ({vocal_start:.1f}s), last at win={vocal_end_win} ({vocal_end:.1f}s)", flush=True)

    vocal_start = max(vocal_start - padding, 0.0)
    vocal_end = min(vocal_end + padding, duration_secs)
    print(f"[nightingale:LOG] Vocal region (with {padding}s padding): {vocal_start:.1f}s - {vocal_end:.1f}s (song duration: {duration_secs:.1f}s)", flush=True)

    return vocal_start, vocal_end

def silent_gaps(audio, sr: int = 16000, win_secs: float = 0.5,
                min_gap_secs: float = 3.0, threshold_pct=None) -> list[tuple[float, float]]:
    """Return ``(start, end)`` seconds of stretches of at least ``min_gap_secs``
    where the vocal stem's RMS stays under the vocal-detection threshold."""
    if threshold_pct is None:
        threshold_pct = _vocal_threshold_pct
    window_samples = int(win_secs * sr)
    rms_values = [
        float(np.sqrt(np.mean(audio[i : i + window_samples] ** 2)))
        for i in range(0, len(audio), window_samples)
    ]
    if not rms_values:
        return []

    threshold = max(rms_values) * threshold_pct
    gaps: list[tuple[float, float]] = []
    run_start = None
    for i, rms in enumerate(rms_values + [threshold]):
        if rms < threshold:
            if run_start is None:
                run_start = i
            continue
        if run_start is not None and (i - run_start) * win_secs >= min_gap_secs:
            gaps.append((run_start * win_secs, min(i * win_secs, len(audio) / sr)))
        run_start = None
    return gaps


def highpass_filter(audio, sr: int = 16000, cutoff_hz: float = 80.0):
    """Apply a simple highpass filter to remove sub-bass rumble from stems."""
    from scipy.signal import butter, sosfilt
    sos = butter(5, cutoff_hz, btype="high", fs=sr, output="sos")
    filtered = sosfilt(sos, audio.astype(np.float64)).astype(audio.dtype)
    print(f"[nightingale:LOG] Applied highpass filter at {cutoff_hz}Hz", flush=True)
    return filtered


def normalize_rms(audio, target_rms: float = 0.1, max_gain: float = 10.0):
    """Boost audio volume to a target RMS level. Returns normalized audio."""
    raw_rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    if raw_rms > 0:
        gain = min(target_rms / raw_rms, max_gain)
        audio = (audio * gain).astype(audio.dtype)
        print(f"[nightingale:LOG] Normalized vocals: rms {raw_rms:.5f} -> {target_rms} (gain {gain:.2f}x)", flush=True)
    return audio
