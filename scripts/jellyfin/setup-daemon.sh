#!/usr/bin/env bash
# One-time setup for the Jellyfin Fetcher.
# Installs transmission-daemon, configures it to run as the `server` user with
# the workshop's torrent-done hook, and applies the DB migration.
#
# Run as: sudo bash scripts/jellyfin/setup-daemon.sh

set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Must be run as root (use sudo)." >&2; exit 1; }

SERVER_USER="${SERVER_USER:-server}"
RPC_PORT="${RPC_PORT:-9091}"
RPC_USER="${RPC_USER:-workshop}"
RPC_PASS="${RPC_PASS:-$(openssl rand -hex 16)}"
WORKSHOP_DIR="/home/$SERVER_USER/devys-workshop"

CONFIG_DIR="/var/lib/transmission-daemon/info"
SETTINGS="$CONFIG_DIR/settings.json"

echo "==> Installing transmission-daemon"
apt-get update -qq
apt-get install -y -qq transmission-daemon transmission-cli jq postgresql-client

echo "==> Stopping daemon to edit settings"
systemctl stop transmission-daemon || true

mkdir -p /Media/.staging/tv /Media/.staging/movies /Media/.incomplete /var/log/jellyfin-fetch
chown -R "$SERVER_USER:$SERVER_USER" /Media/.staging /Media/.incomplete /var/log/jellyfin-fetch

# Run the daemon as the `server` user so it can read/write /Media without perm gymnastics.
# Force Type=simple — the package ships Type=notify but transmission-daemon doesn't reliably
# call sd_notify(READY=1) on Ubuntu 24.04, so systemd kills it after the start timeout.
mkdir -p /etc/systemd/system/transmission-daemon.service.d
cat >/etc/systemd/system/transmission-daemon.service.d/override.conf <<EOF
[Service]
Type=simple
User=$SERVER_USER
Group=$SERVER_USER
EOF

# Move config into the server user's home (cleaner permissions)
USER_CONFIG_DIR="/home/$SERVER_USER/.config/transmission-daemon"
mkdir -p "$USER_CONFIG_DIR"
chown -R "$SERVER_USER:$SERVER_USER" "/home/$SERVER_USER/.config"

# Write a minimal settings.json. Daemon will fill in defaults for anything else on first start.
cat >"$USER_CONFIG_DIR/settings.json" <<EOF
{
  "rpc-enabled": true,
  "rpc-bind-address": "127.0.0.1",
  "rpc-port": $RPC_PORT,
  "rpc-whitelist-enabled": false,
  "rpc-authentication-required": true,
  "rpc-username": "$RPC_USER",
  "rpc-password": "$RPC_PASS",
  "download-dir": "/Media/.staging/movies",
  "incomplete-dir": "/Media/.incomplete",
  "incomplete-dir-enabled": true,
  "umask": 2,
  "script-torrent-done-enabled": true,
  "script-torrent-done-filename": "$WORKSHOP_DIR/scripts/jellyfin/ingest.sh",
  "ratio-limit-enabled": true,
  "ratio-limit": 1.0,
  "idle-seeding-limit-enabled": true,
  "idle-seeding-limit": 30
}
EOF
chown "$SERVER_USER:$SERVER_USER" "$USER_CONFIG_DIR/settings.json"
chmod 600 "$USER_CONFIG_DIR/settings.json"

# Override the unit's ExecStart to point at our config dir.
cat >>/etc/systemd/system/transmission-daemon.service.d/override.conf <<EOF
ExecStart=
ExecStart=/usr/bin/transmission-daemon -f --log-level=info --config-dir=$USER_CONFIG_DIR
EOF

chmod +x "$WORKSHOP_DIR/scripts/jellyfin/clean.sh" "$WORKSHOP_DIR/scripts/jellyfin/ingest.sh"

echo "==> Applying DB migration"
sudo -u "$SERVER_USER" bash -c "PGPASSWORD=workshop psql -h localhost -U server -d workshop -f $WORKSHOP_DIR/scripts/migrations/002-jellyfin.sql"

echo "==> Opening firewall (loopback only — RPC is bound to 127.0.0.1)"
# No external port; the workshop talks to the daemon over loopback.

echo "==> Starting transmission-daemon"
systemctl daemon-reload
systemctl enable --now transmission-daemon

echo "==> Writing daemon creds into devys-workshop/config.json"
TMP_JSON="$(mktemp)"
sudo -u "$SERVER_USER" jq \
  --arg url "http://127.0.0.1:$RPC_PORT/transmission/rpc" \
  --arg user "$RPC_USER" --arg pass "$RPC_PASS" \
  '. + {transmission: {rpcUrl: $url, username: $user, password: $pass}}' \
  "$WORKSHOP_DIR/config.json" >"$TMP_JSON"
mv "$TMP_JSON" "$WORKSHOP_DIR/config.json"
chown "$SERVER_USER:$SERVER_USER" "$WORKSHOP_DIR/config.json"
chmod 600 "$WORKSHOP_DIR/config.json"

echo
echo "Done. transmission-daemon is running on 127.0.0.1:$RPC_PORT"
echo "  RPC user: $RPC_USER"
echo "  RPC pass: $RPC_PASS"
echo "  Staging:  /Media/.staging/{tv,movies}"
echo "  Done hook: $WORKSHOP_DIR/scripts/jellyfin/ingest.sh"
