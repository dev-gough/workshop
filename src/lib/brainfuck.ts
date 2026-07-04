import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import pool from '@/lib/db';
import { brainfuckRepoPath, pythonBinPath } from '@/lib/config';

const REPO_DIR = brainfuckRepoPath();
const PYTHON = pythonBinPath();
const RUNNER = 'runner.py';
const CWD = REPO_DIR;

// ── GA hyperparameter config ────────────────────────────────────────────────
// Mirrors util.GAConfig in the Python side. Keep field names in sync.

export interface GAConfig {
  pop_size: number;
  max_generations: number;
  max_prog_len: number;
  min_prog_len: number;
  crossover_rate: number;
  mutation_rate: number;
  mut_prob: number;
  macro_mut_rate: number;
  restart_every: number;
  restart_keep_frac: number;
  bracket_mut_rate: number;
  islands: number;
  migration_every: number;
  // 0/1 — switch parent selection from tournament to lexicase (per-target-
  // position case filtering). Stored as 0|1 so the rest of the numeric
  // knob plumbing (bounds, parser, CLI) stays uniform; the runner casts
  // it to bool.
  lexicase: number;
  // Output-fitness-sharing strength. 0 disables (baseline). >0 rescales each
  // program's selection-fitness by 1 / count[output]^strength, so dominant
  // output clusters can't monopolize parent selection. 1.0 = sharp ("score
  // per copy"), 0.5 = soft (sqrt-crowding). Pairs well with lexicase: sharing
  // becomes the lexicase-tie weighting instead of a fitness rescale.
  share_strength: number;
  // Lamarckian repair cadence — NOT a genetic operator (it reads the target
  // to compute exact deltas). 0 = pure GA, the default; kept only as an
  // A/B instrument for memetic-vs-pure comparisons.
  repair_every: number;
  // Per-child probability of a blind geometric ±k jump on one '+'/'-' run —
  // the honest counterpart of repair's step-size lesson: big random moves
  // through byte space, with selection (not the target) deciding survival.
  run_mut_rate: number;
  // Spin detection: truncate an eval after this many ops with no output
  // (silent loops otherwise burn the full 250k-op cap — ~100x a healthy
  // eval — and dominate wall time in converged populations). 0 disables.
  spin_ops: number;
  // Workshop-only knob (not passed to runner.py): when > 1, "Start run"
  // spawns N independent runner processes racing for the same target. First
  // one to emit a 'found' event wins; siblings get killed and marked
  // 'superseded'. Different RNG seeds across processes give lottery-style
  // diversity on top of whatever in-process diversity (islands, restart) is
  // already configured.
  parallel_runs: number;
}

export const DEFAULT_CONFIG: GAConfig = {
  pop_size: 100,
  max_generations: 1_000_000,
  max_prog_len: 300,
  min_prog_len: 10,
  crossover_rate: 0.5,
  mutation_rate: 0.1,
  // 0 = adaptive per-char rate (~1.5/gene-length, the textbook 1/L regime).
  // The old constant 0.7 rewrote ~70% of every child and is why long
  // near-solutions never survived; set an explicit value to override.
  mut_prob: 0,
  macro_mut_rate: 0.05,
  restart_every: 250_000,
  restart_keep_frac: 0.2,
  bracket_mut_rate: 0.30,
  islands: 1,
  migration_every: 10_000,
  lexicase: 1,
  share_strength: 0,
  repair_every: 0,
  run_mut_rate: 0.35,
  spin_ops: 40_000,
  parallel_runs: 1,
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
  // 100M cap: at PyPy's ~3.8k gens/s that's a deliberate overnight run,
  // not an accidental one. (Was 10M when CPython made even that ~8h.)
  max_generations:    { min: 100,   max: 100_000_000, integer: true },
  max_prog_len:       { min: 20,    max: 2000,       integer: true },
  min_prog_len:       { min: 1,     max: 200,        integer: true },
  crossover_rate:     { min: 0,     max: 1 },
  mutation_rate:      { min: 0,     max: 1 },
  mut_prob:           { min: 0,     max: 1 },
  macro_mut_rate:     { min: 0,     max: 1 },
  restart_every:      { min: 0,     max: 100_000_000, integer: true },
  restart_keep_frac:  { min: 0,     max: 1 },
  bracket_mut_rate:   { min: 0,     max: 1 },
  islands:            { min: 1,     max: 10,         integer: true },
  migration_every:    { min: 0,     max: 1_000_000,  integer: true },
  lexicase:           { min: 0,     max: 1,          integer: true },
  share_strength:     { min: 0,     max: 2 },
  repair_every:       { min: 0,     max: 1_000_000,  integer: true },
  run_mut_rate:       { min: 0,     max: 1 },
  spin_ops:           { min: 0,     max: 250_000,    integer: true },
  parallel_runs:      { min: 1,     max: 4,          integer: true },
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
    '--crossover-rate',     String(cfg.crossover_rate),
    '--mutation-rate',      String(cfg.mutation_rate),
    '--mut-prob',           String(cfg.mut_prob),
    '--macro-mut-rate',     String(cfg.macro_mut_rate),
    '--restart-every',      String(cfg.restart_every),
    '--restart-keep-frac',  String(cfg.restart_keep_frac),
    '--bracket-mut-rate',   String(cfg.bracket_mut_rate),
    '--islands',            String(cfg.islands),
    '--migration-every',    String(cfg.migration_every),
    '--lexicase',           String(cfg.lexicase),
    '--share-strength',     String(cfg.share_strength),
    '--repair-every',       String(cfg.repair_every),
    '--run-mut-rate',       String(cfg.run_mut_rate),
    '--spin-ops',           String(cfg.spin_ops),
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
// Diversity-mechanism events emitted by runner.py. Previously dropped on the
// floor; now surfaced as lightweight activity entries in the run panel.
type RestartEvent = { type: 'restart'; gen: number; kept: number; best_fitness: number };
type MigrationEvent = { type: 'migration'; gen: number; K: number; best_fitness: number };
export interface SolutionStats {
  gene_length: number;
  loop_count: number;
  max_loop_depth: number;
  unique_instructions: number;
  ops_executed: number;
  halted: boolean;
  output_length: number;
  cells_used: number;
  output_exact_match: boolean;
}
type SolutionEvent = {
  type: 'solution';
  gen: number;
  best_fitness: number;
  best_gene: string;
  best_output: string;
  stats: SolutionStats;
};
type Event =
  | ProgressEvent
  | FoundEvent
  | DoneEvent
  | StartEvent
  | BenchmarkEvent
  | ErrorEvent
  | SolutionEvent
  | RestartEvent
  | MigrationEvent;

// ── Live event fan-out ──────────────────────────────────────────────────────
// The SSE route (api/brainfuck/runs/stream) subscribes here to push runner
// events to browsers in real time, replacing 1s polling. This emitter is part
// of the same module singleton as the child-process manager, so a route
// handler that imports from '@/lib/brainfuck' shares this exact instance and
// sees events for the currently-running child(ren). Events carry the run id so
// a client watching a specific run can filter.
export type StreamEvent = { runId: number } & Event;

const streamBus = new EventEmitter();
// SSE clients per active run can pile up; lift the default 10-listener cap so
// Node doesn't warn on legitimate fan-out.
streamBus.setMaxListeners(0);

export function subscribeRunEvents(listener: (evt: StreamEvent) => void): () => void {
  streamBus.on('event', listener);
  return () => streamBus.off('event', listener);
}

function emitStreamEvent(runId: number, evt: Event): void {
  streamBus.emit('event', { runId, ...evt } as StreamEvent);
}

// Each currently-running runner subprocess (1..N for parallel races, always 1
// for solo runs). The race_id groups siblings together so a 'found' event on
// one can identify the others to terminate.
interface ActiveLane {
  runId: number;
  raceId: string | null;
  child: ChildProcess;
}
let activeLanes: ActiveLane[] = [];
let activeBenchmarkId: number | null = null;
// All lanes of the currently-running benchmark row (1 for throughput rows,
// SOLVE_LANES for solve rows racing to the first find).
let activeBenchLanes: ChildProcess[] = [];
// IDs that were intentionally killed because a sibling won the race. The
// child's exit handler checks this set and writes 'superseded' rather than
// the default 'stopped' for SIGTERM exits.
const supersededIds = new Set<number>();
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
): Promise<{ ids: number[]; raceId: string | null }> {
  await bootstrap();

  if (activeLanes.length > 0 || activeBenchLanes.length > 0) {
    throw new Error(
      activeBenchmarkId != null
        ? 'A benchmark is in progress. Wait for it to finish before starting a new run.'
        : 'A run is already in progress. Stop it before starting a new one.',
    );
  }

  const lanes = Math.max(1, Math.min(4, Math.trunc(config.parallel_runs || 1)));
  const raceId = lanes > 1 ? `race-${Date.now()}` : null;
  const bfVersion = getBFVersion();

  const ids: number[] = [];
  for (let i = 0; i < lanes; i++) {
    const id = await spawnLane(target, config, raceId, bfVersion.hash);
    ids.push(id);
  }
  return { ids, raceId };
}

async function spawnLane(
  target: string,
  config: GAConfig,
  raceId: string | null,
  versionHash: string | null,
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO brainfuck_runs (target, max_generations, pop_size, status, config_json, race_id)
     VALUES ($1, $2, $3, 'running', $4, $5) RETURNING id`,
    [target, config.max_generations, config.pop_size, JSON.stringify(config), raceId],
  );
  const id: number = rows[0].id;

  // Captured here so the 'solution' event handler (which is keyed by run id
  // only) can write the discovery context — target, config, BF repo HEAD —
  // without re-querying the runs row.
  const runContext = { target, config, versionHash };

  const child = spawn(
    PYTHON,
    [
      RUNNER,
      '--target', target,
      // PyPy emits ~90k gens/sec. Per-event UPDATE+INSERT through Node's
      // serialized chain caps at ~1k DB ops/sec — at the old 50-gen cadence
      // the chain backlogged minutes behind Python and the UI looked frozen.
      // 5000 keeps us comfortably ahead while still showing live progress.
      '--progress-every', '5000',
      ...configToCliArgs(config),
    ],
    { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  activeLanes.push({ runId: id, raceId, child });

  if (child.pid) {
    await pool.query(`UPDATE brainfuck_runs SET pid = $1 WHERE id = $2`, [child.pid, id]);
  }

  const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
  // Serialize handlers per-lane so events are applied to the DB in the same
  // order they arrived on stdout. Without this, async handlers race and a
  // late progress UPDATE can clobber the values written by an earlier 'done'
  // (we hit exactly that: status='found' with sub-target best_fitness).
  let chain: Promise<void> = Promise.resolve();
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let evt: Event;
    try {
      evt = JSON.parse(trimmed) as Event;
    } catch {
      return;
    }
    // Fan out to any live SSE subscribers immediately — no need to wait for the
    // DB-write chain to drain, since the stream carries the event payload
    // directly. The persisted row is still the source of truth on reconnect.
    emitStreamEvent(id, evt);
    chain = chain
      .then(() => handleEvent(id, evt, runContext))
      .catch((e) => console.error('[brainfuck] event handler', e));
  });

  let stderrBuf = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
  });

  child.on('exit', (code, signal) => {
    activeLanes = activeLanes.filter((l) => l.runId !== id);
    finalize(id, code, signal, stderrBuf).catch((e) =>
      console.error('[brainfuck] finalize', e),
    );
  });

  return id;
}

interface RunContext {
  target: string;
  config: GAConfig;
  versionHash: string | null;
}

async function handleEvent(id: number, evt: Event, ctx: RunContext): Promise<void> {
  if (evt.type === 'progress' || evt.type === 'found') {
    // Monotonic guard: best_fitness can only ever go up. The progress trail
    // (brainfuck_progress) still records every event for the sparkline, but
    // the row's "best" snapshot never regresses even if a stale handler runs
    // after a higher-fitness one wrote first. The status='running' check
    // also prevents progress writes from siblings that have already been
    // marked 'superseded' but whose chain is still draining.
    await pool.query(
      `UPDATE brainfuck_runs
       SET generations = GREATEST(generations, $2),
           best_fitness = $3,
           best_gene = $4,
           best_output = $5
       WHERE id = $1
         AND status = 'running'
         AND ($3 >= COALESCE(best_fitness, $3))`,
      [id, evt.gen, evt.best_fitness, evt.best_gene, evt.best_output],
    );
    await pool.query(
      `INSERT INTO brainfuck_progress (run_id, gen, best_fitness) VALUES ($1, $2, $3)`,
      [id, evt.gen, evt.best_fitness],
    );

    // First sibling to find a solution wins the race — kill the others and
    // mark them 'superseded' so finalize() can distinguish "user stopped"
    // from "race ended".
    if (evt.type === 'found') {
      const winnerLane = activeLanes.find((l) => l.runId === id);
      if (winnerLane?.raceId) {
        const losers = activeLanes.filter(
          (l) => l.raceId === winnerLane.raceId && l.runId !== id,
        );
        for (const loser of losers) {
          supersededIds.add(loser.runId);
          await pool.query(
            `UPDATE brainfuck_runs SET status='superseded', completed_at=NOW()
             WHERE id=$1 AND status='running'`,
            [loser.runId],
          );
          loser.child.kill('SIGTERM');
        }
      }
    }
  } else if (evt.type === 'solution') {
    // Dedup-by-(target,gene) upsert into the solutions catalog. Same gene
    // discovered in a later run just bumps times_found + last_seen_at;
    // structural/runtime stats are immutable for a given gene so we don't
    // overwrite them. Discovery context (run_id, generations_to_solve)
    // stays as the *first* discovery, which is the more interesting fact.
    const s = evt.stats;
    await pool.query(
      `INSERT INTO brainfuck_solutions (
         target, gene, output,
         gene_length, loop_count, max_loop_depth, unique_instructions,
         ops_executed, halted, output_length, cells_used, output_exact_match,
         run_id, generations_to_solve, config_json, bf_version_hash
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6, $7,
         $8, $9, $10, $11, $12,
         $13, $14, $15, $16
       )
       ON CONFLICT (target, gene) DO UPDATE SET
         times_found = brainfuck_solutions.times_found + 1,
         last_seen_at = NOW()`,
      [
        ctx.target, evt.best_gene, evt.best_output,
        s.gene_length, s.loop_count, s.max_loop_depth, s.unique_instructions,
        s.ops_executed, s.halted, s.output_length, s.cells_used, s.output_exact_match,
        id, evt.gen, JSON.stringify(ctx.config), ctx.versionHash,
      ],
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
  const wasSuperseded = supersededIds.delete(id);
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    await pool.query(
      `UPDATE brainfuck_runs SET status = $2, completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [id, wasSuperseded ? 'superseded' : 'stopped'],
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

// Stops one specific lane. If the lane belongs to a multi-lane race, the
// other lanes keep running (matches "stop just this one" semantics). To
// stop the whole race, the UI calls stopRun for each lane (or we can
// expose a stopRace helper later if needed).
export function stopRun(id: number): boolean {
  const lane = activeLanes.find((l) => l.runId === id);
  if (!lane) return false;
  lane.child.kill('SIGTERM');
  return true;
}

export function getActiveRunIds(): number[] {
  return activeLanes.map((l) => l.runId);
}

// Back-compat scalar accessor — returns the *first* active lane id, or null.
// Used by the runs/[id] DELETE check; multi-lane callers should use
// getActiveRunIds().includes(id) instead.
export function getActiveRunId(): number | null {
  return activeLanes[0]?.runId ?? null;
}

// ── Benchmarks ────────────────────────────────────────────────────────────

// Suite of configs every benchmark click runs. Sweeps short→long targets and
// pop/gen scaling so a single click captures throughput at a few operating
// points, not just one. Sequential — they share the JVM lock.
export const BENCHMARK_PRESET: { target: string; popSize: number; maxGen: number }[] = [
  { target: 'hi',       popSize: 50,  maxGen: 50  },
  { target: 'devy',     popSize: 50,  maxGen: 100 },
  { target: 'hello',    popSize: 100, maxGen: 100 },
  // Heavy probe: 8-char target the recent algo can solve in ~1m gens with
  // racing+lexicase but earlier versions can't touch. Runs full 1m gens on
  // commits where it doesn't solve, giving a real throughput delta vs the
  // old algos. Use scripts/backfill-bf-benchmarks.ts to populate this row
  // for historical commits.
  { target: 'sparqsys', popSize: 100, maxGen: 1_000_000 },
];

// Solve-rate suite: repeated default-config runs per target, measuring
// whether (and at what generation) the algorithm actually solves — the
// metric that makes hyperparameter comparisons meaningful, where the
// throughput suite only measures evals/s. A target ladder: 4 chars should
// be routine, 8 the former ceiling, 12 (with a space, far from lowercase
// ASCII) hard enough that flat-repair alone can't close it under the
// 300-char budget — the discriminator for future operator work.
//
// Solve rows race SOLVE_LANES independent runner processes; the first lane
// to solve wins and the row records its generations/wall (per-attempt solve
// probability ~67-100% makes a race-of-4 miss vanishingly rare, which is
// how the interactive rig is meant to be driven). Throughput rows stay
// single-lane — racing shares cores and would corrupt evals/s.
export const SOLVE_LANES = 4;
export const SOLVE_REPS = 3;

// The ladder: 4 → 20 chars, three reps each (the UI averages reps per
// target). Longer rungs mix in spaces and punctuation — bytes far from
// the lowercase cluster stress different loop structures than all-letter
// targets do. Caps scale with expected difficulty so a capped rep stays
// affordable (~1-3 min at PyPy speed) without silently truncating runs
// that were about to land.
const SOLVE_LADDER: { target: string; maxGen: number }[] = [
  { target: 'devy',                 maxGen: 100_000 },  //  4 ch
  { target: 'genome',               maxGen: 150_000 },  //  6 ch
  { target: 'sparqsys',             maxGen: 250_000 },  //  8 ch
  { target: 'brainfuck!',           maxGen: 250_000 },  // 10 ch, punctuation
  { target: 'the tape lab',         maxGen: 300_000 },  // 12 ch, spaces
  { target: 'genetic splice',       maxGen: 400_000 },  // 14 ch
  { target: 'hall of machines',     maxGen: 500_000 },  // 16 ch
  { target: 'evolution eats tapes', maxGen: 750_000 },  // 20 ch
];

export const SOLVE_PRESET: { target: string; popSize: number; maxGen: number; lanes: number }[] =
  SOLVE_LADDER.flatMap((rung) =>
    Array.from({ length: SOLVE_REPS }, () => ({
      target: rung.target,
      popSize: 100,
      maxGen: rung.maxGen,
      lanes: SOLVE_LANES,
    })),
  );

export type BenchmarkSuite = 'throughput' | 'solve';

interface BatchQueueItem {
  rowId: number;
  target: string;
  popSize: number;
  maxGen: number;
  lanes: number;
  // Full GA config override for sweep cells; null = repo defaults (the
  // preset's popSize/maxGen still apply — maxGen is passed last so it wins
  // over the config's own value).
  config: GAConfig | null;
}

let benchmarkBatchQueue: BatchQueueItem[] = [];
let benchmarkBatchStopped = false;

export async function startBenchmarkBatch(
  label: string | null,
  suite: BenchmarkSuite = 'throughput',
  config: GAConfig | null = null,
): Promise<{ batchId: string; rowIds: number[] }> {
  await bootstrap();

  if (activeBenchLanes.length > 0 || activeLanes.length > 0) {
    throw new Error(
      activeLanes.length > 0
        ? 'A run is in progress. Stop it before starting a benchmark.'
        : 'A benchmark is already in progress.',
    );
  }

  const preset = suite === 'solve' ? SOLVE_PRESET : BENCHMARK_PRESET;
  const version = getBFVersion();
  const batchId = String(Date.now());
  benchmarkBatchStopped = false;

  // Pre-create one row per config so the UI can show all configs in the batch
  // immediately (queued ones too). With a config override, the override's
  // pop_size replaces the preset's (the preset still owns target/maxGen/lanes)
  // and the full config is recorded on the row — sweep cells self-describe.
  const rowIds: number[] = [];
  for (const cfg of preset) {
    const lanes = 'lanes' in cfg ? (cfg as { lanes: number }).lanes : 1;
    const popSize = config?.pop_size ?? cfg.popSize;
    const { rows } = await pool.query(
      `INSERT INTO brainfuck_benchmarks
         (version_hash, version_subject, version_label, batch_id, suite,
          target, pop_size, max_generations, lanes, config_json, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'queued')
       RETURNING id`,
      [version.hash, version.subject, label, batchId, suite, cfg.target, popSize, cfg.maxGen, lanes,
       config ? JSON.stringify(config) : null],
    );
    rowIds.push(rows[0].id);
  }

  benchmarkBatchQueue = rowIds.map((rowId, i) => ({
    rowId,
    target: preset[i].target,
    popSize: config?.pop_size ?? preset[i].popSize,
    maxGen: preset[i].maxGen,
    lanes: 'lanes' in preset[i] ? (preset[i] as { lanes: number }).lanes : 1,
    config,
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
    activeBenchLanes = [];
    return;
  }

  // Promote this row from 'queued' to 'running'
  pool.query(
    `UPDATE brainfuck_benchmarks SET status = 'running' WHERE id = $1`,
    [next.rowId],
  ).catch((e) => console.error('[brainfuck] mark running', e));

  // Race `next.lanes` identical runner processes. The first lane to exit
  // with found=true wins the row and its siblings are killed; if nobody
  // finds, the row records the best-fitness lane's stats with found=false.
  // The next config spawns only after ALL lanes have exited so two rows
  // never overlap on the CPU.
  const lanes = Math.max(1, next.lanes);
  let winner: BenchmarkEvent | null = null;
  const alsoRan: BenchmarkEvent[] = [];
  const errors: string[] = [];
  let exited = 0;

  const finishRow = () => {
    finalizeBenchmarkRow(next.rowId, winner, alsoRan, errors)
      .catch((e) => console.error('[brainfuck] finalizeBenchmarkRow', e))
      .finally(() => spawnNextBenchmarkInBatch());
  };

  activeBenchmarkId = next.rowId;
  activeBenchLanes = [];

  // Config override args go first; the preset row's --max-gen and
  // --pop-size come last so argparse's last-wins keeps the row's budget
  // authoritative even when a full config is present.
  const configArgs = next.config ? configToCliArgs(next.config) : [];

  for (let lane = 0; lane < lanes; lane++) {
    const child = spawn(
      PYTHON,
      [
        RUNNER,
        '--benchmark',
        '--target', next.target,
        ...configArgs,
        '--max-gen', String(next.maxGen),
        '--pop-size', String(next.popSize),
      ],
      { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    activeBenchLanes.push(child);

    if (lane === 0 && child.pid) {
      pool.query(`UPDATE brainfuck_benchmarks SET pid = $1 WHERE id = $2`, [child.pid, next.rowId])
        .catch((e) => console.error('[brainfuck] write pid', e));
    }

    let laneResult: BenchmarkEvent | null = null;
    let laneError: string | null = null;

    const rl = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const evt = JSON.parse(trimmed) as Event;
        if (evt.type === 'benchmark') laneResult = evt;
        else if (evt.type === 'error') laneError = evt.message;
      } catch {
        /* ignore non-JSON lines */
      }
    });

    let stderrBuf = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
    });

    child.on('exit', (code) => {
      exited++;
      if (laneResult) {
        if (laneResult.found && winner === null) {
          winner = laneResult;
          // First find wins — cancel the rest of the race.
          for (const sibling of activeBenchLanes) {
            if (sibling !== child && sibling.exitCode === null && !sibling.killed) {
              sibling.kill('SIGTERM');
            }
          }
        } else {
          alsoRan.push(laneResult);
        }
      } else if (laneError || stderrBuf || code !== 0) {
        errors.push(laneError ?? stderrBuf ?? `exit code ${code}`);
      }
      if (exited === lanes) finishRow();
    });
  }
}

async function finalizeBenchmarkRow(
  id: number,
  winner: BenchmarkEvent | null,
  alsoRan: BenchmarkEvent[],
  errors: string[],
): Promise<void> {
  // User stop: no winner and the stop flag is up — killed lanes produce no
  // benchmark event, so alsoRan only holds lanes that finished before the
  // stop. (A raced sibling killed AFTER a win still resolves 'completed'
  // via the winner branch below.)
  if (winner === null && benchmarkBatchStopped) {
    await pool.query(
      `UPDATE brainfuck_benchmarks SET status = 'stopped', completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [id],
    );
    return;
  }

  // Winner, else the best also-ran (highest fitness; all found=false).
  const result =
    winner ??
    alsoRan.reduce<BenchmarkEvent | null>(
      (best, r) => (best === null || r.best_fitness > best.best_fitness ? r : best),
      null,
    );

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
  // No lane produced a result event — crash or abnormal exit.
  await pool.query(
    `UPDATE brainfuck_benchmarks SET status = 'failed', error = $2, completed_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [id, errors[0] ?? 'no benchmark result'],
  );
}

export function stopBenchmark(id: number): boolean {
  if (activeBenchmarkId !== id || activeBenchLanes.length === 0) return false;
  // Tell the post-exit handler not to spawn the next config in the batch.
  benchmarkBatchStopped = true;
  for (const child of activeBenchLanes) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  return true;
}

export function getActiveBenchmarkId(): number | null {
  return activeBenchmarkId;
}
