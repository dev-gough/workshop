import { sortedTrackIndices } from './songUtils';

export interface LibraryAlbum {
  songs: string[];
  songGenres?: Record<string, string[]>;
}

export interface RadioAlbum extends LibraryAlbum {
  artist: string;
  genres?: string[];
}

export interface LibraryTrackRef {
  albumIndex: number;
  songIndex: number;
}

export interface LibraryTrackIdentity {
  artist: string;
  album: string;
  song: string;
}

export interface GenrePlaylist {
  genre: string;
  tracks: LibraryTrackRef[];
}

function shuffledIndices(length: number, random: () => number): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

/** Randomize records while preserving each record's printed track order. */
export function buildAlbumShuffleQueue(
  albums: LibraryAlbum[],
  random: () => number = Math.random,
): LibraryTrackRef[] {
  return shuffledIndices(albums.length, random).flatMap((albumIndex) =>
    sortedTrackIndices(albums[albumIndex].songs).map((songIndex) => ({ albumIndex, songIndex })),
  );
}

/** Build read-only playlists from each track's embedded genre tags. */
export function buildGenrePlaylists(albums: LibraryAlbum[]): GenrePlaylist[] {
  const byGenre = new Map<string, GenrePlaylist>();

  albums.forEach((album, albumIndex) => {
    album.songs.forEach((song, songIndex) => {
      for (const rawGenre of album.songGenres?.[song] ?? []) {
        const genre = rawGenre.trim();
        if (!genre) continue;
        const key = genre.toLocaleLowerCase();
        let playlist = byGenre.get(key);
        if (!playlist) {
          playlist = { genre, tracks: [] };
          byGenre.set(key, playlist);
        }
        playlist.tracks.push({ albumIndex, songIndex });
      }
    });
  });

  return [...byGenre.values()].sort((a, b) =>
    a.genre.localeCompare(b.genre, undefined, { sensitivity: 'base' }),
  );
}

function trackGenres(album: RadioAlbum, song: string): Set<string> {
  return new Set(
    [...(album.songGenres?.[song] ?? []), ...(album.genres ?? [])]
      .map((genre) => genre.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
}

/**
 * Build a deterministic radio queue from one record. Closely tagged tracks
 * lead, while round-robin album buckets keep the mix from getting stuck on
 * one sleeve. Untagged libraries still get a useful cross-record mix.
 */
export function buildAlbumRadioQueue(
  albums: RadioAlbum[],
  seedAlbumIndex: number,
  limit = 24,
): LibraryTrackRef[] {
  const seed = albums[seedAlbumIndex];
  if (!seed || limit <= 0) return [];

  const seedOrder = sortedTrackIndices(seed.songs);
  if (seedOrder.length === 0) return [];
  const queue: LibraryTrackRef[] = [{ albumIndex: seedAlbumIndex, songIndex: seedOrder[0] }];
  if (limit === 1) return queue;

  const seedGenres = new Set(
    seed.songs.flatMap((song) => [...trackGenres(seed, song)]),
  );
  const buckets = albums.flatMap((album, albumIndex) => {
    if (albumIndex === seedAlbumIndex) return [];
    const tracks = sortedTrackIndices(album.songs).map((songIndex) => {
      const genres = trackGenres(album, album.songs[songIndex]);
      let affinity = 0;
      for (const genre of genres) if (seedGenres.has(genre)) affinity++;
      return { albumIndex, songIndex, affinity };
    });
    tracks.sort((a, b) => b.affinity - a.affinity);
    return tracks.length ? [{ artist: album.artist, tracks }] : [];
  });

  const hasMatches = buckets.some((bucket) => bucket.tracks[0].affinity > 0);
  const eligible = hasMatches
    ? buckets.filter((bucket) => bucket.tracks[0].affinity > 0)
    : buckets;
  eligible.sort((a, b) =>
    b.tracks[0].affinity - a.tracks[0].affinity ||
    a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }),
  );

  let round = 0;
  while (queue.length < limit) {
    let added = false;
    for (const bucket of eligible) {
      const track = bucket.tracks[round];
      if (!track || (hasMatches && track.affinity === 0)) continue;
      queue.push({ albumIndex: track.albumIndex, songIndex: track.songIndex });
      added = true;
      if (queue.length === limit) break;
    }
    if (!added) break;
    round++;
  }
  return queue;
}

function albumKey(artist: string, album: string): string {
  return `${artist}\0${album}`;
}

/**
 * Resolve external playlist identities in O(library tracks + playlist songs),
 * rather than scanning every album and track for every requested song.
 */
export function resolvePlaylistTracks(
  albums: (LibraryAlbum & { artist: string; name: string })[],
  songs: LibraryTrackIdentity[],
): LibraryTrackRef[] {
  const lookup = new Map<string, { albumIndex: number; songs: Map<string, number> }>();
  albums.forEach((album, albumIndex) => {
    const songs = new Map<string, number>();
    album.songs.forEach((song, songIndex) => {
      songs.set(song, songIndex);
    });
    lookup.set(albumKey(album.artist, album.name), { albumIndex, songs });
  });

  return songs.flatMap(({ artist, album, song }) => {
    const match = lookup.get(albumKey(artist, album));
    const songIndex = match?.songs.get(song);
    return match && songIndex !== undefined ? [{ albumIndex: match.albumIndex, songIndex }] : [];
  });
}
