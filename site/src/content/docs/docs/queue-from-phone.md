---
title: Queue From Your Phone
---

Guests can manage the queue from their own phone while the machine keeps playing.

Show a QR code, they scan it, and they get a queue page: search the library, add songs, reorder, remove. Nothing on the phone can start, pause, or stop playback.

## Open the QR code

Press the profile button at the bottom of the sidebar and choose **Phone remote**, or use the QR button in the playback queue header.

- **Desktop:** the app serves the queue page itself on port `64449`.
- **Self-hosted:** the server you already run serves it on the port it listens on.

The link is printed under the code, so it can be typed in when a camera is not handy.

## What guests can do

- Search analyzed songs and add them to the end of the queue.
- Reorder entries and remove them, including entries another guest added.
- Start the queue on the host, pause or resume, skip straight to the next queued song, or end the song and go back to the menu. These are the same actions the host's own pause and end-of-song screens offer.
- Watch the queue change live: every edit from a phone appears on the host screen immediately.

Playback always runs on the host. The phone only sends the request, so a guest cannot play audio on their own device or take over the song. The remote does not expose seeking, volume, or picking a song to play out of order; skip only advances to the next entry already in the queue. Guests also get no settings, library management, or microphone access. Unanalyzed songs are hidden from search, because a song has to be analyzed before it can be queued.

In browser playback mode where each song opens in its own playback window (the **session** playback mode), some browsers block that window when the start comes from a phone tap rather than a click on the host. Use the default single-window mode if guests should be able to start the night from their phones.

## How the address is picked

The QR encodes a plain HTTP LAN address:

```text
http://<lan-ip>:<port>/q?t=<token>
```

- A raw IP instead of a `<hostname>.local` name, because many phones cannot resolve mDNS names. Real DNS names and IP addresses you reached the app with are kept as they are.
- The port the server actually listens on, not the port in your browser's address bar. A host reachable through Caddy on `443` still gets the direct listener in the code.
- A random token. The first visit stores it as a cookie and strips it from the address bar, so it does not sit in the phone's history.

### Override the address

Some setups cannot be described by a LAN address, for example a container port mapping, a proxy in front of a loopback bind, or a VPN-only interface. Pin it instead:

```bash
NIGHTINGALE_REMOTE_URL=http://192.168.1.10:64448
```

or, for the server binary:

```bash
server --remote-url http://192.168.1.10:64448
```

## If the phone cannot load the page

- The phone must be on the same network and subnet.
- Many guest Wi-Fi networks enable client isolation, which blocks phone-to-computer traffic. Use the normal network.
- The port must pass the host firewall: `64449` on desktop, or the server port on self-hosted installs.
- A VPN active on the phone routes traffic away from the LAN.

## Security

Anyone who can scan the code can manage the queue. To invalidate existing links, quit Nightingale and delete `remote-control.json` from the data folder; a new token is generated on the next start.

On desktop, the phone page is all the network can reach: it accepts only the queue commands and library search. Self-hosted mode already answers its full API to anything on the LAN, and the queue link does not widen that.
