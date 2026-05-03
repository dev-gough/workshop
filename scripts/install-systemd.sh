#!/usr/bin/env bash
# Install the workshop's systemd units (workshop, soulseek-ingest, challenge-poller)
# from the templates under scripts/systemd/. Substitutes $WORKSHOP_DIR and
# $SERVER_USER in each template.
#
# Usage: sudo bash scripts/install-systemd.sh
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo bash $0)" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_USER="${SERVER_USER:-${SUDO_USER:-$USER}}"
WORKSHOP_DIR="${WORKSHOP_DIR:-$REPO_ROOT}"

echo "==> Installing units"
echo "    SERVER_USER=$SERVER_USER"
echo "    WORKSHOP_DIR=$WORKSHOP_DIR"

for tmpl in "$REPO_ROOT"/scripts/systemd/*.service.tmpl; do
  unit="$(basename "$tmpl" .tmpl)"
  out="/etc/systemd/system/$unit"
  echo "  → $out"
  SERVER_USER="$SERVER_USER" WORKSHOP_DIR="$WORKSHOP_DIR" \
    envsubst '$SERVER_USER $WORKSHOP_DIR' < "$tmpl" > "$out"
done

systemctl daemon-reload
echo "==> Enabling units (start them with: sudo systemctl start <unit>)"
for tmpl in "$REPO_ROOT"/scripts/systemd/*.service.tmpl; do
  unit="$(basename "$tmpl" .tmpl)"
  systemctl enable "$unit" 2>/dev/null || true
done

echo "==> Done. Start with:"
echo "    sudo systemctl start workshop soulseek-ingest challenge-poller"
