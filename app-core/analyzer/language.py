"""Multi-window language detection using WhisperX."""

from audio import ALIGNMENT_SAMPLE_RATE


def detect_language_multiwindow(model, audio, sample_rate=ALIGNMENT_SAMPLE_RATE, window_secs=30) -> str:
    """Detect language by sampling multiple 30s windows and voting."""
    from whisperx.audio import log_mel_spectrogram

    window_samples = window_secs * sample_rate
    total_samples = len(audio)
    n_mels = model.model.feat_kwargs.get("feature_size") or 80

    offsets = [0]
    if total_samples > window_samples:
        offsets.append(total_samples // 2 - window_samples // 2)
    if total_samples > window_samples * 2:
        offsets.append(total_samples // 4)
        offsets.append(total_samples * 3 // 4 - window_samples)

    votes = []
    for offset in offsets:
        offset = max(0, min(offset, total_samples - window_samples))
        chunk = audio[offset : offset + window_samples]
        padding = max(0, window_samples - len(chunk))
        segment = log_mel_spectrogram(chunk, n_mels=n_mels, padding=padding)
        encoder_output = model.model.encode(segment)
        results = model.model.model.detect_language(encoder_output)
        lang_token, prob = results[0][0]
        lang = lang_token[2:-2]
        print(f"[nightingale:LOG] Window @{offset/sample_rate:.0f}s: lang={lang} prob={prob:.2f}", flush=True)
        votes.append((lang, prob))

    lang_scores: dict[str, float] = {}
    for lang, prob in votes:
        lang_scores[lang] = lang_scores.get(lang, 0.0) + prob

    best_lang = max(lang_scores, key=lambda l: lang_scores[l])
    print(f"[nightingale:LOG] Language scores: {lang_scores} -> '{best_lang}'", flush=True)
    return best_lang
