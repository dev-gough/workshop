import { spawn, ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import pool from '@/lib/db';

const REPO_DIR = '/home/server/brainfuck-genetic';
const PYTHON = `${REPO_DIR}/.venv/bin/python`;
const RUNNER = 'Project/runner.py';
const CWD = '/home/server';

type ProgressEvent = { type: 'progress'; gen: number; best_fitness: number; best_gene: string; best_output: string };
type FoundEvent = { type: 'found'; gen: number; best_fitness: number; best_gene: string; best_output: string };
type DoneEvent = { type: 'done'; gen: number; best_fitness: number; best_gene: string; best_output: string; found: boolean };
type StartEvent = { type: 'start'; target: string; pop_size: number; max_generations: number };
type ErrorEvent = { type: 'error'; message: string };
type Event = ProgressEvent | FoundEvent | DoneEvent | StartEvent | ErrorEvent;

let activeRunId: number | null = null;
let activeChild: ChildProcess | null = null;
let bootstrapped = false;

async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  await pool.query(
    `UPDATE brainfuck_runs SET status = 'interrupted', completed_at = NOW()
     WHERE status = 'running'`,
  );
}

export async function startRun(
  target: string,
  maxGen: number,
  popSize: number,
): Promise<{ id: number }> {
  await bootstrap();

  if (activeChild) {
    throw new Error('A run is already in progress. Stop it before starting a new one.');
  }

  const { rows } = await pool.query(
    `INSERT INTO brainfuck_runs (target, max_generations, pop_size, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [target, maxGen, popSize],
  );
  const id: number = rows[0].id;

  const child = spawn(
    PYTHON,
    [
      RUNNER,
      '--target', target,
      '--max-gen', String(maxGen),
      '--pop-size', String(popSize),
      '--progress-every', '50',
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
