#!/usr/bin/env bash
# Create the Python venv for the BrainFuck genetic algorithm and install
# its only runtime dep (numpy). Idempotent — safe to re-run.
#
# Reads the venv path from config.json (paths.pythonBin), or falls back to
# the in-repo default vendor/brainfuck-genetic/.venv.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Where to put the venv. Honor an override via $BF_REPO; otherwise read from
# config.json if present, else default to the submodule path.
DEFAULT_REPO="vendor/brainfuck-genetic"
BF_REPO="${BF_REPO:-}"
if [[ -z "$BF_REPO" && -f config.json ]]; then
  BF_REPO="$(node -e "try{const c=require('./config.json');process.stdout.write(c.paths?.brainfuckRepo||'')}catch{}" 2>/dev/null || true)"
fi
BF_REPO="${BF_REPO:-$DEFAULT_REPO}"

if [[ ! -d "$BF_REPO" ]]; then
  echo "BrainFuck repo not found at: $BF_REPO" >&2
  echo "Run \`git submodule update --init\` to populate vendor/brainfuck-genetic." >&2
  exit 1
fi

VENV="$BF_REPO/.venv"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.10+ first." >&2
  exit 1
fi

if [[ ! -d "$VENV" ]]; then
  echo "==> Creating venv at $VENV"
  python3 -m venv "$VENV"
else
  echo "==> Reusing venv at $VENV"
fi

echo "==> Installing numpy"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet numpy

echo "==> Done. Python: $VENV/bin/python"
