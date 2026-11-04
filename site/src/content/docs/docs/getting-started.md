---
title: Getting Started
description: Install Nightingale and add your first songs.
---

## Download

| Platform | Format                    | Architectures      |
| -------- | ------------------------- | ------------------- |
| Linux    | `.deb`, `.rpm` | x86_64, ARM (arm64) |
| macOS    | `.dmg`                    | Apple Silicon, Intel |
| Windows  | Installer `.exe`, `.msi` | x86_64 |

<br />

Download the latest version from the [Releases](https://github.com/rzru/nightingale/releases) page.

Supported audio formats: `.mp3`, `.flac`, `.ogg`, `.opus`, `.wav`, `.m4a`, `.aac`, `.wma`.

Supported video formats: `.mp4`, `.mkv`, `.avi`, `.webm`, `.mov`, `.m4v`.

UltraStar Deluxe songs (`.usdx`, plus `.txt` files whose contents look like USDX) are also picked up automatically and bypass the analyzer pipeline entirely. See [UltraStar Deluxe](/docs/usdx/) for the supported tags and folder layout.

## macOS: Removing the Quarantine Flag

macOS automatically adds a quarantine attribute to files downloaded from the internet. Since Nightingale is not signed with an Apple Developer ID, Gatekeeper will block it with a message like _"app is damaged and can't be opened"_ or _"Apple cannot check it for malicious software"_.

To fix this, remove the quarantine attribute after moving the Nightingale.app to Applications:

```bash
xattr -cr /Applications/Nightingale.app
```

This tells macOS to clear (`-c`) all extended attributes recursively (`-r`) from the app bundle, which removes the `com.apple.quarantine` flag that triggers Gatekeeper. The app itself is safe — it's just not code-signed.

## First Launch

On first launch, Nightingale will guide you through setup:

1. **Choose data folder** — select where cache, models, videos, vendor tools, and the library database are stored. After setup, Settings can split cache, videos, models, and vendor tools into separate folders.
2. **Downloads ffmpeg** — needed for audio/video processing
3. **Downloads uv** — Python package manager
4. **Installs Python 3.10** — via uv, isolated from your system Python
5. **Creates virtual environment** — with PyTorch, WhisperX, Demucs, and UVR models
6. **Downloads ML models** — stem separation and transcription models
7. **Pre-downloads video backgrounds** — Pixabay videos for the first session

This process takes a few minutes and shows a progress screen. After setup completes, Nightingale is ready to use.

<!-- TODO: screenshot of the setup/bootstrap progress screen -->

![Setup progress](images/setup.png)

## Adding Music

When prompted, select your music folder. Nightingale scans it for supported audio and video files. You can change this folder later from the sidebar actions menu.

## Browsing and Playing Songs

Use the song-list toolbar to switch between a compact table and an artwork grid. Search combines with sidebar selections and the toolbar's analysis-status and lyric-source filters, so you can narrow the library without losing context.

Select a song to open its details sidebar before playback. From there you can review the cover, metadata, and analysis state; adjust key and tempo; edit or provide lyrics; run analysis actions; play immediately; start [multiplayer](/docs/multiplayer/); or add the song to the playback queue.

Every row and card also has quick actions, so the common steps do not need the sidebar: the queue button adds the song to the bottom of the queue, the play button starts it, and the analyze button starts analysis. A right-click (or long press) on each of those buttons opens a small menu instead of running the default — add to the top of the queue, choose solo or multiplayer playback, or pick analyze or provide-lyrics.

Songs you want to keep together with their prepared audio and lyrics can be packed into a single `.nge` file from the details sidebar. See [Song Bundles](/docs/song-bundles/).

Open the queue from the toolbar to see what is next, reorder or remove songs, start the queue in solo or multiplayer mode, or clear it. Key and tempo choices are stored with each queued song.

Choose **Settings → Playback → Session mode** to open playback in a dedicated desktop window or browser tab while the menu remains available for queue management. The same settings page controls master volume, lyric placement, lyric romanization, and independent lyric and pitch-graph scaling with a live preview.

## Analysis

Before most songs can be played as karaoke, they need to be analyzed:

1. Select a song from the library to open its details sidebar.
2. Start analysis from the available action.
3. Nightingale separates stems, finds or transcribes lyrics, and aligns their timing.
4. Results are cached — subsequent plays are instant.

Timed LRC / Enhanced LRC and UltraStar songs can skip some or all of this pipeline. See [Lyrics & Transcription](/docs/lyrics/#editing--providing-lyrics) and [UltraStar Deluxe](/docs/usdx/).

Use the song-list actions menu to analyze songs, cancel active analysis, refresh metadata, realign lyrics, reanalyze, or clear cached results across the current filtered list. You can also enable **Settings → Analysis → Auto-analyze** to queue newly discovered unanalyzed songs after each scan. Bulk actions respect the active search, sidebar selection, status filter, and lyric-source filter.

<!-- TODO: screenshot of the song library with a mix of analyzed/queued/not-analyzed songs -->

![Song library](images/library.png)

## Updating

On **macOS** and **Windows**, Nightingale checks for new releases once at launch. When one is available:

1. The sidebar avatar grows a small green dot.
2. The **Update** entry in the sidebar dropdown menu also shows the badge and opens a dialog with the version, release date, and notes.
3. Click **Install & Restart**. The signed bundle downloads (with a progress bar), installs, and the app relaunches.

Platform notes:

- **macOS**: the bundle is replaced in place and the app relaunches.
- **Windows**: the installer runs in `passive` mode — a small progress window appears, the app exits, and it comes back automatically once the install finishes.

### Linux

The Linux build ships **without** the in-app updater. The **Update** entry is still in the sidebar menu, but instead of fetching a bundle it opens a dialog that explains this and gives you an **Open GitHub Releases** button. Pick the `.deb` or `.rpm` for your distro from the [Releases](https://github.com/rzru/nightingale/releases) page and install it the usual way.

There is no update badge on the sidebar avatar on Linux.

If the macOS or Windows dialog reports an error, see [Troubleshooting → Updates](/docs/troubleshooting/#updates).

## Force Re-setup

If something goes wrong with setup or dependencies, open the sidebar actions menu and select **Re-run Setup**. If you only need to move cache/models/videos/vendor files, use Settings so Nightingale migrates existing contents and avoids stale paths.
