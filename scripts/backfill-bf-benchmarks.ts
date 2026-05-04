/**
 * Backfill the heavy benchmark row (target='sparqsys', pop=100, max-gen=1M)
 * across the BF reference repo's full git history. Lets us answer "how far
 * have we come" with apples-to-apples throughput numbers on a config that
 * the original algorithm can't actually solve.
 *
 * Walks `git log` in /home/server/brainfuck-genetic, and for each commit:
 *   1. checks it out (after stashing any working-tree edits)
 *   2. runs `pypy3 runner.py --benchmark` with the heavy preset
 *   3. parses the single {"type":"benchmark", ...} JSON line
 *   4. inserts a brainfuck_benchmarks row stamped with that commit's
 *      hash + subject + authored date as `started_at`
 *
 * Already-backfilled commits are skipped (idempotent — safe to rerun if you
 * Ctrl-C partway through).
 *
 * IMPORTANT: do not start any BF runs or benchmarks via the workshop UI
 * while this is running. The workshop spawns runner.py from the same repo
 * we're checking historical commits into; a UI-triggered run during
 * backfill would silently use whichever ancient algorithm version happens
 * to be checked out. Script aborts up-front if it sees an active run.
 *
 * Usage:
 *   npx tsx scripts/backfill-bf-benchmarks.ts            # all commits
 *   npx tsx scripts/backfill-bf-benchmarks.ts --since 5  # only the 5 most recent
 *   npx tsx scripts/backfill-bf-benchmarks.ts --dry-run  # list, don't run
 *   npx tsx scripts/backfill-bf-benchmarks.ts --timeout 600  # per-commit cap (s)
 */

import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { brainfuckRepoPath, pythonBinPath } from '../src/lib/config';
import { makePool } from '../src/lib/db';

const REPO = brainfuckRepoPath();
const PYTHON = pythonBinPath();
const TARGET = 'sparqsys';
const POP_SIZE = 100;
const MAX_GEN = 1_000_000;
const DEFAULT_TIMEOUT_S = 1800; // 30 min per commit; oldest algos are slow

const pool = makePool('workshop');

// ── CLI arg parsing ─────────────────────────────────────────────────────────

interface Args {
  since: number | null;
  dryRun: boolean;
  timeoutS: number;
}

function parseArgs(): Args {
  const out: Args = { since: null, dryRun: false, timeoutS: DEFAULT_TIMEOUT_S };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--since') out.since = parseInt(argv[++i] ?? '', 10);
    else if (a === '--timeout') out.timeoutS = parseInt(argv[++i] ?? '', 10);
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  return out;
}

// ── Git helpers ─────────────────────────────────────────────────────────────

function git(...args: string[]): string {
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' }).trim();
}

interface Commit {
  hash: string;       // short hash
  subject: string;
  authoredAt: string; // ISO 8601
}

function listCommits(since: number | null): Commit[] {
  // Format: short-hash<TAB>iso-strict-date<TAB>subject
  const log = git('log', '--pretty=format:%h%x09%aI%x09%s');
  const all: Commit[] = log.split('\n').filter(Boolean).map((line) => {
    const [hash, authoredAt, ...rest] = line.split('\t');
    return { hash, authoredAt, subject: rest.join('\t') };
  });
  return since != null ? all.slice(0, since) : all;
}

// ── Workshop safety check ───────────────────────────────────────────────────

async function ensureNoActiveWork(): Promise<void> {
  const { rows: runs } = await pool.query(
    `SELECT id FROM brainfuck_runs WHERE status IN ('running', 'queued')`,
  );
  const { rows: bench } = await pool.query(
    `SELECT id FROM brainfuck_benchmarks WHERE status IN ('running', 'queued')`,
  );
  if (runs.length > 0 || bench.length > 0) {
    console.error(
      `Refusing to start: workshop has ${runs.length} active run(s) and ` +
      `${bench.length} active benchmark(s). Stop them in the UI first.`,
    );
    process.exit(1);
  }
}

// ── Per-commit benchmark execution ──────────────────────────────────────────

interface BenchmarkResult {
  generations: number;
  evaluations: number;
  wall_seconds: number;
  evals_per_sec: number;
  gens_per_sec: number;
  best_fitness: number;
  found: boolean;
}

function runBenchmark(timeoutS: number): Promise<BenchmarkResult | { error: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      PYTHON,
      [
        'runner.py',
        '--benchmark',
        '--target', TARGET,
        '--pop-size', String(POP_SIZE),
        '--max-gen', String(MAX_GEN),
      ],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let result: BenchmarkResult | null = null;
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // SIGKILL fallback if the runner doesn't respond
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutS * 1000);

    const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const evt = JSON.parse(trimmed);
        if (evt.type === 'benchmark') result = evt;
      } catch { /* ignore non-JSON */ }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) return resolve({ error: `timed out after ${timeoutS}s` });
      if (result) return resolve(result);
      const trimmed = stderr.trim().split('\n').slice(-3).join(' | ');
      resolve({ error: `exit ${code}; ${trimmed || 'no stderr'}` });
    });
  });
}

// ── DB writes ───────────────────────────────────────────────────────────────

async function alreadyBackfilled(hash: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM brainfuck_benchmarks
     WHERE version_hash = $1 AND target = $2 AND pop_size = $3 AND max_generations = $4
     LIMIT 1`,
    [hash, TARGET, POP_SIZE, MAX_GEN],
  );
  return rows.length > 0;
}

async function insertBackfillRow(
  commit: Commit,
  result: BenchmarkResult | { error: string },
  batchId: string,
): Promise<void> {
  if ('error' in result) {
    await pool.query(
      `INSERT INTO brainfuck_benchmarks
         (version_hash, version_subject, version_label, batch_id,
          target, pop_size, max_generations,
          status, error, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed', $8, $9, $9)`,
      [
        commit.hash, commit.subject, 'backfill', batchId,
        TARGET, POP_SIZE, MAX_GEN,
        result.error, commit.authoredAt,
      ],
    );
    return;
  }
  await pool.query(
    `INSERT INTO brainfuck_benchmarks
       (version_hash, version_subject, version_label, batch_id,
        target, pop_size, max_generations,
        generations, evaluations, wall_seconds,
        evals_per_sec, gens_per_sec, best_fitness, found,
        status, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             'completed', $15, $15)`,
    [
      commit.hash, commit.subject, 'backfill', batchId,
      TARGET, POP_SIZE, MAX_GEN,
      result.generations, result.evaluations, result.wall_seconds,
      result.evals_per_sec, result.gens_per_sec, result.best_fitness, result.found,
      commit.authoredAt,
    ],
  );
}

// ── Working-tree restore (always runs, even on Ctrl-C) ──────────────────────

interface SavedState {
  ref: string;       // branch name OR sha if detached
  isBranch: boolean;
  stashed: boolean;  // whether we created a stash to pop later
}

function saveState(): SavedState {
  // `--abbrev-ref HEAD` returns the branch name, or "HEAD" if detached
  const branchOrHead = git('rev-parse', '--abbrev-ref', 'HEAD');
  const isBranch = branchOrHead !== 'HEAD';
  const ref = isBranch ? branchOrHead : git('rev-parse', 'HEAD');

  // Stash uncommitted changes (incl. untracked) if any. The current state of
  // /home/server/brainfuck-genetic includes the lexicase work-in-progress.
  const dirty = git('status', '--porcelain') !== '';
  let stashed = false;
  if (dirty) {
    git('stash', 'push', '--include-untracked', '-m', 'backfill-bf-benchmarks autosave');
    stashed = true;
  }
  return { ref, isBranch, stashed };
}

function restoreState(saved: SavedState): void {
  if (saved.isBranch) {
    git('checkout', saved.ref);
  } else {
    git('checkout', '--detach', saved.ref);
  }
  if (saved.stashed) {
    git('stash', 'pop');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`BF repo: ${REPO}`);
  console.log(`Python:  ${PYTHON}`);
  console.log(`Preset:  target='${TARGET}', pop=${POP_SIZE}, max-gen=${MAX_GEN}`);
  console.log(`Timeout: ${args.timeoutS}s per commit`);
  console.log();

  await ensureNoActiveWork();

  const commits = listCommits(args.since);
  console.log(`Walking ${commits.length} commit(s)...\n`);

  // Pre-filter so we don't waste a checkout on already-done commits
  const todo: Commit[] = [];
  for (const c of commits) {
    const done = await alreadyBackfilled(c.hash);
    const flag = done ? 'skip (already done)' : 'queue';
    console.log(`  [${flag}] ${c.hash}  ${c.subject}`);
    if (!done) todo.push(c);
  }
  console.log(`\n${todo.length} commit(s) to run.`);
  if (args.dryRun) {
    console.log('(dry run — exiting without checkouts)');
    await pool.end();
    return;
  }
  if (todo.length === 0) {
    await pool.end();
    return;
  }

  const batchId = `backfill-${Date.now()}`;
  const saved = saveState();
  console.log(`\nSaved state: ${saved.isBranch ? 'branch' : 'detached@'}${saved.ref}` +
              `${saved.stashed ? ' (stashed working changes)' : ''}\n`);

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try { restoreState(saved); console.log(`\nRestored state.`); }
    catch (e) { console.error(`\nFAILED to restore state: ${e}\nManual recovery needed.`); }
  };
  process.on('SIGINT',  () => { restore(); process.exit(130); });
  process.on('SIGTERM', () => { restore(); process.exit(143); });

  try {
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i];
      console.log(`[${i + 1}/${todo.length}] ${c.hash}  ${c.subject}`);
      try {
        git('checkout', '--detach', c.hash);
      } catch (e) {
        console.log(`  checkout failed: ${e}; skipping`);
        continue;
      }

      const t0 = Date.now();
      const result = await runBenchmark(args.timeoutS);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      if ('error' in result) {
        console.log(`  ✗ ${elapsed}s — ${result.error}`);
      } else {
        const solved = result.found ? 'SOLVED' : `fit=${result.best_fitness}`;
        console.log(
          `  ✓ ${elapsed}s — ${solved}, ` +
          `${result.gens_per_sec.toFixed(0)} gens/s, ` +
          `${result.generations.toLocaleString()} gens`,
        );
      }
      await insertBackfillRow(c, result, batchId);
    }
  } finally {
    restore();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
