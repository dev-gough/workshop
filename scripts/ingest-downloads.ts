import { promises as fs } from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { parseFile } from 'music-metadata';
import { cleanDownloadPath, sanitizeFilename } from '../src/lib/songUtils';
import { scanSingleAlbum } from '../src/lib/musicScanner';

const MUSIC_DIR = '/home/server/music';
const DOWNLOADS_DIR = '/home/server/music/.slskd-downloads';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg']);
const POLL_INTERVAL = 10_000; // 10 seconds
const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const pool = new Pool({
  user: 'soulseek_ingest',
  password: 'soulseek_ingest',
  host: 'localhost',
  port: 5432,
  database: 'workshop',
});

interface SlskdTransfer {
  id: string;
  username: string;
  filename: string;
  size: number;
  state: string;
  bytesTransferred: number;
  averageSpeed: number;
  percentComplete: number;
  startedAt?: string;
  endedAt?: string;
}

async function getSlskdConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw).slskd as { baseUrl: string; apiKey: string };
}

async function slskdGet<T>(urlPath: string): Promise<T> {
  const config = await getSlskdConfig();
  const res = await fetch(`${config.baseUrl}${urlPath}`, {
    headers: { 'X-API-Key': config.apiKey },
  });
  if (!res.ok) throw new Error(`slskd GET ${urlPath}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch { /* dir might not exist */ }
  return results;
}

async function extractMetadata(filePath: string): Promise<{ artist?: string; album?: string; title?: string; track?: number }> {
  try {
    const metadata = await parseFile(filePath);
    return {
      artist: metadata.common.artist || metadata.common.albumartist || undefined,
      album: metadata.common.album || undefined,
      title: metadata.common.title || undefined,
      track: metadata.common.track?.no || undefined,
    };
  } catch {
    return {};
  }
}

async function processCompletedDownloads() {
  try {
    // Get all download transfers from slskd (nested format: [{ username, directories: [{ files }] }])
    const raw = await slskdGet<{ username: string; directories: { files: SlskdTransfer[] }[] }[]>('/api/v0/transfers/downloads');
    const transfers: Record<string, SlskdTransfer[]> = {};
    if (Array.isArray(raw)) {
      for (const group of raw) {
        const files: SlskdTransfer[] = [];
        for (const dir of group.directories || []) {
          if (dir.files) files.push(...dir.files);
        }
        if (files.length > 0) transfers[group.username] = files;
      }
    }

    for (const [username, userTransfers] of Object.entries(transfers)) {
      for (const transfer of userTransfers) {
        // Only process completed transfers
        if (transfer.state !== 'Completed, Succeeded') continue;

        // Check if already tracked in DB
        const { rows: existing } = await pool.query(
          "SELECT id FROM soulseek_downloads WHERE slskd_id = $1",
          [transfer.id]
        );

        if (existing.length > 0) continue; // Already processed

        // Parse the remote path for metadata
        const parsed = cleanDownloadPath(transfer.filename);

        // Find the actual downloaded file
        const allFiles = await walkDir(DOWNLOADS_DIR);
        const basename = path.basename(transfer.filename.replace(/\\/g, '/'));
        const localFile = allFiles.find(f => path.basename(f) === basename);

        // Try to get better metadata from the file itself
        let meta = { artist: parsed.artist, album: parsed.album };
        if (localFile) {
          const fileMeta = await extractMetadata(localFile);
          if (fileMeta.artist) meta.artist = fileMeta.artist;
          if (fileMeta.album) meta.album = fileMeta.album;
        }

        // Insert as 'staging' status (awaiting review)
        await pool.query(
          `INSERT INTO soulseek_downloads (slskd_id, username, remote_path, filename, artist, album, size_bytes, speed_bytes_per_sec, status, started_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'staging', $9, NOW())
           ON CONFLICT DO NOTHING`,
          [
            transfer.id,
            username,
            transfer.filename,
            basename,
            meta.artist,
            meta.album,
            transfer.size,
            Math.round(transfer.averageSpeed),
            transfer.startedAt || null,
          ]
        );

        console.log(`[staging] ${username}: ${meta.artist} - ${meta.album} / ${basename}`);
      }
    }

    // Also track active uploads (record who's downloading from us)
    try {
      const rawUl = await slskdGet<{ username: string; directories: { files: SlskdTransfer[] }[] }[]>('/api/v0/transfers/uploads');
      const uploads: Record<string, SlskdTransfer[]> = {};
      if (Array.isArray(rawUl)) {
        for (const group of rawUl) {
          const files: SlskdTransfer[] = [];
          for (const dir of group.directories || []) {
            if (dir.files) files.push(...dir.files);
          }
          if (files.length > 0) uploads[group.username] = files;
        }
      }
      for (const [username, userTransfers] of Object.entries(uploads)) {
        for (const transfer of userTransfers) {
          if (transfer.state !== 'Completed, Succeeded') continue;

          const { rows: existing } = await pool.query(
            "SELECT id FROM soulseek_uploads WHERE username = $1 AND filename = $2 AND created_at > NOW() - INTERVAL '1 hour'",
            [username, path.basename(transfer.filename.replace(/\\/g, '/'))]
          );
          if (existing.length > 0) continue;

          const parsed = cleanDownloadPath(transfer.filename);
          await pool.query(
            `INSERT INTO soulseek_uploads (username, filename, artist, album, size_bytes, speed_bytes_per_sec, status, started_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, NOW())`,
            [
              username,
              path.basename(transfer.filename.replace(/\\/g, '/')),
              parsed.artist,
              parsed.album,
              transfer.size,
              Math.round(transfer.averageSpeed),
              transfer.startedAt || null,
            ]
          );
          console.log(`[upload tracked] ${username} downloaded: ${parsed.artist} - ${parsed.album} / ${path.basename(transfer.filename)}`);
        }
      }
    } catch (err) {
      // Upload tracking is best-effort
    }
  } catch (err) {
    console.error('Poll error:', err);
  }
}

// Auto-ingest mode: when enabled, automatically process staging items
async function autoIngest() {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
    if (!config.slskd?.autoIngest) return; // Only run if enabled

    const { rows } = await pool.query(
      "SELECT * FROM soulseek_downloads WHERE status = 'staging'"
    );

    for (const download of rows) {
      if (!download.artist || !download.album) continue;

      const cleanArtist = sanitizeFilename(download.artist);
      const cleanAlbum = sanitizeFilename(download.album);
      const targetDir = path.join(MUSIC_DIR, cleanArtist, cleanAlbum);

      await fs.mkdir(targetDir, { recursive: true });

      // Find and move the file
      const allFiles = await walkDir(DOWNLOADS_DIR);
      const localFile = allFiles.find(f => path.basename(f) === download.filename);
      if (localFile) {
        const destFile = path.join(targetDir, sanitizeFilename(path.basename(localFile)));
        await fs.rename(localFile, destFile);
      }

      await pool.query(
        "UPDATE soulseek_downloads SET status = 'completed', artist = $1, album = $2, local_path = $3, completed_at = NOW() WHERE id = $4",
        [cleanArtist, cleanAlbum, targetDir, download.id]
      );

      // Scan into barfoo
      try {
        await scanSingleAlbum(pool, MUSIC_DIR, cleanArtist, cleanAlbum, 'soulseek');
      } catch {}

      console.log(`[auto-ingested] ${cleanArtist} - ${cleanAlbum} / ${download.filename}`);
    }
  } catch {}
}

async function main() {
  console.log('Soulseek ingestion service started');
  console.log(`  Downloads dir: ${DOWNLOADS_DIR}`);
  console.log(`  Music dir: ${MUSIC_DIR}`);
  console.log(`  Poll interval: ${POLL_INTERVAL / 1000}s`);

  // Initial poll
  await processCompletedDownloads();
  await autoIngest();

  // Continuous polling
  setInterval(async () => {
    await processCompletedDownloads();
    await autoIngest();
  }, POLL_INTERVAL);
}

main().catch(err => {
  console.error('Ingestion service failed:', err);
  process.exit(1);
});
