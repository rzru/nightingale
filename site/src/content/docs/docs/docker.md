---
title: Docker
---

Run the self-hosted web server in a container instead of installing it with `scripts/install.sh`. This skips the systemd / Caddy / Avahi setup and just runs the `server` binary, so you bring your own networking (port mapping or a reverse proxy).

Two image flavors are built from the same [`docker/Dockerfile`](https://github.com/rzru/nightingale/blob/master/docker/Dockerfile):

- **CPU** — `debian:bookworm-slim` base. Works everywhere.
- **CUDA / GPU** — `nvidia/cuda` base. Needs the NVIDIA Container Toolkit on the host for faster analysis.

The heavy ML stack (ffmpeg, `uv`, Python 3.10, PyTorch, WhisperX, Demucs, UVR models, ...) is **not** baked into the image. It downloads on first launch into the mounted data volume, exactly like a bare-metal install.

## Prebuilt images

Each release publishes images to Docker Hub and GHCR, so you don't have to build locally:

| Flavor | Docker Hub | GHCR |
| --- | --- | --- |
| CPU | `razzaru/nightingale:latest` | `ghcr.io/rzru/nightingale:latest` |
| CUDA / GPU | `razzaru/nightingale:latest-cuda` | `ghcr.io/rzru/nightingale:latest-cuda` |

Versioned tags (`:1.3.0`, `:1.3.0-cuda`, ...) are published alongside `latest`.

```bash
docker pull razzaru/nightingale:latest
```

## Quick start (Docker Compose)

Copy and paste this on your NAS or Docker host. Change `/path/to/your/music` to the host path containing your music library:

```bash
mkdir -p nightingale && cd nightingale

cat > compose.yaml <<'YAML'
services:
  nightingale:
    image: razzaru/nightingale:latest
    container_name: nightingale
    restart: unless-stopped
    ports:
      - "64448:8080"
    volumes:
      - nightingale-data:/data
      - /path/to/your/music:/songs:ro

volumes:
  nightingale-data:
YAML

docker compose pull
docker compose up -d
```

Then open `http://<host>:64448` and follow the setup wizard. Port `64448` spells **NIGHT** on a phone keypad and avoids common self-hosted app defaults. The CPU image supports both AMD64 and ARM64 NAS devices. To use GHCR instead, change `image` to `ghcr.io/rzru/nightingale:latest`.

If you already cloned the repository and want to build locally, edit the music path in `docker/compose.yaml`, then run:

```bash
docker compose -f docker/compose.yaml up -d --build
```

## Quick start (docker run)

```bash
docker build -f docker/Dockerfile -t nightingale .

docker run -d \
  --name nightingale \
  -p 64448:8080 \
  -v nightingale-data:/data \
  -v /path/to/your/music:/songs:ro \
  nightingale
```

## First launch

1. Open `http://<host>:64448`.
2. Continue through the setup wizard. The data folder is fixed to the `/data` volume (the container sets `NIGHTINGALE_DATA_PATH=/data`), so the wizard skips the data-folder step entirely.
3. Wait while Nightingale downloads ffmpeg, Python, PyTorch, WhisperX, Demucs, and the UVR models into `/data/vendor`. This is several GB and only happens once — as long as you keep the volume.
4. Your library is already configured: the image pins it to `/songs`, so the folder you mounted is scanned on startup. Add or change songs on the host, then hit **Rescan** in the sidebar.

## Configuring the music library

A browser file picker can't hand the server an absolute filesystem path, so instead of picking a folder in the UI the library is set by convention: **the image pins it to `/songs`** (via a default `NIGHTINGALE_LIBRARY_PATH=/songs`). Just mount your host music there:

```bash
-v /path/to/your/music:/songs:ro
```

Nightingale configures a folder library source at that path on every startup and rescans if it changed, so your run/compose file is the single source of truth for the library. While it's pinned, the in-app source buttons (folder / Plex / Jellyfin / Navidrome) are hidden.

To mount your music somewhere else, override the path (`-e NIGHTINGALE_LIBRARY_PATH=/music -v /path/to/music:/music:ro`). To use a remote source (Plex, Jellyfin, or Navidrome) instead, set it empty (`-e NIGHTINGALE_LIBRARY_PATH=`) and connect from the sidebar as usual. For a LAN-only Plex server, ensure the container can reach its PMS URL (for example `http://192.168.1.20:32400`); the advanced PMS URL + token flow then operates directly against that server without requiring plex.tv after connection.

## GPU

Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) on the host, then build the CUDA image and run it with GPU access.

```bash
docker build -f docker/Dockerfile \
  --build-arg RUNTIME_BASE=nvidia/cuda:12.6.2-runtime-ubuntu24.04 \
  -t nightingale:cuda .

docker run -d \
  --name nightingale-gpu \
  --gpus all \
  -p 64448:8080 \
  -v nightingale-data:/data \
  -v /path/to/your/music:/songs:ro \
  nightingale:cuda
```

Or with Compose:

```bash
docker compose -f docker/compose.yaml --profile gpu up -d nightingale-gpu
```

Nightingale detects the GPU by running `nvidia-smi` inside the container (injected by the Container Toolkit) and picks a matching PyTorch CUDA wheel at bootstrap. The PyTorch wheels bundle their own CUDA runtime, so the only host requirement is an NVIDIA driver new enough for the selected CUDA version (12.6 by default).

If `nvidia-smi` isn't available in the container, Nightingale falls back to CPU-only PyTorch — analysis still works, just slower.

## Persistence

Everything lives under the single `/data` volume: `config.json`, `songs.db`, cache, videos, models, and the `vendor/` toolchain. `$HOME` is also set to `/data` so `uv` / `pip` / Hugging Face caches persist there too.

Keep the `nightingale-data` volume across upgrades. Deleting it forces the multi-GB dependency download to run again.

## Microphone and HTTPS

Browsers only allow microphone capture in a secure context. `http://<host>:64448` is **not** secure, so mic scoring is disabled there — but browsing, playback, queues, and analysis all work fine over plain HTTP.

To enable mic scoring, terminate TLS in front of the container. Two common options:

- Put a reverse proxy (Caddy, Traefik, nginx) in front and serve HTTPS with a trusted certificate.
- Run with `--network host` and front the container with a host-level Caddy, mirroring the bare-metal [self-hosted](/docs/self-hosted/) setup.

## Updating

Pull the current cloud image and recreate the container:

```bash
cd nightingale
docker compose pull
docker compose up -d
```

For a local checkout using `docker/compose.yaml`, rebuild instead:

```bash
docker compose -f docker/compose.yaml up -d --build
```

Your config, library, cache, and downloaded dependencies stay on the `/data` volume. There is no in-app updater in container mode — you update by rebuilding or pulling a new image.

## Music folder permissions

The container runs as a non-root `nightingale` user. Mount your music read-only (`:ro`) and make sure it's world-readable, or adjust ownership so the container user can read it.

## Environment variables

| Variable | Default | Use |
| --- | --- | --- |
| `NIGHTINGALE_BIND` | `0.0.0.0:8080` | Address the server listens on inside the container. |
| `NIGHTINGALE_DATA_PATH` | `/data` | Data + config directory (mount this as a volume). Fixed, so the setup wizard skips the data-folder step. |
| `NIGHTINGALE_LIBRARY_PATH` | `/songs` | Pin the library to a folder at this in-container path (mount your music here). Scanned on startup; the in-app source pickers are hidden while it's set. Set empty to use in-app / remote sources instead. |
| `NIGHTINGALE_REMOTE_URL` | empty | Base URL phones should scan for [queue control](/docs/queue-from-phone/), e.g. `http://192.168.1.10:64448`. Overrides LAN address detection. Needed when you open the app through `localhost`, because a container cannot see the host address phones should use. |

Build-time:

| Build arg | Default | Use |
| --- | --- | --- |
| `RUNTIME_BASE` | `debian:bookworm-slim` | Set to an `nvidia/cuda:*-runtime-*` image for GPU support. |
| `PIXABAY_API_KEY` | empty | Baked into the binary to enable Pixabay video backgrounds. |
