#!/usr/bin/env bash
# transmission-daemon torrent-done script.
# Reads TR_* env vars, picks the largest video file (and any sidecar subs),
# moves into the Jellyfin layout, and records the move in postgres.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
# shellcheck source=clean.sh
source "$SCRIPT_DIR/clean.sh"

LOG_FILE="/var/log/jellyfin-fetch/ingest.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || LOG_FILE="/tmp/jellyfin-ingest.log"

TV_LIBRARY="${JELLYFIN_TV_DIR:-/Media/TV Shows}"
MOVIE_LIBRARY="${JELLYFIN_MOVIE_DIR:-/Media/Movies}"
STAGING_TV="/Media/.staging/tv"
STAGING_MOVIES="/Media/.staging/movies"

PSQL_DSN="${JELLYFIN_PSQL_DSN:-postgresql://server:workshop@localhost:5432/workshop}"

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*" >>"$LOG_FILE"; }

psql_exec() {
  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD=workshop psql "$PSQL_DSN" -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>>"$LOG_FILE" || true
  fi
}

# Determine mode from the staging dir. transmission's TR_TORRENT_DIR is the download-dir.
mode=""
case "${TR_TORRENT_DIR:-}" in
  "$STAGING_TV"*)     mode="tv" ;;
  "$STAGING_MOVIES"*) mode="movie" ;;
  *)
    log "Unknown TR_TORRENT_DIR=$TR_TORRENT_DIR — skipping"
    exit 0
    ;;
esac

torrent_path="${TR_TORRENT_DIR}/${TR_TORRENT_NAME}"
log "Ingest start mode=$mode hash=${TR_TORRENT_HASH:-?} path=$torrent_path"

[[ -e "$torrent_path" ]] || { log "Path missing: $torrent_path"; exit 0; }

# Collect candidate video files (largest first), and any subtitle siblings.
mapfile -t videos < <(
  find "$torrent_path" -type f -regextype posix-extended \
    -iregex '.*\.(mkv|mp4|avi|mov|m4v|ts|wmv|flv|webm)$' \
    -printf '%s\t%p\n' 2>/dev/null | sort -rn | cut -f2-
)

if [[ ${#videos[@]} -eq 0 ]]; then
  log "No video files found in $torrent_path"
  exit 0
fi

ingest_one() {
  local src="$1" mode="$2"
  local base ext final_path final_dir final_name
  base="$(basename "$src")"
  ext="$(printf '%s' "$base" | grep -oEi "$VIDEO_EXTS_RE" || true)"

  if [[ "$mode" == "movie" ]]; then
    IFS='|' read -r title year <<<"$(parse_movie "$base")"
    [[ -z "$title" ]] && title="$(parse_movie "$TR_TORRENT_NAME")" && IFS='|' read -r title year <<<"$title"
    final_path="$(build_movie_path "$MOVIE_LIBRARY" "$title" "$year" "$ext")"
  else
    IFS='|' read -r show year season episode <<<"$(parse_tv "$base")"
    # Always merge torrent-name fields to fill any missing piece. The torrent
    # name is more reliable for the show's canonical year than per-episode
    # filenames, which often omit it. Without this merge, "Severance.S02E01.mkv"
    # gives year="" and "Severance.2022.S01E01.mkv" gives year="2022", so the
    # two seasons land under different show folders.
    IFS='|' read -r show2 year2 season2 episode2 <<<"$(parse_tv "$TR_TORRENT_NAME")"
    [[ -z "$show"    ]] && show="$show2"
    [[ -z "$year"    ]] && year="$year2"
    [[ -z "$season"  ]] && season="$season2"
    [[ -z "$episode" ]] && episode="$episode2"
    final_path="$(build_tv_path "$TV_LIBRARY" "$show" "$year" "$season" "$episode" "$ext")"
  fi

  final_dir="$(dirname "$final_path")"
  final_name="$(basename "$final_path")"
  mkdir -p "$final_dir"

  if [[ -e "$final_path" ]]; then
    log "Already exists, skipping: $final_path"
    return 0
  fi

  # Hardlink first (instant, same filesystem); fall back to copy.
  if ln "$src" "$final_path" 2>/dev/null; then
    log "Linked $src → $final_path"
  else
    cp -- "$src" "$final_path"
    log "Copied $src → $final_path"
  fi

  # Pick up subtitles that share the basename
  local src_stem
  src_stem="${src%.*}"
  local sub
  for sub in "$src_stem".*; do
    [[ -f "$sub" ]] || continue
    [[ "$sub" =~ $SUB_EXTS_RE ]] || continue
    local sub_ext sub_dest
    sub_ext="${sub##*.}"
    sub_dest="${final_path%.*}.$sub_ext"
    cp -- "$sub" "$sub_dest" 2>/dev/null && log "Subtitle $sub → $sub_dest"
  done

  psql_exec "
    INSERT INTO jellyfin_ingest_files (torrent_id, source_path, dest_path, size_bytes, kind)
    SELECT id, '$(printf '%s' "$src" | sed "s/'/''/g")',
              '$(printf '%s' "$final_path" | sed "s/'/''/g")',
              $(stat -c%s "$src" 2>/dev/null || echo 0),
              'video'
    FROM jellyfin_torrents
    WHERE hash = '$(printf '%s' "${TR_TORRENT_HASH:-}" | tr 'A-F' 'a-f')'
      AND status NOT IN ('removed', 'ingested')
    ORDER BY id DESC LIMIT 1;
  "
}

# For movies: ingest only the largest video. For TV: ingest every video (season packs).
if [[ "$mode" == "movie" ]]; then
  ingest_one "${videos[0]}" "$mode"
else
  for v in "${videos[@]}"; do ingest_one "$v" "$mode"; done
fi

# Mark the torrent row as ingested
final_for_db=""
if [[ "$mode" == "movie" ]]; then
  IFS='|' read -r t y <<<"$(parse_movie "${videos[0]##*/}")"
  ext="$(printf '%s' "${videos[0]}" | grep -oEi "$VIDEO_EXTS_RE" || true)"
  final_for_db="$(build_movie_path "$MOVIE_LIBRARY" "$t" "$y" "$ext")"
else
  IFS='|' read -r s y se ep <<<"$(parse_tv "$TR_TORRENT_NAME")"
  final_for_db="$TV_LIBRARY/$s${y:+ ($y)}${se:+/Season $(printf %02d "$se")}"
fi

hash_lc="$(printf '%s' "${TR_TORRENT_HASH:-}" | tr 'A-F' 'a-f')"
# Scope to non-terminal rows: a previously-removed submission of the same
# magnet (e.g. user cancelled a wrong-mode add and re-submitted with the
# correct mode) must not be retroactively flipped to 'ingested'.
psql_exec "
  UPDATE jellyfin_torrents
  SET status = 'ingested',
      completed_at = COALESCE(completed_at, NOW()),
      ingested_at = NOW(),
      final_path = '$(printf '%s' "$final_for_db" | sed "s/'/''/g")'
  WHERE hash = '$hash_lc'
    AND status NOT IN ('removed', 'ingested');
"

log "Ingest done"
