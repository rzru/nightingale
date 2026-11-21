"""CTC forced alignment via ``torchaudio.functional.forced_align``.

Drop-in replacement for :func:`whisperx.align` that swaps WhisperX's
pure-Python Viterbi (``get_trellis`` / ``backtrack`` / ``merge_repeats``, run on
CPU even when a GPU is present) for torchaudio's C++/CUDA ``forced_align``
kernel. Everything else -- model/dictionary loading, wildcard handling,
character -> word -> sentence assembly and NaN interpolation -- is kept
identical to WhisperX so the output contract (and CJK per-character behaviour)
is preserved.

The alignment loop body is adapted from whisperX (BSD-4-Clause,
m-bain/whisperX, ``whisperx/alignment.py``); only the trellis/backtrack section
is replaced.
"""

import numpy as np
import pandas as pd
import torch
from torchaudio.functional import forced_align, merge_tokens

import nltk
from nltk.data import load as nltk_load

from whisperx.audio import SAMPLE_RATE
from whisperx.utils import interpolate_nans, PUNKT_LANGUAGES

LANGUAGES_WITHOUT_SPACES = ["ja", "zh"]


def add_wildcard_column(emission: torch.Tensor, blank_id: int) -> tuple[torch.Tensor, int]:
    """Append a synthetic wildcard class to ``emission`` (the per-frame max
    logit across every non-blank class) so a character outside the model's
    dictionary can still be used as a forced_align target instead of
    aborting the whole segment. Returns ``(expanded_emission, wildcard_id)``.
    Shared with :func:`wav2vec2_bert_align.wav2vec2_bert_align`, which has
    the same out-of-vocabulary problem against a different model/dictionary.
    """
    non_blank_mask = torch.ones(emission.size(1), dtype=torch.bool, device=emission.device)
    non_blank_mask[blank_id] = False
    wildcard_col = emission[:, non_blank_mask].max(dim=1).values
    expanded = torch.cat([emission, wildcard_col.unsqueeze(1)], dim=1)
    return expanded, expanded.size(1) - 1


def ctc_align(
    transcript,
    model,
    align_model_metadata: dict,
    audio,
    device: str,
    interpolate_method: str = "nearest",
    return_char_alignments: bool = False,
) -> dict:
    """Align a known transcript to audio using torchaudio forced alignment.

    Mirrors the signature and return shape of :func:`whisperx.align`:
    ``{"segments": [...], "word_segments": [...]}`` where each segment carries a
    ``words`` list of ``{"word", "start"?, "end"?, "score"?}`` entries (one entry
    per character for ``ja``/``zh``).
    """
    if not torch.is_tensor(audio):
        if isinstance(audio, str):
            from whisperx.audio import load_audio
            audio = load_audio(audio)
        audio = torch.from_numpy(audio)
    if len(audio.shape) == 1:
        audio = audio.unsqueeze(0)

    max_duration = audio.shape[1] / SAMPLE_RATE

    model_dictionary = align_model_metadata["dictionary"]
    model_lang = align_model_metadata["language"]
    model_type = align_model_metadata["type"]

    # The blank id can never be an alignment target: torchaudio's forced_align
    # rejects targets that contain it. Some models map a real glyph to the blank
    # slot (e.g. torchaudio's English wav2vec2 uses "-" at index 0), so a literal
    # hyphen in the transcript ("round-abouts", "in-between") would otherwise be
    # emitted as a blank token and abort the whole segment.
    blank_id = 0
    for char, code in model_dictionary.items():
        if char == "[pad]" or char == " ":
            blank_id = code

    # 1. Preprocess to keep only characters in the model dictionary.
    total_segments = len(transcript)
    segment_data: dict[int, dict] = {}
    for sdx, segment in enumerate(transcript):
        num_leading = len(segment["text"]) - len(segment["text"].lstrip())
        num_trailing = len(segment["text"]) - len(segment["text"].rstrip())
        text = segment["text"]

        clean_char, clean_cdx = [], []
        for cdx, char in enumerate(text):
            char_ = char.lower()
            if model_lang not in LANGUAGES_WITHOUT_SPACES:
                char_ = char_.replace(" ", "|")

            if cdx < num_leading:
                pass
            elif cdx > len(text) - num_trailing - 1:
                pass
            elif model_dictionary.get(char_) == blank_id:
                # A glyph that maps to the blank slot (e.g. "-") can't be an
                # alignment target; drop it like punctuation.
                pass
            elif char_ in model_dictionary.keys():
                clean_char.append(char_)
                clean_cdx.append(cdx)
            elif char_ not in (" ", "|"):
                clean_char.append(char_)
                clean_cdx.append(cdx)

        clean_wdx = list(range(len(text.split(" ") if model_lang not in LANGUAGES_WITHOUT_SPACES else text)))

        punkt_lang = PUNKT_LANGUAGES.get(model_lang, "english")
        try:
            sentence_splitter = nltk_load(f"tokenizers/punkt_tab/{punkt_lang}.pickle")
        except LookupError:
            nltk.download("punkt_tab", quiet=True)
            sentence_splitter = nltk_load(f"tokenizers/punkt_tab/{punkt_lang}.pickle")
        sentence_spans = list(sentence_splitter.span_tokenize(text))

        segment_data[sdx] = {
            "clean_char": clean_char,
            "clean_cdx": clean_cdx,
            "clean_wdx": clean_wdx,
            "sentence_spans": sentence_spans,
        }

    aligned_segments = []

    # 2. Per-segment: emissions -> forced_align -> char/word/sentence assembly.
    for sdx, segment in enumerate(transcript):
        t1 = segment["start"]
        t2 = segment["end"]
        text = segment["text"]
        avg_logprob = segment.get("avg_logprob")

        aligned_seg = {"start": t1, "end": t2, "text": text, "words": [], "chars": None}
        if avg_logprob is not None:
            aligned_seg["avg_logprob"] = avg_logprob
        if return_char_alignments:
            aligned_seg["chars"] = []

        if len(segment_data[sdx]["clean_char"]) == 0:
            print(
                f"[nightingale:LOG] ctc-align: no in-dictionary chars in segment "
                f"('{text[:60]}'), resorting to original",
                flush=True,
            )
            aligned_segments.append(aligned_seg)
            continue

        if t1 >= max_duration:
            print(
                f"[nightingale:LOG] ctc-align: segment start {t1:.1f}s beyond audio "
                f"duration {max_duration:.1f}s, skipping",
                flush=True,
            )
            aligned_segments.append(aligned_seg)
            continue

        text_clean = "".join(segment_data[sdx]["clean_char"])

        f1 = int(t1 * SAMPLE_RATE)
        f2 = int(t2 * SAMPLE_RATE)

        waveform_segment = audio[:, f1:f2]
        if waveform_segment.shape[-1] < 400:
            lengths = torch.as_tensor([waveform_segment.shape[-1]]).to(device)
            waveform_segment = torch.nn.functional.pad(
                waveform_segment, (0, 400 - waveform_segment.shape[-1])
            )
        else:
            lengths = None

        with torch.inference_mode():
            if model_type == "torchaudio":
                emissions, _ = model(waveform_segment.to(device), lengths=lengths)
            elif model_type == "huggingface":
                emissions = model(waveform_segment.to(device)).logits
            else:
                raise NotImplementedError(f"Align model of type {model_type} not supported.")
            emissions = torch.log_softmax(emissions, dim=-1)

        # Keep the emission on the compute device (GPU stays GPU); forced_align
        # runs on CPU/CUDA. float32 + contiguous keeps the kernel happy.
        emission = emissions[0].detach().float().contiguous()

        has_wildcard = any(c not in model_dictionary for c in text_clean)
        if has_wildcard:
            emission, wildcard_id = add_wildcard_column(emission, blank_id)
            tokens = [model_dictionary.get(c, wildcard_id) for c in text_clean]
        else:
            tokens = [model_dictionary[c] for c in text_clean]

        num_frame = emission.size(0)

        char_segments = forced_align_segment(emission, tokens, blank_id)
        if char_segments is None or len(char_segments) != len(text_clean):
            print(
                f"[nightingale:LOG] ctc-align: forced_align failed for segment "
                f"('{text[:60]}'), resorting to original",
                flush=True,
            )
            aligned_segments.append(aligned_seg)
            continue

        duration = t2 - t1
        ratio = duration * waveform_segment.size(0) / num_frame

        # 3. Assign timestamps to aligned characters (identical to WhisperX).
        char_segments_arr = []
        word_idx = 0
        for cdx, char in enumerate(text):
            start, end, score = None, None, None
            if cdx in segment_data[sdx]["clean_cdx"]:
                char_seg = char_segments[segment_data[sdx]["clean_cdx"].index(cdx)]
                start = round(char_seg["start"] * ratio + t1, 3)
                end = round(char_seg["end"] * ratio + t1, 3)
                score = round(char_seg["score"], 3)

            char_segments_arr.append(
                {"char": char, "start": start, "end": end, "score": score, "word-idx": word_idx}
            )

            if model_lang in LANGUAGES_WITHOUT_SPACES:
                word_idx += 1
            elif cdx == len(text) - 1 or text[cdx + 1] == " ":
                word_idx += 1

        char_segments_arr = pd.DataFrame(char_segments_arr)

        aligned_subsegments = []
        char_segments_arr["sentence-idx"] = None
        for sdx2, (sstart, send) in enumerate(segment_data[sdx]["sentence_spans"]):
            curr_chars = char_segments_arr.loc[
                (char_segments_arr.index >= sstart) & (char_segments_arr.index <= send)
            ]
            char_segments_arr.loc[
                (char_segments_arr.index >= sstart) & (char_segments_arr.index <= send),
                "sentence-idx",
            ] = sdx2

            sentence_text = text[sstart:send]
            sentence_start = curr_chars["start"].min()
            end_chars = curr_chars[curr_chars["char"] != " "]
            sentence_end = end_chars["end"].max()
            sentence_words = []

            for word_idx in curr_chars["word-idx"].unique():
                word_chars = curr_chars.loc[curr_chars["word-idx"] == word_idx]
                word_text = "".join(word_chars["char"].tolist()).strip()
                if len(word_text) == 0:
                    continue

                word_chars = word_chars[word_chars["char"] != " "]

                word_start = word_chars["start"].min()
                word_end = word_chars["end"].max()
                word_score = round(word_chars["score"].mean(), 3)

                word_segment = {"word": word_text}
                if not np.isnan(word_start):
                    word_segment["start"] = word_start
                if not np.isnan(word_end):
                    word_segment["end"] = word_end
                if not np.isnan(word_score):
                    word_segment["score"] = word_score

                sentence_words.append(word_segment)

            if sentence_words:
                _starts = pd.Series([w.get("start", np.nan) for w in sentence_words])
                _ends = pd.Series([w.get("end", np.nan) for w in sentence_words])
                if _starts.isna().any() and _starts.notna().any():
                    _starts = interpolate_nans(_starts, method=interpolate_method)
                    _ends = interpolate_nans(_ends, method=interpolate_method)
                    for i, w in enumerate(sentence_words):
                        if "start" not in w and pd.notna(_starts.iloc[i]):
                            w["start"] = _starts.iloc[i]
                        if "end" not in w and pd.notna(_ends.iloc[i]):
                            w["end"] = _ends.iloc[i]

            subsegment = {
                "text": sentence_text,
                "start": sentence_start,
                "end": sentence_end,
                "words": sentence_words,
            }
            if avg_logprob is not None:
                subsegment["avg_logprob"] = avg_logprob
            aligned_subsegments.append(subsegment)

            if return_char_alignments:
                curr_chars = curr_chars[["char", "start", "end", "score"]]
                curr_chars.fillna(-1, inplace=True)
                curr_chars = curr_chars.to_dict("records")
                curr_chars = [{k: v for k, v in char.items() if v != -1} for char in curr_chars]
                aligned_subsegments[-1]["chars"] = curr_chars

        aligned_subsegments = pd.DataFrame(aligned_subsegments)
        aligned_subsegments["start"] = interpolate_nans(
            aligned_subsegments["start"], method=interpolate_method
        )
        aligned_subsegments["end"] = interpolate_nans(
            aligned_subsegments["end"], method=interpolate_method
        )

        agg_dict = {"text": " ".join, "words": "sum"}
        if model_lang in LANGUAGES_WITHOUT_SPACES:
            agg_dict["text"] = "".join
        if return_char_alignments:
            agg_dict["chars"] = "sum"
        if avg_logprob is not None:
            agg_dict["avg_logprob"] = "first"
        aligned_subsegments = aligned_subsegments.groupby(["start", "end"], as_index=False).agg(agg_dict)
        aligned_subsegments = aligned_subsegments.to_dict("records")
        aligned_segments += aligned_subsegments

    word_segments = []
    for segment in aligned_segments:
        word_segments += segment["words"]

    return {"segments": aligned_segments, "word_segments": word_segments}


def forced_align_segment(emission: torch.Tensor, tokens: list[int], blank_id: int):
    """Run torchaudio forced_align for one segment.

    Returns a list of ``{"start", "end", "score"}`` (one per target token, in
    order, with frame-index timings) or ``None`` if alignment is not possible
    (e.g. the ``T >= L + repeats`` constraint is violated, or the op raised).
    """
    try:
        targets = torch.tensor(tokens, dtype=torch.int32, device=emission.device).unsqueeze(0)
        aligned_tokens, scores = forced_align(emission.unsqueeze(0), targets, blank=blank_id)
        spans = merge_tokens(aligned_tokens[0], scores[0].exp(), blank=blank_id)
    except Exception as e:
        print(f"[nightingale:LOG] ctc-align: forced_align raised: {e}", flush=True)
        return None

    return [{"start": s.start, "end": s.end, "score": s.score} for s in spans]
