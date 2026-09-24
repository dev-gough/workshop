import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { messagesForChatModel, validModelName } from '@/lib/parlor';
import { getParlorUser, parlorUnauthorized } from '@/lib/parlor-auth';
import {
  createChat,
  deleteMessage,
  getVisibleChat,
  insertMessage,
  listMessages,
  removeImages,
  saveImage,
  shapeChat,
  shapeMessage,
  touchChat,
} from '@/lib/parlor-db';
import { OllamaError, ollamaBaseUrl, ollamaChatStream, ollamaGenerateImage } from '@/lib/ollama';
import { extractGeneratedImage, parseChatChunk } from '@/lib/parlor';

export const dynamic = 'force-dynamic';

interface SendBody {
  chatId?: number | null;
  mode?: 'chat' | 'image';
  model?: string;
  content?: string;
}

async function resolveChat(userId: number, chatId: number | null): Promise<
  { ok: true; id: number; created: boolean } | { ok: false; status: number; error: string }
> {
  if (chatId == null) {
    return { ok: true, id: await createChat(userId), created: true };
  }
  if (!Number.isInteger(chatId)) return { ok: false, status: 404, error: 'That chat isn’t on the table.' };
  const chat = await getVisibleChat(chatId, userId);
  if (!chat) return { ok: false, status: 404, error: 'That chat isn’t on the table.' };
  if (chat.owner_id !== userId) {
    return { ok: false, status: 403, error: 'Only the person who started this chat can add to it.' };
  }
  return { ok: true, id: chat.id, created: false };
}

export async function POST(request: Request) {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();

  let body: SendBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Missing message.' }, { status: 400 });
  }
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const model = typeof body.model === 'string' ? body.model : '';
  const mode = body.mode === 'image' ? 'image' : body.mode === 'chat' ? 'chat' : null;
  if (!mode) return NextResponse.json({ error: 'Pick talk or draw.' }, { status: 400 });
  if (!content || content.length > 8000) {
    return NextResponse.json({ error: 'Write something, up to a few thousand characters.' }, { status: 400 });
  }
  if (!validModelName(model)) return NextResponse.json({ error: 'Pick a model.' }, { status: 400 });

  const baseUrl = ollamaBaseUrl();
  if (!baseUrl) return NextResponse.json({ error: 'Ollama isn’t configured on this server.' }, { status: 503 });

  const chatId = body.chatId == null ? null : Number(body.chatId);
  const chat = await resolveChat(user.id, chatId);
  if (!chat.ok) {
    return NextResponse.json({ error: chat.error }, { status: chat.status });
  }

  if (mode === 'image') {
    return sendImage(user.id, chat.id, chat.created, model, content, baseUrl);
  }
  return sendChat(user.id, chat.id, chat.created, model, content, baseUrl, request.signal);
}

async function sendImage(
  userId: number,
  chatId: number,
  created: boolean,
  model: string,
  content: string,
  baseUrl: string,
) {
  let generated: unknown;
  try {
    generated = await ollamaGenerateImage(baseUrl, model, content);
  } catch (err) {
    if (created) await pool.query(`DELETE FROM parlor_chats WHERE id = $1`, [chatId]);
    const message = err instanceof OllamaError ? err.message : 'The laptop couldn’t draw that.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const image = extractGeneratedImage(generated);
  if (!image.ok) {
    if (created) await pool.query(`DELETE FROM parlor_chats WHERE id = $1`, [chatId]);
    return NextResponse.json({ error: image.error }, { status: 502 });
  }

  let imagePath: string;
  try {
    imagePath = await saveImage(image.bytes);
  } catch (err) {
    if (created) await pool.query(`DELETE FROM parlor_chats WHERE id = $1`, [chatId]);
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userMessage = await insertMessage(chatId, { role: 'user', kind: 'text', content, model }, client);
    const assistant = await insertMessage(chatId, {
      role: 'assistant',
      kind: 'image',
      content,
      model,
      imagePath,
    }, client);
    await touchChat(chatId, content, client);
    await client.query('COMMIT');
    const chat = await getVisibleChat(chatId, userId);
    return NextResponse.json({
      chat: chat ? shapeChat(chat, userId) : null,
      messages: [shapeMessage(userMessage), shapeMessage(assistant)],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    await removeImages([imagePath]);
    if (created) await pool.query(`DELETE FROM parlor_chats WHERE id = $1`, [chatId]);
    throw err;
  } finally {
    client.release();
  }
}

async function sendChat(
  userId: number,
  chatId: number,
  created: boolean,
  model: string,
  content: string,
  baseUrl: string,
  signal: AbortSignal,
) {
  const prior = await listMessages(chatId);
  const userMessage = await insertMessage(chatId, { role: 'user', kind: 'text', content, model });
  await touchChat(chatId, content);
  const history = messagesForChatModel([
    ...prior.map((message) => ({ role: message.role, kind: message.kind, content: message.content })),
    { role: 'user' as const, kind: 'text' as const, content },
  ]);

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      const chat = await getVisibleChat(chatId, userId);
      send({ type: 'chat', chat: chat ? shapeChat(chat, userId) : null, message: shapeMessage(userMessage) });

      let reply = '';
      let thinking = '';
      let failed: string | null = null;
      try {
        const upstream = await ollamaChatStream(baseUrl, { model, messages: history, stream: true }, signal);
        let buf = '';
        for await (const chunk of upstream) {
          buf += (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString('utf8');
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const parsed = parseChatChunk(line);
            if (!parsed) continue;
            if (parsed.error) throw new OllamaError(parsed.error);
            if (parsed.content || parsed.thinking) {
              reply += parsed.content;
              thinking += parsed.thinking;
              send({ type: 'delta', content: parsed.content, thinking: parsed.thinking });
            }
          }
        }
        if (buf.trim()) {
          const parsed = parseChatChunk(buf);
          if (parsed?.error) throw new OllamaError(parsed.error);
          if (parsed) {
            reply += parsed.content;
            thinking += parsed.thinking;
          }
        }
      } catch (err) {
        failed = err instanceof OllamaError ? err.message : 'The laptop stopped answering.';
      }

      if (failed && !reply && !thinking) {
        await deleteMessage(userMessage.id);
        if (created) await pool.query(`DELETE FROM parlor_chats WHERE id = $1`, [chatId]);
        send({ type: 'error', error: failed, dropped: true });
        if (!closed) controller.close();
        return;
      }

      const assistant = await insertMessage(chatId, {
        role: 'assistant',
        kind: 'text',
        content: reply,
        thinking: thinking || null,
        model,
      });
      await touchChat(chatId, content);
      send({
        type: 'done',
        message: shapeMessage(assistant),
        error: failed,
      });
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
