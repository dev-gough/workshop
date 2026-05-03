import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import pool from '@/lib/db';

const REPO_DIR = '/home/server/brainfuck-genetic';
const PYTHON = `${REPO_DIR}/.venv/bin/python`;
const RUNNER = 'Project/runner.py';
const CWD = '/home/server';

// ── GA hyperparameter config ────────────────────────────────────────────────
// Mirrors util.GAConfig in the Python side. Keep field names in sync.

export interface GAConfig {
  pop_size: number;
  max_generations: number;
  max_prog_len: number;
  min_prog_len: number;
  max_crossover_dist: number;
  crossover_rate: number;
  mutation_rate: number;
  mut_prob: number;
  macro_mut_rate: number;
}

export const DEFAULT_CONFIG: GAConfig = {
  pop_size: 100,
  max_generations: 1_000_000,
  max_prog_len: 300,
  min_prog_len: 10,
  max_crossover_dist: 10,
  crossover_rate: 0.5,
  mutation_rate: 0.1,
  mut_prob: 0.7,
  macro_mut_rate: 0.05,
};

interface NumericRange {
  min: number;
  max: number;
  integer?: boolean;
}

// Bounds for each knob — used by parseRunConfig to validate POST bodies and
// also exported so the UI can pull them rather than duplicating constants.
export const CONFIG_BOUNDS: Record<keyof GAConfig, NumericRange> = {
  pop_size:           { min: 10,    max: 500,        integer: true },
  max_generations:    { min: 100,   max: 10_000_000, integer: true },
  max_prog_len:       { min: 20,    max: 2000,       integer: true },
  min_prog_len:       { min: 1,     max: 200,        integer: true },
  max_crossover_dist: { min: 1,     max: 100,        integer: true },
  crossover_rate:     { min: 0,     max: 1 },
  mutation_rate:      { min: 0,     max: 1 },
  mut_prob:           { min: 0,     max: 1 },
  macro_mut_rate:     { min: 0,     max: 1 },
};

export function parseRunConfig(body: Record<string, unknown>): GAConfig {
  const out = { ...DEFAULT_CONFIG };
  for (const key of Object.keys(CONFIG_BOUNDS) as (keyof GAConfig)[]) {
    if (!(key in body)) continue;
    const raw = body[key];
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(v)) {
      throw new Error(`${key} must be a number`);
    }
    const b = CONFIG_BOUNDS[key];
    if (v < b.min || v > b.max) {
      throw new Error(`${key} must be in [${b.min}, ${b.max}]`);
    }
    if (b.integer && !Number.isInteger(v)) {
      throw new Error(`${key} must be an integer`);
    }
    out[key] = v;
  }
  if (out.min_prog_len > out.max_prog_len) {
    throw new Error('min_prog_len cannot exceed max_prog_len');
  }
  return out;
}

function configToCliArgs(cfg: GAConfig): string[] {
  return [
    '--pop-size',           String(cfg.pop_size),
    '--max-gen',            String(cfg.max_generations),
    '--max-prog-len',       String(cfg.max_prog_len),
    '--min-prog-len',       String(cfg.min_prog_len),
    '--max-crossover-dist', String(cfg.max_crossover_dist),
    '--crossover-rate',     String(cfg.crossover_rate),
    '--mutation-rate',      String(cfg.mutation_rate),
    '--mut-prob',           String(cfg.mut_prob),
    '--macro-mut-rate',     String(cfg.macro_mut_rate),
  ];
}

type ProgressEvent = { type: 'progress'; gen: number; best_fitness: number; best_gene: string; best_output: string };
type FoundEvent = { type: 'found'; gen: number; best_fitness: number; best_gene: string; best_output: string };
type DoneEvent = { type: 'done'; gen: number; best_fitness: number; best_gene: string; best_output: string; found: boolean };
type StartEvent = { type: 'start'; target: string; pop_size: number; max_generations: number };
type BenchmarkEvent = {
  type: 'benchmark';
  target: string;
  pop_size: number;
  max_generations: number;
  generations: number;
  evaluations: number;
  wall_seconds: number;
  evals_per_sec: number;
  gens_per_sec: number;
  best_fitness: number;
  found: boolean;
};
type ErrorEvent = { type: 'error'; message: string };
type Event = ProgressEvent | FoundEvent | DoneEvent | StartEvent | BenchmarkEvent | ErrorEvent;

let activeRunId: number | null = null;
let activeBenchmarkId: number | null = null;
let activeChild: ChildProcess | null = null;
let bootstrapped = false;

async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  await pool.query(
    `UPDATE brainfuck_runs SET status = 'interrupted', completed_at = NOW()
     WHERE status = 'running'`,
  );
  await pool.query(
    `UPDATE brainfuck_benchmarks SET status = 'failed',
       error = COALESCE(error, 'workshop service restarted'),
       completed_at = NOW()
     WHERE status IN ('running', 'queued')`,
  );
}

// Read the BF reference repo's HEAD so each benchmark row records exactly
// which version of the algorithm was timed. Runs synchronously at benchmark
// start — fast and safe.
function getBFVersion(): { hash: string | null; subject: string | null } {
  try {
    const hash = execFileSync('git', ['-C', REPO_DIR, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const subject = execFileSync('git', ['-C', REPO_DIR, 'log', '-1', '--format=%s'], {
      encoding: 'utf8',
    }).trim();
    return { hash, subject };
  } catch {
    return { hash: null, subject: null };
  }
}

export async function startRun(
  target: string,
  config: GAConfig,
): Promise<{ id: number }> {
  await bootstrap();

  if (activeChild) {
    throw new Error(
      activeBenchmarkId != null
        ? 'A benchmark is in progress. Wait for it to finish before starting a new run.'
        : 'A run is already in progress. Stop it before starting a new one.',
    );
  }

  const { rows } = await pool.query(
    `INSERT INTO brainfuck_runs (target, max_generations, pop_size, status, config_json)
     VALUES ($1, $2, $3, 'running', $4) RETURNING id`,
    [target, config.max_generations, config.pop_size, JSON.stringify(config)],
  );
  const id: number = rows[0].id;

  const child = spawn(
    PYTHON,
    [
      RUNNER,
      '--target', target,
      '--progress-every', '50',
      ...configToCliArgs(config),
    ],
    { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  activeRunId = id;
  activeChild = child;

  if (child.pid) {
    await pool.query(`UPDATE brainfuck_runs SET pid = $1 WHERE id = $2`, [child.pid, id]);
  }

  const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt: Event;
    try {
      evt = JSON.parse(trimmed) as Event;
    } catch {
      return;
    }
    handleEvent(id, evt).catch((e) => console.error('[brainfuck] event handler', e));
  });

  let stderrBuf = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  child.on('exit', (code, signal) => {
    activeRunId = null;
    activeChild = null;
    finalize(id, code, signal, stderrBuf).catch((e) =>
      console.error('[brainfuck] finalize', e),
    );
  });

  return { id };
}

async function handleEvent(id: number, evt: Event): Promise<void> {
  if (evt.type === 'progress' || evt.type === 'found') {
    await pool.query(
      `UPDATE brainfuck_runs
       SET generations = $2, best_fitness = $3, best_gene = $4, best_output = $5
       WHERE id = $1`,
      [id, evt.gen, evt.best_fitness, evt.best_gene, evt.best_output],
    );
    await pool.query(
      `INSERT INTO brainfuck_progress (run_id, gen, best_fitness) VALUES ($1, $2, $3)`,
      [id, evt.gen, evt.best_fitness],
    );
  } else if (evt.type === 'done') {
    await pool.query(
      `UPDATE brainfuck_runs
       SET generations = $2, best_fitness = $3, best_gene = $4, best_output = $5,
           status = $6, completed_at = NOW()
       WHERE id = $1`,
      [id, evt.gen, evt.best_fitness, evt.best_gene, evt.best_output, evt.found ? 'found' : 'done'],
    );
  } else if (evt.type === 'error') {
    await pool.query(
      `UPDATE brainfuck_runs SET status = 'failed', error = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [id, evt.message],
    );
  }
}

async function finalize(
  id: number,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): Promise<void> {
  // The exit handler also fires for runs that already wrote a terminal status
  // via {type: "done"} — only update rows still marked running.
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    await pool.query(
      `UPDATE brainfuck_runs SET status = 'stopped', completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [id],
    );
    return;
  }
  if (code !== 0 && code !== 1) {
    await pool.query(
      `UPDATE brainfuck_runs SET status = 'failed', error = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [id, stderr || `exit code ${code}`],
    );
  }
}

export function stopRun(id: number): boolean {
  if (activeRunId !== id || !activeChild) return false;
  activeChild.kill('SIGTERM');
  return true;
}

export function getActiveRunId(): number | null {
  return activeRunId;
}

// ── Benchmarks ────────────────────────────────────────────────────────────

// Suite of configs every benchmark click runs. Sweeps short→long targets and
// pop/gen scaling so a single click captures throughput at a few operating
// points, not just one. Sequential — they share the JVM lock.
export const BENCHMARK_PRESET: { target: string; popSize: number; maxGen: number }[] = [
  { target: 'hi',     popSize: 50,  maxGen: 50  },
  { target: 'devy',   popSize: 50,  maxGen: 100 },
  { target: 'hello',  popSize: 100, maxGen: 100 },
];

interface BatchQueueItem {
  rowId: number;
  target: string;
  popSize: number;
  maxGen: number;
}

let benchmarkBatchQueue: BatchQueueItem[] = [];
let benchmarkBatchStopped = false;

export async function startBenchmarkBatch(
  label: string | null,
): Promise<{ batchId: string; rowIds: number[] }> {
  await bootstrap();

  if (activeChild) {
    throw new Error(
      activeRunId != null
        ? 'A run is in progress. Stop it before starting a benchmark.'
        : 'A benchmark is already in progress.',
    );
  }

  const version = getBFVersion();
  const batchId = String(Date.now());
  benchmarkBatchStopped = false;

  // Pre-create one row per config so the UI can show all configs in the batch
  // immediately (queued ones too).
  const rowIds: number[] = [];
  for (const cfg of BENCHMARK_PRESET) {
    const { rows } = await pool.query(
      `INSERT INTO brainfuck_benchmarks
         (version_hash, version_subject, version_label, batch_id,
          target, pop_size, max_generations, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
       RETURNING id`,
      [version.hash, version.subject, label, batchId, cfg.target, cfg.popSize, cfg.maxGen],
    );
    rowIds.push(rows[0].id);
  }

  benchmarkBatchQueue = rowIds.map((rowId, i) => ({
    rowId,
    target: BENCHMARK_PRESET[i].target,
    popSize: BENCHMARK_PRESET[i].popSize,
    maxGen: BENCHMARK_PRESET[i].maxGen,
  }));

  spawnNextBenchmarkInBatch();

  return { batchId, rowIds };
}

function spawnNextBenchmarkInBatch(): void {
  // Drain any queue entries that were marked stopped while we were between
  // spawns (so the user's stop click doesn't leak into the next config).
  if (benchmarkBatchStopped) {
    for (const item of benchmarkBatchQueue) {
      pool.query(
        `UPDATE brainfuck_benchmarks SET status = 'stopped', completed_at = NOW()
         WHERE id = $1 AND status = 'queued'`,
        [item.rowId],
      ).catch((e) => console.error('[brainfuck] cancel queued', e));
    }
    benchmarkBatchQueue = [];
    benchmarkBatchStopped = false;
    return;
  }

  const next = benchmarkBatchQueue.shift();
  if (!next) {
    activeBenchmarkId = null;
    activeChild = null;
    return;
  }

  // Promote this row from 'queued' to 'running'
  pool.query(
    `UPDATE brainfuck_benchmarks SET status = 'running' WHERE id = $1`,
    [next.rowId],
  ).catch((e) => console.error('[brainfuck] mark running', e));

  const child = spawn(
    PYTHON,
    [
      RUNNER,
      '--benchmark',
      '--target', next.target,
      '--max-gen', String(next.maxGen),
      '--pop-size', String(next.popSize),
    ],
    { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  activeBenchmarkId = next.rowId;
  activeChild = child;

  if (child.pid) {
    pool.query(`UPDATE brainfuck_benchmarks SET pid = $1 WHERE id = $2`, [child.pid, next.rowId])
      .catch((e) => console.error('[brainfuck] write pid', e));
  }

  let benchmarkResult: BenchmarkEvent | null = null;
  let benchmarkError: string | null = null;

  const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const evt = JSON.parse(trimmed) as Event;
      if (evt.type === 'benchmark') benchmarkResult = evt;
      else if (evt.type === 'error') benchmarkError = evt.message;
    } catch {
      /* ignore non-JSON lines */
    }
  });

  let stderrBuf = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  child.on('exit', (code, signal) => {
    finalizeBenchmark(next.rowId, code, signal, benchmarkResult, benchmarkError, stderrBuf)
      .catch((e) => console.error('[brainfuck] finalizeBenchmark', e))
      .finally(() => spawnNextBenchmarkInBatch());
  });
}

async function finalizeBenchmark(
  id: number,
  code: number | null,
  signal: NodeJS.Signals | null,
  result: BenchmarkEvent | null,
  errMsg: string | null,
  stderr: string,
): Promise<void> {
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    await pool.query(
      `UPDATE brainfuck_benchmarks SET status = 'stopped', completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [id],
    );
    return;
  }
  if (result) {
    await pool.query(
      `UPDATE brainfuck_benchmarks
       SET status = 'completed',
           generations = $2,
           evaluations = $3,
           wall_seconds = $4,
           evals_per_sec = $5,
           gens_per_sec = $6,
           best_fitness = $7,
           found = $8,
           completed_at = NOW()
       WHERE id = $1`,
      [
        id,
        result.generations,
        result.evaluations,
        result.wall_seconds,
        result.evals_per_sec,
        result.gens_per_sec,
        result.best_fitness,
        result.found,
      ],
    );
    return;
  }
  // No result event arrived — child crashed or exited abnormally.
  await pool.query(
    `UPDATE brainfuck_benchmarks SET status = 'failed', error = $2, completed_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [id, errMsg ?? stderr ?? `exit code ${code}`],
  );
}

export function stopBenchmark(id: number): boolean {
  if (activeBenchmarkId !== id || !activeChild) return false;
  // Tell the post-exit handler not to spawn the next config in the batch.
  benchmarkBatchStopped = true;
  activeChild.kill('SIGTERM');
  return true;
}

export function getActiveBenchmarkId(): number | null {
  return activeBenchmarkId;
}
