import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import pool from './db';
import {
  imageMime,
  parlorImageDir,
  safeImageName,
  titleFromPrompt,
  type PublicUser,
} from './parlor';

export interface ChatRow {
  id: number;
  title: string;
  hidden: boolean;
  updated_at: string;
  owner_id: number;
  owner_name: string;
  owner_color: string;
}

export interface MessageRow {
  id: number;
  role: 'user' | 'assistant';
  kind: 'text' | 'image';
  content: string;
  thinking: string | null;
  model: string | null;
  image_path: string | null;
}

export function shapeChat(row: ChatRow, viewerId: number) {
  return {
    id: row.id,
    title: row.title,
    hidden: row.hidden,
    updatedAt: row.updated_at,
    mine: row.owner_id === viewerId,
    owner: { id: row.owner_id, name: row.owner_name, color: row.owner_color },
  };
}

export function shapeMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    kind: row.kind,
    content: row.content,
    thinking: row.thinking,
    model: row.model,
    imageUrl: row.kind === 'image' && row.image_path ? `/api/parlor/images/${row.id}` : null,
  };
}

const CHAT_SELECT = `
  SELECT c.id, c.title, c.hidden, c.updated_at, c.owner_id,
         u.name AS owner_name, u.color AS owner_color
  FROM parlor_chats c
  JOIN parlor_users u ON u.id = c.owner_id
`;

export async function listVisibleChats(viewerId: number): Promise<ChatRow[]> {
  const { rows } = await pool.query<ChatRow>(
    `${CHAT_SELECT}
     WHERE c.hidden = false OR c.owner_id = $1
     ORDER BY c.updated_at DESC
     LIMIT 200`,
    [viewerId],
  );
  return rows;
}

/** Null when the chat is missing or hidden from this viewer. */
export async function getVisibleChat(chatId: number, viewerId: number): Promise<ChatRow | null> {
  const { rows } = await pool.query<ChatRow>(
    `${CHAT_SELECT} WHERE c.id = $1 AND (c.hidden = false OR c.owner_id = $2)`,
    [chatId, viewerId],
  );
  return rows[0] ?? null;
}

export async function listMessages(chatId: number): Promise<MessageRow[]> {
  const { rows } = await pool.query<MessageRow>(
    `SELECT id, role, kind, content, thinking, model, image_path
     FROM parlor_messages WHERE chat_id = $1 ORDER BY id ASC`,
    [chatId],
  );
  return rows;
}

export async function createChat(ownerId: number, client: PoolClient | typeof pool = pool): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO parlor_chats (owner_id) VALUES ($1) RETURNING id`,
    [ownerId],
  );
  return rows[0].id;
}

export async function touchChat(chatId: number, content: string, client: PoolClient | typeof pool = pool): Promise<void> {
  await client.query(
    `UPDATE parlor_chats
     SET updated_at = NOW(),
         title = CASE WHEN title = 'New chat' THEN $2 ELSE title END
     WHERE id = $1`,
    [chatId, titleFromPrompt(content)],
  );
}

export async function insertMessage(
  chatId: number,
  message: {
    role: 'user' | 'assistant';
    kind: 'text' | 'image';
    content: string;
    thinking?: string | null;
    model?: string | null;
    imagePath?: string | null;
  },
  client: PoolClient | typeof pool = pool,
): Promise<MessageRow> {
  const { rows } = await client.query<MessageRow>(
    `INSERT INTO parlor_messages (chat_id, role, kind, content, thinking, model, image_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, role, kind, content, thinking, model, image_path`,
    [
      chatId,
      message.role,
      message.kind,
      message.content,
      message.thinking ?? null,
      message.model ?? null,
      message.imagePath ?? null,
    ],
  );
  return rows[0];
}

export async function deleteMessage(id: number): Promise<void> {
  await pool.query(`DELETE FROM parlor_messages WHERE id = $1`, [id]);
}

export async function saveImage(bytes: Buffer): Promise<string> {
  const { ext } = imageMime(bytes);
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  if (!safeImageName(name)) throw new Error('refusing to store that image name');
  const dir = parlorImageDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), bytes);
  return name;
}

export async function removeImages(names: string[]): Promise<void> {
  const dir = parlorImageDir();
  await Promise.all(names.filter(safeImageName).map(async (name) => {
    await fs.unlink(path.join(dir, name)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }));
}

export async function openSession(user: PublicUser, tokenHash: string): Promise<void> {
  await pool.query(
    `INSERT INTO parlor_sessions (token_hash, user_id) VALUES ($1, $2)`,
    [tokenHash, user.id],
  );
}
