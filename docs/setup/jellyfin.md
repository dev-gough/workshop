# Jellyfin

Jellyfin is only required for the **Jellyfin** project tile (server status + transcoder pings). The workshop also reads Jellyfin's port to expose it on the server dashboard.

## Install

```bash
curl https://repo.jellyfin.org/install-debuntu.sh | sudo bash
```

Then visit <http://localhost:8096> and complete the first-run wizard pointing at your media directories.

## Wire it up

In `/setup` → **Jellyfin**, set the base URL (`http://localhost:8096`). The API key is optional but recommended: with a key, the fetcher page resolves finished downloads to their actual Jellyfin library items and deep-links straight to them (without one it falls back to a search link). Create one in Jellyfin under **Dashboard → API Keys**.

Click **Test connection** to verify.

## jellyfin.local (mDNS)

Jellyfin is reachable portlessly on the LAN at <http://jellyfin.local>, mirroring the `workshop.local` setup:

- `/etc/systemd/system/avahi-jellyfin.service` — publishes `jellyfin.local` → the server's LAN IP via `avahi-publish-address`.
- `/etc/nginx/sites-available/jellyfin` — nginx vhost routing `Host: jellyfin.local` to `127.0.0.1:8096` (websockets enabled, buffering off for streaming).

`http://jellyfin.local:8096` also works, since the name resolves to the host. Note Android browsers don't resolve `.local` names; the fetcher page falls back to `<hostname>:8096` links there.
