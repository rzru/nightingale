---
title: Configuration
---

Nightingale stores app settings in `~/.nightingale/config.json`.

## Data Storage

During setup, you can choose a custom data folder. Most runtime data lives in that selected folder. In v0.8.0, cache, videos, models, and vendor tools can also move into separate folders from the settings page. `config.json` and `nightingale.log` remain in the default `~/.nightingale` path.

Typical selected data folder layout:

```
<selected-data-folder>/
├── cache/               # Stems, transcripts, lyrics, shifted variants, covers, playable videos
├── songs.db             # Song library and analysis metadata (SQLite)
├── profiles.json        # Player profiles and scores
├── videos/              # Cached Pixabay video backgrounds
├── sounds/              # Sound effects
├── vendor/
│   ├── ffmpeg           # Downloaded ffmpeg binary
│   ├── uv               # Downloaded uv binary
│   ├── python/          # Python 3.10 installed via uv
│   ├── venv/            # Virtual environment with ML packages
│   ├── analyzer/        # Extracted analyzer Python scripts
│   └── .ready           # Marker indicating setup is complete
└── models/
    ├── torch/           # Demucs model cache
    ├── huggingface/     # WhisperX model cache
    └── audio_separator/ # UVR Karaoke model cache
```

## Video Backgrounds

Pixabay video backgrounds use the [Pixabay API](https://pixabay.com/api/docs/). In development, create a `.env` file at the project root with:

```
PIXABAY_API_KEY=your_key_here
```

## Theme

Toggle between dark and light themes from the sidebar. The theme preference is saved in the config.

![White theme](images/white-theme.png)

## Notable Settings

`config.json` is written by the app — you'll usually change these from **Settings** rather than by editing the file directly. Settings are grouped into **General**, **Playback**, and **Analysis** tabs. A few keys worth knowing:

| Key | Purpose |
|---|---|
| `asr_engine` | Selects the transcription engine. `whisper` (default) or `parakeet`. See [Lyrics & Transcription](/docs/lyrics/#choosing-the-asr-engine). |
| `align_backend` | Forced-alignment backend. `whisperx` (default, Python Viterbi), `ctc` (torchaudio `forced_align` C++/CUDA kernel; faster), or `qwen` (Qwen3-ForcedAligner-0.6B; 11 languages incl. CJK, runs on CUDA/MPS/CPU). All non-default backends fall back to WhisperX on error or unsupported input. See [Lyrics & Transcription](/docs/lyrics/#choosing-the-forced-alignment-backend). |
| `separator` | Stem separation model: `karaoke` (UVR, default) or `demucs`. |
| `vocal_detection_threshold_pct` | RMS threshold (fraction of the loudest window, `0.0`–`1.0`, default `0.15`) that marks where vocals start and end. Lower values keep more quiet intros/outros and soft singing; higher values trim more silence. Shown in Settings as **Vocal detection sensitivity** (0–60%). |
| `whisper_model` | Whisper model size: `large-v3` (default), `large-v3-turbo`, `medium`, `small`, `base`, `tiny`. Ignored when `asr_engine` is `parakeet`. |
| `beam_size` / `batch_size` | Decoder beam width and batch size for Whisper. Higher values are more accurate but slower and use more VRAM. |
| `mic_monitor_gain` | Live monitor gain when mic monitoring is on. Range `0.0`–`2.0` (slider shown as 0–200%). Configs from older builds that used `mic_mirror_gain` are read transparently and migrated on next save. |
| `mic_latency_compensation_sec` | Speaker-to-mic latency compensation for pitch scoring. Tune manually or use the Settings latency test. |
| `mic_active` / `mic_monitoring` / `preferred_mic` | Microphone state and the device chosen for scoring + monitoring. Older `mic_mirroring` configs are accepted and migrated on next save. |
| `playback_mode` | `classic` replaces the menu with playback; `session` opens playback in a dedicated desktop window or browser tab so the menu can manage the queue. |
| `master_volume` | Overall playback volume from `0.0` to `1.0` (0–100%, default `1.0`). |
| `lyrics_vertical_position` / `lyrics_horizontal_position` | Playback lyrics placement. Vertical: `top`, `center`, `bottom`; horizontal: `left`, `center`, `right`. |
| `lyrics_scale` / `pitch_graph_scale` | Independent playback display scales from `0.5` to `2.5` (50–250%, default `1.0`). |
| `lyrics_romanization_mode` | Shows (`enabled`, default) or hides (`disabled`) romanized readings above Japanese, Chinese, Cantonese, and Korean lyrics. |
| `auto_analyze` | When `true`, scans automatically queue every unanalyzed song after they finish. |
| `auto_continue_queue` | Remembered choice of the results screen's **Auto-continue** checkbox. When `true`, the next queued song starts by itself five seconds after the results appear. Defaults to off. |
| `language` | Interface language: `system` (follow the OS/browser language) or a BCP 47 tag such as `de` or `zh-cn`. `null` means follow the system. Also available in **Settings → General**; see [Languages](#languages). |
| `cache_paths` | Optional per-folder overrides for `songs`, `videos`, `models`, and `vendor`. Use Settings to move them so existing contents migrate safely. |
| `last_video_flavor` | Index of the last-used Pixabay video flavor (Nature, Underwater, Space, City, Countryside). |
| `last_theme` | Index of the last-used playback background (shaders → video → source). |
| `language_overrides` | Per-song forced ASR language, keyed by song hash. Set this from the song-list controls. |
| `data_path` | Selected data folder root. Set during first-run setup. |
| `multiplayer_players` | Last singer lineup (profile, color, microphone) reused as the starting point for multiplayer and queue playback. |
| `multiplayer_combine_multi_channel` | When `true`, a multi-channel interface is offered as one device per channel instead of a single combined input. |

## Languages

Nightingale ships with English, German, and Simplified Chinese, and picks the system language on first launch. Change it in **Settings → General → Interface language**; **System default** follows the operating system (and later changes to it) instead of pinning a language.

The choice travels with your settings, so the playback window and any self-hosted browser session read the same language. Songs' own metadata, lyrics, and analysis are never translated — only the interface around them.

Translations are plain JSON catalogs under `client/src/i18n/translations`; the [translations README](https://github.com/rzru/nightingale/tree/master/client/src/i18n/translations#readme) explains how to add a language. The **Contribute a translation** link on that setting opens it.
