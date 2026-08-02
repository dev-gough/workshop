// "In Library" matching — decide whether a Soulseek result folder is an
// album already on the BarFoo shelves. Album-level, two signals:
//
//  1. Song overlap: most of the folder's audio files match song titles of
//     one specific library album (robust to folder-naming schemes).
//  2. Folder name: a path segment reads as "<artist> - <album>", "<album>",
//     etc. for an album we hold (robust to renamed/retagged tracks).
//
// Artist alone is deliberately NOT enough — owning two Anyma records must
// not badge every Anyma folder on the network.

import { cleanSongDisplay } from '@/lib/songUtils';

export interface LibraryAlbumRef {
  artist: string;
  name: string;
  songs: string[];
}

export interface FolderMatch {
  artist: string;
  album: string;
  /** Distinct library songs of that album found in the folder (0 for pure name matches). */
  matched: number;
  /** Audio files in the folder. */
  of: number;
  via: 'songs' | 'name';
}

export interface LibraryIndex {
  albums: { artist: string; name: string; artistKey: string; nameKey: string; songCount: number }[];
  /** normalized song title -> album ids holding a song with that title */
  songIndex: Map<string, number[]>;
}

const AUDIO_EXT_RE = /\.(flac|mp3|wav|ogg|m4a|aac|opus|wma|aiff?|ape|alac)$/i;

/** Aggressive text key: lowercased, deaccented, alphanumerics only. */
function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Album-title key: year tags and bracketed qualifiers ((Deluxe), [FLAC],
    {2019}…) dropped so "The End Of Genesys (2025) [FLAC]" == "The End of
    Genesys". Applied to BOTH library names and folder segments. */
function albumKey(s: string): string {
  return normKey(
    s
      .replace(/^\[\d{4}\]\s*/, '')
      .replace(/^\(?(19|20)\d{2}\)?\s*[-–.]\s*/, '')
      .replace(/[([{][^()[\]{}]*[)\]}]/g, ' ')
  );
}

/** Candidate title keys for one result filename: with/without the leading
    track number and with up to two "Artist - " / "Album - " prefixes
    stripped, so "01 - Anyma - Pictures of You.flac", "Anyma - Pictures of
    You.flac" and "01. Pictures of You.flac" all yield "pictures of you". */
function fileTitleKeys(filename: string): string[] {
  let base = filename.replace(/\\/g, '/').split('/').pop() || filename;
  base = base.replace(AUDIO_EXT_RE, '').replace(/_/g, ' ');
  const keys = new Set<string>();
  const push = (s: string) => {
    const k = normKey(s);
    if (k) keys.add(k);
  };
  const stripNum = (s: string) => s.replace(/^[a-d]?\d{1,3}[\s._-]+/i, '');
  push(base);
  let s = stripNum(base);
  push(s);
  for (let i = 0; i < 2; i++) {
    const idx = s.indexOf(' - ');
    if (idx < 0) break;
    s = s.slice(idx + 3);
    push(s);
    push(stripNum(s));
  }
  return [...keys];
}

export function buildLibraryIndex(albums: LibraryAlbumRef[]): LibraryIndex {
  const index: LibraryIndex = { albums: [], songIndex: new Map() };
  albums.forEach((a, id) => {
    index.albums.push({
      artist: a.artist,
      name: a.name,
      artistKey: normKey(a.artist),
      nameKey: albumKey(a.name),
      songCount: a.songs.length,
    });
    for (const song of a.songs) {
      const key = normKey(cleanSongDisplay(song, a.artist, a.name));
      if (!key) continue;
      const ids = index.songIndex.get(key);
      if (!ids) index.songIndex.set(key, [id]);
      else if (!ids.includes(id)) ids.push(id);
    }
  });
  return index;
}

/** Match one result folder (path + files) against the library. */
export function matchFolder(
  index: LibraryIndex,
  folderPath: string,
  files: { filename: string }[]
): FolderMatch | null {
  const audio = files.filter(f => AUDIO_EXT_RE.test(f.filename));

  // ── Signal 1: song overlap, tallied per album ──
  const perAlbum = new Map<number, Set<string>>();
  for (const f of audio) {
    for (const key of fileTitleKeys(f.filename)) {
      for (const id of index.songIndex.get(key) ?? []) {
        let set = perAlbum.get(id);
        if (!set) perAlbum.set(id, (set = new Set()));
        set.add(key);
      }
    }
  }
  let bestId = -1, bestMatched = 0;
  for (const [id, titles] of perAlbum) {
    if (titles.size > bestMatched) { bestId = id; bestMatched = titles.size; }
  }
  // Most of the folder must be one album we hold — 2+ shared titles so a
  // lone cover/single can't claim a whole folder.
  if (bestId >= 0 && bestMatched >= 2 && bestMatched >= audio.length * 0.5) {
    const a = index.albums[bestId];
    return { artist: a.artist, album: a.name, matched: bestMatched, of: audio.length, via: 'songs' };
  }

  // ── Signal 2: folder name reads as an album we hold ──
  const segs = folderPath.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2);
  const pathKey = ` ${normKey(segs.join(' '))} `;
  for (const seg of segs.map(albumKey).filter(Boolean)) {
    for (const a of index.albums) {
      if (!a.nameKey) continue;
      // A name-only match needs the artist somewhere in the path, or a
      // title distinctive enough to stand alone — "Greatest Hits" or
      // "Gold" without an artist must not badge strangers' folders.
      const artistNearby = !!a.artistKey && pathKey.includes(` ${a.artistKey} `);
      const standsAlone = a.nameKey.split(' ').length >= 3;
      if (!artistNearby && !standsAlone) continue;
      const hit =
        seg === a.nameKey ||
        seg === `${a.artistKey} ${a.nameKey}` ||
        ` ${seg} `.includes(` ${a.nameKey} `);
      if (hit) {
        return { artist: a.artist, album: a.name, matched: 0, of: audio.length, via: 'name' };
      }
    }
  }
  return null;
}
