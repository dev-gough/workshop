import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { sendRconCommand } from '@/lib/rcon';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { service, command } = await request.json();

    if (!service || !command) {
      return NextResponse.json({ error: 'Missing service or command' }, { status: 400 });
    }

    const server = getConfig().minecraftServers.find((s) => s.name === service);
    if (!server) {
      return NextResponse.json({ error: 'RCON not configured for this service' }, { status: 400 });
    }

    const response = await sendRconCommand(server.host, server.port, server.password, command);
    return NextResponse.json({ response });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('RCON error:', message);
    return NextResponse.json({ error: `RCON failed: ${message}` }, { status: 500 });
  }
}
