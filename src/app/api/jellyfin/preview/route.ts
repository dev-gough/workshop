import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';

const CLEAN_SCRIPT = path.join(process.cwd(), 'scripts/jellyfin/clean.sh');
const TV_LIBRARY = '/Media/TV Shows';
const MOVIE_LIBRARY = '/Media/Movies';

function runPreview(mode: 'tv' | 'movie', name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const root = mode === 'tv' ? TV_LIBRARY : MOVIE_LIBRARY;
    const child = spawn('bash', [CLEAN_SCRIPT, 'preview', mode, name, root]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `clean.sh exit ${code}`));
      else resolve(stdout.trim());
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const { name, mode } = await request.json();
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    if (mode !== 'tv' && mode !== 'movie') {
      return NextResponse.json({ error: 'mode must be "tv" or "movie"' }, { status: 400 });
    }
    const preview = await runPreview(mode, name);
    return NextResponse.json({ input: name, mode, preview });
  } catch (error) {
    return NextResponse.json({ error: 'Preview failed', detail: String(error) }, { status: 500 });
  }
}
