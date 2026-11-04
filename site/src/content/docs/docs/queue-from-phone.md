---
title: Queue From Your Phone
---

Guests can manage the queue from their own phone while the machine keeps playing.

Show a QR code, they scan it, and they get a queue page: search the library, add songs, reorder, remove. Nothing on the phone can start, pause, or stop playback.

## Open the QR code

Hover the QR button at the top right of the sidebar for the code and its link. Click it (or press it with a keyboard or gamepad) to open the same code in a dialog, where the link can be copied with one click.

- **Desktop:** the app serves the queue page itself on port `64449`.
- **Self-hosted:** the server you already run serves it on the port it listens on, or on whatever your proxy publishes it as.

The link is printed under the code, so it can be typed in when a camera is not handy.

## What guests can do

- Search analyzed songs and add them to the end of the queue.
- Reorder entries and remove them, including entries another guest added.
- Start the queue on the host, pause or resume, skip straight to the next queued song, or end the song and go back to the menu. These are the same actions the host's own pause and end-of-song screens offer.
- Watch the queue change live: every edit from a phone appears on the host screen immediately.

Playback always runs on the host. The phone only sends the request, so a guest cannot play audio on their own device or take over the song. The remote does not expose seeking, volume, or picking a song to play out of order; skip only advances to the next entry already in the queue. Guests also get no settings, library management, or microphone access. Unanalyzed songs are hidden from search, because a song has to be analyzed before it can be queued.

In browser playback mode where each song opens in its own playback window (the **session** playback mode), some browsers block that window when the start comes from a phone tap rather than a click on the host. Use the default single-window mode if guests should be able to start the night from their phones.

## How the address is picked

The address mirrors how you reached the app, so the phone talks to the same door your browser used:

- An IP address or real DNS name in the address bar is kept as it is.
- The bare hostname is swapped for the machine's LAN address when it is something phones struggle with (`nightingale.local`, `localhost`, single-label names).
- The link is always plain `http://`. The installer's HTTPS uses a local CA that phones flag as insecure, and a phone needs no secure context to sit in the queue, so the QR never hands out a warning screen. The port follows the request: a container mapping keeps the published port (`64448` in the Compose example), and visiting over `https://` falls back to the proxy's HTTP port (`80`).
- If your phones should use a real HTTPS address instead, pin it with the override below.
- If the server listens only on loopback and nothing proxies it, the app shows no address at all instead of a link no phone can open. Put a proxy in front, bind to the LAN, or pin the address.
- A random token. The first visit stores it as a cookie and strips it from the address bar, so it does not sit in the phone's history.

Browsing through `localhost` cannot reveal the address phones should use, which is why container and proxy setups often want the override below.

### Override the address

Some setups cannot be described by a LAN address, for example a Docker container browsing through `localhost`, a proxy in front of a loopback bind, or a VPN-only interface. Pin it instead:

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
