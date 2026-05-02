#!/usr/bin/env bash
# fetch.sh — submit a torrent or magnet to transmission-daemon, staged for
# Jellyfin Fetcher to auto-clean and move into /Media on completion.
#
# Usage:
#   fetch.sh -t <link>          # TV show
#   fetch.sh -m <link>          # Movie
#   fetch.sh -p -t "<name>"     # Preview the rename (no download)
#   fetch.sh --json -t <link>   # Emit JSON (for the workshop API)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f "${BASH_SOURCE[0]}")")" &>/dev/null && pwd)"
CLEAN_LIB="$SCRIPT_DIR/clean.sh"
STAGING_TV="/Media/.staging/tv"
STAGING_MOVIES="/Media/.staging/movies"
TV_LIBRARY="/Media/TV Shows"
MOVIE_LIBRARY="/Media/Movies"

usage() {
  cat <<'EOF'
Usage:
  fetch.sh -t <torrent-link-or-magnet>     Download a TV show
  fetch.sh -m <torrent-link-or-magnet>     Download a movie
  fetch.sh -p -t "<filename-or-name>"      Preview rename (no download)
  fetch.sh -p -m "<filename-or-name>"
  fetch.sh --json -t <link>                Emit JSON: {hash, name, mode, staging}

Requires: transmission-daemon running locally with RPC creds in
~/.config/transmission-daemon/settings.json (run scripts/jellyfin/setup-daemon.sh).
EOF
}

die() { echo "Error: $*" >&2; exit 1; }

mode=""; preview=0; json=0; link=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t) [[ -n "$mode" ]] && die "Use only one of -t or -m"; mode="tv"; shift ;;
    -m) [[ -n "$mode" ]] && die "Use only one of -t or -m"; mode="movie"; shift ;;
    -p|--preview) preview=1; shift ;;
    --json) json=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) usage; die "Unknown flag: $1" ;;
    *)  [[ -n "$link" ]] && die "Only one link/name allowed"; link="$1"; shift ;;
  esac
done

[[ -z "$mode" ]] && { usage; die "You must specify -t or -m"; }
[[ -z "$link" ]] && { usage; die "You must provide a link or name"; }

# Preview mode — just show the rename target, no daemon needed.
if [[ $preview -eq 1 ]]; then
  [[ -f "$CLEAN_LIB" ]] || die "Cleaner not found: $CLEAN_LIB"
  # shellcheck source=/dev/null
  source "$CLEAN_LIB"
  root="$([[ "$mode" == "tv" ]] && printf '%s' "$TV_LIBRARY" || printf '%s' "$MOVIE_LIBRARY")"
  out="$(preview_rename "$mode" "$link" "$root")"
  if [[ $json -eq 1 ]]; then
    printf '{"mode":"%s","input":"%s","preview":"%s"}\n' "$mode" "${link//\"/\\\"}" "${out//\"/\\\"}"
  else
    echo "$out"
  fi
  exit 0
fi

command -v transmission-remote >/dev/null 2>&1 \
  || die "transmission-remote not installed. Run scripts/jellyfin/setup-daemon.sh"

# Read RPC creds from transmission-daemon's settings (the daemon owns the source of truth).
SETTINGS="${TR_SETTINGS_JSON:-$HOME/.config/transmission-daemon/settings.json}"
[[ -r "$SETTINGS" ]] || die "Can't read $SETTINGS — is the daemon set up?"
RPC_PORT="$(grep -oE '"rpc-port"[[:space:]]*:[[:space:]]*[0-9]+' "$SETTINGS" | grep -oE '[0-9]+$' || echo 9091)"
RPC_USER="$(grep -oE '"rpc-username"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS" | sed -E 's/.*"([^"]*)"$/\1/')"
RPC_PASS="$(grep -oE '"rpc-password"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS" | sed -E 's/.*"([^"]*)"$/\1/')"

dest="$([[ "$mode" == "tv" ]] && printf '%s' "$STAGING_TV" || printf '%s' "$STAGING_MOVIES")"
mkdir -p "$dest"

TR_AUTH=()
[[ -n "$RPC_USER" && -n "$RPC_PASS" ]] && TR_AUTH=(-n "$RPC_USER:$RPC_PASS")

# Submit the torrent. transmission-remote prints "responseCode: 200" or similar.
out="$(transmission-remote "127.0.0.1:$RPC_PORT" "${TR_AUTH[@]}" \
  -a "$link" -w "$dest" 2>&1)" || die "transmission-remote failed: $out"

# Find the just-added torrent (latest in the list with state we can match).
list="$(transmission-remote "127.0.0.1:$RPC_PORT" "${TR_AUTH[@]}" -l 2>/dev/null || true)"
last_id="$(printf '%s\n' "$list" | awk 'NR>1 && $1 ~ /^[0-9]+$/ {id=$1} END{print id}')"

hash=""
name=""
if [[ -n "$last_id" ]]; then
  info="$(transmission-remote "127.0.0.1:$RPC_PORT" "${TR_AUTH[@]}" -t "$last_id" -i 2>/dev/null || true)"
  hash="$(printf '%s' "$info" | grep -oE 'Hash:[[:space:]]*[a-fA-F0-9]+' | awk '{print tolower($2)}' || true)"
  name="$(printf '%s' "$info" | grep -m1 -oE 'Name:[[:space:]]*.+' | sed -E 's/^Name:[[:space:]]*//')"
fi

if [[ $json -eq 1 ]]; then
  printf '{"mode":"%s","id":%s,"hash":"%s","name":"%s","staging":"%s"}\n' \
    "$mode" "${last_id:-null}" "$hash" "${name//\"/\\\"}" "$dest"
else
  echo "Submitted to transmission-daemon"
  echo "  mode:    $mode"
  echo "  id:      ${last_id:-?}"
  echo "  hash:    ${hash:-?}"
  echo "  name:    ${name:-?}"
  echo "  staging: $dest"
  echo "  ingest:  on completion → $([[ "$mode" == tv ]] && echo "$TV_LIBRARY" || echo "$MOVIE_LIBRARY")"
fi
