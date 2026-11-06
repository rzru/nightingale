---
title: Song Bundles (.nge)
---

A song bundle is one `.nge` file that holds a song together with everything Nightingale prepared for it: the separated audio, the cover, the timed lyrics, and the video background when the source had one. It plays straight from the file — nothing is unpacked and no analysis run is needed to play it.

## What is inside

| Entry | When it is included |
|---|---|
| `instrumental.<ext>` + `vocals.<ext>` | Analyzed songs with separated stems. |
| `audio.<ext>` | Songs analyzed without stem separation — the original file is included instead of stems. |
| `transcript.json` | The timed lyrics and pitch data the analyzer produced. |
| `lyrics.json` | The plain lyrics text, when it differs from the transcript. |
| `cover.jpg` | The cover art, when the library has one. |
| `video.mp4` | The converted background video, when the song is a video. |
| `manifest.json` | Format version, song metadata, and a checksum for every entry. |

Bundles are written uncompressed on purpose: that is what lets playback seek inside the file instead of reading it from the start. Each entry carries its own checksum, so a damaged bundle is reported as broken rather than played with the wrong lyrics or a truncated stem.

## Make one

1. Open a song's details and find the **Actions** list on the right.
2. Pick **Export (.nge)**.
3. Choose where to write it — or, in self-hosted web mode, let it download.

Export is offered for analyzed songs from folder, Jellyfin, Navidrome, and Plex libraries. Songs that are already a bundle have no export action. Bundles always store the original key and tempo: key and tempo changes are playback-time adjustments, not part of the file.

In web mode the server writes the bundle into its data folder and streams it to your browser as a download; the temporary copy is removed once the download finishes, so exports do not pile up on the server.

## Play one

Drop the `.nge` file into a folder library and let the scan find it. It shows up in the song list with an **NGE** badge and plays like any other analyzed song: microphone scoring, multiplayer, key and tempo shifts, pitch graphs, and the background themes all work.

Three things are different from a regular song, because the bundle is the source of truth:

- **No re-analysis.** The analysis actions — realign, refetch lyrics, force transcribe, full reanalysis, change language — are hidden. What the bundle contains is what plays.
- **Read-only lyrics.** The actions list shows **View lyrics** instead of an editor. To change the words, export from the original song again.
- **Stems are extracted once for shifts.** A bundle with separated stems copies them into the cache the first time you change key or tempo, then reuses them. A bundle with only the original mix cannot be shifted — the same rule as an unseparated song.

A bundle's source video, if it has one, plays as the background exactly like a regular video source, without a converted copy on disk.

Bundles need a folder library source: the remote sources list what their server reports, so a file dropped into a music folder is only seen by the folder scanner.
