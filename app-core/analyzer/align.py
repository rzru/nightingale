"""Lyrics alignment: align pre-fetched lyrics text to vocals audio using WhisperX."""

import itertools
import json
import re

import cjk
from audio import detect_vocal_region, silent_gaps
from gpu import gpu_model
from language import detect_language_multiwindow
from whisper_compat import progress, align_device_for, compute_type_for, align_with_fallback, get_align_backend


def align_lyrics(
    lyrics_path: str,
    vocals_path: str,
    device: str,
    model_name: str = "large-v3",
    language_override: str | None = None,
    whisper_model=None,
    pre_align_cleanup=None,
) -> dict:
    """Align pre-existing lyrics to vocals audio using WhisperX.

    Steps:
      1. Load lyrics text from JSON
      2. Load vocals audio and detect vocal region via RMS
      3. Detect language
      4. Probe multiple start offsets to find where vocals actually begin
      5. Run final forced alignment from the best offset
      6. Map aligned word timestamps back to original lyric lines
    """
    import whisperx

    progress(55, "Loading lyrics...")
    with open(lyrics_path, "r", encoding="utf-8") as f:
        lyrics_data = json.load(f)

    lines = lyrics_data.get("lines", [])
    print(f"[nightingale:LOG] Lyrics loaded: {len(lines)} lines", flush=True)

    clean_lines: list[str] = []
    for line in lines:
        text = line.strip() if isinstance(line, str) else str(line).strip()
        if text:
            clean_lines.append(text)

    audio = whisperx.load_audio(vocals_path)
    duration_secs = len(audio) / 16000
    print(f"[nightingale:LOG] Vocals audio loaded: {len(audio)} samples ({duration_secs:.1f}s)", flush=True)

    progress(56, "Detecting vocal regions...")
    vocal_start, vocal_end = detect_vocal_region(audio)

    a_device = align_device_for(device)
    c_type = compute_type_for(device)

    if language_override and language_override.strip().lower() not in ("unknown", "und", ""):
        language = language_override
        print(f"[nightingale:LOG] Using language override: '{language}'", flush=True)
        progress(59, f"Language override: {language}")
    else:
        progress(58, "Detecting language...")
        with gpu_model(f"whisper:{model_name}:lang_detect") as held:
            model = whisperx.load_model(
                model_name, a_device, compute_type=c_type, task="transcribe",
            )
            held.append(model)
            language = detect_language_multiwindow(model, audio)
        print(f"[nightingale:LOG] Detected language: '{language}'", flush=True)
        progress(59, f"Detected language: {language}")

    progress(80, f"Final alignment from {vocal_start:.1f}s...")

    import qwen_align
    if get_align_backend() == "qwen" and qwen_align.is_supported(language):
        qwen_segments = _align_lyrics_qwen(
            clean_lines, audio, language, vocal_start, vocal_end, pre_align_cleanup,
        )
        if qwen_segments is not None:
            _trim_words_to_vocals(qwen_segments, audio)
            progress(90, f"Alignment complete: {len(qwen_segments)} segments, lang={language}")
            if qwen_segments:
                print(f"[nightingale:LOG] First segment: '{qwen_segments[0]['text'][:100]}'", flush=True)
                print(f"[nightingale:LOG] Last segment: '{qwen_segments[-1]['text'][:100]}'", flush=True)
            return {"language": language, "segments": qwen_segments, "source": "lyrics"}
        print(
            "[nightingale:LOG] Qwen lyrics alignment unavailable; falling back to wav2vec2 path",
            flush=True,
        )

    line_token_pairs: list[list[tuple[str, str]]] | None = None
    if cjk.is_cjk(language):
        line_token_pairs = [cjk.tokenize_for_alignment(line, language) for line in clean_lines]
        cleaned_lines = ["".join(r for _, r in toks) for toks in line_token_pairs]
        full_text = "".join(cleaned_lines)
        print(
            f"[nightingale:LOG] CJK alignment input: {len(full_text)} chars across "
            f"{sum(1 for c in cleaned_lines if c)} non-empty lines (lang={language}, "
            f"model={cjk.align_model_for(language) or 'default'})",
            flush=True,
        )
    else:
        full_text = " ".join(clean_lines)

    raw_segments = [{"text": full_text, "start": vocal_start, "end": vocal_end}]

    align_result = align_with_fallback(
        raw_segments, audio, cjk.align_lang_code(language), a_device, pre_align_cleanup,
        model_name=cjk.align_model_for(language),
    )

    if cjk.is_cjk(language):
        segments = _map_chars_to_lines_cjk(align_result, clean_lines, line_token_pairs, language)
    else:
        segments = _map_words_to_lines(align_result, clean_lines)
        if cjk.is_korean(language):
            for seg in segments:
                cjk.attach_reading(seg["words"], language)

    _trim_words_to_vocals(segments, audio)

    progress(90, f"Alignment complete: {len(segments)} segments, lang={language}")
    if segments:
        print(f"[nightingale:LOG] First segment: '{segments[0]['text'][:100]}'", flush=True)
        print(f"[nightingale:LOG] Last segment: '{segments[-1]['text'][:100]}'", flush=True)

    return {"language": language, "segments": segments, "source": "lyrics"}

def _trim_words_to_vocals(segments: list[dict], audio) -> None:
    """Shrink words that span a long vocal silence to their longest sung part.

    Aligners fill instrumental breaks by stretching the neighbouring word across
    them (風 highlighted through a 40 s interlude). Words lying entirely inside a
    silence are left alone: there is no sung part to move them to.
    """
    gaps = silent_gaps(audio)
    if not gaps:
        return
    trimmed = 0
    for seg in segments:
        words = seg.get("words") or []
        for w in words:
            start, end = w.get("start"), w.get("end")
            if start is None or end is None:
                continue
            pieces: list[tuple[float, float]] = []
            cursor = start
            for g_start, g_end in gaps:
                if g_end <= cursor or g_start >= end:
                    continue
                if g_start > cursor:
                    pieces.append((cursor, g_start))
                cursor = max(cursor, g_end)
            if cursor < end:
                pieces.append((cursor, end))
            if not pieces or pieces == [(start, end)]:
                continue
            best_start, best_end = max(pieces, key=lambda p: p[1] - p[0])
            w["start"] = round(best_start, 3)
            w["end"] = round(best_end, 3)
            trimmed += 1
        if words:
            seg["start"] = words[0]["start"]
            seg["end"] = max(seg["start"], words[-1]["end"])
    if trimmed:
        print(f"[nightingale:LOG] Trimmed {trimmed} words stretched over vocal silences", flush=True)


def _normalize(word: str) -> str:
    return re.sub(r"[^\w]", "", word).lower()


def _collect_aligned(align_result: dict) -> list[dict]:
    """Extract every aligned word in input-text order, including NaN-timestamp ones.

    WhisperX iterates input characters in order and groups them by a
    monotonically-increasing word index, so the resulting word list preserves
    lyric order. Words the CTC backtrack could not place are emitted without
    "start"/"end" keys (whisperx/alignment.py l.343-350); we keep those in the
    stream as None-timestamp entries so the line-mapper can treat them as
    missing rather than silently consuming a later occurrence's timestamp.
    """
    out: list[dict] = []
    for seg in align_result.get("segments", []):
        for w in seg.get("words", []):
            text = w.get("word", "").strip()
            if not text:
                continue
            out.append({
                "word": text,
                "norm": _normalize(text),
                "start": w.get("start"),
                "end": w.get("end"),
                "score": w.get("score"),
            })
    return out


def _map_chars_to_lines_cjk(
    align_result: dict,
    original_lines: list[str],
    line_token_pairs: list[list[tuple[str, str]]],
    language: str,
) -> list[dict]:
    """Map per-character whisperx timestamps onto fugashi/jieba tokens.

    ``line_token_pairs[i]`` is the per-token (display_surface,
    alignment_text) decomposition of ``original_lines[i]``. The aligner saw
    the concatenation of every alignment_text and emitted one timed entry
    per char in input order; we slice that stream per line by the line's
    total alignment-char count, then reattribute char timings onto tokens
    using each token's alignment-text length (which may differ from the
    surface length, e.g. when surface=kanji and alignment=hiragana).
    """
    aligned = _collect_aligned(align_result)
    timed_count = sum(1 for a in aligned if a["start"] is not None and a["end"] is not None)
    print(
        f"[nightingale:LOG] CJK alignment: {len(aligned)} chars emitted "
        f"({timed_count} timed, {len(aligned) - timed_count} NaN)",
        flush=True,
    )

    segments: list[dict] = []
    cursor = 0
    skipped_empty = 0

    for original, token_pairs in zip(original_lines, line_token_pairs):
        n = sum(len(r) for _, r in token_pairs)
        if n == 0:
            skipped_empty += 1
            continue

        slice_chars = aligned[cursor:cursor + n]
        cursor += len(slice_chars)

        if not token_pairs:
            continue
        surfaces = [s for s, _ in token_pairs]
        lengths = [len(r) for _, r in token_pairs]

        fb_start = next((c["start"] for c in slice_chars if c["start"] is not None), None)
        fb_end = next((c["end"] for c in reversed(slice_chars) if c["end"] is not None), None)

        entries = cjk.attribute_chars_to_tokens(
            surfaces, slice_chars,
            fallback_start=fb_start,
            fallback_end=fb_end,
            cleaned_lengths=lengths,
        )
        entries = cjk.merge_punct(entries)

        valid = [e for e in entries if e.get("start") is not None and e.get("end") is not None]
        if not valid:
            continue

        for e in valid:
            e["start"] = round(e["start"], 3)
            e["end"] = round(e["end"], 3)
            if e["end"] < e["start"]:
                e["end"] = e["start"]
            if "score" in e and e["score"] is not None:
                e["score"] = round(e["score"], 3)

        cjk.attach_reading(valid, language)

        seg_start = valid[0]["start"]
        seg_end = valid[-1]["end"]
        if seg_end < seg_start:
            seg_end = seg_start

        segments.append({
            "text": original,
            "start": seg_start,
            "end": seg_end,
            "words": valid,
        })

    for i in range(1, len(segments)):
        prev = segments[i - 1]
        cur = segments[i]
        if cur["start"] < prev["end"]:
            cur["start"] = prev["end"]
            if cur["end"] < cur["start"]:
                cur["end"] = cur["start"]

    total_words = sum(len(s["words"]) for s in segments)
    print(
        f"[nightingale:LOG] CJK lyrics alignment: {len(segments)} lines, "
        f"{total_words} tokens ({skipped_empty} empty lines skipped)",
        flush=True,
    )

    return _split_long_segments(segments, joiner="")


def _split_long_segments(segments: list[dict], joiner: str = " ") -> list[dict]:
    MAX_WORDS_PER_LINE = 10
    out: list[dict] = []
    for seg in segments:
        words = seg["words"]
        if len(words) <= MAX_WORDS_PER_LINE:
            out.append(seg)
            continue
        for chunk in [words[i:i+MAX_WORDS_PER_LINE] for i in range(0, len(words), MAX_WORDS_PER_LINE)]:
            out.append({
                "text": joiner.join(w["word"] for w in chunk),
                "start": chunk[0]["start"],
                "end": chunk[-1]["end"],
                "words": chunk,
            })
    return out


def _align_lyrics_qwen(
    clean_lines: list[str],
    audio,
    language: str,
    vocal_start: float,
    vocal_end: float,
    pre_align_cleanup=None,
) -> list[dict] | None:
    """Align lyrics with Qwen3-ForcedAligner and map tokens back to lines.

    The whole vocal region is aligned in one pass against the newline-joined
    lyrics (newlines make line boundaries token boundaries and are dropped by
    Qwen's tokenizer). The flat timed-token stream is then sliced onto lines by
    cumulative kept-char count. Returns ``None`` on any qwen failure so the
    caller falls back to the wav2vec2 path.
    """
    import qwen_align

    full_text = "\n".join(clean_lines)
    raw_segments = [{"text": full_text, "start": vocal_start, "end": vocal_end}]
    try:
        result = qwen_align.qwen_align_with_cpu_fallback(
            raw_segments, audio, language, pre_align_cleanup,
        )
    except qwen_align.QwenUnsupportedError as e:
        print(f"[nightingale:LOG] Qwen aligner unsupported: {e}", flush=True)
        return None
    except Exception as e:
        print(f"[nightingale:LOG] Qwen aligner failed: {e}", flush=True)
        return None

    segments = _map_qwen_units_to_lines(result, clean_lines, language)
    if not segments:
        return None

    total_words = sum(len(s["words"]) for s in segments)
    print(
        f"[nightingale:LOG] Qwen lyrics alignment: {len(segments)} lines, {total_words} tokens",
        flush=True,
    )
    return segments


def _map_qwen_units_to_lines(align_result: dict, clean_lines: list[str], language: str) -> list[dict]:
    """Slice Qwen's flat timed-token stream onto lyric lines by kept-char count.

    Every Qwen token carries a timestamp (the model never drops units), and token
    surfaces concatenate to each line's kept content, so a running kept-char
    counter attributes tokens to lines without normalized-text matching. Readings
    are attached per line for CJK/Korean.

    Qwen's tokenizer can merge the last word of a line with the first of the next
    (金の塔 / 北の丘 -> "塔北"), so such units are split at the line boundary
    first, and the counter is cumulative so any leftover mismatch stays local
    instead of shifting every following line.
    """
    line_lens = [cjk.qwen_kept_len(line) for line in clean_lines]
    units = _split_units_at_boundaries(
        _collect_aligned(align_result),
        set(itertools.accumulate(line_lens)),
    )
    segments: list[dict] = []
    cursor = 0
    consumed = 0
    target = 0

    for line_text, need in zip(clean_lines, line_lens):
        if need == 0:
            continue
        target += need

        taken: list[dict] = []
        while cursor < len(units) and consumed < target:
            u = units[cursor]
            cursor += 1
            taken.append(u)
            consumed += cjk.qwen_kept_len(u["word"])

        words: list[dict] = []
        for u in taken:
            if u["start"] is None or u["end"] is None:
                continue
            entry = {"word": u["word"], "start": round(u["start"], 3), "end": round(u["end"], 3)}
            if entry["end"] < entry["start"]:
                entry["end"] = entry["start"]
            if u["score"] is not None:
                entry["score"] = round(u["score"], 3)
            words.append(entry)

        if not words:
            continue

        if cjk.is_supported_lang(language):
            cjk.attach_reading(words, language)

        seg_start = words[0]["start"]
        seg_end = words[-1]["end"]
        if seg_end < seg_start:
            seg_end = seg_start

        segments.append({
            "text": line_text,
            "start": seg_start,
            "end": seg_end,
            "words": words,
        })

    for i in range(1, len(segments)):
        prev = segments[i - 1]
        cur = segments[i]
        if cur["start"] < prev["end"]:
            cur["start"] = prev["end"]
            if cur["end"] < cur["start"]:
                cur["end"] = cur["start"]

    joiner = "" if cjk.is_cjk(language) else " "
    return _split_long_segments(segments, joiner=joiner)


def _split_units_at_boundaries(units: list[dict], boundaries: set[int]) -> list[dict]:
    """Split units whose kept chars straddle a cumulative line boundary.

    Each piece keeps its share of the unit's time span, proportional to its
    kept-char count.
    """
    out: list[dict] = []
    consumed = 0
    for u in units:
        n = cjk.qwen_kept_len(u["word"])
        cuts = sorted(b - consumed for b in boundaries if consumed < b < consumed + n)
        consumed += n
        if not cuts:
            out.append(u)
            continue

        pieces: list[str] = []
        current = ""
        kept = 0
        for ch in u["word"]:
            current += ch
            kept += cjk.qwen_kept_len(ch)
            if cuts and kept == cuts[0]:
                pieces.append(current)
                current = ""
                cuts.pop(0)
        if current:
            pieces.append(current)

        timed = u["start"] is not None and u["end"] is not None
        offset = 0
        for piece in pieces:
            k = cjk.qwen_kept_len(piece)
            part = dict(u, word=piece, norm=_normalize(piece))
            if timed:
                span = u["end"] - u["start"]
                part["start"] = u["start"] + span * offset / n
                part["end"] = u["start"] + span * (offset + k) / n
            offset += k
            out.append(part)
    return out


def _map_words_to_lines(align_result: dict, clean_lines: list[str]) -> list[dict]:
    """Map aligned word timestamps back to original lyric lines.

    Walks the aligned stream with a single forward cursor and bounded lookahead
    so that a dropped word in a repeated phrase (e.g. the 2nd "love" of three)
    no longer causes downstream occurrences to inherit each other's timestamps.
    """
    aligned = _collect_aligned(align_result)
    timed_count = sum(1 for a in aligned if a["start"] is not None and a["end"] is not None)
    print(
        f"[nightingale:LOG] Final alignment: {len(aligned)} words emitted "
        f"({timed_count} timed, {len(aligned) - timed_count} NaN)",
        flush=True,
    )

    LOOKAHEAD = 6
    ai = 0
    segments = []
    missed_lyric_words = 0
    interpolated_drops = 0

    for line_text in clean_lines:
        word_entries = []
        for word_text in line_text.split():
            target = _normalize(word_text)
            matched = -1
            if target:
                limit = min(ai + LOOKAHEAD, len(aligned))
                for k in range(ai, limit):
                    if aligned[k]["norm"] == target:
                        matched = k
                        break

            if matched >= 0:
                a = aligned[matched]
                ai = matched + 1
                if a["start"] is not None and a["end"] is not None:
                    entry = {
                        "word": word_text,
                        "start": round(a["start"], 3),
                        "end": round(a["end"], 3),
                    }
                    if a["score"] is not None:
                        entry["score"] = round(a["score"], 3)
                else:
                    entry = {"word": word_text, "start": None, "end": None, "estimated": True}
                    interpolated_drops += 1
            else:
                entry = {"word": word_text, "start": None, "end": None, "estimated": True}
                missed_lyric_words += 1
            word_entries.append(entry)

        _interpolate_missing(word_entries)

        valid_words = [e for e in word_entries if e["start"] is not None]
        if not valid_words:
            continue

        seg_start = valid_words[0]["start"]
        seg_end = valid_words[-1]["end"]
        if seg_end < seg_start:
            seg_end = seg_start

        segments.append({
            "text": line_text,
            "start": seg_start,
            "end": seg_end,
            "words": valid_words,
        })

    for i in range(1, len(segments)):
        prev = segments[i - 1]
        cur = segments[i]
        if cur["start"] < prev["end"]:
            cur["start"] = prev["end"]
            if cur["end"] < cur["start"]:
                cur["end"] = cur["start"]

    total_words = sum(len(s["words"]) for s in segments)
    print(
        f"[nightingale:LOG] Lyrics alignment: {len(segments)} lines preserved, "
        f"{total_words} words ({interpolated_drops} interpolated from NaN, "
        f"{missed_lyric_words} unmatched lyric words)",
        flush=True,
    )

    return _split_long_segments(segments, joiner=" ")


def _interpolate_missing(word_entries: list[dict]):
    """Fill in timestamps for words the aligner couldn't place, using neighbors."""
    unset = [i for i, e in enumerate(word_entries) if e["start"] is None]
    set_entries = [e for e in word_entries if e["start"] is not None]

    if not unset or not set_entries:
        return

    for ui in unset:
        prev_end = set_entries[0]["start"]
        next_start = set_entries[-1]["end"]
        for j in range(ui - 1, -1, -1):
            if word_entries[j]["start"] is not None:
                prev_end = word_entries[j]["end"]
                break
        for j in range(ui + 1, len(word_entries)):
            if word_entries[j]["start"] is not None:
                next_start = word_entries[j]["start"]
                break
        mid = (prev_end + next_start) / 2
        word_entries[ui]["start"] = round(prev_end, 3)
        word_entries[ui]["end"] = round(mid, 3)
