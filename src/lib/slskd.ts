import { promises as fs } from 'fs';
import path from 'path';

let _config: { baseUrl: string; apiKey: string } | null = null;

async function getConfig() {
  if (_config) return _config;
  const raw = await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8');
  const config = JSON.parse(raw);
  _config = config.slskd;
  return _config!;
}

async function slskdFetch(urlPath: string, options: RequestInit = {}): Promise<Response> {
  const config = await getConfig();
  const url = `${config.baseUrl}${urlPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res;
}

export async function slskdGet<T = unknown>(urlPath: string): Promise<T> {
  const res = await slskdFetch(urlPath);
  if (!res.ok) throw new Error(`slskd GET ${urlPath}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function slskdPost<T = unknown>(urlPath: string, body?: unknown): Promise<T> {
  const res = await slskdFetch(urlPath, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`slskd POST ${urlPath}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function slskdPut<T = unknown>(urlPath: string, body?: unknown): Promise<T> {
  const res = await slskdFetch(urlPath, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`slskd PUT ${urlPath}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function slskdDelete(urlPath: string): Promise<void> {
  const res = await slskdFetch(urlPath, { method: 'DELETE' });
  if (!res.ok) throw new Error(`slskd DELETE ${urlPath}: ${res.status} ${res.statusText}`);
}
