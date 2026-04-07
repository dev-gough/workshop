import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import sharp from 'sharp';
import { parseFile } from 'music-metadata';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg']);
const PREFERRED_NAMES = ['cover', 'folder', 'front', 'albumart', 'album', 'thumb'];
const THUMBNAIL_WIDTH = 200;

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

export async function generateThumbnail(imageBuffer: Buffer): Promise<string> {
  const resized = await sharp(imageBuffer)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_WIDTH, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer();
  return `data:image/jpeg;base64,${resized.toString('base64')}`;
}

export async function extractEmbeddedCover(albumPath: string, audioFiles: string[]): Promise<Buffer | undefined> {
  for (const file of audioFiles) {
    try {
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

  let thumbnail: string | null = null;

  // Try file-based cover art
  const imageFile = findBestImageFile(files);
  if (imageFile) {
    const imageBuffer = await fs.readFile(path.join(albumPath, imageFile));
    thumbnail = await generateThumbnail(imageBuffer);
  }

  // Fall back to embedded metadata
  if (!thumbnail && songs.length > 0) {
    const embeddedBuffer = await extractEmbeddedCover(albumPath, songs);
    if (embeddedBuffer) {
      thumbnail = await generateThumbnail(embeddedBuffer);
    }
  }

  await pool.query(
    `INSERT INTO albums (artist, name, thumbnail, songs, scanned_at, source)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (artist, name) DO UPDATE
     SET thumbnail = $3, songs = $4, scanned_at = NOW(), source = $5`,
    [artist, album, thumbnail, songs, source]
  );
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
