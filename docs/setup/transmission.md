# Transmission

Used by the Jellyfin Ingest project to add torrents and watch their progress.

## Install

```bash
sudo apt-get install -y transmission-daemon
sudo systemctl stop transmission-daemon
```

Edit `/var/lib/transmission-daemon/info/settings.json`:

```json
{
  "rpc-username": "workshop",
  "rpc-password": "...",
  "rpc-whitelist-enabled": true,
  "rpc-whitelist": "127.0.0.1",
  "download-dir": "/Media/.staging"
}
```

```bash
sudo systemctl start transmission-daemon
```

## Wire it up

In `/setup` → **Transmission**, enter:

- RPC URL: `http://127.0.0.1:9091/transmission/rpc`
- Username / password as above

Click **Test connection** to verify the CSRF dance succeeds.

## Bundled installer

For the workshop's exact production layout (running as your user, with the torrent-done hook for Jellyfin), see `scripts/jellyfin/setup-daemon.sh`.
