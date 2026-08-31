# Changelog

All notable changes to Nightingale are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release pipeline (`.github/workflows/release.yml`) extracts the section
matching the pushed tag (e.g. `v0.6.0` -> `## [0.6.0]`) and uses it as the
GitHub Release body. If a section is missing the release is still created
with a fallback body, but ideally every tagged version has its own entry
below.

## [Unreleased]

### Features

- Added a playback queue to the song browser with a queue count, compact next-up sidebar, per-song removal, confirmed queue clearing, and keyboard and gamepad navigation.
- Added Session playback mode, which opens playback in a dedicated desktop window or browser tab while the menu remains available for live queue management.
- Playback settings now have a dedicated tab with a proportional live preview, lyric placement controls, and 50–250% lyric and pitch-graph scaling (100% by default).
- Add bulk song actions and a Refresh Metadata action for reloading metadata from the library source.
- Queued or in-progress song analysis can now be cancelled per song or in bulk across filtered songs.
- Added compact sortable song-table headers with stable duplicate-file rendering and flicker-free transitions.

### Improvements

- Leaderboard entries now show when each score was achieved beneath the profile name.
- Long gaps between lyric lines now show a compact countdown beneath the song details, while the circular three-second countdown bubble stays beside the lyric line as the next line approaches. The next lyric block is no longer previewed across an instrumental break.
- Change "AI generated" to "AI transcribed" in song list.
- Add Windows ASIO microphone support and a microphone recording/playback test in Settings.
- Analyzer setup now installs the released `transformers` 5.13+ package instead of cloning a pinned Git commit.

### Fixes

- Re-running setup no longer wipes the vendor folder first: already-installed components are detected and reused, and a second setup trigger is ignored while one is already running.
- Video files now use audio-stream title metadata, preventing subtitle titles from replacing song names.
- The lyrics editor now allows re-aligning analyzed songs without requiring a lyrics change.
- Empty transcription results now finish without attempting forced alignment.

## [1.1.0] - 2026-08-14

### Features

- Leaderboards — open a global top-10 ranking across every profile and song from the profile menu, or open a song-specific leaderboard to compare each profile's personal best. Scored songs expose the per-song board directly from their details panel.
- Personal-best ratings — song cards, table rows, and song details now show the active profile's best score as a five-star rating, with the exact score available on hover.

### Improvements

- Instant key and tempo controls — stepper changes are now staged immediately, then prepared together when playback starts. The Play button shows preparation progress and enters playback only after the adjusted audio is ready.
- Prebuilt Docker distribution — release tooling can publish multi-architecture CPU images and CUDA images to Docker Hub and GHCR. The Docker quick start now uses the published image, a persistent named data volume, and host port `64448`, while local builds remain supported.
- Theme-aware scrollbars — scrollable app surfaces now use compact scrollbar colors that follow the active light or dark theme.

### Fixes

- Setup errors now wrap and scroll within the modal instead of overflowing the dialog.
- UVR stem separation now converts source audio to WAV before loading it, preventing failures on input formats the separator cannot read directly.

## [1.0.0] - 2026-07-25

🎉 **Nightingale 1.0 is here!** Reaching this milestone means a great deal to me. I'm incredibly proud of the app Nightingale has become and grateful to everyone who has tried it, shared feedback, reported issues, contributed, or simply cheered the project on. Thank you for being part of the journey — I hope you enjoy this release as much as I've enjoyed building it.

### Features

- Provide your own lyrics — paste timed **LRC / Enhanced LRC** to skip transcription (optionally skipping stem separation to play over the original mix), or plain lyrics to run alignment. Available on un-analyzed songs via a new **Provide LRC** action and in the existing lyrics editor; LRCLIB matches now include plain-text results. No-stems songs still detect key for key/tempo shifts, hide the guide control, and score pitch against the original mix (flagged as less accurate).
- Plex Media Server provider — authorize through Plex's hosted PIN flow with account server discovery, or connect a LAN-only PMS directly with its URL and token. Choose one or more music libraries; Nightingale syncs their tracks and associated playable clips, metadata, covers, and read-only audio playlists. Playback and analysis lazily cache original media, video uses the authenticated range proxy, and every normal provider request goes directly to the selected PMS rather than app.plex.tv. Tokens are encrypted at rest and never placed in frontend media URLs.
- Playlist browsing — open existing Plex, Jellyfin, Navidrome, `.m3u`, `.m3u8`, and `.pls` playlists from the sidebar.

### Improvements

- Redesigned song browser — switch between a compact table and an artwork-first grid, scan clearer status and metadata at a glance, and select a song to open a dedicated details sidebar before playback. The sidebar brings the cover, analysis state, key/tempo controls, lyrics and language tools, analysis actions, and Play button into one focused view.
- Jellyfin library selection — choose which Jellyfin music libraries Nightingale syncs instead of importing every library.
- Analysis queue navigation — Quick Filters now includes a **Queued** view that shows the active track first followed by pending tracks in queue order. Sidebar counts use one compact segmented badge for total, queued, analysing, and analysed tracks, with matching status colors on song cards.
- Song list filtering — the responsive top toolbar can filter songs by analysis status and transcript type (**Generated**, **AI Aligned**, or **LRC**). Filters combine with search and sidebar selections, and **Analyze all** now respects the complete filtered view.

## [0.9.0] - 2026-07-06

### Features

- Docker support for self-hosted web mode — a multi-stage [`docker/Dockerfile`](docker/Dockerfile) and [`docker/compose.yaml`](docker/compose.yaml) build the `server` binary (with the React bundle embedded) into a container that runs without the systemd/Caddy/Avahi installer. The same Dockerfile produces both a CPU image (`debian:bookworm-slim`) and a CUDA/GPU image (via `--build-arg RUNTIME_BASE=nvidia/cuda:...` plus the NVIDIA Container Toolkit). The ML toolchain still bootstraps on first launch into the mounted `/data` volume, so the image stays small and dependencies persist across recreates. The data folder is fixed to `/data` (the setup wizard skips the data-folder step) and the music library follows a `/songs` convention via a new `NIGHTINGALE_LIBRARY_PATH` env var (defaulted in the image) — mount your music at `/songs` and Nightingale pins a folder source there on startup and hides the in-app source pickers, so nothing needs typing in the browser. Mic scoring still needs a TLS reverse proxy for a secure context. See [docs/docker](https://nightingale.cafe/docs/docker.html).
- Cantonese (`yue`) lyric support — Cantonese now joins Japanese, Mandarin, and Korean as a first-class CJK language. It rides the same per-character forced-alignment path as Mandarin (reusing the Chinese wav2vec2 model and jieba tokenization, since Cantonese is written in the same Han characters), works with the Qwen alignment backend, and shows [Jyutping](https://github.com/CanCLID/ToJyutping) romanized readings above each token. The per-song language override now lists **Mandarin** and **Cantonese** separately (the former "Chinese" label). Existing installs should re-run setup so the new Cantonese romanization dependency is installed.
- Experimental CTC forced-alignment backend — **Settings → Analysis → Forced alignment** can now use torchaudio's `forced_align` C++/CUDA kernel instead of WhisperX's pure-Python Viterbi. It computes each word's start/end points with a different algorithm, and is much faster on CUDA GPUs and Apple Silicon (where WhisperX alignment runs on the CPU). It also speeds up LRCLIB lyrics alignment and automatically falls back to WhisperX on error. Defaults to WhisperX, so existing behavior is unchanged unless you opt in.
- Experimental Qwen forced-alignment backend — **Settings → Analysis → Forced alignment** can also use [Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf), a non-autoregressive model that timestamps every token in one forward pass from audio + transcript (no wav2vec2, no phonetic step). It's fast and covers 11 languages, runs on CUDA and Apple Silicon MPS (as well as CPU), and falls back to WhisperX for unsupported languages, over-length audio, or any error. Timing quality varies song to song, but it can do better on CJK. Defaults to WhisperX, so existing behavior is unchanged unless you opt in. Existing installs should re-run setup so the new Qwen dependencies are installed.
- Adjustable vocal-detection sensitivity — **Settings → Analysis → Vocal detection sensitivity** exposes the RMS threshold that decides where a song's vocals start and end. Lower it when quiet intros, outros, or soft singing get trimmed; raise it to cut more silence. Defaults to 15%, matching previous behavior.

### Improvements

- Clearer analysis settings — the vocal separator, transcription model, and alignment model options now have plain-language descriptions explaining what each choice actually changes.
- Smoother lyrics display across short pauses — a finished line now stays on screen with its already-sung word colors until the next line's lead-in begins, instead of vanishing the moment it ends. Longer gaps still show the countdown as before.

### Fixes

- Fixed Settings page focus rings: tabs, buttons, and the beam/batch number pickers no longer show clipped borders or a brief shrink flicker on hover. The page now uses the same focus-ring style as the rest of the app (removing the `ring-offset` that got clipped by the scroll containers) and the number pickers have room for the ring.

## [0.8.0] - 2026-06-08

### Highlights

- Flexible cache folders — cache, video, model, and vendor directories can be separated from the main data folder, with guarded migration of existing contents.
- Auto-analysis — when enabled, scans queue newly discovered unanalyzed songs automatically.
- Playback polish — touch devices get on-screen playback controls, lyrics can be placed top/center/bottom and left/center/right, and the menu/playback UI adapts better to small screens.

### Improvements

- Settings moved from a modal into a dedicated page, keeping the existing controls easier to browse and navigate.

## [0.7.2] - 2026-05-28

### Highlights

- Donations — Nightingale is open-source, free, and built by one person. You can now support development with recurring monthly backing on [Patreon](https://www.patreon.com/cw/nightingalekaraoke) or a one-off tip on [Ko-fi](https://ko-fi.com/nightingalekaraoke). A new **Donate** entry under the sidebar avatar (heart icon) opens a dialog with both options. Until it's opened once, the avatar shows a pink badge — the existing green update dot still takes priority. The marketing site also gained a matching `Support Nightingale` section and `Donate` nav link.

## [0.7.1] - 2026-05-27

### Fixes

- Folder libraries now detect `.opus` audio files and serve them with an Ogg audio MIME type for browser playback.
- Changing a song's language can now realign existing lyrics without forcing a fresh transcription, and the selected language is preserved for the alignment pass.
- Edited lyrics keep the song's previous language hint when re-running alignment, avoiding accidental language resets.
- The self-hosted update/install command no longer pipes the installer through `sudo`, matching the script's own privilege handling.

### Improvements

- Polished the language-selection dialog with explicit force-transcribe vs realign choices and controlled selection state.
- Tightened the library sidebar scroll/layout behavior around the main navigation list.

## [0.7.0] - 2026-05-20

### Highlights

- Self-hosted web mode (v1) — Nightingale now ships a second binary, `server`, that runs the same app over HTTP on a Linux box on the LAN. The React bundle is embedded into the binary via `rust-embed`, browsers on phones/laptops/tablets/TVs all open the app at `http://<hostname>.local`. A one-shot `scripts/install.sh` drops a systemd unit, a Caddy front-door (HTTP on `:80`, opt-in HTTPS via Caddy's local CA on `:443` for mic capture), and an avahi advertisement onto the host so it's reachable without DNS. See [docs/self-hosted](https://nightingale.cafe/docs/self-hosted.html).
- Jellyfin media provider — connect the library to a Jellyfin server from the sidebar. Items are scanned via paginated `GET /Items` with `SortName` for stable enumeration; bytes are downloaded lazily on first analysis into `cache/sources/<file_hash>.<container>` and rekeyed to a true Blake3 hash, so the rest of the karaoke pipeline (stems, transcription, shifts) behaves identically to a folder library.
- Navidrome / Subsonic media provider — same shape as Jellyfin, but talking the [Subsonic API](http://www.subsonic.org/pages/api.jsp). Audio-only (Navidrome doesn't serve video). Auth uses per-call `MD5(password + salt)` tokens; the password is encrypted at rest in `config.json`.
- Lyrics editor with LRCLIB browser — every song now has an "Edit lyrics" entry that opens an editor seeded with the current transcript. When LRCLIB returns multiple candidate matches, a second tab lets you carousel through them and apply one with a single click. Saving re-runs alignment with your edits, so timing stays accurate.
- Sidebar restructure — Library actions (folder picker, Jellyfin/Navidrome connect, rescan), cache actions (clear all / videos / models), and the theme toggle moved out of the avatar dropdown into dedicated clusters. The Library row exposes its source buttons inline with live status badges (green/grey/amber) and tooltips showing the reachable hostname or the connection error. The avatar dropdown is now Profile / Settings / Update / About / Exit / Re-run Setup.

### Improvements

- Persistent scroll — sidebar and song-list scroll positions are preserved when navigating away and back, via a new `usePersistentScroll` hook keyed by panel id.
- Higher-contrast sidebar surfaces — various sidebar/menu surfaces had their contrast bumped after the cluster restructure, mostly for the badges and the focused/hovered ring states.
- `app-core` crate extraction — all cross-runtime logic (config, scanner, library DB, vendor bootstrap, sources, secrets, media server) was lifted out of `client/src-tauri` into a new `app-core` crate consumed by both the Tauri desktop client and the new self-hosted `server`. Drops a chunk of duplicated code and removes the few client/server divergences that had crept in.
- `library_db` modularization — the single 1k-line `library_db.rs` was split into `connection`, `migrations`, `queries`, `songs`, `analysis_queue`, `remote`, and `rebase`. Remote-source helpers live in `library_db::remote` so Jellyfin/Navidrome share the prune/upsert plumbing.
- Single-focus refactor — `use-menu-nav.ts` was split into `menu-nav/{use-menu-nav-input, use-menu-nav-refs, use-mouse-menu-focus, use-nav-lock, use-scroll-to-song, use-tab-panel-switch}`. Resolves a pile of edge cases where focus could land in two panels at once or get stuck after dialog dismissal.
- `mic_mirroring` → `mic_monitoring` — the setting and its config keys are renamed (`mic_monitoring`, `mic_monitor_gain`, `mic_active`). Older configs with `mic_mirroring` / `mic_mirror_gain` are read transparently via serde aliases and rewritten under the new names on next save. Existing UI hotkeys (`R` to toggle, etc.) are unchanged.

### Documentation

- New [Self-Hosted Web Mode](https://nightingale.cafe/docs/self-hosted.html) page with the full install / HTTPS / firewall / co-existing-with-your-own-Caddy story.
- New [Library Sources](https://nightingale.cafe/docs/library-sources.html) page covering the Folder / Jellyfin / Navidrome options and the at-rest credential envelope.
- Updated [Lyrics & Transcription](https://nightingale.cafe/docs/lyrics.html) page with a section on the in-app lyrics editor and the LRCLIB candidate browser.
- Updated [Configuration](https://nightingale.cafe/docs/configuration.html) page with the new `library_source` key and the `mic_monitor_gain` rename.

## [0.6.0] - 2026-05-10

### Highlights

- CJK lyric support — Japanese, Chinese, and Korean songs now go through a per-character forced-alignment path with romanized readings (Hepburn / pinyin / Revised Romanization) shown above each token. Japanese uses a hiragana-vocab wav2vec2 model fed through fugashi, which sidesteps the dense kanji vocabulary and matches natural speech far better than the default checkpoint.
- Parakeet v3 ASR (experimental) — alternative to Whisper for ~25 European languages. NeMo on CUDA, ONNX Runtime on CPU and Apple Silicon. Switchable from Settings → Analysis. Falls back to Whisper automatically if Parakeet returns no usable words.
- UltraStar Deluxe songs (experimental) — drop USDX bundles (.txt or .usdx plus sibling audio/vocals/instrumental/video) into your library and play them with their built-in pitch and lyric data. No analyzer pass needed; stem separation is skipped entirely when #VOCALS and #INSTRUMENTAL are provided. See [docs/usdx](https://nightingale.cafe/docs/usdx.html).
- Audio-reactive shader backgrounds — the 5-shader lineup is now 10 (Plasma, Waves, Nebula, Starfield, Sonar, Voronoi, Vortex, Metaballs, Spectrum, Oscilloscope) and they all react to your microphone input in real time when the mic is enabled.
- Persistent analyzer server — the Python analyzer is now a long-lived process talking to the app over a token-authenticated loopback TCP socket using NDJSON.
- In-app updater (macOS and Windows) — Nightingale now checks for new releases and can download and install updates from inside the app. A new **Update** entry lives in the sidebar actions menu, with progress reporting and a one-click relaunch when the install finishes. Linux still ships the menu entry but opens the GitHub Releases page since the updater plugin isn't compiled in for Linux builds.

### Improvements

- Mic monitor gain slider — the live mic-mirror volume is now a 0–200% slider in Settings, replacing the previous fixed level.
- Cleaner client architecture — playback state lives in dedicated React contexts (transport, transcript, mic, theme) instead of being prop-drilled through playback-inner. The shader visualizer was also extracted from the old monolithic video-background component.
- Pitch and reactive analysis moved to the client — both run in TypeScript over raw PCM samples streamed from Tauri, dropping a chunk of native code and making them easier to tune.
- Single GPU model at a time — Whisper, Parakeet, the alignment model, and the stem separator are now loaded one at a time and freed between stages, lowering peak VRAM and reducing OOMs on smaller GPUs.
- Alignment robustness — several edge cases in the WhisperX alignment path were fixed, including better handling of silence-bounded segments and tokens that fall outside the model vocab.

### Fixes

- Various typo and copy fixes in playback UI strings.

### Documentation

- New [UltraStar Deluxe](https://nightingale.cafe/docs/usdx.html) docs page covering detection, supported tags, the BPM/GAP timing model, and limitations.
- Expanded [Lyrics & Transcription](https://nightingale.cafe/docs/lyrics.html) docs with ASR engine selection and a CJK languages section.
- Updated [Backgrounds](https://nightingale.cafe/docs/backgrounds.html), [Configuration](https://nightingale.cafe/docs/configuration.html), and [How It Works](https://nightingale.cafe/docs/how-it-works.html) pages.

## [0.5.0] - 2026-04-06

Initial public release tracked in this changelog. See the
[v0.5.0 release notes](https://github.com/rzru/nightingale/releases/tag/v0.5.0)
on GitHub for the full artifact list.
