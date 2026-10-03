/**
 * Time the throughput probes on every commit of the BF reference repo.
 *
 * Walks `git log` in the brainfuck repo, and for each commit:
 *   1. checks it out (after stashing any working-tree edits)
 *   2. runs that commit's `runner.py` under the configured Python
 *   3. parses the single {"type":"benchmark", ...} JSON line
 *   4. inserts a brainfuck_benchmarks row stamped with that commit
 *
 * Commits that speak fixed-v1 (the `--bench-mode` flag) get the current
 * throughput preset: seeded, no early exit, warmup discarded, repeated
 * until the window is long enough. Those rows are comparable with each
 * other and with a later C / C++ / Rust port of the same flags.
 *
 * Older commits don't have that flag. They are skipped, because the old
 * one-shot (including the historical sparqsys / 1M row) stops when it
 * solves and so is not the same measurement. Pass `--legacy` to time that
 * old probe anyway; those rows are stored as protocol='legacy' and should
 * not be read next to fixed-v1 numbers.
 *
 * This walk always runs `runner.py` from the checkout. A compiled port is
 * not rebuilt per commit — point the Tape Lab at it with paths.brainfuckRunner
 * and use the bench button on the current tree.
 *
 * Already-backfilled (commit, probe) pairs are skipped.
 *
 * IMPORTANT: do not start any BF runs or benchmarks via the workshop UI
 * while this is running. The workshop spawns runner.py from the same repo
 * this script checks historical commits into.
 *
 * Usage:
 *   npx tsx scripts/backfill-bf-benchmarks.ts            # all commits, fixed-v1 only
 *   npx tsx scripts/backfill-bf-benchmarks.ts --since 5  # only the 5 most recent
 *   npx tsx scripts/backfill-bf-benchmarks.ts --dry-run  # list, don't run
 *   npx tsx scripts/backfill-bf-benchmarks.ts --timeout 180
 *   npx tsx scripts/backfill-bf-benchmarks.ts --legacy   # also time pre-protocol commits
 */

import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { brainfuckRepoPath, pythonBinPath } from '../src/lib/config';
import { THROUGHPUT_PRESET, benchCaseArgs, type BenchCase } from '../src/lib/brainfuck-benchmarks';
import { makePool } from '../src/lib/db';

const REPO = brainfuckRepoPath();
const PYTHON = pythonBinPath();
// The historical one-shot. Only used with --legacy, and stored apart from
// fixed-v1 so the two series are not averaged.
const LEGACY_CASE: BenchCase = {
  target: 'sparqsys',
  popSize: 100,
  maxGen: 1_000_000,
  lanes: 1,
  trials: 1,
  warmupGens: 0,
  minSeconds: 0,
  seed: 1,
};
const DEFAULT_TIMEOUT_S = 180;

const pool = makePool('workshop');

// ── CLI arg parsing ─────────────────────────────────────────────────────────

interface Args {
  since: number | null;
  dryRun: boolean;
  timeoutS: number;
  legacy: boolean;
}

function parseArgs(): Args {
  const out: Args = { since: null, dryRun: false, timeoutS: DEFAULT_TIMEOUT_S, legacy: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--legacy') out.legacy = true;
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
  trials?: number | null;
  solved?: number | null;
  solve_rate?: number | null;
  median_gens?: number | null;
  p90_gens?: number | null;
  seed?: number | null;
  runtime?: string | null;
  host?: string | null;
  cpu?: string | null;
  repeats?: number | null;
  found_at?: number | null;
  protocol?: string | null;
  cache_hit_rate?: number | null;
}

function runnerSupportsFixedV1(): boolean {
  try {
    const help = execFileSync(PYTHON, ['runner.py', '--help'], {
      cwd: REPO, encoding: 'utf8',
    });
    return help.includes('--bench-mode');
  } catch {
    return false;
  }
}

function runBenchmark(
  benchCase: BenchCase,
  timeoutS: number,
  protocol: 'fixed-v1' | 'legacy',
): Promise<BenchmarkResult | { error: string }> {
  // benchCaseArgs is the flag list. Both protocols spawn `runner.py` from
  // the commit that is checked out, never a separately built binary.
  const childArgs = protocol === 'fixed-v1'
    ? ['runner.py', ...benchCaseArgs('throughput', benchCase)]
    : [
        'runner.py', '--benchmark',
        '--target', benchCase.target,
        '--pop-size', String(benchCase.popSize),
        '--max-gen', String(benchCase.maxGen),
      ];
  return new Promise((resolve) => {
    const child = spawn(
      PYTHON,
      childArgs,
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

async function alreadyBackfilled(
  hash: string,
  benchCase: BenchCase,
  protocol: 'fixed-v1' | 'legacy',
): Promise<boolean> {
  // Historical 1M rows were inserted before the protocol column existed.
  // Treat those as the legacy probe so --legacy does not duplicate them.
  const protocolClause = protocol === 'legacy'
    ? `(protocol IS NULL OR protocol = 'legacy')`
    : `protocol = 'fixed-v1'`;
  const { rows } = await pool.query(
    `SELECT 1 FROM brainfuck_benchmarks
     WHERE version_hash = $1 AND target = $2 AND pop_size = $3 AND max_generations = $4
       AND ${protocolClause}
     LIMIT 1`,
    [hash, benchCase.target, benchCase.popSize, benchCase.maxGen],
  );
  return rows.length > 0;
}

async function insertBackfillRow(
  commit: Commit,
  benchCase: BenchCase,
  protocol: 'fixed-v1' | 'legacy',
  result: BenchmarkResult | { error: string },
  batchId: string,
): Promise<void> {
  if ('error' in result) {
    await pool.query(
      `INSERT INTO brainfuck_benchmarks
         (version_hash, version_subject, version_label, batch_id, suite,
          target, pop_size, max_generations, protocol,
          status, error, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'throughput', $5, $6, $7, $8, 'failed', $9, $10, $10)`,
      [
        commit.hash, commit.subject, 'backfill', batchId,
        benchCase.target, benchCase.popSize, benchCase.maxGen, protocol,
        result.error, commit.authoredAt,
      ],
    );
    return;
  }
  await pool.query(
    `INSERT INTO brainfuck_benchmarks
       (version_hash, version_subject, version_label, batch_id, suite,
        target, pop_size, max_generations,
        generations, evaluations, wall_seconds,
        evals_per_sec, gens_per_sec, best_fitness, found,
        trials, solved, solve_rate, median_gens, p90_gens,
        seed, runtime, host, cpu, repeats, found_at, protocol, cache_hit_rate,
        result_json, status, started_at, completed_at)
     VALUES ($1, $2, $3, $4, 'throughput', $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19,
             $20, $21, $22, $23, $24, $25, $26, $27,
             $28, 'completed', $29, $29)`,
    [
      commit.hash, commit.subject, 'backfill', batchId,
      benchCase.target, benchCase.popSize, benchCase.maxGen,
      result.generations, result.evaluations, result.wall_seconds,
      result.evals_per_sec, result.gens_per_sec, result.best_fitness, result.found,
      result.trials ?? null, result.solved ?? null, result.solve_rate ?? null,
      result.median_gens ?? null, result.p90_gens ?? null,
      result.seed ?? benchCase.seed, result.runtime ?? null, result.host ?? null,
      result.cpu ?? null, result.repeats ?? null, result.found_at ?? null,
      result.protocol ?? protocol, result.cache_hit_rate ?? null,
      JSON.stringify(result), commit.authoredAt,
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
  console.log(`Probes:  ${THROUGHPUT_PRESET.map((c) => `${c.maxGen} gen / ≥${c.minSeconds}s`).join(', ')}`);
  console.log(`Legacy:  ${args.legacy ? `sparqsys / ${LEGACY_CASE.maxGen} gen one-shot` : 'off'}`);
  console.log(`Timeout: ${args.timeoutS}s per probe`);
  console.log();

  await ensureNoActiveWork();

  const commits = listCommits(args.since);
  console.log(`Walking ${commits.length} commit(s)...\n`);

  // A commit whose fixed-v1 probes are all stored needs no checkout. Commits
  // that predate the protocol still get checked out so we can tell them apart.
  const todo: Commit[] = [];
  for (const c of commits) {
    const done = (await Promise.all(
      THROUGHPUT_PRESET.map((probe) => alreadyBackfilled(c.hash, probe, 'fixed-v1')),
    )).every(Boolean);
    console.log(`  [${done ? 'skip (fixed-v1 done)' : 'queue'}] ${c.hash}  ${c.subject}`);
    if (!done) todo.push(c);
  }
  console.log(`\n${todo.length} commit(s) to inspect.`);
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

      const fixed = runnerSupportsFixedV1();
      if (!fixed && !args.legacy) {
        console.log('  skip — runner has no --bench-mode (pass --legacy for the old one-shot)');
        continue;
      }
      const jobs: { benchCase: BenchCase; protocol: 'fixed-v1' | 'legacy' }[] = fixed
        ? THROUGHPUT_PRESET.map((benchCase) => ({ benchCase, protocol: 'fixed-v1' as const }))
        : [{ benchCase: LEGACY_CASE, protocol: 'legacy' as const }];

      for (const job of jobs) {
        if (await alreadyBackfilled(c.hash, job.benchCase, job.protocol)) {
          console.log(`  skip ${job.benchCase.maxGen} gen (${job.protocol} already stored)`);
          continue;
        }
        const t0 = Date.now();
        const result = await runBenchmark(job.benchCase, args.timeoutS, job.protocol);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const label = `${job.protocol} ${job.benchCase.maxGen} gen`;

        if ('error' in result) {
          console.log(`  ✗ ${label} ${elapsed}s — ${result.error}`);
        } else {
          console.log(
            `  ✓ ${label} ${elapsed}s — ` +
            `${Math.round(result.gens_per_sec).toLocaleString()} gens/s, ` +
            `${result.repeats ?? 1} repeat(s)`,
          );
        }
        await insertBackfillRow(c, job.benchCase, job.protocol, result, batchId);
      }
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
