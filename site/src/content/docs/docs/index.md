---
title: Nightingale
description: Turn your music library into karaoke with stem separation, synchronized lyrics, pitch scoring, and dynamic backgrounds.
slug: docs
---

**Karaoke from any song in your music library, powered by neural networks.**

Nightingale scans your music folder, separates lead vocals from instrumentals using the UVR Karaoke model (or Demucs), transcribes lyrics with word-level timestamps via WhisperX, and plays it all back with synchronized highlighting, pitch scoring, local multiplayer, key/tempo controls, profiles, and dynamic backgrounds.

Ships as a single binary. No manual installation of Python, ffmpeg, or ML models required — everything is downloaded and bootstrapped automatically on first launch.

<!-- TODO: screenshot of playback UI with lyrics highlighted over a background -->
![Nightingale playback](images/playback.png)

## Key Features

- **Stem Separation** — isolates lead vocals from instrumentals
- **Word-Level Lyrics** — automatic transcription with alignment, LRCLIB matches, or your own timed LRC / Enhanced LRC and plain lyrics
- **CJK Lyrics** — Japanese / Chinese / Cantonese / Korean songs get per-character forced alignment and optional romanized readings (Hepburn, pinyin, Jyutping, Revised Romanization) above each token
- **Pluggable ASR** — Whisper (default) or Parakeet v3 (experimental, ~25 European languages)
- **UltraStar Deluxe Songs (experimental)** — drop USDX folders into your library and play them with their built-in pitch + lyric data
- **Pitch Scoring** — real-time microphone input with star ratings
- **Full-Screen Pitch Guide** — the whole screen becomes a scrolling pitch graph with octave lanes and color-coded singer trails
- **Local Multiplayer** — two to four singers with separate microphones, profiles, live scores, and ranked results
- **Queue From Your Phone** — scan a QR code and manage the queue and playback from any phone on the same network
- **Song Bundles (.nge)** — one file that carries stems, lyrics, cover, and video, ready to play or export
- **Interface Languages** — English, German, and Simplified Chinese, following the system language by default
- **Key & Tempo Shifts** — adjust analyzed songs to better fit your voice
- **Profiles** — per-player score tracking
- **Video Files** — use video files with synchronized background playback
- **Audio-Reactive Backgrounds** — 10 GPU shaders that react to your mic, 5 Pixabay video flavors, source-video for video files
- **Song Browser + Bulk Tools** — switch between table and artwork-grid views, sort the table by multiple columns, and run analysis, metadata refresh, realignment, or cache actions across the current filtered list
- **Sidebar Filters + Playlists** — combine search with artist, album, playlist, analysis-status, and lyric-source filters, and browse existing folder/Plex/Jellyfin/Navidrome playlists
- **Playback Queue + Session Mode** — build a set list, manage what plays next, and keep the menu available while playback runs in a dedicated window or browser tab
- **Custom Playback Layout** — place lyrics at the top, center, or bottom and left, center, or right; scale lyrics and the pitch graph independently from 50–250%
- **Mic Monitoring + Setup Tests** — optional live mic monitoring with adjustable gain (0–200%), latency calibration, recording/playback testing, and Windows ASIO support
- **Flexible Storage** — split cache, videos, models, and vendor tools into separate folders
- **Gamepad + Touch Support** — full gamepad navigation and touch playback controls
- **Self-Contained** — zero manual dependency setup

## Supported Platforms

| Platform | Target |
|---|---|
| Linux x86_64 | `x86_64-unknown-linux-gnu` |
| Linux aarch64 | `aarch64-unknown-linux-gnu` |
| macOS ARM | `aarch64-apple-darwin` |
| macOS Intel | `x86_64-apple-darwin` |
| Windows x86_64 | `x86_64-pc-windows-msvc` |
