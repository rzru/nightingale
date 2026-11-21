"""Pass-2 refinement for the two-pass English Wav2Vec2-BERT alignment backend.

Why two passes, and why pause-bounded chunks specifically:

Wav2Vec2-BERT's encoder has the same O(n^2) self-attention cost in sequence
length as any transformer. Running it on a whole song in one shot uses a larger memory bound.

Real pause-to-pause chunk lengths measured across a large analyzed library
average under 10s and are rarely above ~20s, comfortably inside a smaller window.

Skips the song if the MAX_CHUNK_SECS is larger than expected, we return and uses the first pass result.

The caller's pass-1 line boundaries are only trusted here for the coarse
"which lines are in this chunk" question. All precise timing comes from pass 2, which
aligns each chunk's full multi-line text freely against that chunk's audio span
"""

import statistics

from audio import detect_pause_chunks
from gpu import gpu_model
import wav2vec2_bert_align

# A maximum length of a chunk that would pass the bounds of regular memory usage
# Potentially can be adjusted based on available capacity
MAX_CHUNK_SECS = 30.0

# Below this median per-word CTC confidence, pass 2's placement is no more
# trustworthy than a guess rather than an improvement on pass 1.
MIN_MEDIAN_CONFIDENCE = 0.3


def _chunk_index_for(mid: float, chunks: list[tuple[float, float]]) -> int:
    for i, (start, end) in enumerate(chunks):
        if start <= mid < end:
            return i
    return len(chunks) - 1


def merge_with_pass1(pass1_segments: list[dict], pass2_segments: list[dict]) -> list[dict]:
    """Prefer each line's pass-2 (Wav2Vec2-BERT) timing, but fall back to
    pass 1 (WhisperX) wherever pass 2 produced no words, or produced words
    with median confidence below ``MIN_MEDIAN_CONFIDENCE``
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

    Returns the raw ``wav2vec2_bert_align`` result -- the caller re-maps it
    to lines via ``align.map_words_to_lines``
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
