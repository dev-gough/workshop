import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolvePlaylistTracks, type LibraryTrackIdentity } from './musicLibrary';

const albums = Array.from({ length: 4_000 }, (_, albumIndex) => ({
  artist: `Artist ${albumIndex}`,
  name: `Album ${albumIndex}`,
  songs: Array.from({ length: 10 }, (_, songIndex) => `Track ${songIndex}.flac`),
}));
const playlist: LibraryTrackIdentity[] = Array.from({ length: 2_000 }, (_, index) => {
  const albumIndex = (index * 1_997) % albums.length;
  return {
    artist: albums[albumIndex].artist,
    album: albums[albumIndex].name,
    song: albums[albumIndex].songs[index % 10],
  };
});

function legacyResolve() {
  return playlist.map((song) => {
    const albumIndex = albums.findIndex(
      (album) => album.artist === song.artist && album.name === song.album,
    );
    const songIndex = albumIndex >= 0 ? albums[albumIndex].songs.indexOf(song.song) : -1;
    return { albumIndex, songIndex };
  }).filter((track) => track.albumIndex >= 0 && track.songIndex >= 0);
}

function medianRun(run: () => unknown): number {
  const samples = Array.from({ length: 7 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

assert.deepEqual(resolvePlaylistTracks(albums, playlist), legacyResolve());
const legacyMs = medianRun(legacyResolve);
const indexedMs = medianRun(() => resolvePlaylistTracks(albums, playlist));

console.log(JSON.stringify({
  albums: albums.length,
  libraryTracks: albums.length * albums[0].songs.length,
  playlistTracks: playlist.length,
  legacyMs: Number(legacyMs.toFixed(2)),
  indexedMs: Number(indexedMs.toFixed(2)),
  speedup: Number((legacyMs / indexedMs).toFixed(1)),
}));
