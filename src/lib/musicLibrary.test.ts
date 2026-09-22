import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAlbumShuffleQueue, buildGenrePlaylists } from './musicLibrary';
import { normalizeGenres } from './musicScanner';

test('album shuffle keeps tracks together and in track order', () => {
  const albums = [
    { songs: ['02 - Two.flac', '01 - One.flac'] },
    { songs: ['03 - C.flac', '01 - A.flac', '02 - B.flac'] },
  ];

  const queue = buildAlbumShuffleQueue(albums, () => 0);

  assert.deepEqual(queue, [
    { albumIndex: 1, songIndex: 1 },
    { albumIndex: 1, songIndex: 2 },
    { albumIndex: 1, songIndex: 0 },
    { albumIndex: 0, songIndex: 1 },
    { albumIndex: 0, songIndex: 0 },
  ]);
});

test('genre playlists use per-track tags and merge case-insensitively', () => {
  const playlists = buildGenrePlaylists([
    {
      songs: ['one.flac', 'two.flac'],
      songGenres: {
        'one.flac': ['Rock', 'Indie'],
        'two.flac': ['rock'],
      },
    },
  ]);

  assert.deepEqual(playlists, [
    { genre: 'Indie', tracks: [{ albumIndex: 0, songIndex: 0 }] },
    {
      genre: 'Rock',
      tracks: [
        { albumIndex: 0, songIndex: 0 },
        { albumIndex: 0, songIndex: 1 },
      ],
    },
  ]);
});

test('genre normalization splits multi-value tags and removes duplicates', () => {
  assert.deepEqual(
    normalizeGenres(['Rock; Alternative Rock', ' rock ', 'R&B']),
    ['Rock', 'Alternative Rock', 'R&B'],
  );
});
