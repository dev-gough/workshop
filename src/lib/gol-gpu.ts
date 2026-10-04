// One Game of Life census at a time on the laptop 3060.
//
// The binary (cuda/gol-census) prints NDJSON progress on stdout and writes a
// histogram checkpoint on the laptop, so Pause keeps the run resumable. This
// module holds the ssh child; the SSE route subscribes to the same bus.

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import pool from './db';
import { getConfig } from './config';
import type { CensusResult, OscExample } from '@/workers/gol-census-shared';

const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=30'];
const BIN = '/home/devon/compute/gol-census/gol-census';
const CKPT_DIR = '/home/devon/compute/gol-census/ckpt';
const SAVE_MS = 10_000;

export interface GpuJobView {
  running: boolean;
  w: number;
  h: number;
  result: CensusResult | null;
  rate: number | null;
  error: string | null;
}

type GpuStreamEvent =
  | { type: 'progress'; job: GpuJobView }
  | { type: 'result'; job: GpuJobView }
  | { type: 'idle' }
  | { type: 'error'; message: string };

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function subscribeGpu(listener: (evt: GpuStreamEvent) => void): () => void {
  bus.on('event', listener);
  return () => bus.off('event', listener);
}

function sshTarget(): string {
  return getConfig().ollama?.sshHost ?? 'devy-l';
}

interface Job {
  w: number;
  h: number;
  child: ChildProcess;
  result: CensusResult | null;
  rate: number | null;
  error: string | null;
  stopRequested: boolean;
  discard: boolean;
  lastSave: number;
  saveChain: Promise<void>;
  finished: Promise<void>;
  markFinished: () => void;
}

let job: Job | null = null;

export function gpuJobView(): GpuJobView | null {
  if (!job) return null;
  return {
    running: true,
    w: job.w,
    h: job.h,
    result: job.result,
    rate: job.rate,
    error: job.error,
  };
}

function emit(evt: GpuStreamEvent) {
  bus.emit('event', evt);
}

function viewOf(j: Job, running: boolean): GpuJobView {
  return { running, w: j.w, h: j.h, result: j.result, rate: j.rate, error: j.error };
}

function ckptPath(w: number, h: number): string {
  return `${CKPT_DIR}/${w}x${h}.bin`;
}

function ssh(args: string[]): ChildProcess {
  return spawn('ssh', [...SSH_OPTS, sshTarget(), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function runSsh(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = ssh(args);
    let err = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
      if (err.length > 2000) err = err.slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ssh exited ${code}`));
    });
  });
}

function num(v: unknown, total: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= total ? v : null;
}

/** A progress/result line from gol-census --json. `rate` is index states/s. */
function parseLine(raw: string): { kind: 'progress' | 'result'; result: CensusResult; rate: number } | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (body.type !== 'progress' && body.type !== 'result') return null;
  const w = body.w;
  const h = body.h;
  if (typeof w !== 'number' || typeof h !== 'number') return null;
  const total = typeof body.total === 'number' ? body.total : NaN;
  const processed = num(body.processed, total);
  const dies = num(body.dies, total);
  const stillLifes = num(body.stillLifes, total);
  const unresolved = num(body.unresolved, total);
  const elapsedMs = typeof body.elapsedMs === 'number' && body.elapsedMs >= 0 ? body.elapsedMs : null;
  const done = body.done === true;
  if (processed === null || dies === null || stillLifes === null || unresolved === null || elapsedMs === null) return null;
  if (!Number.isFinite(total) || total < 1) return null;
  const periods: Record<number, number> = {};
  if (typeof body.periods === 'object' && body.periods !== null && !Array.isArray(body.periods)) {
    for (const [k, v] of Object.entries(body.periods as Record<string, unknown>)) {
      const p = Number(k);
      const c = num(v, total);
      if (!Number.isInteger(p) || p < 2 || c === null || c === 0) continue;
      periods[p] = c;
    }
  }
  const result: CensusResult = {
    w, h, total, processed, dies, stillLifes, unresolved,
    periods,
    oscExamples: [],
    stillLifeExamples: [],
    done: done && processed === total,
    elapsedMs,
    engine: 'gpu',
  };
  const rate = typeof body.rate === 'number' && Number.isFinite(body.rate) && body.rate >= 0 ? body.rate : 0;
  return { kind: body.type, result, rate };
}

async function rememberExamples(r: CensusResult): Promise<CensusResult> {
  const existing = await pool.query<{ result: CensusResult }>(
    'SELECT result FROM gol_census WHERE w = $1 AND h = $2',
    [r.w, r.h],
  );
  const prev = existing.rows[0]?.result;
  if (!prev) return r;
  const oscExamples: OscExample[] = r.oscExamples.length > 0 ? r.oscExamples : (prev.oscExamples ?? []);
  const stillLifeExamples = r.stillLifeExamples.length > 0 ? r.stillLifeExamples : (prev.stillLifeExamples ?? []);
  return { ...r, oscExamples, stillLifeExamples };
}

async function saveResult(r: CensusResult): Promise<void> {
  const stored = await rememberExamples(r);
  await pool.query(
    `INSERT INTO gol_census (w, h, processed, done, result, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (w, h) DO UPDATE
       SET processed = EXCLUDED.processed,
           done = EXCLUDED.done,
           result = EXCLUDED.result,
           updated_at = now()
       WHERE EXCLUDED.processed > gol_census.processed
          OR (EXCLUDED.done AND NOT gol_census.done)`,
    [stored.w, stored.h, stored.processed, stored.done, JSON.stringify(stored)],
  );
}

export async function startGpuCensus(w: number, h: number, fresh: boolean): Promise<void> {
  if (job) {
    if (job.w === w && job.h === h) return;
    throw new Error(`The 3060 is already counting ${job.w}×${job.h}.`);
  }
  await runSsh(['mkdir', '-p', CKPT_DIR]);
  const args = [BIN, '--json', '--checkpoint', ckptPath(w, h)];
  if (fresh) args.push('--fresh');
  args.push(String(w), String(h));
  const child = ssh(args);
  let markFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => { markFinished = resolve; });
  const started: Job = {
    w, h, child,
    result: null,
    rate: null,
    error: null,
    stopRequested: false,
    discard: false,
    lastSave: 0,
    saveChain: Promise.resolve(),
    finished,
    markFinished,
  };
  job = started;

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    let nl = stdout.indexOf('\n');
    while (nl >= 0) {
      const line = stdout.slice(0, nl).trim();
      stdout = stdout.slice(nl + 1);
      nl = stdout.indexOf('\n');
      if (!line) continue;
      const parsed = parseLine(line);
      if (!parsed || parsed.result.w !== w || parsed.result.h !== h) continue;
      started.result = parsed.result;
      started.rate = parsed.rate;
      const running = parsed.kind === 'progress';
      emit({ type: parsed.kind, job: viewOf(started, running) });
      const now = Date.now();
      const force = parsed.kind === 'result';
      if (force || now - started.lastSave >= SAVE_MS) {
        started.lastSave = now;
        const snap = parsed.result;
        started.saveChain = started.saveChain
          .then(() => saveResult(snap))
          .catch((e) => console.error('[gol-gpu] save', e));
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  child.on('error', (err) => {
    started.error = err.message;
    emit({ type: 'error', message: err.message });
  });
  child.on('close', (code) => {
    if (job === started) job = null;
    const failed = code !== 0 && !started.stopRequested;
    if (failed) {
      const message = stderr.trim().split('\n').filter(Boolean).at(-1) || `The 3060 census exited ${code}.`;
      started.error = message;
      emit({ type: 'error', message });
    }
    const persist = started.discard || !started.result
      ? Promise.resolve()
      : started.saveChain.then(() => saveResult(started.result as CensusResult));
    persist
      .catch((e) => console.error('[gol-gpu] final save', e))
      .finally(() => {
        emit({ type: 'idle' });
        started.markFinished();
      });
  });
}

export async function stopGpuCensus(w: number, h: number, dropCheckpoint: boolean): Promise<void> {
  const running = job && job.w === w && job.h === h ? job : null;
  if (running) {
    running.stopRequested = true;
    running.discard = dropCheckpoint;
    running.child.kill('SIGTERM');
    await running.finished;
  }
  if (dropCheckpoint) await runSsh(['rm', '-f', ckptPath(w, h)]);
}
