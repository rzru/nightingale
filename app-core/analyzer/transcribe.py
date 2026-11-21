"""WhisperX / Parakeet transcription: full-audio transcription of vocals with forced alignment."""

import re

import cjk
from audio import ALIGNMENT_SAMPLE_RATE, detect_vocal_region, highpass_filter, normalize_rms
from gpu import gpu_model, hard_free_gpu
from hallucination import is_hallucination, remove_hallucinated_words
from language import detect_language_multiwindow
from whisper_compat import progress, align_with_fallback, get_align_backend, load_whisper_model


def transcribe_vocals(
    vocals_path: str,
    original_audio_path: str,
    device: str,
    model_name: str = "large-v3",
    beam_size: int = 5,
    batch_size: int = 16,
    engine: str = "whisper",
    language_override: str | None = None,
    whisper_model=None,
    pre_align_cleanup=None,
) -> dict:
    """Transcribe vocals to get word-level timestamps.

    With Whisper: transcription gives sentence-level segments which are then
    refined with wav2vec2 forced alignment for word-level timestamps.

    With Parakeet: the model emits word-level timestamps natively, so the
    wav2vec2 alignment step is skipped and segments are built directly from
    Parakeet's words. The Whisper fallback path (unsupported language) still
    goes through forced alignment.
    """
    import whisperx

    from whisper_compat import compute_type_for
    compute_type = compute_type_for(device)
    if device == "mps":
        device = "cpu"

    progress(55, f"Loading audio ({vocals_path})...")
    full_audio = whisperx.load_audio(vocals_path)
    duration_secs = len(full_audio) / ALIGNMENT_SAMPLE_RATE
    print(f"[nightingale:LOG] Audio loaded: {len(full_audio)} samples ({duration_secs:.1f}s) from {vocals_path}", flush=True)

    progress(56, "Detecting vocal region...")
    vocal_start, vocal_end = detect_vocal_region(full_audio)
    trim_start_samples = int(vocal_start * ALIGNMENT_SAMPLE_RATE)
    trim_end_samples = int(vocal_end * ALIGNMENT_SAMPLE_RATE)
    audio = full_audio[trim_start_samples:trim_end_samples]
    trimmed_duration = len(audio) / ALIGNMENT_SAMPLE_RATE
    print(f"[nightingale:LOG] Trimmed to vocal region: {vocal_start:.1f}s-{vocal_end:.1f}s ({trimmed_duration:.1f}s)", flush=True)

    audio = highpass_filter(audio)
    audio = normalize_rms(audio)
    print(f"[nightingale:LOG] Settings: engine={engine}, model={model_name}, beam_size={beam_size}, batch_size={batch_size}", flush=True)

    if engine == "parakeet":
        payload, language, engine_used = _transcribe_parakeet_or_fallback(
            vocals_path=vocals_path,
            audio=audio,
            full_audio=full_audio,
            vocal_start=vocal_start,
            device=device,
            compute_type=compute_type,
            model_name=model_name,
            beam_size=beam_size,
            batch_size=batch_size,
            language_override=language_override,
            whisper_model=whisper_model,
            pre_align_cleanup=pre_align_cleanup,
        )
        if engine_used in ("parakeet", "onnx-cpu-fallback"):
            return _build_result_from_words(payload, language, duration_secs, engine_used)

        raw_segments = payload
    else:
        raw_segments, language = _transcribe_whisper(
            audio=audio,
            full_audio=full_audio,
            vocal_start=vocal_start,
            device=device,
            compute_type=compute_type,
            model_name=model_name,
            beam_size=beam_size,
            batch_size=batch_size,
            language_override=language_override,
            whisper_model=whisper_model,
        )
        engine_used = "whisper"

    return _build_result_from_raw_segments(
        raw_segments, full_audio, language, duration_secs, device, pre_align_cleanup, engine_used,
    )


def _build_result_from_raw_segments(
    raw_segments, full_audio, language, duration_secs, device, pre_align_cleanup, engine_used,
) -> dict:
    """Whisper path: filter hallucinations, run wav2vec2 forced alignment, build segments."""
    total_raw_words = sum(len(s.get("text", "").split()) for s in raw_segments)
    print(f"[nightingale:LOG] Transcription ({engine_used}): language='{language}', segments={len(raw_segments)}, ~{total_raw_words} words", flush=True)

    for i, seg in enumerate(raw_segments):
        duration = seg.get("end", 0) - seg.get("start", 0)
        words = len(seg.get("text", "").split())
        wps = words / duration if duration > 0 else 0
        print(f"[nightingale:LOG] Seg {i}: [{seg.get('start',0):.1f}-{seg.get('end',0):.1f}] ({duration:.1f}s, {words}w, {wps:.1f}w/s) {seg.get('text','')[:80]}", flush=True)

    raw_segments = _filter_hallucinations(raw_segments, duration_secs)

    progress(75, f"Language: {language}")
    if not raw_segments:
        progress(90, f"No speech found, lang={language}")
        return {"language": language, "segments": [], "source": "generated"}

    result = _align_and_build(raw_segments, full_audio, language, device, pre_align_cleanup)
    result["source"] = "generated"
    return result


def _build_result_from_words(
    words: list[dict], language: str, duration_secs: float, engine_used: str,
) -> dict:
    """Parakeet path: skip wav2vec2 alignment, build segments straight from word timestamps."""
    print(f"[nightingale:LOG] Transcription ({engine_used}): language='{language}', words={len(words)}", flush=True)

    if words:
        covered = words[-1]["end"] - words[0]["start"]
        pct = (covered / duration_secs * 100) if duration_secs else 0
        print(f"[nightingale:LOG] Coverage: {covered:.1f}s / {duration_secs:.1f}s ({pct:.0f}%)", flush=True)

    progress(75, f"Language: {language}")
    progress(80, "Building segments from Parakeet word timestamps...")
    cleaned = remove_hallucinated_words(words)
    segments = _build_segments(cleaned)
    progress(90, f"Transcription complete: {len(segments)} segments, lang={language}")

    if segments:
        print(f"[nightingale:LOG] First segment: '{segments[0]['text'][:100]}'", flush=True)
        if segments[0].get("words"):
            print(f"[nightingale:LOG] First word: '{segments[0]['words'][0]}'", flush=True)
        print(f"[nightingale:LOG] Last segment: '{segments[-1]['text'][:100]}'", flush=True)

    return {"language": language, "segments": segments, "source": "generated"}


def _whisper_asr_options(beam_size: int) -> tuple[dict, dict]:
    """Returns (asr_options, no_vad_asr) used by the WhisperX path."""
    asr_options = {
        "beam_size": beam_size,
        "initial_prompt": (
            "Everything before and including GO is INSTRUCTIONS. DON'T INCLUDE IN TRANSCRIPT. "
            "Song Lyrics transcript. Split lines with punctuation. "
            "No annotations or descriptions. "
            "GO"
        ),
    }
    no_vad_asr = {
        "beam_size": beam_size,
        "initial_prompt": asr_options["initial_prompt"],
        "temperatures": [0],
        "condition_on_previous_text": False,
        "compression_ratio_threshold": 10,
        "log_prob_threshold": -10.0,
        "no_speech_threshold": 0.0,
        "repetition_penalty": 1,
        "no_repeat_ngram_size": 0,
        "suppress_blank": False,
    }
    return asr_options, no_vad_asr


def _transcribe_whisper(
    *, audio, full_audio, vocal_start, device, compute_type,
    model_name, beam_size, batch_size,
    language_override, whisper_model=None,
) -> tuple[list[dict], str]:
    import whisperx

    _, no_vad_asr = _whisper_asr_options(beam_size)

    with gpu_model(f"whisper:{model_name}") as held:
        if language_override:
            language = language_override
            print(f"[nightingale:LOG] Using language override: '{language}'", flush=True)
            progress(59, f"Language override: {language}")
            model = load_whisper_model(
                model_name, device, compute_type,
                task="transcribe", language=language,
                asr_options=no_vad_asr,
            )
            held.append(model)
        else:
            progress(58, "Detecting language from vocals (multi-window)...")
            model = load_whisper_model(
                model_name, device, compute_type,
                task="transcribe", asr_options=no_vad_asr,
            )
            held.append(model)
            language = detect_language_multiwindow(model, full_audio)
            print(f"[nightingale:LOG] Final detected language: '{language}'", flush=True)
            progress(59, f"Detected language: {language}")

        print(f"[nightingale:LOG] Model ready for lang={language}", flush=True)

        progress(60, "Transcribing vocals...")
        result = model.transcribe(
            audio,
            batch_size=batch_size,
            task="transcribe",
            language=language,
            chunk_size=30,
        )

    raw_segments = result.get("segments", [])
    for seg in raw_segments:
        seg["start"] = round(seg.get("start", 0) + vocal_start, 3)
        seg["end"] = round(seg.get("end", 0) + vocal_start, 3)

    return raw_segments, language


def _transcribe_parakeet_or_fallback(
    *, vocals_path, audio, full_audio, vocal_start, device, compute_type,
    model_name, beam_size, batch_size,
    language_override, pre_align_cleanup, whisper_model=None,
) -> tuple[list[dict], str, str]:
    import whisperx
    import parakeet

    if language_override:
        language = language_override
        print(f"[nightingale:LOG] Using language override: '{language}'", flush=True)
        progress(59, f"Language override: {language}")
    else:
        progress(58, "Detecting language with whisper-tiny...")
        if pre_align_cleanup:
            pre_align_cleanup()
        with gpu_model("whisper-tiny:lang_detect") as held:
            tiny = load_whisper_model(
                "tiny", device, compute_type, task="transcribe",
            )
            held.append(tiny)
            language = detect_language_multiwindow(tiny, full_audio)
        print(f"[nightingale:LOG] Final detected language: '{language}'", flush=True)
        progress(59, f"Detected language: {language}")

    if not parakeet.is_supported(language):
        print(
            f"[nightingale:LOG] Language '{language}' not in Parakeet's supported set; falling back to Whisper",
            flush=True,
        )
        hard_free_gpu("parakeet_unsupported_lang")
        raw_segments, language = _transcribe_whisper(
            audio=audio, full_audio=full_audio, vocal_start=vocal_start,
            device=device, compute_type=compute_type,
            model_name=model_name, beam_size=beam_size, batch_size=batch_size,
            language_override=language,
        )
        return raw_segments, language, "whisper-fallback"

    try:
        words, backend = parakeet.transcribe(
            vocals_path=vocals_path,
            device=device,
            language=language,
            batch_size=batch_size,
            pre_load_cleanup=pre_align_cleanup,
        )
    except parakeet.ParakeetEmptyOutputError as e:
        print(
            f"[nightingale:LOG] {e}; falling back to Whisper for this song",
            flush=True,
        )
        hard_free_gpu("parakeet_empty_output")
        raw_segments, language = _transcribe_whisper(
            audio=audio, full_audio=full_audio, vocal_start=vocal_start,
            device=device, compute_type=compute_type,
            model_name=model_name, beam_size=beam_size, batch_size=batch_size,
            language_override=language,
        )
        return raw_segments, language, "whisper-fallback"

    engine_used = "onnx-cpu-fallback" if backend == "onnx-cpu-fallback" else "parakeet"
    return words, language, engine_used


def _filter_hallucinations(raw_segments: list[dict], duration_secs: float) -> list[dict]:
    """Remove hallucinated segments and log coverage."""
    good_segments = []
    hallucinated = []
    for seg in raw_segments:
        if is_hallucination(seg):
            hallucinated.append(seg)
        else:
            good_segments.append(seg)

    if hallucinated:
        for seg in hallucinated:
            dur = seg.get("end", 0) - seg.get("start", 0)
            print(f"[nightingale:LOG] Discarded hallucination [{seg.get('start',0):.1f}-{seg.get('end',0):.1f}] ({dur:.1f}s): {seg.get('text','')[:80]}", flush=True)
        print(f"[nightingale:LOG] Kept {len(good_segments)} segments, discarded {len(hallucinated)} hallucinations", flush=True)

    covered = sum(s.get("end", 0) - s.get("start", 0) for s in good_segments)
    print(f"[nightingale:LOG] Coverage: {covered:.1f}s / {duration_secs:.1f}s ({covered/duration_secs*100:.0f}%)", flush=True)

    return good_segments


def _align_and_build(raw_segments: list[dict], audio, language: str, device: str, pre_align_cleanup=None) -> dict:
    """Run forced alignment, interpolate unaligned words, and build final segments."""
    align_device = "cpu" if device == "mps" else device
    is_cjk = cjk.is_cjk(language)

    import qwen_align
    if get_align_backend() == "qwen" and qwen_align.is_supported(language):
        qwen_result = _align_and_build_qwen(raw_segments, audio, language, pre_align_cleanup)
        if qwen_result is not None:
            return qwen_result
        print(
            "[nightingale:LOG] Qwen alignment unavailable; falling back to wav2vec2 path",
            flush=True,
        )

    if is_cjk:
        cleaned: list[dict] = []
        for seg in raw_segments:
            orig = seg.get("text", "")
            stripped = cjk.to_alignment_text(orig, language)
            if not stripped:
                continue
            seg = dict(seg)
            seg["_orig_text"] = orig
            seg["text"] = stripped
            cleaned.append(seg)
        raw_segments = cleaned
        print(
            f"[nightingale:LOG] CJK pre-clean: {len(raw_segments)} segments after dropping punct-only "
            f"(lang={language}, model={cjk.align_model_for(language) or 'default'})",
            flush=True,
        )

    total_input_words = sum(len(s.get("text", "").split()) for s in raw_segments)
    print(f"[nightingale:LOG] Pre-alignment: {len(raw_segments)} segments, {total_input_words} words total", flush=True)

    progress(80, f"Aligning word timestamps (lang={language})...")
    result = align_with_fallback(
        raw_segments, audio, cjk.align_lang_code(language), align_device, pre_align_cleanup,
        model_name=cjk.align_model_for(language),
    )

    output_segments = result.get("segments", [])
    total_output_words = sum(len(s.get("words", [])) for s in output_segments)
    print(f"[nightingale:LOG] Post-alignment: {len(output_segments)} segments, {total_output_words} words total", flush=True)

    if is_cjk:
        all_words = _retokenize_cjk(raw_segments, output_segments, language)
    else:
        _recover_dropped_words(raw_segments, output_segments)
        all_words = _interpolate_words(output_segments)
        all_words = remove_hallucinated_words(all_words)
        if cjk.is_korean(language):
            cjk.attach_reading(all_words, language)

    segments = _build_segments(all_words, is_cjk=is_cjk)

    progress(90, f"Transcription complete: {len(segments)} segments, lang={language}")
    if segments:
        print(f"[nightingale:LOG] First segment: '{segments[0]['text'][:100]}'", flush=True)
        if segments[0].get("words"):
            print(f"[nightingale:LOG] First word: '{segments[0]['words'][0]}'", flush=True)
        print(f"[nightingale:LOG] Last segment: '{segments[-1]['text'][:100]}'", flush=True)

    return {"language": language, "segments": segments}


def _align_and_build_qwen(raw_segments: list[dict], audio, language: str, pre_align_cleanup=None) -> dict | None:
    """Align with Qwen3-ForcedAligner and build segments.

    Qwen tokenizes the display text itself (dropping punctuation) and returns a
    timed unit per token, so this skips the wav2vec2 word-recovery /
    interpolation / CJK-retokenize steps: it attaches romanized readings for
    CJK/Korean within each original segment, flattens the timed tokens, and
    groups them into display segments.
    Returns ``None`` on any qwen failure so the caller falls back to wav2vec2.
    """
    import qwen_align

    progress(80, f"Aligning word timestamps with Qwen (lang={language})...")
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

    all_words: list[dict] = []
    for seg in result.get("segments", []):
        seg_words: list[dict] = []
        for w in seg.get("words", []):
            word_text = w.get("word", "").strip()
            if not word_text or w.get("start") is None or w.get("end") is None:
                continue
            seg_words.append({"word": word_text, "start": w["start"], "end": w["end"]})
        # Readings come from the original segment's own text, before the
        # timing-based regrouping below can merge or split source lines.
        if seg_words and cjk.is_supported_lang(language):
            cjk.attach_reading(seg_words, language, line=seg.get("text") or None)
        all_words.extend(seg_words)

    if not all_words:
        return None

    all_words = remove_hallucinated_words(all_words)
    segments = _build_segments(all_words, is_cjk=cjk.is_cjk(language))
    progress(90, f"Transcription complete: {len(segments)} segments, lang={language}")
    if segments:
        print(f"[nightingale:LOG] First segment: '{segments[0]['text'][:100]}'", flush=True)
        if segments[0].get("words"):
            print(f"[nightingale:LOG] First word: '{segments[0]['words'][0]}'", flush=True)
        print(f"[nightingale:LOG] Last segment: '{segments[-1]['text'][:100]}'", flush=True)

    return {"language": language, "segments": segments}


def _retokenize_cjk(raw_segments: list[dict], aligned_segments: list[dict], language: str) -> list[dict]:
    """Replace per-character CJK alignment output with fugashi/jieba tokens.

    Each raw segment's original (punctuated) text is re-tokenized into words,
    and the aligned char stream for that segment is mapped onto the tokens.
    Punctuation is folded into adjacent tokens via ``cjk.merge_punct`` and a
    romaji/pinyin reading is attached to each displayable token.
    """
    if len(raw_segments) != len(aligned_segments):
        print(
            f"[nightingale:LOG] CJK retokenize: segment count mismatch "
            f"(raw={len(raw_segments)}, aligned={len(aligned_segments)})",
            flush=True,
        )

    pairs = list(zip(raw_segments, aligned_segments))
    all_words: list[dict] = []
    total_chars = 0
    total_tokens = 0

    for raw_seg, aligned_seg in pairs:
        original = raw_seg.get("_orig_text", raw_seg.get("text", ""))
        if not original:
            continue

        char_entries: list[dict] = []
        for w in aligned_seg.get("words", []):
            word_text = w.get("word", "").strip()
            if not word_text:
                continue
            char_entries.append({
                "word": word_text,
                "start": w.get("start"),
                "end": w.get("end"),
                "score": w.get("score"),
            })

        token_pairs = cjk.tokenize_for_alignment(original, language)
        if not token_pairs:
            continue
        surfaces = [s for s, _ in token_pairs]
        lengths = [len(r) for _, r in token_pairs]

        seg_start = aligned_seg.get("start", raw_seg.get("start", 0.0))
        seg_end = aligned_seg.get("end", raw_seg.get("end", seg_start + 0.1))

        entries = cjk.attribute_chars_to_tokens(
            surfaces, char_entries,
            fallback_start=seg_start,
            fallback_end=seg_end,
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

        cjk.attach_reading(valid, language, line=original)

        total_chars += len(char_entries)
        total_tokens += len(valid)
        all_words.extend(valid)

    print(
        f"[nightingale:LOG] CJK retokenize: {total_chars} aligned chars -> {total_tokens} tokens",
        flush=True,
    )
    return all_words


def _normalize(word: str) -> str:
    return re.sub(r"[^\w]", "", word).lower()


def _recover_dropped_words(raw_segments: list[dict], aligned_segments: list[dict]):
    """Compare input vs aligned output and re-inject words the aligner silently dropped."""
    if len(raw_segments) != len(aligned_segments):
        print(
            f"[nightingale:LOG] Segment count mismatch (raw={len(raw_segments)}, "
            f"aligned={len(aligned_segments)}), skipping word recovery",
            flush=True,
        )
        return

    total_recovered = 0

    for raw_seg, aligned_seg in zip(raw_segments, aligned_segments):
        raw_text = raw_seg.get("text", "")
        raw_words = raw_text.split()
        aligned_words: list[dict] = aligned_seg.get("words", [])

        if not raw_words:
            continue

        aligned_norms = [_normalize(w.get("word", "")) for w in aligned_words]

        matched_raw: set[int] = set()
        matched_aligned: set[int] = set()
        ai = 0
        for ri, rw in enumerate(raw_words):
            rn = _normalize(rw)
            if not rn:
                matched_raw.add(ri)
                continue
            for si in range(ai, min(ai + 8, len(aligned_norms))):
                if si not in matched_aligned and aligned_norms[si] == rn:
                    matched_raw.add(ri)
                    matched_aligned.add(si)
                    ai = si + 1
                    break

        missing_indices = [i for i in range(len(raw_words)) if i not in matched_raw]
        if not missing_indices:
            continue

        seg_start = aligned_seg.get("start", raw_seg.get("start", 0))
        seg_end = aligned_seg.get("end", raw_seg.get("end", 0))
        missing_text = " ".join(raw_words[i] for i in missing_indices)
        print(
            f"[nightingale:LOG] Recovering {len(missing_indices)} dropped words in segment "
            f"[{seg_start:.1f}-{seg_end:.1f}]: {missing_text}",
            flush=True,
        )

        for orig_idx in reversed(missing_indices):
            insert_pos = len(aligned_words)
            for check_ri in range(orig_idx + 1, len(raw_words)):
                check_norm = _normalize(raw_words[check_ri])
                for ai_pos, an in enumerate(aligned_norms):
                    if an == check_norm:
                        insert_pos = ai_pos
                        break
                if insert_pos < len(aligned_words):
                    break

            recovered = {"word": raw_words[orig_idx]}
            aligned_words.insert(insert_pos, recovered)
            aligned_norms.insert(insert_pos, _normalize(raw_words[orig_idx]))
            total_recovered += 1

        aligned_seg["words"] = aligned_words

    if total_recovered > 0:
        print(f"[nightingale:LOG] Total recovered words: {total_recovered}", flush=True)


def _interpolate_words(output_segments: list[dict]) -> list[dict]:
    """Extract all words from aligned segments, interpolating missing timestamps."""
    all_words = []
    total_aligned = 0
    total_interpolated = 0

    for seg in output_segments:
        raw_words = seg.get("words", [])
        if not raw_words:
            continue

        seg_start = seg.get("start", 0)
        seg_end = seg.get("end", 0)

        entries = []
        for w in raw_words:
            word_text = w.get("word", "").strip()
            if not word_text:
                continue
            has_ts = "start" in w and "end" in w
            entries.append({
                "word": word_text,
                "start": w.get("start"),
                "end": w.get("end"),
                "score": w.get("score"),
                "aligned": has_ts,
            })

        if not entries:
            continue

        anchors = [(i, e) for i, e in enumerate(entries) if e["aligned"]]

        if not anchors:
            n = len(entries)
            dur = (seg_end - seg_start) / n if seg_end > seg_start else 0.1
            for j, e in enumerate(entries):
                e["start"] = seg_start + j * dur
                e["end"] = seg_start + (j + 1) * dur
        else:
            first_idx = anchors[0][0]
            if first_idx > 0:
                _fill_range(entries, 0, first_idx, seg_start, entries[first_idx]["start"])

            for ai in range(len(anchors) - 1):
                a_idx = anchors[ai][0]
                b_idx = anchors[ai + 1][0]
                if b_idx - a_idx > 1:
                    _fill_range(entries, a_idx + 1, b_idx, entries[a_idx]["end"], entries[b_idx]["start"])

            last_idx = anchors[-1][0]
            if last_idx < len(entries) - 1:
                _fill_range(entries, last_idx + 1, len(entries), entries[last_idx]["end"], seg_end)

        seg_interpolated = sum(1 for e in entries if not e["aligned"])
        total_aligned += len(entries) - seg_interpolated
        total_interpolated += seg_interpolated

        if seg_interpolated > 0:
            print(f"[nightingale:LOG] Interpolated {seg_interpolated}/{len(entries)} words in segment [{seg_start:.1f}-{seg_end:.1f}]", flush=True)

        for e in entries:
            if e["start"] is None or e["end"] is None:
                print(f"[nightingale:LOG] WARNING: Dropping word with no timestamps: '{e['word']}'", flush=True)
                continue
            word_entry = {
                "word": e["word"],
                "start": round(e["start"], 3),
                "end": round(e["end"], 3),
            }
            if e.get("score") is not None:
                word_entry["score"] = round(e["score"], 3)
            if not e["aligned"]:
                word_entry["estimated"] = True
            all_words.append(word_entry)

    print(f"[nightingale:LOG] Word stats: {total_aligned} aligned, {total_interpolated} interpolated, {len(all_words)} total", flush=True)
    return all_words


def _fill_range(entries, start_idx, end_idx, gap_start, gap_end):
    """Evenly distribute timestamps across a range of unaligned words."""
    n = end_idx - start_idx
    if n <= 0:
        return
    if gap_end > gap_start:
        d = (gap_end - gap_start) / n
        for j in range(n):
            entries[start_idx + j]["start"] = gap_start + j * d
            entries[start_idx + j]["end"] = gap_start + (j + 1) * d
    else:
        for j in range(n):
            entries[start_idx + j]["start"] = gap_start
            entries[start_idx + j]["end"] = gap_start + 0.1


_CJK_SENTENCE_ENDERS = ("。", "！", "？", "、", "．", "，")


def _build_segments(all_words: list[dict], is_cjk: bool = False) -> list[dict]:
    """Group words into display segments based on time gaps and punctuation."""
    MAX_WORD_GAP = 3.0
    MIN_SENTENCE_GAP = 0.05
    MIN_WORDS_PER_LINE = 3
    joiner = "" if is_cjk else " "

    def _flush(words):
        return {
            "text": joiner.join(wd["word"] for wd in words),
            "start": words[0]["start"],
            "end": words[-1]["end"],
            "words": words,
        }

    sentence_enders = _CJK_SENTENCE_ENDERS if is_cjk else (".", "!", "?", ",")

    segments = []
    current_words = []
    for w in all_words:
        if current_words:
            gap = w["start"] - current_words[-1]["end"]
            last_text = current_words[-1]["word"]
            next_text = w["word"]
            punctuation_end = last_text.rstrip().endswith(sentence_enders)
            capital_start = True if is_cjk else next_text[:1].isupper()
            long_enough = len(current_words) >= MIN_WORDS_PER_LINE

            if gap > MAX_WORD_GAP:
                segments.append(_flush(current_words))
                current_words = []
            elif long_enough and gap >= MIN_SENTENCE_GAP and punctuation_end and capital_start:
                segments.append(_flush(current_words))
                current_words = []
        current_words.append(w)

    if current_words:
        segments.append(_flush(current_words))

    merged = True
    while merged:
        merged = False
        i = 0
        while i < len(segments):
            if len(segments[i]["words"]) < MIN_WORDS_PER_LINE and len(segments) > 1:
                if i == 0:
                    neighbor = i + 1
                elif i == len(segments) - 1:
                    neighbor = i - 1
                else:
                    gap_before = segments[i]["start"] - segments[i - 1]["end"]
                    gap_after = segments[i + 1]["start"] - segments[i]["end"]
                    neighbor = i - 1 if gap_before <= gap_after else i + 1
                if neighbor < i:
                    segments[neighbor] = _flush(segments[neighbor]["words"] + segments[i]["words"])
                    segments.pop(i)
                else:
                    segments[neighbor] = _flush(segments[i]["words"] + segments[neighbor]["words"])
                    segments.pop(i)
                merged = True
            else:
                i += 1

    for seg in segments:
        print(f"[nightingale:LOG] Segment [{seg['start']:.1f}-{seg['end']:.1f}]: {seg['text'][:80]}", flush=True)

    MAX_WORDS_PER_LINE = 10
    MIN_SPLIT_SIZE = 4
    split_segments = []
    for seg in segments:
        words = seg["words"]
        if len(words) <= MAX_WORDS_PER_LINE:
            split_segments.append(seg)
            continue
        remaining = words
        while len(remaining) > MAX_WORDS_PER_LINE:
            search_end = min(len(remaining), MAX_WORDS_PER_LINE + MIN_SPLIT_SIZE)
            best_gap = -1.0
            best_idx = search_end // 2
            for j in range(MIN_SPLIT_SIZE, search_end):
                gap = remaining[j]["start"] - remaining[j - 1]["end"]
                if gap > best_gap:
                    best_gap = gap
                    best_idx = j
            split_segments.append(_flush(remaining[:best_idx]))
            remaining = remaining[best_idx:]
        if remaining:
            split_segments.append(_flush(remaining))

    if len(split_segments) != len(segments):
        print(f"[nightingale:LOG] Split long lines: {len(segments)} -> {len(split_segments)} segments (max {MAX_WORDS_PER_LINE} words/line)", flush=True)

    return split_segments
