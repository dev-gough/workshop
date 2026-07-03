import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import sharp from 'sharp';

// music-metadata is ESM-only; a static import breaks the tsx-run scripts
// (ingest-downloads, scan-music), which are transpiled to CJS. A dynamic
// import stays native and can load ESM from both Next.js and tsx contexts.
let musicMetadata: Promise<typeof import('music-metadata')> | null = null;
export function loadMusicMetadata() {
  return (musicMetadata ??= import('music-metadata'));
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg']);
const PREFERRED_NAMES = ['cover', 'folder', 'front', 'albumart', 'album', 'thumb'];
const THUMBNAIL_WIDTH = 200;

// Covers live in a hidden dir inside the music root so they travel with the
// library and are trivially served by /api/music/cover/[id]. scanAllAlbums
// already skips dot-directories, so this is never mistaken for an artist.
export const COVERS_DIRNAME = '.covers';

export function findBestImageFile(files: string[]): string | undefined {
  const imageFiles = files.filter(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));
  if (imageFiles.length === 0) return undefined;

  for (const preferred of PREFERRED_NAMES) {
    const match = imageFiles.find(f => path.basename(f, path.extname(f)).toLowerCase() === preferred);
    if (match) return match;
  }
  for (const preferred of PREFERRED_NAMES) {
    const match = imageFiles.find(f => path.basename(f, path.extname(f)).toLowerCase().startsWith(preferred));
    if (match) return match;
  }
  return imageFiles[0];
}

// Resize/crop to a square jpeg. Returns the raw bytes so the scanner can write
// them to disk; callers that still want a data-URI (e.g. soulseek staging) wrap
// the result with generateThumbnail().
export async function resizeCover(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer();
}

export async function generateThumbnail(imageBuffer: Buffer): Promise<string> {
  const resized = await resizeCover(imageBuffer);
  return `data:image/jpeg;base64,${resized.toString('base64')}`;
}

export async function extractEmbeddedCover(albumPath: string, audioFiles: string[]): Promise<Buffer | undefined> {
  for (const file of audioFiles) {
    try {
      const { parseFile } = await loadMusicMetadata();
      const metadata = await parseFile(path.join(albumPath, file));
      const picture = metadata.common.picture?.[0];
      if (picture) return Buffer.from(picture.data);
    } catch {
      // skip
    }
  }
  return undefined;
}

export function isAudioFile(filename: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export async function scanSingleAlbum(
  pool: Pool,
  musicDir: string,
  artist: string,
  album: string,
  source: string = 'local',
): Promise<void> {
  const albumPath = path.join(musicDir, artist, album);
  const files = await fs.readdir(albumPath);
  const songs: string[] = [];

  // Collect songs from album root
  const rootSongs = files
    .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();

  // Detect duplicate leading track numbers (flat multi-disc albums)
  const trackNums = rootSongs.map(f => {
    const m = f.match(/^(\d+)/);
    return m ? m[1] : null;
  });
  const hasDuplicateNums = trackNums.some((n, i) => n !== null && trackNums.indexOf(n) !== i);

  if (hasDuplicateNums && rootSongs.length > 0) {
    const byNum: Record<string, string[]> = {};
    for (const song of rootSongs) {
      const m = song.match(/^(\d+)/);
      const num = m ? m[1] : '999';
      if (!byNum[num]) byNum[num] = [];
      byNum[num].push(song);
    }
    const numDiscs = Math.max(...Object.values(byNum).map(arr => arr.length));
    const discs: string[][] = Array.from({ length: numDiscs }, () => []);
    for (const num of Object.keys(byNum).sort((a, b) => parseInt(a) - parseInt(b))) {
      const group = byNum[num];
      for (let i = 0; i < group.length; i++) {
        discs[i].push(group[i]);
      }
    }
    for (let d = 0; d < discs.length; d++) {
      for (const song of discs[d]) {
        songs.push(`Disc ${d + 1}/${song}`);
      }
    }
  } else {
    songs.push(...rootSongs);
  }

  // Check for disc subdirectories
  for (const entry of files) {
    const entryPath = path.join(albumPath, entry);
    const entryStat = await fs.stat(entryPath);
    if (entryStat.isDirectory() && /^(disc|disk|cd)\s*\d+$/i.test(entry)) {
      const discFiles = await fs.readdir(entryPath);
      const discSongs = discFiles
        .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
        .sort()
        .map(f => `${entry}/${f}`);
      songs.push(...discSongs);
    }
  }

  // Resolve the source image (file-based first, embedded metadata as fallback)
  // and resize it to the square jpeg we serve. Bytes go to disk, not the DB.
  let coverJpeg: Buffer | null = null;

  const imageFile = findBestImageFile(files);
  if (imageFile) {
    const imageBuffer = await fs.readFile(path.join(albumPath, imageFile));
    coverJpeg = await resizeCover(imageBuffer);
  }

  if (!coverJpeg && songs.length > 0) {
    const embeddedBuffer = await extractEmbeddedCover(albumPath, songs);
    if (embeddedBuffer) {
      coverJpeg = await resizeCover(embeddedBuffer);
    }
  }

  // Upsert the row first so we have the album id to key the cover file by. This
  // runs on every scan (INSERT or UPDATE), so a rescan of an EXISTING album still
  // reaches the cover-writing step below — nothing is skipped just because the
  // row already exists.
  const { rows } = await pool.query(
    `INSERT INTO albums (artist, name, songs, scanned_at, source)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (artist, name) DO UPDATE
     SET songs = $3, scanned_at = NOW(), source = $4
     RETURNING id`,
    [artist, album, songs, source]
  );
  const albumId: number = rows[0].id;

  // Write (or refresh) the cover file and record its relative path. A rescan of
  // an existing album always rewrites the file + cover_path here.
  if (coverJpeg) {
    const coversDir = path.join(musicDir, COVERS_DIRNAME);
    await fs.mkdir(coversDir, { recursive: true });
    const relPath = path.join(COVERS_DIRNAME, `${albumId}.jpg`);
    await fs.writeFile(path.join(musicDir, relPath), coverJpeg);
    await pool.query('UPDATE albums SET cover_path = $1 WHERE id = $2', [relPath, albumId]);
  } else {
    // No art found this scan — clear any stale path so the UI shows a placeholder
    // rather than pointing at a file we no longer wrote.
    await pool.query('UPDATE albums SET cover_path = NULL WHERE id = $1', [albumId]);
  }
}

export async function scanAllAlbums(pool: Pool, musicDir: string): Promise<number> {
  let count = 0;
  const artists = await fs.readdir(musicDir);

  for (const artist of artists) {
    const artistPath = path.join(musicDir, artist);
    const stat = await fs.stat(artistPath);
    if (!stat.isDirectory() || artist.startsWith('.')) continue;

    const albumDirs = await fs.readdir(artistPath);
    for (const album of albumDirs) {
      const albumPath = path.join(artistPath, album);
      const albumStat = await fs.stat(albumPath);
      if (!albumStat.isDirectory()) continue;

      try {
        await scanSingleAlbum(pool, musicDir, artist, album);
        count++;
        console.log(`  [${count}] ${artist} - ${album}`);
      } catch (error) {
        console.error(`  Error scanning ${artist} - ${album}:`, error);
      }
    }
  }

  return count;
}
