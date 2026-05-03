# Jellyfin

Jellyfin is only required for the **Jellyfin** project tile (server status + transcoder pings). The workshop also reads Jellyfin's port to expose it on the server dashboard.

## Install

```bash
curl https://repo.jellyfin.org/install-debuntu.sh | sudo bash
```

Then visit <http://localhost:8096> and complete the first-run wizard pointing at your media directories.

## Wire it up

In `/setup` → **Jellyfin**, set the base URL (`http://localhost:8096`). The API key is optional — we currently only ping `/System/Info/Public`, which doesn't need auth.

Click **Test connection** to verify.
