import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAlbumRadioQueue,
  buildAlbumShuffleQueue,
  buildGenrePlaylists,
  resolvePlaylistTracks,
} from './musicLibrary';
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

test('album radio starts from the seed and rotates related records by affinity', () => {
  const queue = buildAlbumRadioQueue([
    {
      artist: 'Seed',
      songs: ['02 - Deep Cut.flac', '01 - Opener.flac'],
      songGenres: { '01 - Opener.flac': ['Soul'], '02 - Deep Cut.flac': ['Funk'] },
    },
    {
      artist: 'Funk Friend',
      songs: ['01 - One.flac', '02 - Two.flac'],
      songGenres: { '01 - One.flac': ['Funk'], '02 - Two.flac': ['Funk'] },
    },
    {
      artist: 'Soul Friend',
      songs: ['01 - Three.flac', '02 - Four.flac'],
      songGenres: { '01 - Three.flac': ['Soul'], '02 - Four.flac': ['Soul'] },
    },
    {
      artist: 'Unrelated',
      songs: ['01 - Five.flac'],
      songGenres: { '01 - Five.flac': ['Metal'] },
    },
  ], 0, 5);

  assert.deepEqual(queue, [
    { albumIndex: 0, songIndex: 1 },
    { albumIndex: 1, songIndex: 0 },
    { albumIndex: 2, songIndex: 0 },
    { albumIndex: 1, songIndex: 1 },
    { albumIndex: 2, songIndex: 1 },
  ]);
});

test('album radio falls back to a cross-record mix without genre metadata', () => {
  assert.deepEqual(buildAlbumRadioQueue([
    { artist: 'A', songs: ['01.flac'] },
    { artist: 'B', songs: ['01.flac'] },
    { artist: 'C', songs: ['01.flac'] },
  ], 0), [
    { albumIndex: 0, songIndex: 0 },
    { albumIndex: 1, songIndex: 0 },
    { albumIndex: 2, songIndex: 0 },
  ]);
});

test('playlist resolver preserves requested order and skips missing tracks', () => {
  const albums = [
    { artist: 'A', name: 'First', songs: ['one.flac', 'two.flac'] },
    { artist: 'B', name: 'Second', songs: ['three.flac'] },
  ];

  assert.deepEqual(resolvePlaylistTracks(albums, [
    { artist: 'B', album: 'Second', song: 'three.flac' },
    { artist: 'missing', album: 'missing', song: 'missing.flac' },
    { artist: 'A', album: 'First', song: 'one.flac' },
  ]), [
    { albumIndex: 1, songIndex: 0 },
    { albumIndex: 0, songIndex: 0 },
  ]);
});
