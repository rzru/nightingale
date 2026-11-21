---
title: How It Works
---

Nightingale's pipeline transforms any audio or video file into a karaoke experience through several stages.

## Pipeline Overview

### Audio and video files

1. **Separate the audio** with UVR Karaoke or Demucs to produce vocal and instrumental stems.
2. **Find or transcribe lyrics** with LRCLIB, WhisperX, or experimental Parakeet v3.
3. **Align every word**, including optional readings for CJK lyrics.
4. **Play the song** with synchronized lyrics, pitch scoring, key and tempo controls, mic monitoring, and audio-reactive backgrounds.

### UltraStar Deluxe bundles

USDX bundles bypass stem separation and transcription. Nightingale parses the bundled `.txt` or `.usdx` data into the same transcript format used by the analyzer cache, so both paths share the playback pipeline. See [UltraStar Deluxe](/docs/usdx/).

## Analyzer Server

The analyzer is a long-lived Python process that Nightingale spawns on the first analysis and talks to over a token-authenticated loopback TCP socket using newline-delimited JSON (NDJSON). Per-song startup costs (model load, CUDA init, Python imports) are paid once, after which `analyze` requests stream `progress` events and complete with `done` or `error` messages. This makes back-to-back analyses noticeably faster than the previous per-song subprocess model. Once no analysis has run for a few minutes, the process stops to give its memory and GPU context back; the next analysis starts it again. It also exits with Nightingale, even mid-analysis or after an unexpected close.

## Caching

Analysis results are cached in your configured data folder (`cache/`) using blake3 file hashes. Re-analysis only happens if the source file changes, if you trigger it manually, or when creating shifted key/tempo variants.

## Hardware Acceleration

The Python analyzer uses PyTorch and auto-detects the best backend:

| Backend | Device | Notes |
|---|---|---|
| CUDA | NVIDIA GPU | Fastest |
| MPS | Apple Silicon | macOS; WhisperX alignment falls back to CPU |
| CPU | Any | Slowest but always works |

<br />

The UVR Karaoke model uses ONNX Runtime and enables CUDA acceleration automatically on NVIDIA GPUs, or CoreML on Apple Silicon.

A song typically takes 2–5 minutes on GPU, 10–20 minutes on CPU.
