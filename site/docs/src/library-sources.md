# Library Sources

Nightingale can build your karaoke library from a local folder, Plex Media Server, Jellyfin, or Navidrome. Use the **Library** buttons in the sidebar to choose one.

Only one source is active at a time. You can switch later without losing already-analyzed songs that point to the same audio.

| Source | Best for | Supports video? | What you enter |
|---|---|---:|---|
| Folder | Music stored on this computer or drive | Yes | Folder path |
| Plex | Selected music libraries on a Plex Media Server | Associated music video clips | Hosted Plex sign-in, or PMS URL + token |
| Jellyfin | Music and videos on a Jellyfin server | Yes | Server URL, username, password |
| Navidrome | Music on Navidrome or another Subsonic server | No | Server URL, username, password |

## Local folder

Choose a music folder and Nightingale scans it recursively.

Use this when your files are already on this computer, an external drive, or a mounted network share. Folder libraries support audio files, video files, and UltraStar Deluxe song folders.

To update the list after adding or removing files, rescan from the sidebar. Existing analysis is reused when the file has not changed.

See [Getting Started](./getting-started.md#adding-music) for supported formats.

## Plex Media Server

Use Plex when music lives on a local, LAN-only, shared, or remotely accessible Plex Media Server (PMS).

1. Click the Plex button in the **Library** sidebar section.
2. Choose **Sign in with Plex**. Nightingale opens Plex's hosted authorization page and uses the resulting account access only to discover your available servers.
3. Select a discovered PMS and one or more music libraries.
4. Click **Connect selected libraries**.

For a LAN-only server, or when you do not want to use plex.tv discovery, choose **Advanced: use a server URL and token**. Enter the PMS URL itself (for example `http://192.168.1.20:32400`) and its token in separate fields. After connection, identity, health checks, library sync, metadata, covers, playlists, downloads, and streams all go directly to that saved PMS base URL. Normal operation does not require plex.tv, and media is never proxied through app.plex.tv.

Only explicitly selected Plex music sections are synced. Nightingale also imports playable clip items exposed by those music sections, but it does not ingest generic movie or TV libraries. Existing audio playlists are imported read-only. Original media is fetched lazily into Nightingale's source cache for playback and analysis; associated video uses the authenticated, range-aware local proxy so the Plex token never appears in frontend media URLs or logs.

Plex's hosted PIN v2 and account resource APIs are less completely documented than the PMS API. Nightingale implements the standard defensive flow and keeps the manual PMS URL + token path available if cloud authorization or discovery changes.

## Jellyfin

Use Jellyfin when your music or music videos live on a Jellyfin server.

1. Click the Jellyfin button in the **Library** sidebar section.
2. Enter your server URL, username, and password.
3. Click **Test connection**.
4. Choose one or more music libraries.
5. Click **Connect**.

After connecting, Nightingale lists songs and videos from the selected Jellyfin libraries. Cover art loads as needed. When you analyze or play a song that needs processing, Nightingale downloads the original media once into its local cache. Later analyses reuse that cached copy.

Connection status appears on the Jellyfin button:

- Green: server reachable.
- Amber: last check failed. Hover for details.
- Grey: still checking.

## Navidrome / Subsonic

Use Navidrome when your music lives on a Navidrome or Subsonic-compatible server.

1. Click the Navidrome button in the **Library** sidebar section.
2. Enter your server URL, username, and password.
3. Click **Test connection**.
4. Click **Connect**.

Nightingale scans albums and songs from the server. Audio downloads only when a song is first analyzed, then stays in the local cache for reuse.

Navidrome sources are audio-only. Video items are not imported.

## Playlists

Existing playlists appear in a read-only **Playlists** section in the sidebar. Nightingale imports playlists from Plex, Jellyfin, and Navidrome, while folder libraries discover `.m3u`, `.m3u8`, and `.pls` files recursively.

Playlist order is preserved. Relative paths in folder playlists are resolved from the playlist file's directory, and entries that do not match songs in the active library are skipped. Rescan the library after changing playlist files or remote playlists.

Nightingale uses playlists for navigation only; creating or editing playlists remains in Plex, Jellyfin, Navidrome, or your playlist-file editor.

## Switching sources

Connect a different source whenever you want to change libraries. Nightingale rescans and shows songs from the new source.

Your analysis cache stays on disk. If you return to a source later, songs with the same audio can reuse existing stems, lyrics, and other analysis files.

## Sharing a cache between machines

Analysis is keyed by the audio file's content hash, not its path, so several installs can point their songs cache at the same shared folder (for example a NAS share chosen during setup). Analyze on the machine with the strong GPU, then on the other machine press **Rescan library**: besides picking up new files, the rescan checks the cache for finished analyses of songs already in that machine's library and marks them ready without re-running stem separation or transcription. A toast reports how many songs were marked ready; entries whose stems or transcript are not finished yet are left alone until the other machine completes them.

Each machine still scans its own library folder, so the audio must be reachable from both — the paths can differ, only the file contents need to match. Songs that a rescan adds to the library for the first time are picked up on the next rescan.

## Passwords and tokens

Plex, Jellyfin, and Navidrome credentials are saved so Nightingale can reconnect next time. Nightingale never asks for a Plex username or password; it stores only the PMS token returned by hosted authorization or entered in the advanced flow.

Credentials are encrypted in `config.json`, but you still should not share that file. If you previously used an older build with plain-text credentials, Nightingale wraps them the next time it saves settings.
