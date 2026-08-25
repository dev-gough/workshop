// Minecraft RCON client — https://wiki.vg/RCON

import * as net from 'net';

const PACKET_TYPE = {
  AUTH: 3,
  AUTH_RESPONSE: 2,
  COMMAND: 2,
  COMMAND_RESPONSE: 0,
} as const;

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf-8');
  const length = 4 + 4 + bodyBuf.length + 2;
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

export function sendRconCommand(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseBuffer = Buffer.alloc(0);
    let authenticated = false;
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error('RCON timeout'));
    }, timeoutMs);

    const finish = (err?: Error, body?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (err) {
        // MCPC / 1.2.5 RCON often RSTs after tell/say instead of a response packet.
        const reset = err.message.includes('ECONNRESET') || err.message.includes('EPIPE');
        if (authenticated && reset) {
          resolve(body ?? '');
          return;
        }
        reject(err);
        return;
      }
      resolve(body ?? '');
    };

    socket.connect(port, host, () => {
      socket.write(encodePacket(1, PACKET_TYPE.AUTH, password));
    });

    socket.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);

      while (responseBuffer.length >= 4) {
        const packetLength = responseBuffer.readInt32LE(0);
        const totalLength = 4 + packetLength;
        if (responseBuffer.length < totalLength) break;

        const packet = decodePacket(responseBuffer.subarray(0, totalLength));
        responseBuffer = responseBuffer.subarray(totalLength);

        if (!authenticated) {
          if (packet.id === -1) {
            finish(new Error('RCON authentication failed'));
            return;
          }
          authenticated = true;
          socket.write(encodePacket(2, PACKET_TYPE.COMMAND, command));
        } else {
          finish(undefined, packet.body);
          return;
        }
      }
    });

    socket.on('error', (err) => {
      finish(err);
    });

    socket.on('close', () => {
      // 1.2.5 MCPC often closes without a command-response packet. If we already
      // authed, treat that as an empty success; otherwise let timeout/error win.
      if (authenticated) finish(undefined, '');
    });
  });
}
