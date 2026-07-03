import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getConfig } from '@/lib/config';
import { COVERS_DIRNAME } from '@/lib/musicScanner';

export const dynamic = 'force-dynamic';

const notFound = () => new NextResponse('Not found', { status: 404 });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const albumId = Number(id);
  if (!Number.isInteger(albumId) || albumId <= 0) return notFound();

  const musicDir = getConfig().paths.musicDirectory;
  if (!musicDir) return notFound();

  // Only ever serve the file the DB row points at — never a request-controlled
  // path — and confirm it resolves inside the covers dir before streaming.
  const { rows } = await pool.query(
    'SELECT cover_path FROM albums WHERE id = $1',
    [albumId],
  );
  const coverPath: string | null = rows[0]?.cover_path ?? null;
  if (!coverPath) return notFound();

  const coversRoot = path.resolve(musicDir, COVERS_DIRNAME);
  const resolved = path.resolve(musicDir, coverPath);
  if (resolved !== path.join(coversRoot, path.basename(resolved))) return notFound();

  let stat;
  try {
    stat = await fsp.stat(resolved);
  } catch {
    return notFound();
  }

  return new NextResponse(Readable.toWeb(fs.createReadStream(resolved)) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': stat.size.toString(),
      'Cache-Control': 'public, max-age=604800',
    },
  });
}
