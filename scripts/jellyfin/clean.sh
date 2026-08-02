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
  # dot-separated names are space-normalized before stripping, so the dotted
  # audio tags above also need their spaced forms. NO capture groups here —
  # tags are interpolated into a sed pattern whose \1/\3 refs would shift.
  'ddp[0-9]+ [017]' 'ddp[0-9]+' 'dd[0-9]+ [017]' 'dd[0-9]+'
  'eac[0-9]+' '[57] 1' '2 0' '[0-9]+bits?'
  'repack' 'proper' 'extended' 'unrated' 'internal' 'limited' 'imax'
  'dubbed' 'multisubs' 'multi' 'remastered' 'directors\.cut' 'esubs?' 'subbed'
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
  # NB: dash must sit LAST in the bracket class — ".\-_" reads as a \..._ range
  # that silently excludes '-' itself, breaking "HEVC-Group" style boundaries.
  for tag in "${JUNK_TAGS[@]}"; do
    s="$(printf '%s' "$s" | sed -E "s/(^|[[:space:]._-])($tag)([[:space:]._-]|$)/\1 \3/Ig")"
  done
  # Drop trailing release-group after a dash: "...-RARBG", "...-ETRG", "...-Tigole",
  # including codec-digit-prefixed forms like "265-Rapta"
  s="$(printf '%s' "$s" | sed -E 's/[[:space:].]-[[:space:].]?[A-Za-z0-9_]{2,}[[:space:].]*$//')"
  s="$(printf '%s' "$s" | sed -E 's/[[:space:]][0-9]{2,4}-[A-Za-z0-9_]{2,}[[:space:].]*$//')"
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

# Clean an episode-title fragment: junk tags out, filesystem-safe, keep the
# source's own casing (episode titles are usually already well-cased).
clean_eptitle() {
  local s="$1"
  s="$(printf '%s' "$s" | sed -E 's/^[[:space:].\-]+//')"
  s="$(strip_junk "$s")"
  s="$(normalize_separators "$s")"
  s="$(sanitize_fs "$s")"
  printf '%s' "$s"
}

# Extras that must not become "shows": creditless openings/endings, previews,
# trailers, menus, samples. Word-bounded, checked only when no episode parses.
EXTRAS_RE='(^|[^a-zA-Z])(nc(op|ed)|clean[ ._-]?(op|ed|opening|ending)|creditless|preview|trailer|menu|sample|extras?|adds|omake|featurettes?)([^a-zA-Z]|$)'

# parse_tv <name>  →  echoes "SHOW|YEAR|SEASON|EPISODE|EPTITLE|KIND"
# (year/season/episode/eptitle optional; KIND is "episode" or "extra").
# Detects: SxxExx, sNNeNN, 1x05, Season N, OAD/OVA/Special NN (→ season 0),
# SxxPyy part-specials (→ extra), and anime absolute numbering ("Show - 01 - Title").
parse_tv() {
  local raw="$1"
  raw="$(strip_path_prefix_junk "$raw")"
  raw="$(printf '%s' "$raw" | sed -E "s/$VIDEO_EXTS_RE//I")"

  # Fractional episodes ("S01E13.5") are recap specials with no real episode
  # slot — flag before normalization turns the dot into a space and the number
  # silently collides with the real SxxExx episode.
  local fractional=0
  [[ "$raw" =~ [sS][0-9]{1,2}[[:space:]]?[eE][0-9]{1,3}[.][0-9] ]] && fractional=1

  raw="$(normalize_separators "$raw")"

  local season episode show year="" eptitle="" kind="episode"
  # Try SxxExx first (specific episode)
  if [[ "$raw" =~ [sS]([0-9]{1,2})[[:space:]]?[eE]([0-9]{1,3}) ]]; then
    season="${BASH_REMATCH[1]}"
    episode="${BASH_REMATCH[2]}"
    show="${raw%%"${BASH_REMATCH[0]}"*}"
    eptitle="${raw#*"${BASH_REMATCH[0]}"}"
  # SxxPyy — "part"/special markers inside a season ("S04P03 - ... Special 1").
  # No portable episode slot for these → file them under the show's extras.
  elif [[ "$raw" =~ [sS]([0-9]{1,2})[[:space:]]?[pP]([0-9]{1,3}) ]]; then
    season="${BASH_REMATCH[1]}"
    episode=""
    kind="extra"
    show="${raw%%"${BASH_REMATCH[0]}"*}"
  # OAD/OVA/ONA/Special NN → Jellyfin's specials season (Season 00)
  elif [[ "$raw" =~ (^|[^A-Za-z])([oO][aAvVnN][dDaA]|[sS][pP][eE][cC][iI][aA][lL])[sS]?[[:space:]._-]*[eE]?0*([0-9]{1,3}) ]]; then
    season="0"
    episode="${BASH_REMATCH[3]}"
    show="${raw%%"${BASH_REMATCH[0]}"*}"
    eptitle="${raw#*"${BASH_REMATCH[0]}"}"
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

  # Absolute numbering ("Show - 01 - Title" / "Show - 01v2 - Title"), common in
  # anime packs. Only fills a still-missing episode; 1-3 digits so years never
  # match. A missing season defaults to 1 further below — grouping every
  # episode under one show beats a folder per episode.
  if [[ -z "$episode" && "$kind" == "episode" ]] &&
     [[ "$raw" =~ [[:space:]]-[[:space:]]0*([0-9]{1,3})([vV][0-9])?([[:space:]]-[[:space:]]|[[:space:]]?\(|[[:space:]]?\[|$) ]]; then
    episode="${BASH_REMATCH[1]}"
    [[ -z "$season" ]] && season="1"
    if [[ -z "$show" || "$show" == "$raw" ]]; then
      show="${raw%%"${BASH_REMATCH[0]}"*}"
      eptitle="${raw#*"${BASH_REMATCH[0]}"}"
    fi
  fi

  if [[ "$fractional" -eq 1 ]]; then
    kind="extra"
    episode=""
    eptitle=""
  fi

  # Still nothing episode-like? Check for extras (creditless OP/ED, previews…)
  # so they don't masquerade as one-episode shows.
  if [[ -z "$season" && -z "$episode" && "$kind" == "episode" ]]; then
    shopt -s nocasematch
    if [[ "$raw" =~ $EXTRAS_RE ]]; then
      kind="extra"
      show="${raw%%"${BASH_REMATCH[0]}"*}"
    fi
    shopt -u nocasematch
  fi

  # Strip residual "Season N", "Season N-M", "Seasons N to M", "Complete" leftovers from
  # multi-season pack names where one of the Sxx markers has already been consumed.
  show="$(printf '%s' "$show" | sed -E 's/[[:space:]]all[[:space:]]+seasons?([[:space:]]|$)/ /Ig')"
  show="$(printf '%s' "$show" | sed -E 's/seasons?[[:space:]]+[0-9]+([[:space:]]*[-–to]+[[:space:]]*[0-9]+)?//Ig')"
  show="$(printf '%s' "$show" | sed -E 's/[[:space:]]complete[[:space:]]?/ /Ig')"
  # Named-season suffixes ("Show - The Final Season - S04E01") belong to the
  # season, not the show — keep them out of the show folder.
  show="$(printf '%s' "$show" | sed -E 's/[-–[:space:]]*(the[[:space:]]+)?final[[:space:]]+season[-–[:space:]]*$//I')"

  # Strip trailing year from the show title and capture it. Boundary-guarded so
  # digit runs inside release-hashes ("[2051945C]") never read as years.
  if [[ "$show" =~ (^|[^0-9A-Za-z])((19|20)[0-9]{2})([^0-9A-Za-z]|$) ]]; then
    year="${BASH_REMATCH[2]}"
    show="$(printf '%s' "$show" | sed -E "s/\(?$year\)?//")"
  fi

  show="$(strip_junk "$show")"
  show="$(normalize_separators "$show")"
  show="$(sanitize_fs "$show")"
  show="$(title_case "$show")"
  eptitle="$(clean_eptitle "$eptitle")"

  # Strip leading zeros
  season="$(printf '%s' "$season" | sed -E 's/^0+([0-9])/\1/')"
  episode="$(printf '%s' "$episode" | sed -E 's/^0+([0-9])/\1/')"

  printf '%s|%s|%s|%s|%s|%s' "$show" "$year" "$season" "$episode" "$eptitle" "$kind"
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

# build_tv_path <library_root> <show> <year> <season> <episode> <ext> [eptitle]
build_tv_path() {
  local root="$1" show="$2" year="$3" season="$4" episode="$5" ext="$6" eptitle="${7:-}"
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
      [[ -n "$eptitle" ]] && file="$file - $eptitle"
    fi
    printf '%s/%s/%s/%s%s' "$root" "$show_dir" "$season_dir" "$file" "$ext"
  else
    printf '%s/%s/%s%s' "$root" "$show_dir" "$show_dir" "$ext"
  fi
}

# build_tv_extra_path <library_root> <show> <year> <original_name>
# Extras live in the show's "extras" folder (a Jellyfin-recognized name),
# keeping a cleaned version of their original filename.
build_tv_extra_path() {
  local root="$1" show="$2" year="$3" name="$4"
  local ext base show_dir="$show"
  [[ -n "$year" ]] && show_dir="$show ($year)"
  ext="$(printf '%s' "$name" | grep -oEi "$VIDEO_EXTS_RE" || true)"
  base="$(printf '%s' "$name" | sed -E "s/$VIDEO_EXTS_RE//I")"
  base="$(clean_eptitle "$(normalize_separators "$base")")"
  printf '%s/%s/extras/%s%s' "$root" "$show_dir" "$base" "$ext"
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
    IFS='|' read -r show year season ep eptitle kind <<<"$(parse_tv "$name")"
    if [[ "$kind" == "extra" ]]; then
      build_tv_extra_path "$root" "$show" "$year" "$name"
    else
      build_tv_path "$root" "$show" "$year" "$season" "$ep" "$ext" "$eptitle"
    fi
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
