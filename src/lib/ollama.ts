import http from 'node:http';
import https from 'node:https';
import { getConfig } from './config';

export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OllamaError';
  }
}

export function ollamaBaseUrl(): string | null {
  return getConfig().ollama?.baseUrl ?? null;
}

function request(
  baseUrl: string,
  pathname: string,
  method: 'GET' | 'POST',
  body: string | null,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<http.IncomingMessage> {
  const url = new URL(pathname, `${baseUrl}/`);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method,
      headers: body
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        : {},
      timeout: timeoutMs,
    }, resolve);
    const fail = (err: Error) => reject(err);
    req.on('error', fail);
    req.on('timeout', () => req.destroy(new OllamaError('The laptop took too long to answer.')));
    if (signal) {
      if (signal.aborted) {
        req.destroy(new OllamaError('Stopped.'));
        return;
      }
      signal.addEventListener('abort', () => req.destroy(new OllamaError('Stopped.')), { once: true });
    }
    if (body) req.write(body);
    req.end();
  });
}

export async function readIncoming(res: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of res) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function errorFrom(res: http.IncomingMessage): Promise<string> {
  const text = await readIncoming(res);
  try {
    const body = JSON.parse(text) as { error?: string };
    if (body.error) return body.error;
  } catch { /* not json */ }
  return text.trim() || `The laptop answered ${res.statusCode}.`;
}

export async function ollamaTags(baseUrl: string): Promise<{ name: string; capabilities?: string[] }[]> {
  const res = await request(baseUrl, '/api/tags', 'GET', null, 8_000);
  if (res.statusCode !== 200) throw new OllamaError(await errorFrom(res));
  const body = JSON.parse(await readIncoming(res)) as { models?: { name?: string; capabilities?: string[] }[] };
  return (body.models ?? [])
    .filter((model): model is { name: string; capabilities?: string[] } => typeof model.name === 'string');
}

/** Open a streaming /api/chat response. Caller reads NDJSON lines. */
export async function ollamaChatStream(
  baseUrl: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<http.IncomingMessage> {
  const res = await request(baseUrl, '/api/chat', 'POST', JSON.stringify(body), 10 * 60_000, signal);
  if (res.statusCode !== 200) throw new OllamaError(await errorFrom(res));
  return res;
}

export async function ollamaGenerateImage(baseUrl: string, model: string, prompt: string): Promise<unknown> {
  const res = await request(baseUrl, '/api/generate', 'POST', JSON.stringify({
    model,
    prompt,
    stream: false,
  }), 12 * 60_000);
  const text = await readIncoming(res);
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* leave text */ }
  if (res.statusCode !== 200) {
    const message = body && typeof body === 'object' && typeof (body as { error?: string }).error === 'string'
      ? (body as { error: string }).error
      : `The laptop answered ${res.statusCode}.`;
    throw new OllamaError(message);
  }
  return body;
}
