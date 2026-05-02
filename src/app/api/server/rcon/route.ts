import { NextRequest, NextResponse } from 'next/server';
import * as net from 'net';

export const dynamic = 'force-dynamic';

// RCON port mapping for Minecraft services
const RCON_CONFIG: Record<string, { port: number; password: string }> = {
  'minecraft-atm6':         { port: 25585, password: 'root' },
  'minecraft-atm10':        { port: 25586, password: 'root' },
  'minecraft-stoneblock3':  { port: 25587, password: 'root' },
  'minecraft-meatballcraft': { port: 25588, password: 'root' },
  'minecraft-atm9sky':      { port: 25589, password: 'root' },
  'minecraft-above-beyond': { port: 25585, password: 'root' },
  'minecraft-star-technology': { port: 25590, password: 'root' },
};

// ── RCON Protocol ──
// https://wiki.vg/RCON

const PACKET_TYPE = {
  AUTH: 3,
  AUTH_RESPONSE: 2,
  COMMAND: 2,
  COMMAND_RESPONSE: 0,
} as const;

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf-8');
  const length = 4 + 4 + bodyBuf.length + 2; // id + type + body + 2 null bytes
  const buf = Buffer.alloc(4 + length);
  buf.writeInt32LE(length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt8(0, 12 + bodyBuf.length);
  buf.writeInt8(0, 13 + bodyBuf.length);
  return buf;
}

function decodePacket(buf: Buffer): { id: number; type: number; body: string } {
  const id = buf.readInt32LE(4);
  const type = buf.readInt32LE(8);
  const body = buf.toString('utf-8', 12, buf.length - 2);
  return { id, type, body };
}

function sendRconCommand(host: string, port: number, password: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseBuffer = Buffer.alloc(0);
    let authenticated = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('RCON timeout'));
    }, 5000);

    socket.connect(port, host, () => {
      socket.write(encodePacket(1, PACKET_TYPE.AUTH, password));
    });

    socket.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);

      // Process all complete packets in the buffer
      while (responseBuffer.length >= 4) {
        const packetLength = responseBuffer.readInt32LE(0);
        const totalLength = 4 + packetLength;
        if (responseBuffer.length < totalLength) break;

        const packet = decodePacket(responseBuffer.subarray(0, totalLength));
        responseBuffer = responseBuffer.subarray(totalLength);

        if (!authenticated) {
          if (packet.id === -1) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error('RCON authentication failed'));
            return;
          }
          authenticated = true;
          socket.write(encodePacket(2, PACKET_TYPE.COMMAND, command));
        } else {
          clearTimeout(timeout);
          socket.destroy();
          resolve(packet.body);
          return;
        }
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    socket.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const { service, command } = await request.json();

    if (!service || !command) {
      return NextResponse.json({ error: 'Missing service or command' }, { status: 400 });
    }

    const config = RCON_CONFIG[service];
    if (!config) {
      return NextResponse.json({ error: 'RCON not configured for this service' }, { status: 400 });
    }

    const response = await sendRconCommand('127.0.0.1', config.port, config.password, command);
    return NextResponse.json({ response });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('RCON error:', message);
    return NextResponse.json({ error: `RCON failed: ${message}` }, { status: 500 });
  }
}
