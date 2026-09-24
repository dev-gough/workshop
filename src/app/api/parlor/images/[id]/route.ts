import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getParlorUser, parlorUnauthorized } from '@/lib/parlor-auth';
import { imageMime, parlorImageDir, safeImageName } from '@/lib/parlor';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();
  const messageId = Number((await params).id);
  if (!Number.isInteger(messageId)) return NextResponse.json({ error: 'Missing image.' }, { status: 404 });

  const { rows } = await pool.query<{ image_path: string }>(
    `SELECT m.image_path
     FROM parlor_messages m
     JOIN parlor_chats c ON c.id = m.chat_id
     WHERE m.id = $1
       AND m.kind = 'image'
       AND m.image_path IS NOT NULL
       AND (c.hidden = false OR c.owner_id = $2)`,
    [messageId, user.id],
  );
  const name = rows[0]?.image_path;
  if (!name || !safeImageName(name)) return NextResponse.json({ error: 'Missing image.' }, { status: 404 });

  const file = path.join(parlorImageDir(), name);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(file);
  } catch {
    return NextResponse.json({ error: 'Missing image.' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': imageMime(bytes).mime,
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
