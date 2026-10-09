"""CJK (Japanese / Chinese / Korean) tokenization, romanization, and
char-timing reattribution helpers.

The wav2vec2 alignment models nightingale uses for ja/zh
(``jonatasgrosman/wav2vec2-large-xlsr-53-{japanese,chinese-zh-cn}``) are
character-level CTC checkpoints whose vocabs hold only kana+kanji / hanzi —
no punctuation, no romaji. ``clean_for_alignment`` mirrors their
training-time ``CHARS_TO_IGNORE`` so the aligner only sees in-vocab chars.
Per-character timing from those aligners is mapped onto fugashi (ja) or
jieba (zh) tokens for display.

Cantonese ("yue") shares written Han characters with Mandarin, so it rides
the same char-level path as ``zh``: jieba tokenization for display and the
Chinese wav2vec2 CTC checkpoint for alignment (WhisperX ships no ``yue``
default). Only its reading differs — Jyutping instead of pinyin.

Korean ("ko") uses ``kresnik/wav2vec2-large-xlsr-korean`` and is *not* in
WhisperX's ``LANGUAGES_WITHOUT_SPACES`` list, so its alignment output is
already per-eojeol (whitespace chunks) and bypasses the char-level
retokenization path entirely; only :func:`reading` is involved for ko.

Reading systems used: pykakasi Hepburn (ja), pypinyin tone-mark pinyin
(zh), ToJyutping Jyutping (yue), hangul-romanize academic Revised
Romanization (ko). All heavy modules are imported lazily on first use so
non-CJK songs don't pay the fugashi/pykakasi/jieba/ToJyutping/
hangul-romanize startup cost.
"""

import itertools
import re

# Punctuation / symbols / whitespace not present in the wav2vec2 ja/zh
# vocabs. Concatenates the CHARS_TO_IGNORE lists from both model cards plus
# common kaomoji/lyric punctuation we've seen in LRClib payloads.
_NOISE_CHARS = (
    ",?¿.!¡;:\"%~`_+<>=…–—°´«»„“”'’/\\^"
    "。、，、；：！？「」『』【】〝〟〜〽‧～｛｝（）［］〈〉《》"
    "♪♫♬·・…‥─━‐‑‒–—―•※"
)
_NOISE_CHARS_SET = set(_NOISE_CHARS) | {" ", "\t", "\n", "\r", "\u3000"}

# Hiragana-output wav2vec2 CTC model (vocab is ~80 hiragana chars + specials).
# We feed it fugashi-derived hiragana readings, which sidesteps the dense
# kanji vocabulary of the default jonatasgrosman checkpoint and matches the
# acoustic prior of natural Japanese speech much better.
JA_ALIGN_MODEL = "vumichien/wav2vec2-large-xlsr-japanese-hiragana"

# Han-character CTC checkpoint used for zh; also reused for yue since Cantonese
# lyrics are written in the same Han characters and WhisperX has no yue default.
ZH_ALIGN_MODEL = "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn"

_fugashi_tagger = None
_pykakasi_instance = None
_jieba_inited = False
_korean_transliter = None


def is_cjk(lang) -> bool:
    """Languages that go through the char-level alignment + retokenize path."""
    return lang in ("ja", "zh", "yue")


def qwen_kept_len(text: str) -> int:
    """Count characters the Qwen forced aligner keeps when it tokenizes.

    Mirrors transformers' ``_is_kept_char`` for ``Qwen3ASRProcessor`` (letters,
    numbers, apostrophes, CJK; punctuation and whitespace dropped). Used to slice
    Qwen's flat token stream back onto lyric lines by cumulative kept-char count,
    which works uniformly whether a line tokenizes per-character (zh) or per-word
    (ja/ko/latin) since token surfaces concatenate to the line's kept content.
    """
    import unicodedata

    count = 0
    for ch in text:
        if ch == "'":
            count += 1
            continue
        category = unicodedata.category(ch)
        if category.startswith("L") or category.startswith("N"):
            count += 1
    return count


def is_korean(lang) -> bool:
    return lang == "ko"


def is_supported_lang(lang) -> bool:
    """Any language for which we attach a romanized reading per token."""
    return is_cjk(lang) or is_korean(lang)


def _has_hangul(text: str) -> bool:
    for ch in text:
        c = ord(ch)
        if 0xAC00 <= c <= 0xD7AF:
            return True
        if 0x1100 <= c <= 0x11FF:
            return True
        if 0x3130 <= c <= 0x318F:
            return True
    return False


def clean_for_alignment(text: str) -> str:
    """Drop chars outside the wav2vec2 ja/zh model vocabulary."""
    if not text:
        return ""
    return "".join(ch for ch in text if ch not in _NOISE_CHARS_SET)


def _get_fugashi():
    global _fugashi_tagger
    if _fugashi_tagger is None:
        import fugashi
        _fugashi_tagger = fugashi.Tagger()
    return _fugashi_tagger


def _get_pykakasi():
    global _pykakasi_instance
    if _pykakasi_instance is None:
        import pykakasi
        _pykakasi_instance = pykakasi.kakasi()
    return _pykakasi_instance


def _ensure_jieba():
    global _jieba_inited
    if not _jieba_inited:
        import jieba
        jieba.initialize()
        _jieba_inited = True


def _get_korean_romanizer():
    global _korean_transliter
    if _korean_transliter is None:
        from hangul_romanize import Transliter
        from hangul_romanize.rule import academic
        _korean_transliter = Transliter(academic)
    return _korean_transliter


def _get_tojyutping():
    import ToJyutping
    return ToJyutping


def tokenize_japanese(text: str) -> list[str]:
    tagger = _get_fugashi()
    out: list[str] = []
    for t in tagger(text):
        s = getattr(t, "surface", None) or str(t)
        if s:
            out.append(s)
    return out


def _katakana_to_hiragana(text: str) -> str:
    """Lossless katakana→hiragana conversion. Long-mark ー and non-kana chars
    pass through unchanged."""
    out_chars: list[str] = []
    for ch in text:
        c = ord(ch)
        if 0x30A1 <= c <= 0x30F6:
            out_chars.append(chr(c - 0x60))
        else:
            out_chars.append(ch)
    return "".join(out_chars)


def _morpheme_kana(t) -> str:
    """Best-effort UniDic kana reading for a fugashi morpheme (or empty)."""
    feature = getattr(t, "feature", None)
    if feature is None:
        return ""
    for attr in ("kana", "pron", "kanaBase", "pronBase"):
        v = getattr(feature, attr, None)
        if v and v != "*":
            return v
    return ""


def _tag_japanese(text: str):
    """Yield ``(start, morpheme)`` for each fugashi morpheme of ``text``.

    MeCab skips ASCII spaces, which glues the words around them together
    (街 家 -> 街家, with 家 read as the suffix か), so they are tagged as
    full-width spaces. Both are one char, so ``start`` still indexes ``text``;
    it is -1 when a surface can't be located.
    """
    tagged = text.replace(" ", "　")
    pos = 0
    for m in _get_fugashi()(tagged):
        surface = getattr(m, "surface", None) or str(m)
        if not surface:
            continue
        start = tagged.find(surface, pos)
        if start >= 0:
            pos = start + len(surface)
        yield start, m


def tokenize_japanese_with_reading(text: str, spans=()) -> list[tuple[str, str]]:
    """Return ``[(surface, hiragana_reading), ...]`` per fugashi morpheme.

    The hiragana reading is the chars to feed the slplab hiragana CTC model;
    concatenating it across all tokens yields the alignment-text for the
    whole input. Tokens with no kana representation (ASCII, numerals,
    symbols) get an empty reading and are subsequently treated as punct by
    :func:`attribute_chars_to_tokens` / :func:`merge_punct`. Words listed in
    :data:`_JA_COMPOUND_READINGS` use their fixed reading.

    ``spans`` are user notes from :func:`parse_reading_markup`; kana ones
    replace the reading of the morphemes they cover (romaji ones can't be fed
    to the hiragana aligner and only affect display).
    """
    if not text:
        return []
    kana_spans = _compound_spans(text) + [sp for sp in spans if _is_kana_reading(sp[2])]
    frags = _apply_reading_spans(list(text), kana_spans) if kana_spans else None
    out: list[tuple[str, str]] = []
    for start, t in _tag_japanese(text):
        surface = getattr(t, "surface", None) or str(t)
        end = start + len(surface)
        if start >= 0:
            surface = text[start:end]
        if frags is not None and start >= 0 and any(s < end and start < e for s, e, _ in kana_spans):
            kana = "".join(frags[start:end])
        else:
            kana = _morpheme_kana(t)
        if not kana:
            out.append((surface, ""))
            continue
        hira = _katakana_to_hiragana(kana)
        # Keep hiragana + long-mark only; slplab vocab is hiragana-based and
        # anything else (kanji that slipped through, latin, digits) would be
        # a wildcard that destabilises CTC alignment.
        hira_only = "".join(
            ch for ch in hira
            if 0x3040 <= ord(ch) <= 0x309F or ch == "ー"
        )
        out.append((surface, hira_only))
    return out


# unidic-lite readings that are valid but almost never what lyrics mean
# (formal/rare defaults, or kana spelled as pronounced like 言う=ユウ).
_JA_READING_OVERRIDES = {
    "私": "わたし",
    "明日": "あした",
    "日本": "にほん",
    "言う": "いう",
    "闇夜": "やみよ",
}
# Words unidic-lite splits into several morphemes and so misreads (三日+月 =
# みっか+つき). Readings are per character so any token split stays correct.
_JA_COMPOUND_READINGS = {
    "三日月": ("み", "か", "づき"),
    # Literary 駆ける, missing from unidic-lite: tagged as 駆 (かける) + く.
    "駆く": ("か", "く"),
}
# unidic-lite always reads 何 as ナン; before these particles it is なに.
_JA_NANI_FOLLOWERS = ("を", "が", "か", "も", "に", "より")
# Topic/direction particles romanize by pronunciation, not spelling.
_JA_PARTICLE_READINGS = {"は": "わ", "へ": "え"}
_JA_SOKUON = ("っ", "ッ")

# Note typed in the lyrics editor and shown above a word: {彷徨|さまよ},
# {君|kimi}, {行|háng}, {colour|kʌlər}.
_READING_MARKUP_RE = re.compile(r"\{([^{}|]+)\|([^{}|]*)\}")


def parse_reading_markup(line: str) -> tuple[str, list[tuple[int, int, str]]]:
    """Strip ``{base|note}`` markup from a lyric line.

    Returns the plain line (what is displayed and aligned) and
    ``(start, end, note)`` spans indexing into it. In any language the note is
    shown above the word instead of its automatic reading; for Japanese a kana
    note also replaces the kana fed to the aligner. Markup with an empty note
    is just unwrapped.
    """
    plain: list[str] = []
    spans: list[tuple[int, int, str]] = []
    plain_len = 0
    last = 0
    for m in _READING_MARKUP_RE.finditer(line):
        before = line[last:m.start()]
        base, note = m.group(1), m.group(2).strip()
        plain.append(before)
        plain_len += len(before)
        if note:
            spans.append((plain_len, plain_len + len(base), note))
        plain.append(base)
        plain_len += len(base)
        last = m.end()
    plain.append(line[last:])
    return "".join(plain), spans

def _compound_spans(text: str) -> list[tuple[int, int, str]]:
    """Per-character reading spans for :data:`_JA_COMPOUND_READINGS` in ``text``."""
    spans: list[tuple[int, int, str]] = []
    for word, readings in _JA_COMPOUND_READINGS.items():
        start = text.find(word)
        while start >= 0:
            spans.extend((start + j, start + j + 1, r) for j, r in enumerate(readings))
            start = text.find(word, start + len(word))
    return spans


def _is_kana_reading(reading: str) -> bool:
    return all(_is_kana(ch) for ch in reading)


def _apply_reading_spans(frags: list[str], spans) -> list[str]:
    """Put each span's reading on its first char and blank the rest, so any
    token covering the span's start carries the whole reading."""
    for start, end, rd in spans:
        if start >= len(frags):
            continue
        frags[start] = rd
        for j in range(start + 1, min(end, len(frags))):
            frags[j] = ""
    return frags


def _is_kanji(ch: str) -> bool:
    c = ord(ch)
    return (
        0x4E00 <= c <= 0x9FFF
        or 0x3400 <= c <= 0x4DBF
        or 0xF900 <= c <= 0xFAFF
        or ch == "々"
    )


def _is_kana(ch: str) -> bool:
    return 0x3040 <= ord(ch) <= 0x30FF


def _japanese_char_kana(text: str, spans=()) -> list[str]:
    """Per-character kana for ``text``, using fugashi/UniDic readings so that
    kanji are read in sentence context (彷徨っ=さまよっ, 君=きみ) rather than
    by context-free dictionary default (ほうこう, くん).

    Returns a list parallel to ``text``. Kana/latin/punct chars map to
    themselves; a kanji morpheme's reading goes on its first kanji char (other
    kanji get "") while its kana prefix/okurigana stay on their own chars, so
    any slice of the list lines up with the same slice of ``text`` even when
    display tokens split a morpheme. User ``spans`` (see
    :func:`parse_reading_markup`) are applied last and win.
    """
    frags = list(text)
    tagged = list(_tag_japanese(text))
    morphemes = [m for _, m in tagged]
    for i, (start, m) in enumerate(tagged):
        surface = getattr(m, "surface", None) or str(m)
        if start < 0:
            continue

        if not any(_is_kanji(ch) for ch in surface):
            particle = _JA_PARTICLE_READINGS.get(surface)
            if particle and getattr(m.feature, "pos1", None) == "助詞":
                frags[start] = particle
            continue

        prev = morphemes[i - 1].surface if i > 0 else ""
        nxt = morphemes[i + 1].surface if i + 1 < len(morphemes) else ""
        kana = _JA_READING_OVERRIDES.get(surface)
        if kana is None and surface == "何" and nxt in _JA_NANI_FOLLOWERS:
            kana = "なに"
        if kana is None and surface == "君" and prev:
            # After latin ("you 君") UniDic parses 君 as the name suffix くん.
            if not any(_is_kana(ch) or _is_kanji(ch) for ch in prev):
                kana = "きみ"
        if kana is None and surface == "色" and prev and getattr(m.feature, "pos1", None) == "接尾辞":
            # Colour after a kana word (ハッカ色, オレンジ色) is いろ, not しょく.
            if not any(_is_kanji(ch) for ch in prev):
                kana = "いろ"
        if kana is None and surface == "金" and nxt == "の" and prev != "お":
            # UniDic reads 金の as money (かね); in lyrics it is gold (金の塔).
            kana = "きん"
        if kana is None:
            kana = _katakana_to_hiragana(_morpheme_kana(m))
        if not kana:
            continue

        # Split the reading across the surface's kanji/kana runs (立ち尽くし
        # = たち|つく|し) so a token boundary inside the morpheme still gets
        # the right share; if the kana runs don't match, the whole reading
        # goes on the first char.
        runs = [
            (r_start, "".join(g))
            for r_start, g in _char_runs(surface, _is_kana)
        ]
        pattern = "".join(
            re.escape(_katakana_to_hiragana(r)) if _is_kana(r[0]) else "(.+?)"
            for _, r in runs
        )
        match = re.fullmatch(pattern, kana)
        for j in range(start, start + len(surface)):
            frags[j] = ""
        if match is None:
            frags[start] = kana
            continue
        groups = iter(match.groups())
        for r_start, r in runs:
            if _is_kana(r[0]):
                for j, ch in enumerate(r):
                    frags[start + r_start + j] = ch
            else:
                frags[start + r_start] = next(groups)
    return _apply_reading_spans(frags, _compound_spans(text) + list(spans))


def _char_runs(text: str, pred):
    """Yield ``(offset, chars)`` for maximal runs of ``text`` sharing ``pred``."""
    offset = 0
    for _, group in itertools.groupby(text, key=pred):
        chars = list(group)
        yield offset, chars
        offset += len(chars)


def _kana_to_romaji(kana: str) -> str:
    chunks = _get_pykakasi().convert(kana)
    return "".join(c.get("hepburn", "") for c in chunks).strip()


def _japanese_readings(words: list[str], line: str | None = None, spans=()) -> list:
    """Hepburn romaji for consecutive display tokens of one line.

    The tokens are analysed within ``line`` (or, without it, joined) so
    fugashi sees the full sentence; each token then gets the romaji of its
    own slice. ``spans`` index into ``line`` and override readings. A token
    ending in a sokuon (彷徨っ|て) gets the next token's doubled consonant
    (samayot|te) instead of pykakasi's standalone "tsu".
    """
    text = line if line is not None else "".join(words)
    try:
        frags = _japanese_char_kana(text, spans)
    except Exception:
        frags = _apply_reading_spans(list(text), spans)

    kanas: list[str] = []
    sokuon: list[bool] = []
    pos = 0
    for w in words:
        at = text.find(w, pos) if w else -1
        if at >= 0:
            k = "".join(frags[at:at + len(w)])
            pos = at + len(w)
        else:
            # Token text not found in the line (aligner normalised it): read
            # it standalone rather than misattributing a neighbour's slice.
            try:
                k = "".join(_japanese_char_kana(w))
            except Exception:
                k = w
        body = k.rstrip("".join(_NOISE_CHARS_SET))
        tail = k[len(body):]
        if body.endswith(_JA_SOKUON):
            # Geminate only into a directly following token; before punct
            # or at line end (あっ！) the sokuon is just a glottal stop.
            kanas.append(body[:-1] + tail)
            sokuon.append(not tail)
        else:
            kanas.append(k)
            sokuon.append(False)

    out: list = []
    for w, k in zip(words, kanas):
        try:
            r = _kana_to_romaji(k) if clean_for_alignment(w) else ""
        except Exception:
            r = ""
        out.append(r)

    for i in range(len(out)):
        if not sokuon[i] or i + 1 >= len(out):
            continue
        nxt = out[i + 1]
        if nxt[:1].isalpha() and nxt[:1].lower() not in "aeiou":
            out[i] += "t" if nxt.lower().startswith("ch") else nxt[0].lower()
    return [r or None for r in out]


def tokenize_chinese(text: str) -> list[str]:
    _ensure_jieba()
    import jieba
    return [t for t in jieba.lcut(text, cut_all=False) if t]


def tokenize_korean(text: str) -> list[str]:
    return text.split()


def tokenize(text: str, lang: str) -> list[str]:
    """Word/morpheme tokenization. Token concatenation equals ``text`` for
    ja/zh; for ko it returns whitespace-separated eojeol (concatenation
    equals ``text`` only after collapsing inter-word spaces)."""
    if not text:
        return []
    if lang == "ja":
        return tokenize_japanese(text)
    if lang in ("zh", "yue"):
        return tokenize_chinese(text)
    if lang == "ko":
        return tokenize_korean(text)
    return [text]


def tokenize_for_alignment(text: str, lang: str, spans=()) -> list[tuple[str, str]]:
    """Per-token ``(display_surface, alignment_chars)`` pairs.

    Concatenating the second element of every pair yields the full string
    fed to the wav2vec2 aligner. The first element is what we want to show
    on screen and what :func:`reading` consumes for romanization.

    For ``ja`` the alignment chars are the hiragana reading of the morpheme
    (matches the slplab hiragana CTC vocab). For ``zh`` they are the token
    with ja/zh-vocab punctuation stripped (matches the kanji/hanzi CTC
    vocab). For other languages we fall back to a single (text, cleaned)
    pair so callers stay uniform.
    """
    if not text:
        return []
    if lang == "ja":
        return tokenize_japanese_with_reading(text, spans)
    if lang in ("zh", "yue"):
        return [(t, clean_for_alignment(t)) for t in tokenize_chinese(text)]
    return [(text, clean_for_alignment(text))]


def to_alignment_text(text: str, lang: str) -> str:
    """Concatenate :func:`tokenize_for_alignment` outputs into a single
    string suitable for the wav2vec2 aligner. For ``ja`` this is the all-
    hiragana version of ``text``; for ``zh`` it strips out-of-vocab punct."""
    if lang == "ja":
        return "".join(r for _, r in tokenize_japanese_with_reading(text))
    return clean_for_alignment(text)


def align_model_for(lang: str):
    """Override wav2vec2 align model for languages where the WhisperX
    default is poorly suited. Returns ``None`` to mean 'use default'."""
    if lang == "ja":
        return JA_ALIGN_MODEL
    if lang == "yue":
        return ZH_ALIGN_MODEL
    return None


def align_lang_code(lang: str) -> str:
    """WhisperX ``language_code`` for the wav2vec2 aligner.

    Cantonese reuses the Chinese code so WhisperX applies its no-space
    (per-character) word grouping and Han-character alignment path — the same
    treatment ``zh`` gets. WhisperX only uses this code to pick the word-split
    behaviour and (when no ``model_name`` is given) the default model, so the
    app keeps tracking ``yue`` separately for jieba tokenization and Jyutping
    readings."""
    return "zh" if lang == "yue" else lang


def reading(text: str, lang: str):
    """Romanized reading: pykakasi Hepburn (ja), tone-mark pinyin (zh),
    Jyutping (yue), Revised Romanization (ko)."""
    if not text:
        return None
    if not clean_for_alignment(text):
        return None
    if lang == "yue":
        try:
            pairs = _get_tojyutping().get_jyutping_list(text)
            # Drop Jyutping tone digits — bare numbers read poorly as karaoke
            # syllables (e.g. "hoi2 fut3" -> "hoi fut").
            parts = ["".join(ch for ch in jp if not ch.isdigit()) for _, jp in pairs if jp]
            r = " ".join(p for p in parts if p).strip()
            return r or None
        except Exception:
            return None
    if lang == "ja":
        return _japanese_readings([text])[0]
    if lang == "zh":
        try:
            from pypinyin import pinyin, Style
            chunks = pinyin(text, style=Style.TONE, heteronym=False, errors="ignore")
            parts = [c[0] for c in chunks if c and c[0]]
            r = " ".join(parts).strip()
            return r or None
        except Exception:
            return None
    if lang == "ko":
        if not _has_hangul(text):
            return None
        try:
            r = _get_korean_romanizer().translit(text).strip()
            return r or None
        except Exception:
            return None
    return None


def attribute_chars_to_tokens(
    tokens: list[str],
    chars_with_ts: list[dict],
    fallback_start=None,
    fallback_end=None,
    cleaned_lengths: list[int] | None = None,
) -> list[dict]:
    """Map per-character timestamps onto tokens.

    ``chars_with_ts`` is the WhisperX char-level alignment output for the
    text obtained by ``clean_for_alignment("".join(tokens))`` — or, when
    ``cleaned_lengths`` is supplied, by some caller-provided transformation
    (e.g. fugashi's hiragana reading per morpheme) whose per-token char
    counts are passed explicitly. Each token's timing window is taken from
    the first/last char it contains; tokens with zero alignment-chars are
    emitted with ``_punct: True`` and no timestamps so the caller can fold
    them into a neighbour via :func:`merge_punct`.
    """
    if cleaned_lengths is None:
        cleaned_lengths = [len(clean_for_alignment(t)) for t in tokens]
    expected = sum(cleaned_lengths)
    actual = len(chars_with_ts)

    if expected != actual:
        ts_starts = [c.get("start") for c in chars_with_ts if c.get("start") is not None]
        ts_ends = [c.get("end") for c in chars_with_ts if c.get("end") is not None]
        seg_start = ts_starts[0] if ts_starts else fallback_start
        seg_end = ts_ends[-1] if ts_ends else fallback_end
        if seg_start is None:
            seg_start = 0.0
        if seg_end is None or seg_end <= seg_start:
            seg_end = seg_start + 0.1
        timed_tokens = max(1, sum(1 for length in cleaned_lengths if length > 0))
        step = (seg_end - seg_start) / timed_tokens
        out: list[dict] = []
        idx = 0
        for tok, length in zip(tokens, cleaned_lengths):
            if length == 0:
                out.append({"word": tok, "_punct": True})
                continue
            s = seg_start + idx * step
            e = seg_start + (idx + 1) * step
            out.append({"word": tok, "start": s, "end": e, "estimated": True})
            idx += 1
        return out

    out: list[dict] = []
    cursor = 0
    for tok, length in zip(tokens, cleaned_lengths):
        if length == 0:
            out.append({"word": tok, "_punct": True})
            continue
        slice_chars = chars_with_ts[cursor:cursor + length]
        cursor += length
        ts_starts = [c.get("start") for c in slice_chars if c.get("start") is not None]
        ts_ends = [c.get("end") for c in slice_chars if c.get("end") is not None]
        scores = [c.get("score") for c in slice_chars if c.get("score") is not None]

        entry: dict = {"word": tok}
        if ts_starts and ts_ends:
            entry["start"] = ts_starts[0]
            entry["end"] = ts_ends[-1]
            if scores:
                entry["score"] = sum(scores) / len(scores)
        else:
            entry["estimated"] = True
        out.append(entry)
    return out


def merge_punct(entries: list[dict]) -> list[dict]:
    """Fold punctuation-only tokens into the adjacent timed token's text.

    Glues trailing punctuation onto the previous word, leading punctuation
    onto the following word. The displayable on-screen ``word`` keeps the
    original punctuation; timing/reading stay with the timed token.
    """
    out: list[dict] = []
    pending_prefix: list[str] = []
    for e in entries:
        if e.get("_punct"):
            if out:
                out[-1]["word"] = out[-1]["word"] + e["word"]
            else:
                pending_prefix.append(e["word"])
            continue
        cleaned = {k: v for k, v in e.items() if k != "_punct"}
        if pending_prefix:
            cleaned["word"] = "".join(pending_prefix) + cleaned["word"]
            pending_prefix = []
        out.append(cleaned)
    if pending_prefix and out:
        out[-1]["word"] = out[-1]["word"] + "".join(pending_prefix)
    return out


def attach_reading(entries: list[dict], lang: str, line: str | None = None, spans=()) -> None:
    """Attach a ``reading`` field to each entry that has displayable text.

    Japanese entries are read together (within ``line`` when given) so each
    token's kanji reading comes from its sentence context (see
    :func:`_japanese_readings`). Other supported languages get a per-token
    reading. In every language, ``spans`` from :func:`parse_reading_markup`
    (indexing into ``line``) put the user's note above the words they cover."""
    words = [e for e in entries if "word" in e]
    if lang == "ja":
        for e, r in zip(words, _japanese_readings([e["word"] for e in words], line, spans)):
            if r:
                e["reading"] = r
        return
    if is_supported_lang(lang):
        for e in words:
            r = reading(e["word"], lang)
            if r:
                e["reading"] = r
    if spans and line is not None:
        _apply_notes(words, line, spans, lang)


def _apply_notes(words: list[dict], line: str, spans, lang: str) -> None:
    """Show ``{base|note}`` notes above the words they cover.

    A note replaces the automatic reading of the characters it covers and is
    shown once, on the word where it starts; the rest of a partly covered word
    keeps its own reading (``{行|háng}走`` inside the token 行走 -> "háng zǒu").
    """
    pos = 0
    for e in words:
        at = line.find(e["word"], pos) if e["word"] else -1
        if at < 0:
            continue
        word_start, word_end = at, at + len(e["word"])
        pos = word_end
        hits = sorted(span for span in spans if span[0] < word_end and word_start < span[1])
        if not hits:
            continue
        parts: list[str] = []
        cursor = word_start
        for start, end, note in hits:
            if start > cursor:
                parts.append(_default_reading(line[cursor:start], lang))
            if start >= word_start:
                parts.append(note)
            cursor = max(cursor, end)
        if cursor < word_end:
            parts.append(_default_reading(line[cursor:word_end], lang))
        text = " ".join(part for part in parts if part)
        if text:
            e["reading"] = text
        else:
            e.pop("reading", None)


def _default_reading(text: str, lang: str) -> str:
    return (reading(text, lang) or "") if is_supported_lang(lang) else ""
