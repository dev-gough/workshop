import crypto from 'crypto';
import path from 'path';

const COLORS = ['#8c4a32', '#2f6f4e', '#3d5a80', '#8c334d', '#a16207', '#6d28d9', '#0f766e', '#b45309'];

/** Name fragments that mean "this Ollama tag draws pictures" when the server
 *  omits capabilities (Ollama before the capabilities field existed). */
const IMAGE_NAME = /qwen[-_ ]?image|z-image|flux|imagegen|stable-diffusion|\bsdxl\b/i;

export interface PublicUser {
  id: number;
  name: string;
  color: string;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  kind: 'text' | 'image';
  content: string;
}

export function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 32) return null;
  if (/[\u0000-\u001f]/.test(name)) return null;
  return name;
}

export function nameKey(name: string): string {
  return name.toLowerCase();
}

export function colorForName(name: string): string {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 33 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'hex');
    expected = Buffer.from(parts[5], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let key: Buffer;
  try {
    key = crypto.scryptSync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  if (key.length !== expected.length) return false;
  return crypto.timingSafeEqual(key, expected);
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSession(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Hidden chats exist for their owner only. Everyone else is told they aren't there. */
export function chatVisible(chat: { hidden: boolean; ownerId: number }, viewerId: number): boolean {
  return !chat.hidden || chat.ownerId === viewerId;
}

export function titleFromPrompt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (!flat) return 'New chat';
  return flat.length > 72 ? `${flat.slice(0, 72).trimEnd()}…` : flat;
}

export function isImageModel(name: string, capabilities?: string[]): boolean {
  if (capabilities && capabilities.length > 0) return capabilities.includes('image');
  return IMAGE_NAME.test(name);
}

export function classifyModels(models: { name: string; capabilities?: string[] }[]): { chat: string[]; image: string[] } {
  const chat: string[] = [];
  const image: string[] = [];
  for (const model of models) {
    if (!model.name) continue;
    if (isImageModel(model.name, model.capabilities)) image.push(model.name);
    else chat.push(model.name);
  }
  return { chat, image };
}

/** Text the chat model should see. Pictures become a short note, not bytes. */
export function messagesForChatModel(messages: ChatMessageInput[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const message of messages) {
    if (message.kind === 'image') {
      const note = message.content.trim();
      out.push({
        role: message.role,
        content: note ? `Generated an image: ${note}` : 'Generated an image.',
      });
      continue;
    }
    if (!message.content.trim() && message.role === 'assistant') continue;
    out.push({ role: message.role, content: message.content });
  }
  return out;
}

export interface ChatChunk {
  content: string;
  thinking: string;
  done: boolean;
  error: string | null;
}

export function parseChatChunk(line: string): ChatChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let body: unknown;
  try {
    body = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error) {
    return { content: '', thinking: '', done: true, error: record.error };
  }
  let content = '';
  let thinking = '';
  if (record.message && typeof record.message === 'object') {
    const message = record.message as Record<string, unknown>;
    if (typeof message.content === 'string') content = message.content;
    if (typeof message.thinking === 'string') thinking = message.thinking;
  }
  if (!content && typeof record.response === 'string') content = record.response;
  return { content, thinking, done: record.done === true, error: null };
}

function decodeImagePayload(raw: string): Buffer | null {
  const cleaned = raw.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s/g, '');
  if (cleaned.length < 16 || !/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;
  const buf = Buffer.from(cleaned, 'base64');
  return buf.length >= 16 ? buf : null;
}

export function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
  return false;
}

export function imageMime(buf: Buffer): { ext: 'png' | 'jpg' | 'webp'; mime: string } {
  if (buf[0] === 0xff && buf[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.toString('ascii', 0, 4) === 'RIFF') return { ext: 'webp', mime: 'image/webp' };
  return { ext: 'png', mime: 'image/png' };
}

export function extractGeneratedImage(body: unknown): { ok: true; bytes: Buffer } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'The laptop sent an empty response.' };
  const record = body as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error) return { ok: false, error: record.error };
  const candidates: string[] = [];
  if (typeof record.image === 'string') candidates.push(record.image);
  if (Array.isArray(record.images)) {
    for (const image of record.images) {
      if (typeof image === 'string') candidates.push(image);
    }
  }
  if (typeof record.response === 'string') candidates.push(record.response);
  for (const candidate of candidates) {
    const bytes = decodeImagePayload(candidate);
    if (bytes && looksLikeImage(bytes)) return { ok: true, bytes };
  }
  return { ok: false, error: 'The model finished without an image.' };
}

export function safeImageName(name: string): boolean {
  return /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(name);
}

export function parlorImageDir(): string {
  return path.join(process.cwd(), 'data', 'parlor');
}

export function validModelName(name: string): boolean {
  return /^[\w.:/+-]{1,200}$/.test(name);
}
