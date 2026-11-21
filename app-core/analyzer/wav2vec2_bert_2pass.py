"""Pass-2 refinement for the two-pass English Wav2Vec2-BERT alignment backend.

Why two passes, and why pause-bounded chunks specifically:

Wav2Vec2-BERT's encoder has the same O(n^2) self-attention cost in sequence
length as any transformer. Running it on a whole song in one shot (the
single-pass ``wav2vec2_bert`` backend's approach) can and does exceed what
Apple Silicon's MPS allocator will hand back: measured directly on this
hardware, a 144s clip requested a 12.27GiB buffer and failed outright, a
100s clip raised ``MPS backend out of memory``, and even an 80s clip that
technically succeeded took 385s for one forward pass (vs 5.5s at 60s) --
the cost cliff is somewhere between 60s and 80s, not a gentle slope.

Real pause-to-pause chunk lengths measured across a large analyzed library
average under 10s and are rarely above ~20s, comfortably inside the safe
range -- but not every song has a pause: fast, continuous lyrics (e.g.
"One Week") can run 100+ seconds with no detected gap. ``MAX_CHUNK_SECS``
below is the line this module won't cross; if the longest chunk a song
produces exceeds it, ``refine_with_pauses`` returns ``None`` and the caller
(``align.py``) uses the first pass's result as final, rather than risk the
same failure the single-pass backend hit.

The caller's pass-1 line boundaries are only trusted here for the coarse
"which lines are in this chunk" question, not for precise word timing: a
small error there doesn't matter, because pause gaps are much larger than
pass 1's typical error margin. All precise timing comes from pass 2, which
aligns each chunk's full multi-line text freely against that chunk's full
audio span -- nothing from pass 1 constrains where inside the chunk a word
lands, only which chunk it's in.
"""

import statistics

from audio import detect_pause_chunks
from gpu import gpu_model
import wav2vec2_bert_align

# Comfortably under the measured 60s-safe/80s-catastrophic cliff described
# above; real pause-bounded chunks are almost always well under this already.
MAX_CHUNK_SECS = 30.0

# Below this median per-word CTC confidence, pass 2's placement is no more
# trustworthy than a guess rather than an improvement on pass 1. Confirmed
# directly on a real song: every occurrence of a short, shouted/rhythmic
# chorus line ("Let's rock, everybody, let's rock") scored a median of
# ~0.06-0.33 from this backend, consistently 0.5-2.0s *later* than pass 1's
# placement of the same words (median ~0.45-0.6) -- this acoustic model is
# fine-tuned on read speech (Common Voice), not singing, and simply doesn't
# represent short shouted/sung phrases well. Median, not mean: one lucky
# high-scoring word among otherwise-low ones can pull a line's average
# above a naive threshold while most of the line is still a bad guess.
MIN_MEDIAN_CONFIDENCE = 0.3


def _chunk_index_for(mid: float, chunks: list[tuple[float, float]]) -> int:
    for i, (start, end) in enumerate(chunks):
        if start <= mid < end:
            return i
    return len(chunks) - 1


def merge_with_pass1(pass1_segments: list[dict], pass2_segments: list[dict]) -> list[dict]:
    """Prefer each line's pass-2 (Wav2Vec2-BERT) timing, but fall back to
    pass 1 (WhisperX) wherever pass 2 produced no words, or produced words
    with median confidence below ``MIN_MEDIAN_CONFIDENCE`` -- a confidently-
    wrong placement is worse than pass 1's, not better, so "pass 2 produced
    something" alone isn't enough to trust it.
    """
    merged = []
    for p1, p2 in zip(pass1_segments, pass2_segments):
        scores = [w["score"] for w in p2["words"] if w.get("score") is not None]
        if scores and statistics.median(scores) >= MIN_MEDIAN_CONFIDENCE:
            merged.append(p2)
        else:
            merged.append(p1)
    return merged


def refine_with_pauses(
    pass1_segments: list[dict], audio, vocal_start: float, vocal_end: float, device: str,
) -> dict | None:
    """Try to refine ``pass1_segments`` with a Wav2Vec2-BERT pass per
    pause-bounded chunk.

    ``pass1_segments`` is the already pass-1-aligned (e.g. plain WhisperX)
    line list, one entry per lyric line, from ``align.map_words_to_lines``.

    Returns the raw ``wav2vec2_bert_align`` result -- the caller re-maps it
    to lines via ``align.map_words_to_lines``, same as any other backend --
    or ``None`` if the longest detected chunk exceeds ``MAX_CHUNK_SECS``,
    in which case the caller should use ``pass1_segments`` as-is.
    """
    chunks = detect_pause_chunks(audio, vocal_start, vocal_end)
    max_chunk = max(end - start for start, end in chunks)
    if max_chunk > MAX_CHUNK_SECS:
        print(
            f"[nightingale:LOG] wav2vec2-bert-2pass: longest pause-bounded "
            f"chunk is {max_chunk:.1f}s (> {MAX_CHUNK_SECS}s limit); skipping "
            f"pass 2, using pass 1 (whisperx) timing only",
            flush=True,
        )
        return None

    lines_by_chunk: list[list[str]] = [[] for _ in chunks]
    for seg in pass1_segments:
        mid = (seg["start"] + seg["end"]) / 2
        lines_by_chunk[_chunk_index_for(mid, chunks)].append(seg["text"])

    chunk_transcript = [
        {"text": " ".join(lines), "start": start, "end": end}
        for (start, end), lines in zip(chunks, lines_by_chunk)
        if lines
    ]

    print(
        f"[nightingale:LOG] wav2vec2-bert-2pass: refining {len(chunk_transcript)} "
        f"pause-bounded chunk(s) (max {max_chunk:.1f}s) with Wav2Vec2-BERT CTC "
        f"on {device}",
        flush=True,
    )
    with gpu_model(f"wav2vec2-bert-2pass:{device}") as held:
        model_state = wav2vec2_bert_align.load_model(device)
        held.append(model_state["model"])
        return wav2vec2_bert_align.wav2vec2_bert_align(chunk_transcript, model_state, audio, device)
