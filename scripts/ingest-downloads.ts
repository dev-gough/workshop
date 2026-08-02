import { promises as fs } from 'fs';
import path from 'path';
import { cleanDownloadPath, sanitizeFilename, DISC_DIR_RE } from '../src/lib/songUtils';
import { scanSingleAlbum, loadMusicMetadata } from '../src/lib/musicScanner';
import { getConfig, resetConfigCache } from '../src/lib/config';
import { slskdGet, flattenTransfers } from '../src/lib/slskd';
import { makePool } from '../src/lib/db';

function getDirs() {
  resetConfigCache();
  const music = getConfig().paths.musicDirectory;
  if (!music) throw new Error('paths.musicDirectory is not configured in config.json');
  return { music, downloads: path.join(music, '.slskd-downloads') };
}

const { music: MUSIC_DIR, downloads: DOWNLOADS_DIR } = getDirs();

const POLL_INTERVAL = 10_000; // 10 seconds

const pool = makePool('soulseek_ingest');

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
    const { parseFile } = await loadMusicMetadata();
    const metadata = await parseFile(filePath);
    return {
      // albumartist first: per-track artist tags ("X featuring Y") split one
      // album into a folder per collaborator
      artist: metadata.common.albumartist || metadata.common.artist || undefined,
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
    const raw = await slskdGet('/api/v0/transfers/downloads');
    const transfers = flattenTransfers<SlskdTransfer>(raw);

    for (const [username, userTransfers] of Object.entries(transfers)) {
      for (const transfer of userTransfers) {
        // Only process completed transfers
        if (!(transfer.state.includes('Completed') && transfer.state.includes('Succeeded'))) continue;

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

    // Also track completed uploads (record who's downloading from us). Keyed
    // on slskd's transfer id, like downloads — completed transfers linger in
    // slskd's list for hours, so a time-window dedup re-inserts them on every
    // poll past the window (the "7 TB uploaded" bug fixed by migration 015).
    try {
      const rawUl = await slskdGet('/api/v0/transfers/uploads');
      const uploads = flattenTransfers<SlskdTransfer>(rawUl);
      for (const [username, userTransfers] of Object.entries(uploads)) {
        for (const transfer of userTransfers) {
          if (!(transfer.state.includes('Completed') && transfer.state.includes('Succeeded'))) continue;

          const basename = path.basename(transfer.filename.replace(/\\/g, '/'));
          // Legacy rows predate slskd_id, so also match on the transfer's
          // natural key — otherwise the first poll after deploy would
          // re-insert everything still sitting in slskd's list.
          const { rows: existing } = await pool.query(
            `SELECT id FROM soulseek_uploads
             WHERE slskd_id = $1
                OR (username = $2 AND filename = $3 AND started_at IS NOT DISTINCT FROM $4)`,
            [transfer.id, username, basename, transfer.startedAt || null]
          );
          if (existing.length > 0) continue;

          const parsed = cleanDownloadPath(transfer.filename);
          await pool.query(
            `INSERT INTO soulseek_uploads (slskd_id, username, filename, artist, album, size_bytes, speed_bytes_per_sec, status, started_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, NOW())
             ON CONFLICT (slskd_id) DO NOTHING`,
            [
              transfer.id,
              username,
              basename,
              parsed.artist,
              parsed.album,
              transfer.size,
              Math.round(transfer.averageSpeed),
              transfer.startedAt || null,
            ]
          );
          console.log(`[upload tracked] ${username} downloaded: ${parsed.artist} - ${parsed.album} / ${basename}`);
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
    const slskd = getConfig().services.slskd;
    if (!slskd?.autoIngest) return; // Only run if enabled

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
        // Keep multi-disc structure: files that arrived inside a CD1/Disc 2
        // folder go into a disc subfolder the album scanner understands
        const discMatch = path.basename(path.dirname(localFile)).match(DISC_DIR_RE);
        const destDir = discMatch ? path.join(targetDir, `Disc ${parseInt(discMatch[1], 10)}`) : targetDir;
        await fs.mkdir(destDir, { recursive: true });
        const destFile = path.join(destDir, sanitizeFilename(path.basename(localFile)));
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
