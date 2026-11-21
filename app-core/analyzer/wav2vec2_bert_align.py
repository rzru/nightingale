"""Forced alignment via an English Wav2Vec2-BERT CTC fine-tune
(``hf-audio/wav2vec2-bert-CV16-en``, loaded through Hugging Face
``transformers`` rather than torchaudio).

Alternative acoustic model to the default wav2vec2-base WhisperX/CTC path:
same per-segment ``transcript``/``audio``/``device`` call shape and
``{"segments": [...], "word_segments": [...]}`` output contract as
:func:`ctc_align.ctc_align`, so callers don't need to know which ran.
Reuses :func:`ctc_align.add_wildcard_column`
and :func:`ctc_align.forced_align_segment` for the actual forced-align step
-- only model loading and feature extraction differ, since Wav2Vec2-BERT
takes log-mel ``input_features`` (via its own processor) rather than the raw
waveform ``input_values`` whisperx's wav2vec2-base model and ``ctc_align``'s
"huggingface" branch expect.

``hf-audio/wav2vec2-bert-CV16-en`` is fine-tuned from the MIT-licensed
``facebook/w2v-bert-2.0`` encoder on Common Voice 16 (CC0) English speech
only; non-English transcripts aren't supported by this backend.
"""

import torch

from whisperx.audio import SAMPLE_RATE

import ctc_align

MODEL_ID = "hf-audio/wav2vec2-bert-CV16-en"


def load_model(device: str) -> dict:
    """Load the Wav2Vec2-BERT CTC model/processor for ``device``.

    Caller owns the returned model's GPU lifecycle (see ``gpu.gpu_model``).
    """
    from transformers import Wav2Vec2BertForCTC, Wav2Vec2BertProcessor

    processor = Wav2Vec2BertProcessor.from_pretrained(MODEL_ID)
    model = Wav2Vec2BertForCTC.from_pretrained(MODEL_ID).to(device)
    model.eval()
    vocab = processor.tokenizer.get_vocab()
    return {
        "model": model,
        "processor": processor,
        "vocab": vocab,
        "blank_id": processor.tokenizer.pad_token_id,
    }


def wav2vec2_bert_align(transcript, model_state: dict, audio, device: str) -> dict:
    """Align a known (English) transcript to audio using Wav2Vec2-BERT CTC.

    Returns ``{"segments": [...], "word_segments": [...]}`` where each
    segment carries a ``words`` list of
    ``{"word", "start"?, "end"?, "score"?}`` entries.
    """
    if not torch.is_tensor(audio):
        if isinstance(audio, str):
            from whisperx.audio import load_audio
            audio = load_audio(audio)
        audio = torch.from_numpy(audio)
    if len(audio.shape) == 1:
        audio = audio.unsqueeze(0)

    max_duration = audio.shape[1] / SAMPLE_RATE

    model = model_state["model"]
    processor = model_state["processor"]
    vocab = model_state["vocab"]
    blank_id = model_state["blank_id"]

    aligned_segments = []
    for segment in transcript:
        t1 = segment["start"]
        t2 = segment["end"]
        text = segment["text"]
        avg_logprob = segment.get("avg_logprob")

        aligned_seg = {"start": t1, "end": t2, "text": text, "words": []}
        if avg_logprob is not None:
            aligned_seg["avg_logprob"] = avg_logprob

        original_words = text.split()
        stripped = text.strip().lower()
        chars = ["|" if c == " " else c for c in stripped]
        if not original_words:
            print(
                f"[nightingale:LOG] wav2vec2-bert-align: empty segment text, "
                f"resorting to original",
                flush=True,
            )
            aligned_segments.append(aligned_seg)
            continue

        if t1 >= max_duration:
            print(
                f"[nightingale:LOG] wav2vec2-bert-align: segment start {t1:.1f}s "
                f"beyond audio duration {max_duration:.1f}s, skipping",
                flush=True,
            )
            aligned_segments.append(aligned_seg)
            continue

        f1 = int(t1 * SAMPLE_RATE)
        f2 = int(t2 * SAMPLE_RATE)
        waveform_segment = audio[:, f1:f2]
        if waveform_segment.shape[-1] < 400:
            waveform_segment = torch.nn.functional.pad(
                waveform_segment, (0, 400 - waveform_segment.shape[-1])
            )

        try:
            inputs = processor(
                waveform_segment.squeeze(0).cpu().numpy(),
                sampling_rate=SAMPLE_RATE,
                return_tensors="pt",
            )
            with torch.inference_mode():
                logits = model(
                    input_features=inputs["input_features"].to(device),
                    attention_mask=inputs["attention_mask"].to(device),
                ).logits
                emission = torch.log_softmax(logits, dim=-1)[0].detach().float().contiguous()

            has_wildcard = any(c not in vocab for c in chars)
            if has_wildcard:
                emission, wildcard_id = ctc_align.add_wildcard_column(emission, blank_id)
                tokens = [vocab.get(c, wildcard_id) for c in chars]
            else:
                tokens = [vocab[c] for c in chars]

            char_spans = ctc_align.forced_align_segment(emission, tokens, blank_id)
        except Exception as e:
            print(
                f"[nightingale:LOG] wav2vec2-bert-align: alignment failed for "
                f"segment ('{text[:60]}'): {e}; resorting to original",
                flush=True,
            )
            aligned_segments.append(aligned_seg)
            continue

        if char_spans is None or len(char_spans) != len(chars):
            print(
                f"[nightingale:LOG] wav2vec2-bert-align: forced_align failed for "
                f"segment ('{text[:60]}'), resorting to original",
                flush=True,
            )
            aligned_segments.append(aligned_seg)
            continue

        num_frames = emission.size(0)
        ratio = waveform_segment.size(1) / num_frames / SAMPLE_RATE

        seg_words = []
        cur_spans: list[dict] = []
        word_idx = 0
        for ch, span in list(zip(chars, char_spans)) + [("|", None)]:
            if ch == "|":
                if cur_spans and word_idx < len(original_words):
                    start = round(t1 + cur_spans[0]["start"] * ratio, 3)
                    end = round(t1 + cur_spans[-1]["end"] * ratio, 3)
                    score = round(sum(s["score"] for s in cur_spans) / len(cur_spans), 3)
                    seg_words.append(
                        {"word": original_words[word_idx], "start": start, "end": end, "score": score}
                    )
                if cur_spans:
                    word_idx += 1
                cur_spans = []
            else:
                cur_spans.append(span)

        aligned_seg["words"] = seg_words
        aligned_segments.append(aligned_seg)

    word_segments = []
    for segment in aligned_segments:
        word_segments += segment["words"]

    return {"segments": aligned_segments, "word_segments": word_segments}
