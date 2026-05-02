#!/usr/bin/env bash
# Jellyfin filename cleaner — sourced by ingest.sh and exposed for previews.
# Pure-bash regex parser: extracts canonical title/year/SxxExx, builds Jellyfin paths.

set -euo pipefail

VIDEO_EXTS_RE='\.(mkv|mp4|avi|mov|m4v|ts|wmv|flv|webm)$'
SUB_EXTS_RE='\.(srt|ass|ssa|sub|vtt)$'

# Tags to strip — applied case-insensitively, anywhere in the name.
JUNK_TAGS=(
  '2160p' '1080p' '720p' '480p' '4k' 'uhd' 'hdr' 'hdr10' 'sdr' 'dv' 'dovi'
  'x264' 'x265' 'h264' 'h265' 'hevc' 'avc' 'xvid' 'divx' '10bit' '8bit'
  'web-dl' 'webdl' 'webrip' 'web' 'bluray' 'brrip' 'bdrip' 'dvdrip'
  'hdrip' 'remux' 'hdtv' 'pdtv' 'dvdscr' 'cam' 'ts' 'tc'
  'aac' 'ac3' 'dts' 'dts-hd' 'dtshd' 'truehd' 'eac3' 'ddp' 'ddp5\.1'
  'dd5\.1' 'dd\+' 'flac' 'mp3' 'opus' '2\.0' '5\.1' '7\.1' 'atmos'
  'repack' 'proper' 'extended' 'unrated' 'internal' 'limited' 'imax'
  'dubbed' 'multisubs' 'multi' 'remastered' 'directors\.cut'
  'amzn' 'nf' 'dsnp' 'hulu' 'hbo' 'hmax' 'mx' 'atvp'
  'complete'
)

# Strip any wrapper directory pieces transmission may add (e.g., the windows-path one in TV Shows)
strip_path_prefix_junk() {
  local s="$1"
  s="${s##*[\\/]}"  # last component if any path crept in
  printf '%s' "$s"
}

# Replace dots/underscores with spaces, collapse whitespace, trim.
normalize_separators() {
  local s="$1"
  s="${s//./ }"
  s="${s//_/ }"
  s="$(printf '%s' "$s" | sed -E 's/[[:space:]]+/ /g; s/^ +//; s/ +$//')"
  printf '%s' "$s"
}

# Strip every junk tag (and any [bracket] or (paren) blocks that contain only junk)
strip_junk() {
  local s="$1"
  shopt -s nocasematch
  for tag in "${JUNK_TAGS[@]}"; do
    s="$(printf '%s' "$s" | sed -E "s/(^|[[:space:].\\-_])($tag)([[:space:].\\-_]|$)/\1 \3/Ig")"
  done
  # Drop trailing release-group after a dash: "...-RARBG", "...-ETRG", "...-Tigole"
  s="$(printf '%s' "$s" | sed -E 's/[[:space:].]-[[:space:].]?[A-Za-z0-9_]{2,}[[:space:].]*$//')"
  # Drop bracketed/paren'd encoder groups: [i_c], (Tigole), [YTS.MX], (Silence)
  s="$(printf '%s' "$s" | sed -E 's/[[(][^])]*[])]//g')"
  shopt -u nocasematch
  printf '%s' "$s"
}

# Sanitize for filesystem use — keep spaces, drop illegal chars.
# Also tidies up dangling brackets/dashes left behind after strip_junk.
sanitize_fs() {
  local s="$1"
  s="$(printf '%s' "$s" | tr -d '\000-\037')"
  s="$(printf '%s' "$s" | sed -E 's/[<>:"/\\|?*]//g')"
  # Drop unmatched/orphan opening or closing brackets that lost their content
  s="$(printf '%s' "$s" | sed -E 's/[[(][[:space:]]*[])]//g')"   # empty () or []
  s="$(printf '%s' "$s" | sed -E 's/[[:space:]][[(][[:space:]]+/ /g')" # " ( "  → " "
  s="$(printf '%s' "$s" | sed -E 's/[[:space:]]+[])][[:space:]]/ /g')" # " ) "  → " "
  s="$(printf '%s' "$s" | sed -E 's/[[(]+[[:space:]]*$//')"      # trailing "(" or "( "
  s="$(printf '%s' "$s" | sed -E 's/^[[:space:]]*[])]+//')"      # leading ")"
  # Collapse multi-dashes and orphan dashes between spaces
  s="$(printf '%s' "$s" | sed -E 's/[[:space:]]-[[:space:]]-([[:space:]]|$)/ \1/g')"
  s="$(printf '%s' "$s" | sed -E 's/[[:space:]]+/ /g; s/^[[:space:].\-]+//; s/[[:space:].\-]+$//')"
  printf '%s' "$s"
}

# Title-case a phrase, but keep small words lowercase (except first/last).
# Capitalizes after hyphens too (so "Spider-Man" stays "Spider-Man").
title_case() {
  local s="$1"
  printf '%s' "$s" | awk '
    function capword(w,    parts, i, out) {
      # split on hyphens, capitalize each piece, rejoin
      n2 = split(w, parts, "-");
      out = "";
      for (i=1; i<=n2; i++) {
        if (length(parts[i]) > 0) {
          parts[i] = toupper(substr(parts[i],1,1)) tolower(substr(parts[i],2));
        }
        out = (i==1 ? parts[i] : out "-" parts[i]);
      }
      return out;
    }
    {
      n = split($0, w, " ");
      small["a"]=1; small["an"]=1; small["the"]=1; small["and"]=1; small["or"]=1;
      small["but"]=1; small["of"]=1; small["in"]=1; small["on"]=1; small["at"]=1;
      small["to"]=1; small["for"]=1; small["with"]=1; small["from"]=1; small["by"]=1;
      small["as"]=1; small["vs"]=1;
      for (i=1; i<=n; i++) {
        lw = tolower(w[i]);
        if (i!=1 && i!=n && (lw in small)) { w[i] = lw; continue; }
        w[i] = capword(w[i]);
      }
      out = w[1]; for (i=2; i<=n; i++) out = out " " w[i];
      print out;
    }
  '
}

# parse_movie <name>  →  echoes "TITLE|YEAR" or empty if no year found.
parse_movie() {
  local raw="$1"
  raw="$(strip_path_prefix_junk "$raw")"
  # Drop extension if present
  raw="$(printf '%s' "$raw" | sed -E "s/$VIDEO_EXTS_RE//I")"
  raw="$(normalize_separators "$raw")"

  # Find a 4-digit year (1900–2099) — prefer the LAST one (release year usually trails the title).
  local year title
  year="$(printf '%s' "$raw" | grep -oE '\b(19[0-9]{2}|20[0-9]{2})\b' | tail -n1 || true)"
  if [[ -n "$year" ]]; then
    title="$(printf '%s' "$raw" | sed -E "s/(.*)\b$year\b.*/\1/")"
  else
    title="$raw"
  fi
  title="$(strip_junk "$title")"
  title="$(normalize_separators "$title")"
  title="$(sanitize_fs "$title")"
  title="$(title_case "$title")"
  printf '%s|%s' "$title" "$year"
}

# parse_tv <name>  →  echoes "SHOW|YEAR|SEASON|EPISODE" (year/season/episode optional).
# Detects: SxxExx, sNNeNN, 1x05, Season N, etc.
parse_tv() {
  local raw="$1"
  raw="$(strip_path_prefix_junk "$raw")"
  raw="$(printf '%s' "$raw" | sed -E "s/$VIDEO_EXTS_RE//I")"
  raw="$(normalize_separators "$raw")"

  local season episode show year=""
  # Try SxxExx first (specific episode)
  if [[ "$raw" =~ [sS]([0-9]{1,2})[[:space:]]?[eE]([0-9]{1,3}) ]]; then
    season="${BASH_REMATCH[1]}"
    episode="${BASH_REMATCH[2]}"
    show="$(printf '%s' "$raw" | sed -E "s/[sS][0-9]{1,2}[[:space:]]?[eE][0-9]{1,3}.*//")"
  # Sxx-Syy range (multi-season pack, e.g. "S01-S07") — use first season for the path
  elif [[ "$raw" =~ [sS]([0-9]{1,2})-[sS]([0-9]{1,2}) ]]; then
    season="${BASH_REMATCH[1]}"
    episode=""
    show="$(printf '%s' "$raw" | sed -E "s/[sS][0-9]{1,2}-[sS][0-9]{1,2}.*//")"
  # Bare Sxx (single-season pack, e.g. "Severance S01") — must be word-bounded to avoid "Sense8"
  elif [[ "$raw" =~ (^|[^A-Za-z])[sS]([0-9]{1,2})([^A-Za-z0-9]|$) ]]; then
    season="${BASH_REMATCH[2]}"
    episode=""
    show="$(printf '%s' "$raw" | sed -E "s/(^|[^A-Za-z])[sS][0-9]{1,2}([^A-Za-z0-9]|$).*/\1/")"
  elif [[ "$raw" =~ ([0-9]{1,2})[xX]([0-9]{1,3}) ]]; then
    season="${BASH_REMATCH[1]}"
    episode="${BASH_REMATCH[2]}"
    show="$(printf '%s' "$raw" | sed -E "s/[0-9]{1,2}[xX][0-9]{1,3}.*//")"
  elif [[ "$raw" =~ [sS]eason[[:space:]]+([0-9]{1,2}) ]]; then
    season="${BASH_REMATCH[1]}"
    episode=""
    show="$(printf '%s' "$raw" | sed -E "s/[sS]eason[[:space:]]+[0-9]{1,2}.*//")"
  else
    season=""
    episode=""
    show="$raw"
  fi

  # Strip residual "Season N", "Season N-M", "Seasons N to M", "Complete" leftovers from
  # multi-season pack names where one of the Sxx markers has already been consumed.
  show="$(printf '%s' "$show" | sed -E 's/[sS]easons?[[:space:]]+[0-9]+([[:space:]]*[-–to]+[[:space:]]*[0-9]+)?//g')"
  show="$(printf '%s' "$show" | sed -E 's/[[:space:]]complete[[:space:]]?/ /Ig')"

  # Strip trailing year from the show title and capture it
  if [[ "$show" =~ \(?(19[0-9]{2}|20[0-9]{2})\)? ]]; then
    year="${BASH_REMATCH[1]}"
    show="$(printf '%s' "$show" | sed -E "s/\(?[12][0-9]{3}\)?//")"
  fi

  show="$(strip_junk "$show")"
  show="$(normalize_separators "$show")"
  show="$(sanitize_fs "$show")"
  show="$(title_case "$show")"

  # Strip leading zeros
  season="$(printf '%s' "$season" | sed -E 's/^0+([0-9])/\1/')"
  episode="$(printf '%s' "$episode" | sed -E 's/^0+([0-9])/\1/')"

  printf '%s|%s|%s|%s' "$show" "$year" "$season" "$episode"
}

# build_movie_path <library_root> <title> <year> <ext>
build_movie_path() {
  local root="$1" title="$2" year="$3" ext="$4"
  local folder="$title"
  local file="$title"
  if [[ -n "$year" ]]; then
    folder="$title ($year)"
    file="$title ($year)"
  fi
  printf '%s/%s/%s%s' "$root" "$folder" "$file" "$ext"
}

# build_tv_path <library_root> <show> <year> <season> <episode> <ext>
build_tv_path() {
  local root="$1" show="$2" year="$3" season="$4" episode="$5" ext="$6"
  local show_dir="$show"
  [[ -n "$year" ]] && show_dir="$show ($year)"
  if [[ -n "$season" ]]; then
    local season_padded
    season_padded="$(printf 'S%02d' "$season")"
    local season_dir
    season_dir="$(printf 'Season %02d' "$season")"
    local file="$show - $season_padded"
    if [[ -n "$episode" ]]; then
      local ep_padded
      ep_padded="$(printf 'E%02d' "$episode")"
      file="$show - ${season_padded}${ep_padded}"
    fi
    printf '%s/%s/%s/%s%s' "$root" "$show_dir" "$season_dir" "$file" "$ext"
  else
    printf '%s/%s/%s%s' "$root" "$show_dir" "$show_dir" "$ext"
  fi
}

# preview_rename <mode> <name> <library_root>  →  prints "<original>\t<final-path>"
preview_rename() {
  local mode="$1" name="$2" root="$3"
  local ext
  ext="$(printf '%s' "$name" | grep -oEi "$VIDEO_EXTS_RE" || true)"
  if [[ "$mode" == "movie" ]]; then
    IFS='|' read -r title year <<<"$(parse_movie "$name")"
    build_movie_path "$root" "$title" "$year" "$ext"
  else
    IFS='|' read -r show year season ep <<<"$(parse_tv "$name")"
    build_tv_path "$root" "$show" "$year" "$season" "$ep" "$ext"
  fi
}

# When run directly, expose: ./clean.sh preview <tv|movie> <name> <root>
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    preview)
      preview_rename "$2" "$3" "$4"
      echo
      ;;
    parse-movie) parse_movie "$2"; echo ;;
    parse-tv)    parse_tv "$2"; echo ;;
    *)
      echo "Usage: $0 {preview <mode> <name> <root> | parse-movie <name> | parse-tv <name>}" >&2
      exit 2
      ;;
  esac
fi
