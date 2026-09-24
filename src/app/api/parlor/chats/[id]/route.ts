import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getParlorUser, parlorUnauthorized } from '@/lib/parlor-auth';
import { getVisibleChat, listMessages, removeImages, shapeChat, shapeMessage } from '@/lib/parlor-db';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();
  const chatId = Number((await params).id);
  if (!Number.isInteger(chatId)) return NextResponse.json({ error: 'Missing chat.' }, { status: 404 });
  const chat = await getVisibleChat(chatId, user.id);
  if (!chat) return NextResponse.json({ error: 'That chat isn’t on the table.' }, { status: 404 });
  const messages = await listMessages(chat.id);
  return NextResponse.json({
    chat: shapeChat(chat, user.id),
    messages: messages.map(shapeMessage),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();
  const chatId = Number((await params).id);
  let body: { hidden?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Missing fields.' }, { status: 400 });
  }
  if (typeof body.hidden !== 'boolean') {
    return NextResponse.json({ error: 'Say whether to hide it.' }, { status: 400 });
  }
  const { rows } = await pool.query(
    `UPDATE parlor_chats SET hidden = $1, updated_at = NOW()
     WHERE id = $2 AND owner_id = $3
     RETURNING id`,
    [body.hidden, chatId, user.id],
  );
  if (!rows[0]) return NextResponse.json({ error: 'That chat isn’t on the table.' }, { status: 404 });
  const chat = await getVisibleChat(chatId, user.id);
  if (!chat) return NextResponse.json({ error: 'That chat isn’t on the table.' }, { status: 404 });
  return NextResponse.json({ chat: shapeChat(chat, user.id) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();
  const chatId = Number((await params).id);
  const images = await pool.query<{ image_path: string }>(
    `SELECT m.image_path
     FROM parlor_messages m
     JOIN parlor_chats c ON c.id = m.chat_id
     WHERE c.id = $1 AND c.owner_id = $2 AND m.image_path IS NOT NULL`,
    [chatId, user.id],
  );
  const { rowCount } = await pool.query(
    `DELETE FROM parlor_chats WHERE id = $1 AND owner_id = $2`,
    [chatId, user.id],
  );
  if (!rowCount) return NextResponse.json({ error: 'That chat isn’t on the table.' }, { status: 404 });
  await removeImages(images.rows.map((row) => row.image_path));
  return NextResponse.json({ ok: true });
}
