import { sortedTrackIndices } from './songUtils';

export interface LibraryAlbum {
  songs: string[];
  songGenres?: Record<string, string[]>;
}

export interface LibraryTrackRef {
  albumIndex: number;
  songIndex: number;
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
