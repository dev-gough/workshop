import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import pool from '@/lib/db';
import { scanSingleAlbum, generateThumbnail } from '@/lib/musicScanner';
import { sanitizeFilename, cleanSongDisplay } from '@/lib/songUtils';
import { parseFile } from 'music-metadata';

export const dynamic = 'force-dynamic';

const MUSIC_DIR = '/home/server/music';
const DOWNLOADS_DIR = '/home/server/music/.slskd-downloads';
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);

// GET - list staging area (completed downloads pending review)
export async function GET() {
  try {
    // Get downloads in staging status
    const { rows: stagingRows } = await pool.query(
      "SELECT * FROM soulseek_downloads WHERE status = 'staging' ORDER BY created_at DESC"
    );

    // Also scan the downloads directory for any files not yet tracked
    let pendingFiles: string[] = [];
    try {
      pendingFiles = await walkDir(DOWNLOADS_DIR);
    } catch { /* dir might not exist */ }

    // Enrich staging items with cleaned names and cover art
    const enriched = await Promise.all(stagingRows.map(async (row) => {
      const cleanedName = cleanSongDisplay(row.filename, row.artist || undefined, row.album || undefined);
      let coverImage: string | null = null;

      // Try to extract embedded cover art from the actual file
      const localFile = await findDownloadFile(row.filename);
      if (localFile) {
        try {
          const metadata = await parseFile(localFile);
          const picture = metadata.common.picture?.[0];
          if (picture) {
            coverImage = await generateThumbnail(Buffer.from(picture.data));
          }
        } catch { /* no metadata */ }
      }

      return { ...row, cleanedName, coverImage };
    }));

    return NextResponse.json({
      staging: enriched,
      pendingFiles: pendingFiles.filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase())),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch staging', detail: String(error) }, { status: 500 });
  }
}

// POST - approve and ingest a download (or batch)
export async function POST(request: NextRequest) {
  try {
    const { id, artist, album, files } = await request.json();

    if (!artist || !album) {
      return NextResponse.json({ error: 'artist and album are required' }, { status: 400 });
    }

    const cleanArtist = sanitizeFilename(artist);
    const cleanAlbum = sanitizeFilename(album);
    const targetDir = path.join(MUSIC_DIR, cleanArtist, cleanAlbum);

    // Create target directory
    await fs.mkdir(targetDir, { recursive: true });

    // If a specific download ID is provided, ingest that record
    if (id) {
      const { rows } = await pool.query('SELECT * FROM soulseek_downloads WHERE id = $1', [id]);
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Download not found' }, { status: 404 });
      }

      const download = rows[0];
      // Find the actual file in downloads dir
      const sourceFile = await findDownloadFile(download.filename);
      if (sourceFile) {
        const destFile = path.join(targetDir, sanitizeFilename(path.basename(sourceFile)));
        await fs.rename(sourceFile, destFile);
      }

      await pool.query(
        "UPDATE soulseek_downloads SET status = 'completed', artist = $1, album = $2, local_path = $3, completed_at = NOW() WHERE id = $4",
        [cleanArtist, cleanAlbum, targetDir, id]
      );
    }

    // If files array provided, move those files
    if (files && Array.isArray(files)) {
      for (const filePath of files) {
        const fullPath = path.join(DOWNLOADS_DIR, filePath);
        try {
          await fs.access(fullPath);
          const destFile = path.join(targetDir, sanitizeFilename(path.basename(filePath)));
          await fs.rename(fullPath, destFile);
        } catch {
          // File not found, skip
        }
      }

      // Update any matching DB records
      for (const filePath of files) {
        const basename = path.basename(filePath);
        await pool.query(
          "UPDATE soulseek_downloads SET status = 'completed', artist = $1, album = $2, local_path = $3, completed_at = NOW() WHERE filename LIKE $4 AND status = 'staging'",
          [cleanArtist, cleanAlbum, targetDir, `%${basename}`]
        );
      }
    }

    // Try to move any cover art from the download directory
    await moveCoverArt(targetDir);

    // Scan the album into the database
    try {
      await scanSingleAlbum(pool, MUSIC_DIR, cleanArtist, cleanAlbum, 'soulseek');
    } catch (err) {
      console.error('Failed to scan ingested album:', err);
    }

    // Clean up empty directories in downloads
    await cleanEmptyDirs(DOWNLOADS_DIR);

    return NextResponse.json({
      success: true,
      artist: cleanArtist,
      album: cleanAlbum,
      path: targetDir,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Ingestion failed', detail: String(error) }, { status: 500 });
  }
}

// DELETE - reject/discard a staged download
export async function DELETE(request: NextRequest) {
  try {
    const { id, files } = await request.json();

    if (id) {
      const { rows } = await pool.query('SELECT * FROM soulseek_downloads WHERE id = $1', [id]);
      if (rows.length > 0) {
        const download = rows[0];
        const sourceFile = await findDownloadFile(download.filename);
        if (sourceFile) {
          await fs.unlink(sourceFile).catch(() => {});
        }
        await pool.query(
          "UPDATE soulseek_downloads SET status = 'rejected' WHERE id = $1",
          [id]
        );
      }
    }

    if (files && Array.isArray(files)) {
      for (const filePath of files) {
        await fs.unlink(path.join(DOWNLOADS_DIR, filePath)).catch(() => {});
      }
    }

    await cleanEmptyDirs(DOWNLOADS_DIR);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Rejection failed', detail: String(error) }, { status: 500 });
  }
}

// Helper: recursively walk a directory
async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath));
    } else {
      results.push(path.relative(DOWNLOADS_DIR, fullPath));
    }
  }
  return results;
}

// Helper: find a download file by name in the downloads directory
async function findDownloadFile(filename: string): Promise<string | null> {
  const basename = path.basename(filename.replace(/\\/g, '/'));
  const files = await walkDir(DOWNLOADS_DIR);
  const match = files.find(f => path.basename(f) === basename);
  return match ? path.join(DOWNLOADS_DIR, match) : null;
}

// Helper: move cover art files from downloads subfolders to target album dir
async function moveCoverArt(targetDir: string) {
  // Check if target already has cover art
  try {
    const existing = await fs.readdir(targetDir);
    const hasArt = existing.some(f => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));
    if (hasArt) return;

    // Try to extract embedded art from an audio file
    const audioFile = existing.find(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()));
    if (audioFile) {
      try {
        const metadata = await parseFile(path.join(targetDir, audioFile));
        const picture = metadata.common.picture?.[0];
        if (picture) {
          const ext = picture.format.includes('png') ? '.png' : '.jpg';
          await fs.writeFile(path.join(targetDir, `cover${ext}`), picture.data);
        }
      } catch { /* no embedded art */ }
    }
  } catch { /* dir doesn't exist yet */ }
}

// Helper: clean up empty directories
async function cleanEmptyDirs(dir: string) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subdir = path.join(dir, entry.name);
        await cleanEmptyDirs(subdir);
        const remaining = await fs.readdir(subdir);
        if (remaining.length === 0) {
          await fs.rmdir(subdir);
        }
      }
    }
  } catch { /* ignore */ }
}
