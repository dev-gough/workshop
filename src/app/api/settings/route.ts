import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function writeConfig(config: Record<string, unknown>) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

// GET - return user-facing settings
export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({
      musicDirectory: config.musicDirectory,
      slskd: {
        autoIngest: config.slskd?.autoIngest ?? false,
      },
      riotGameName: config.riotGameName,
      riotTagLine: config.riotTagLine,
      riotRegion: config.riotRegion,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read settings', detail: String(error) }, { status: 500 });
  }
}

// PATCH - update specific settings
export async function PATCH(request: NextRequest) {
  try {
    const updates = await request.json();
    const config = await readConfig();

    // Apply allowed updates
    if ('autoIngest' in updates) {
      if (!config.slskd) config.slskd = {};
      config.slskd.autoIngest = Boolean(updates.autoIngest);
    }
    if ('riotGameName' in updates && typeof updates.riotGameName === 'string') {
      config.riotGameName = updates.riotGameName;
    }
    if ('riotTagLine' in updates && typeof updates.riotTagLine === 'string') {
      config.riotTagLine = updates.riotTagLine;
    }
    if ('riotRegion' in updates && typeof updates.riotRegion === 'string') {
      config.riotRegion = updates.riotRegion;
    }

    await writeConfig(config);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update settings', detail: String(error) }, { status: 500 });
  }
}
