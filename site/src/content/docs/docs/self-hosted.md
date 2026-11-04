---
title: Self-Hosted Web Mode
---

Run Nightingale on a Linux box at home, then open it from phones, laptops, tablets, or TVs on your LAN.

You get one local URL:

```text
http://<hostname>.local
```

Use plain HTTP for browsing, playback, queues, and most features. Use HTTPS if you want browser features like microphone capture, fullscreen, and clipboard (unless they work via http).

Guests can also manage the queue from their phones. See [Queue From Your Phone](/docs/queue-from-phone/).

## Quick install

On the Linux host:

```bash
curl -fsSL https://raw.githubusercontent.com/rzru/nightingale/master/scripts/install.sh | bash
```

When system changes start, the installer shows the first `sudo` command, asks for confirmation, then prints each admin command before it runs.

When it finishes, open the URL shown by the installer, usually:

```text
http://<hostname>.local
```

The installer is safe to re-run. Re-running upgrades Nightingale and keeps your data.

## What the installer does

It sets up:

- `nightingale.service` — runs the Nightingale web server.
- `caddy.service` — serves Nightingale on HTTP and HTTPS.
- `avahi-daemon` — makes `<hostname>.local` work on your LAN.
- A system user named `nightingale` (optional).
- A default data folder at `/var/lib/nightingale`.

Your music folder is **not** configured by the installer. You choose it in the app.

## Requirements

- Linux host with `systemd`.
- Root access with `sudo`.
- Internet access to download Nightingale and setup dependencies.
- Ports `80`, `443`, and `5353/udp` allowed on your LAN if you use a firewall.
- Optional: NVIDIA GPU for faster analysis.

The installer can install `caddy` and `avahi-daemon` with `apt`, `dnf`, `pacman`, `zypper`, or `apk`. If your distro uses something else, install those packages first, then run the installer.

## First launch

1. Open `http://<hostname>.local` from any device on your LAN.
2. Follow setup in the browser.
3. Choose a data folder with enough space for models, cache, videos, and analysis files.
4. Wait while Nightingale downloads `ffmpeg`, Python, PyTorch, WhisperX, Demucs, UVR models, and other dependencies.
5. Open the library menu, choose a music folder, and scan your songs.

If your songs are on the server at `/srv/music/karaoke`, enter that full path in the app.

## Microphone support and HTTPS

Browsers block microphone capture on normal HTTP pages unless the page is `localhost`. Since `<hostname>.local` is not treated as secure, mic capture needs HTTPS. When Nightingale asks for microphone access, allow it so the browser can list your inputs.

Nightingale already serves HTTPS at:

```text
https://<hostname>.local
```

Before browsers trust it, install Nightingale's local certificate once on each device.

Download the certificate from your LAN:

```bash
curl -O http://<hostname>.local/root.crt
```

Then trust it:

- **macOS** — open `root.crt`, add it to Keychain, set it to **Always Trust**.
- **iPhone / iPad** — send `root.crt` to the device, install the profile, then enable it in **Settings → General → About → Certificate Trust Settings**.
- **Windows** — double-click `root.crt`, install it to **Trusted Root Certification Authorities**.
- **Android** — install it as a CA certificate in security settings. Some browsers may need their own certificate import too.
- **Linux** — copy it to `/usr/local/share/ca-certificates/nightingale.crt`, run `sudo update-ca-certificates`, and import it separately in Firefox if needed.

After that, use `https://<hostname>.local` for microphone scoring.

## Firewall

If your firewall is active, open these inbound LAN ports:

| Port | Protocol | Used for |
| --- | --- | --- |
| `80` | TCP | HTTP app access |
| `443` | TCP | HTTPS app access and microphone support |
| `5353` | UDP | `.local` discovery with Avahi / mDNS |

Ubuntu / Debian / Raspberry Pi OS with `ufw`:

```bash
sudo ufw allow 80/tcp   comment 'nightingale http'
sudo ufw allow 443/tcp  comment 'nightingale https'
sudo ufw allow 5353/udp comment 'nightingale mdns'
sudo ufw reload
```

Fedora / RHEL / openSUSE with `firewalld`:

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=mdns
sudo firewall-cmd --reload
```

If your firewall is inactive, you do not need to do anything.

## Music folder permissions

Nightingale runs as the `nightingale` user by default, or any other user you prompt during the setup. That user needs read access to your songs.

For a common `/srv/music/karaoke` folder:

```bash
sudo setfacl -m u:nightingale:rx /srv/music
sudo setfacl -R -m u:nightingale:rx /srv/music/karaoke
```

You can also grant access with normal Unix groups if that fits your setup better.

## Updating

Run the installer again:

```bash
curl -fsSL https://raw.githubusercontent.com/rzru/nightingale/master/scripts/install.sh | bash
```

This replaces the server binary and restarts Nightingale. Your config, library, cache, and music stay in place.

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/rzru/nightingale/master/scripts/install.sh | NIGHTINGALE_VERSION=v1.3.0 bash
```

## Useful commands

```bash
systemctl status nightingale caddy
journalctl -u nightingale -f
journalctl -u caddy -f
sudo systemctl restart nightingale
```

## Change the local name

To use a friendlier URL like `nightingale.local`, follow the setup prompts or use an environmental variable:

```bash
curl -fsSL https://raw.githubusercontent.com/rzru/nightingale/master/scripts/install.sh | NIGHTINGALE_HOSTNAME=nightingale.local bash
```

Then open:

```text
http://nightingale.local
```

If your router supports DHCP reservations, reserve a stable IP for the host too.

## Run with Docker

Prefer containers? You can skip the systemd / Caddy / Avahi installer entirely and run the server in Docker (CPU or CUDA/GPU). See [Docker](/docs/docker/).

## Build from source

Use this if you are testing local changes or no release exists yet:

```bash
git clone https://github.com/rzru/nightingale.git
cd nightingale
bash scripts/install.sh --from-source
```

You need `cargo`, `node`, and `pnpm` available in your user shell.

## Advanced installer options

Most users do not need these.

| Variable | Default | Use |
| --- | --- | --- |
| `NIGHTINGALE_VERSION` | `latest` | Install a specific GitHub Release tag. |
| `NIGHTINGALE_REPO` | `rzru/nightingale` | Install from another repo. |
| `NIGHTINGALE_HOSTNAME` | `$(hostname -s).local` | Publish a different `.local` name. |
| `NIGHTINGALE_USER` | `nightingale` | Run service as another system user. |
| `NIGHTINGALE_DATA_DIR` | `/var/lib/nightingale` | Bootstrap config and service data path. |
| `NIGHTINGALE_FORCE_AVAHI_HOSTNAME` | unset | Overwrite an existing Avahi hostname override. |
| `NIGHTINGALE_FORCE_CADDYFILE` | unset | Let installer replace an existing Caddyfile after backing it up. |

The installer tries not to overwrite your existing Caddy or Avahi setup. If it detects a conflict, it stops and prints what to fix.

## Uninstall

```bash
sudo systemctl disable --now nightingale
sudo rm /etc/systemd/system/nightingale.service
sudo systemctl daemon-reload
sudo rm -f /usr/local/bin/nightingale /usr/local/bin/nightingale.etag /usr/local/bin/nightingale.version
sudo rm -f /etc/avahi/services/nightingale.service
sudo systemctl restart avahi-daemon
```

If the installer created Nightingale's Caddy snippet, remove it and reload Caddy:

```bash
sudo rm -f /etc/caddy/Caddyfile.d/nightingale.caddy
sudo systemctl reload caddy
```

Data is kept by default. Remove it only if you are done with it:

```bash
sudo rm -rf /var/lib/nightingale
sudo userdel nightingale
```
