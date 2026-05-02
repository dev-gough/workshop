import { promises as fs } from 'fs';
import path from 'path';

interface TransmissionConfig {
  rpcUrl: string;
  username: string;
  password: string;
}

let _config: TransmissionConfig | null = null;
let _sessionId: string | null = null;

async function getConfig(): Promise<TransmissionConfig> {
  if (_config) return _config;
  const raw = await fs.readFile(path.join(process.cwd(), 'config.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.transmission) {
    throw new Error('config.json missing "transmission" section — run scripts/jellyfin/setup-daemon.sh');
  }
  _config = parsed.transmission;
  return _config!;
}

function basicAuth(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function rpc<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const config = await getConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: basicAuth(config.username, config.password),
  };
  if (_sessionId) headers['X-Transmission-Session-Id'] = _sessionId;

  const body = JSON.stringify({ method, arguments: args });
  let res = await fetch(config.rpcUrl, { method: 'POST', headers, body });

  // Transmission's CSRF dance: first call returns 409 with the session id
  if (res.status === 409) {
    const id = res.headers.get('X-Transmission-Session-Id');
    if (id) {
      _sessionId = id;
      headers['X-Transmission-Session-Id'] = id;
      res = await fetch(config.rpcUrl, { method: 'POST', headers, body });
    }
  }

  if (!res.ok) throw new Error(`transmission RPC ${method}: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.result !== 'success') throw new Error(`transmission ${method}: ${json.result}`);
  return json.arguments as T;
}

export interface TransmissionTorrent {
  id: number;
  hashString: string;
  name: string;
  status: number;          // 0 stopped, 1-2 check, 3-4 download, 5-6 seed
  percentDone: number;     // 0..1
  totalSize: number;
  downloadDir: string;
  rateDownload: number;    // B/s
  rateUpload: number;      // B/s
  eta: number;             // seconds, -1 = unknown
  errorString: string;
  isFinished: boolean;
  doneDate: number;
  addedDate: number;
  uploadRatio: number;
}

const FIELDS = [
  'id', 'hashString', 'name', 'status', 'percentDone', 'totalSize',
  'downloadDir', 'rateDownload', 'rateUpload', 'eta', 'errorString',
  'isFinished', 'doneDate', 'addedDate', 'uploadRatio',
];

export async function listTorrents(): Promise<TransmissionTorrent[]> {
  const result = await rpc<{ torrents: TransmissionTorrent[] }>('torrent-get', { fields: FIELDS });
  return result.torrents;
}

export async function addTorrent(
  link: string,
  downloadDir: string
): Promise<{ id: number; hashString: string; name: string }> {
  const args: Record<string, unknown> = { 'download-dir': downloadDir };
  if (link.startsWith('magnet:') || link.startsWith('http')) {
    args.filename = link;
  } else {
    args.metainfo = link; // already-base64'd .torrent contents
  }
  const result = await rpc<{
    'torrent-added'?: { id: number; hashString: string; name: string };
    'torrent-duplicate'?: { id: number; hashString: string; name: string };
  }>('torrent-add', args);
  return result['torrent-added'] || result['torrent-duplicate']!;
}

export async function removeTorrent(id: number, deleteLocalData = false): Promise<void> {
  await rpc('torrent-remove', { ids: [id], 'delete-local-data': deleteLocalData });
}

export function statusLabel(status: number, isFinished: boolean): string {
  if (status === 0) return isFinished ? 'Stopped' : 'Paused';
  if (status === 1 || status === 2) return 'Verifying';
  if (status === 3 || status === 4) return 'Downloading';
  if (status === 5 || status === 6) return 'Seeding';
  return 'Unknown';
}
