---
title: Rooms & Community Nodes
---

Rooms let up to four singers play the same track at the same moment, each on their own machine,
while you hear each other however you already do — Discord, a call, or the same room.

The node never receives audio or music. It only coordinates who is in a room, who is ready, and the
timestamp everyone starts at. Each singer plays their own copy of the track.

## What you need

- The same track file on every machine. Rooms are keyed by the file's hash, so another rip or
  encode will not match.
- A node. Either a public one from the node list, or one you run yourself and share by URL.
- A network path to the other singers for voice. Rooms do not carry voice.

## Join a room

1. Open **Rooms** from the profile menu.
2. Pick a node on the left. The dot shows the round trip to that node.
3. Give yourself a name, then create a room or join one.
4. If the room is password protected, enter the password. Five wrong attempts per minute are
   allowed before the node starts refusing.

Unreachable nodes are hidden from the list. Paste a node URL to add a private node; it stays in your
list until you remove it.

## Sing together

1. The host picks a track from their own library.
2. Everyone who has that track marks themselves **Ready**. Ready stays disabled when the track is
   missing from your library.
3. The host starts. The node hands out a start time a few seconds ahead, each client loads its own
   copy, and playback begins on that timestamp.
4. Pitch trails from every singer are drawn together, and the room shows each singer's score.

Changing the track clears everyone's ready state. When the host leaves, the next singer in the room
takes over rather than the room closing. A seat is held for a short while after your screen
disconnects, so moving to the playback view does not drop you from the room.

## Run a node

The node is a small binary with no music library, no database, and no volumes.

```bash
docker compose -f docker/node.compose.yaml up -d
```

Configuration:

| Variable                     | Default             | Meaning                                                  |
| ---------------------------- | ------------------- | -------------------------------------------------------- |
| `NIGHTINGALE_BIND`           | `0.0.0.0:8080`      | Listener address.                                        |
| `NIGHTINGALE_NODE_NAME`      | `Nightingale node`  | Name shown in node lists.                                |
| `NIGHTINGALE_NODE_PUBLIC`    | `false`             | List the node in the shared node list.                    |
| `NIGHTINGALE_NODE_MAX_ROOMS` | `10`                | Concurrent rooms.                                        |
| `NIGHTINGALE_NODE_MAX_SLOTS` | `16`                | Concurrent singers across all rooms (4 per room).        |

A private node is reachable by URL exactly like a public one; the flag only controls whether it is
listed. A room disappears as soon as its last singer leaves, and an abandoned seat is released a
few seconds after its screens disconnect — long enough for the playback view to take over.

### Quick add on a NAS

Synology Container Manager, QNAP Container Station, and TrueNAS all run the published image. Paste
this into the NAS compose editor (Project → Create → paste YAML), adjust the name and port, and
start it:

```yaml
services:
  nightingale-node:
    image: razzaru/nightingale-node:latest
    container_name: nightingale-node
    restart: unless-stopped
    environment:
      NIGHTINGALE_NODE_NAME: Sing at home
      NIGHTINGALE_NODE_PUBLIC: "false"
      NIGHTINGALE_NODE_MAX_ROOMS: "4"
      NIGHTINGALE_NODE_MAX_SLOTS: "8"
    ports:
      - "64450:8080"
```

No volumes and no library mount: the node keeps nothing on disk. The image is published for both
`linux/amd64` and `linux/arm64`, so ARM NAS units work.

The image lives on Docker Hub as `razzaru/nightingale-node`. To use the GHCR mirror instead, swap
`image:` for `ghcr.io/rzru/nightingale-node:latest`.

If your NAS compose editor insists on a Compose "project directory", an empty folder is enough — the
whole service is the block above. Port `64450` only needs to be reachable by the people singing;
put it behind your NAS reverse proxy if you want `https://`.

Prefer `docker run` on QNAP or a bare host:

```bash
docker run -d --name nightingale-node --restart unless-stopped \
  -e NIGHTINGALE_NODE_NAME="Sing at home" \
  -p 64450:8080 razzaru/nightingale-node:latest
```

### Publishing the image

Maintainers push the node image with the release script, which builds both architectures and
assembles the manifests:

```bash
VERSION=1.4.1 ./scripts/node-release.sh
```

### Trust and TLS

Only connect to nodes you trust. A node does not get your music or any file access, but it does
decide the room's start time, the member list, and the scoreboard. Plain `http://` also means room
passwords and member tokens are readable by anything on the network path.

That is fine on a network you already trust — your LAN, a VPN, or a Tailscale network — and the
desktop app accepts `http://` node URLs for exactly that case.

**Public nodes must be `https://`.** The shared node list only accepts TLS entries, and the app drops
any plain-http entry it finds there. A public node also logs a reminder at startup, because TLS has
to sit in front of the listener:

```caddyfile
sing.example.com {
    reverse_proxy 127.0.0.1:64450
}
```

Browsers additionally refuse to open a `ws://` connection from an `https://` page, and need a secure
context for microphone capture anyway, so the self-hosted web build always wants a TLS node.

#### Tailscale, without a domain

If the node lives on a NAS and only your tailnet should reach it, let Tailscale terminate TLS:

```bash
tailscale serve --bg 64450    # HTTPS on https://<machine>.<tailnet>.ts.net
tailscale serve status
```

Paste that `https://` address as the node URL. `tailscale serve` is tailnet-only; do not use
`tailscale funnel` for a node.

### Listing a public node

Add an entry to
[`site/public/instances.json`](https://github.com/rzru/nightingale/blob/master/site/public/instances.json)
and open a pull request:

```json
[{ "name": "Sing with us", "url": "https://sing.example.com" }]
```

Nodes whose `/api/node` does not answer are dropped from the list in the app, so a dead entry costs
nobody anything.
