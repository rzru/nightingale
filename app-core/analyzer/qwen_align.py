"""Forced alignment via Qwen3-ForcedAligner-0.6B.

An alternative to the wav2vec2 (whisperx / ctc) alignment backends. Instead of
CTC frame alignment against a phonetic transcript, this uses Qwen's
non-autoregressive token-classification aligner: given ``(audio, transcript,
language)`` it predicts a start/end timestamp for every token in a single
forward pass (``transformers`` ``Qwen3ASRForTokenClassification``).

Key differences from the wav2vec2 path that shape this module:

- The processor tokenizes the *display* text itself -- Japanese via ``nagisa``,
  Korean via ``soynlp``, Chinese per-CJK-character, space-delimited words
  otherwise -- and drops punctuation. So the returned units are already the
  surfaces we want to show; there is no hiragana/phonetic step and no
  per-character reattribution. Callers only need to attach romanized readings.
- It aligns against whatever audio it is given, up to ~5 minutes. We align each
  input segment against its own audio slice so long songs stay under that cap;
  a single over-long segment (e.g. a whole-song lyrics pass) raises
  :class:`QwenUnsupportedError` so callers fall back to wav2vec2.

The output mirrors whisperx: ``{"segments": [{text,start,end,words:[{word,
start,end}]}], "word_segments": [...]}``.
"""

import os

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np
import torch

from audio import ALIGNMENT_SAMPLE_RATE
from gpu import gpu_model
from whisper_compat import detect_device
QWEN_MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B-hf"

# Languages the forced aligner supports (transformers FORCED_ALIGNER_LANGUAGES).
SUPPORTED_LANGS = frozenset(
    {"en", "zh", "yue", "fr", "de", "it", "ja", "ko", "pt", "ru", "es"}
)

# Model tops out at ~5 min of audio (80ms x 3750 timestamp classes = 300s); keep
# a margin so boundary padding never pushes a slice over the edge.
MAX_SEGMENT_SECONDS = 285.0

# Small pad around each segment slice so the aligner sees the leading/trailing
# phonemes that whisper's segment bounds may clip.
SLICE_PAD_SECONDS = 0.2

# Bound peak memory: align at most this many segments per forward pass.
INFERENCE_BATCH = 8

_MIN_SAMPLES = 400


class QwenUnsupportedError(Exception):
    """Raised when the qwen aligner cannot handle the request (unsupported
    language, or audio longer than the model's context window). Callers should
    fall back to the wav2vec2 alignment path."""


def is_supported(language: str) -> bool:
    return language in SUPPORTED_LANGS


def _pick_dtype(device: str):
    return torch.bfloat16 if device == "cuda" else torch.float32


def qwen_align(raw_segments, audio, language: str, device: str) -> dict:
    """Align ``raw_segments`` to ``audio`` with Qwen3-ForcedAligner.

    ``audio`` is a 16kHz mono waveform (numpy array or 1-D tensor). Each segment
    in ``raw_segments`` (``{"text", "start", "end"}``) is aligned against its own
    slice of ``audio`` and its token timestamps are offset back into absolute
    time. Returns a whisperx-shaped dict; OOM errors propagate so the caller can
    retry on CPU, and :class:`QwenUnsupportedError` signals a wav2vec2 fallback.
    """
    if language not in SUPPORTED_LANGS:
        raise QwenUnsupportedError(f"language '{language}' not supported by qwen aligner")

    if torch.is_tensor(audio):
        audio_np = audio.detach().cpu().numpy()
    else:
        audio_np = np.asarray(audio)
    audio_np = np.ascontiguousarray(audio_np, dtype=np.float32)
    total_seconds = len(audio_np) / ALIGNMENT_SAMPLE_RATE

    # Prepare per-segment slices; None marks empty/too-short segments we skip.
    prepared: list[dict | None] = []
    for seg in raw_segments:
        text = (seg.get("text") or "").strip()
        if not text:
            prepared.append(None)
            continue

        start = max(0.0, float(seg.get("start", 0.0)) - SLICE_PAD_SECONDS)
        end = min(total_seconds, float(seg.get("end", total_seconds)) + SLICE_PAD_SECONDS)
        if end <= start:
            prepared.append(None)
            continue
        if end - start > MAX_SEGMENT_SECONDS:
            raise QwenUnsupportedError(
                f"segment spans {end - start:.0f}s, exceeds qwen aligner cap "
                f"{MAX_SEGMENT_SECONDS:.0f}s"
            )

        f1 = int(start * ALIGNMENT_SAMPLE_RATE)
        f2 = int(end * ALIGNMENT_SAMPLE_RATE)
        arr = audio_np[f1:f2]
        if len(arr) < _MIN_SAMPLES:
            prepared.append(None)
            continue

        prepared.append({"arr": arr, "text": text, "offset": start})

    todo = [i for i, p in enumerate(prepared) if p is not None]
    results: list[list | None] = [None] * len(prepared)

    if todo:
        with gpu_model(f"qwen-aligner:{device}") as held:
            from transformers import AutoModelForTokenClassification, AutoProcessor

            dtype = _pick_dtype(device)
            print(
                f"[nightingale:LOG] Loading Qwen forced aligner on {device} ({dtype})",
                flush=True,
            )
            processor = AutoProcessor.from_pretrained(QWEN_MODEL_ID)
            model = AutoModelForTokenClassification.from_pretrained(QWEN_MODEL_ID, dtype=dtype)
            model = model.to(device)
            model.eval()
            held.append(model)

            ts_token_id = model.config.timestamp_token_id

            for b in range(0, len(todo), INFERENCE_BATCH):
                chunk = todo[b:b + INFERENCE_BATCH]
                audios = [prepared[i]["arr"] for i in chunk]
                texts = [prepared[i]["text"] for i in chunk]

                inputs, word_lists = processor.prepare_forced_aligner_inputs(
                    audio=audios, transcript=texts, language=language,
                )
                inputs = inputs.to(model.device, model.dtype)
                with torch.inference_mode():
                    outputs = model(**inputs)

                decoded = processor.decode_forced_alignment(
                    logits=outputs.logits,
                    input_ids=inputs["input_ids"],
                    word_lists=word_lists,
                    timestamp_token_id=ts_token_id,
                )
                for local, i in enumerate(chunk):
                    results[i] = decoded[local]

    aligned_segments = []
    word_segments: list[dict] = []
    total_tokens = 0
    for i, seg in enumerate(raw_segments):
        out_seg = {
            "text": seg.get("text", ""),
            "start": seg.get("start"),
            "end": seg.get("end"),
            "words": [],
        }
        prep = prepared[i]
        tokens = results[i]
        if prep is not None and tokens:
            offset = prep["offset"]
            words = []
            for tok in tokens:
                start = round(float(tok["start_time"]) + offset, 3)
                end = round(float(tok["end_time"]) + offset, 3)
                if end < start:
                    end = start
                words.append({"word": tok["text"], "start": start, "end": end})
            if words:
                out_seg["start"] = words[0]["start"]
                out_seg["end"] = words[-1]["end"]
            out_seg["words"] = words
            word_segments.extend(words)
            total_tokens += len(words)
        aligned_segments.append(out_seg)

    print(
        f"[nightingale:LOG] Qwen alignment: {len(todo)}/{len(prepared)} segments aligned, "
        f"{total_tokens} tokens (lang={language})",
        flush=True,
    )
    return {"segments": aligned_segments, "word_segments": word_segments}


def qwen_align_with_cpu_fallback(raw_segments, audio, language: str, pre_align_cleanup=None) -> dict:
    """Run :func:`qwen_align` on the best available device, retrying on CPU if the
    accelerator runs out of memory.

    Picks the device itself (cuda > mps > cpu): unlike the wav2vec2 backends, the
    transformers aligner runs on MPS, so Apple Silicon gets GPU acceleration
    instead of being forced onto CPU. Raises :class:`QwenUnsupportedError` (or the
    original error) for the caller to handle as a wav2vec2 fallback.
    """
    device = detect_device()
    try:
        return qwen_align(raw_segments, audio, language, device)
    except Exception as e:
        lower = str(e).lower()
        is_oom = "out of memory" in lower or "outofmemoryerror" in lower
        if device == "cpu" or not is_oom:
            raise
        print(
            f"[nightingale:LOG] Qwen alignment OOM on {device}, retrying on CPU",
            flush=True,
        )
        if pre_align_cleanup:
            try:
                pre_align_cleanup()
            except Exception:
                pass
        return qwen_align(raw_segments, audio, language, "cpu")
