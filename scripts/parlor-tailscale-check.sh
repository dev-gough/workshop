#!/usr/bin/env bash
# Confirm this machine can reach the laptop's Parlor compute over Tailscale.
# Chat is HTTP to Ollama. Drawing is SSH, then the laptop's parlor-image.sh.
#
# Usage:
#   scripts/parlor-tailscale-check.sh http://devy-l.tailnet.ts.net:11434 devon@devy-l.tailnet.ts.net

set -euo pipefail

base="${1:-}"
ssh_host="${2:-}"
if [[ -z "$base" || -z "$ssh_host" ]]; then
  echo "Usage: $0 <ollama-base-url> <ssh-host>" >&2
  exit 2
fi
if [[ ! "$base" =~ ^https?:// ]] || [[ ! "$ssh_host" =~ ^[A-Za-z0-9_.:@-]+$ ]]; then
  echo "Base URL must be http(s), and the SSH host must be a host or user@host." >&2
  exit 2
fi

echo "Ollama tags at $base"
code=$(curl -sS -m 8 -o /tmp/parlor-tailscale-tags.json -w '%{http_code}' "$base/api/tags") || {
  echo "Could not reach Ollama. Is the laptop on the tailnet, and is :11434 open to this machine?" >&2
  exit 1
}
if [[ "$code" != "200" ]]; then
  echo "Ollama answered $code." >&2
  exit 1
fi
python3 - << 'PY'
import json
body = json.load(open("/tmp/parlor-tailscale-tags.json"))
names = [m.get("name") for m in body.get("models", []) if m.get("name")]
print(f"{len(names)} model(s)")
for name in names:
    print(f"  {name}")
PY
rm -f /tmp/parlor-tailscale-tags.json

echo "SSH to $ssh_host"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$ssh_host" 'test -x /home/devon/compute/parlor-image.sh && echo parlor-image.sh ok'
echo "The work server can talk and draw."
