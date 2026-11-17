"""Shared analysis pipeline used by both server.py and analyze.py."""

import json
import os
import subprocess
import tempfile

from gpu import hard_free_gpu, log_vram
from whisper_compat import progress
from key_detect import detect_key
from stems import separate_stems, separate_stems_uvr
from transcribe import transcribe_vocals
from align import align_lyrics
from melody import add_melody


def ffmpeg_bin():
    return os.environ.get("FFMPEG_PATH", "ffmpeg")


def convert_to_mp3(src, dest_mp3):
    subprocess.run(
        [ffmpeg_bin(), "-y", "-i", src, "-c:a", "libmp3lame", "-q:a", "2", "-v", "error", dest_mp3],
        check=True,
    )
    if os.path.isfile(dest_mp3):
        os.remove(src)


def normalize_tempo(tempo):
    try:
        t = float(tempo)
    except (TypeError, ValueError):
        return 1.0
    if t <= 0:
        return 1.0
    return round(t + 1e-8, 1)


def format_tempo(tempo):
    return f"{normalize_tempo(tempo):.1f}"


def sanitize_key(key):
    raw = str(key or "").strip()
    out = []
    for ch in raw:
        if ch.isalnum() or ch in ("#", "b"):
            out.append(ch)
        elif ch in (" ", "-", "_"):
            out.append("_")
    cleaned = "".join(out).strip("_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned or "Unknown"


def copy_stem(src, dest):
    subprocess.run(
        [ffmpeg_bin(), "-y", "-i", src, "-c:a", "copy", "-v", "error", dest],
        check=True,
    )


def separate_and_cache(audio_path, output_dir, file_hash, separator, device, key, tempo, free_gpu_fn=None):
    """Run stem separation or reuse cached stems. Returns the vocals path."""
    key_safe = sanitize_key(key)
    tempo_safe = format_tempo(tempo)
    final_vocals = os.path.join(output_dir, f"{file_hash}_vocals_{key_safe}_{tempo_safe}.mp3")
    final_instrumental = os.path.join(output_dir, f"{file_hash}_instrumental_{key_safe}_{tempo_safe}.mp3")

    if os.path.isfile(final_vocals) and os.path.isfile(final_instrumental):
        progress(50, "Stems already cached, skipping separation")
        return final_vocals

    legacy_mp3_v = os.path.join(output_dir, f"{file_hash}_vocals.mp3")
    legacy_mp3_i = os.path.join(output_dir, f"{file_hash}_instrumental.mp3")
    if os.path.isfile(legacy_mp3_v) and os.path.isfile(legacy_mp3_i):
        progress(50, "Copying legacy mp3 stems to key/tempo variant...")
        copy_stem(legacy_mp3_v, final_vocals)
        copy_stem(legacy_mp3_i, final_instrumental)
        return final_vocals

    for ext in (".ogg", ".wav"):
        legacy_v = os.path.join(output_dir, f"{file_hash}_vocals{ext}")
        legacy_i = os.path.join(output_dir, f"{file_hash}_instrumental{ext}")
        if os.path.isfile(legacy_v) and os.path.isfile(legacy_i):
            progress(50, f"Converting legacy {ext} stems to MP3...")
            convert_to_mp3(legacy_v, final_vocals)
            convert_to_mp3(legacy_i, final_instrumental)
            return final_vocals

    with tempfile.TemporaryDirectory(prefix="nightingale_") as work_dir:
        if separator == "karaoke":
            torch_home = os.environ.get("TORCH_HOME", "")
            models_base = os.path.dirname(torch_home) if torch_home else output_dir
            uvr_models_dir = os.path.join(models_base, "audio_separator")
            os.makedirs(uvr_models_dir, exist_ok=True)
            vp, ip = separate_stems_uvr(audio_path, work_dir, uvr_models_dir)
        else:
            vp, ip = separate_stems(audio_path, work_dir, device)
        progress(51, "Saving stems to cache...")
        convert_to_mp3(vp, final_vocals)
        convert_to_mp3(ip, final_instrumental)

    if free_gpu_fn:
        free_gpu_fn()

    return final_vocals


def transcribe_or_align(
    vocals_path, audio_path, device, *,
    model_name, beam_size=5, batch_size=16,
    engine="whisper",
    lyrics_path=None, language_override=None,
    whisper_model=None, pre_align_cleanup=None,
):
    """Choose between lyrics alignment and full transcription."""
    if lyrics_path and os.path.isfile(lyrics_path):
        print(f"[nightingale:LOG] Using pre-fetched lyrics: {lyrics_path}", flush=True)
        return align_lyrics(
            lyrics_path, vocals_path, device,
            model_name=model_name,
            language_override=language_override,
            whisper_model=whisper_model,
            pre_align_cleanup=pre_align_cleanup,
        )

    return transcribe_vocals(
        vocals_path, audio_path, device,
        model_name=model_name,
        beam_size=beam_size,
        batch_size=batch_size,
        engine=engine,
        language_override=language_override,
        whisper_model=whisper_model,
        pre_align_cleanup=pre_align_cleanup,
    )


def add_melody_safe(transcript, vocals_path, output_dir, file_hash):
    """Attach notes to the transcript; a melody failure never fails the song."""
    if not vocals_path or not os.path.isfile(vocals_path):
        return
    progress(92, "Extracting melody...")
    try:
        add_melody(transcript, vocals_path, os.path.join(output_dir, f"{file_hash}_pitch.json"))
    except Exception as e:
        print(f"[nightingale:LOG] Melody extraction failed: {e}", flush=True)


def run_pipeline(
    audio_path, output_dir, file_hash, device, *,
    model_name="large-v3", beam_size=5, batch_size=16,
    separator="karaoke", engine="whisper",
    lyrics_path=None, language_override=None,
    whisper_model=None, pre_align_cleanup=None, free_gpu_fn=None,
    skip_transcription=False,
    skip_separation=False,
):
    """Full analysis pipeline: stem separation -> transcription -> save.

    When ``skip_transcription`` is set, an existing (LRC-provided) transcript is
    kept as-is: only key detection and stem separation run, and the detected key
    is patched into the transcript. When ``skip_separation`` is also set, stem
    separation is skipped too (the song plays over its original mix); only the
    key is detected and stamped onto the provided transcript.
    """
    os.makedirs(output_dir, exist_ok=True)

    transcript_path = os.path.join(output_dir, f"{file_hash}_transcript.json")
    transcript_exists = os.path.isfile(transcript_path)
    if transcript_exists and not skip_transcription:
        progress(100, "Already analyzed, skipping")
        return

    progress(2, f"Using device: {device}")

    try:
        log_vram("phase:start")
        detected_key = detect_key(audio_path)
        tempo = 1.0

        vocals_path = None
        if not skip_separation:
            vocals_path = separate_and_cache(
                audio_path, output_dir, file_hash, separator, device,
                key=detected_key,
                tempo=tempo,
                free_gpu_fn=free_gpu_fn,
            )
            log_vram("phase:after_separation")

        if skip_transcription:
            # Keep the provided LRC transcript; only stamp key/tempo onto it.
            transcript = {}
            if transcript_exists:
                try:
                    with open(transcript_path, "r", encoding="utf-8") as f:
                        transcript = json.load(f)
                except (OSError, ValueError) as e:
                    print(f"[nightingale:LOG] Failed to read provided transcript: {e}", flush=True)
            transcript["key"] = detected_key
            transcript["tempo"] = normalize_tempo(tempo)
            add_melody_safe(transcript, vocals_path, output_dir, file_hash)
            progress(95, "Writing transcript...")
            with open(transcript_path, "w", encoding="utf-8") as f:
                json.dump(transcript, f, ensure_ascii=False, indent=2)
            return

        if callable(whisper_model):
            whisper_model = whisper_model()

        transcript = transcribe_or_align(
            vocals_path, audio_path, device,
            model_name=model_name,
            beam_size=beam_size,
            batch_size=batch_size,
            engine=engine,
            lyrics_path=lyrics_path,
            language_override=language_override,
            whisper_model=whisper_model,
            pre_align_cleanup=pre_align_cleanup,
        )
        log_vram("phase:after_transcribe_or_align")

        transcript["key"] = detected_key
        transcript["tempo"] = normalize_tempo(tempo)
        add_melody_safe(transcript, vocals_path, output_dir, file_hash)

        progress(95, "Writing transcript...")
        with open(transcript_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f, ensure_ascii=False, indent=2)
    finally:
        hard_free_gpu("pipeline_end")
