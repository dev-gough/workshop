'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Code2, Play, Square, Trash2, Loader, ChevronDown, ChevronRight, ChevronLeft,
  CheckCircle, AlertTriangle, Clock, Gauge, GitCommit,
  RotateCcw, Sparkles, Infinity as InfinityIcon, Copy,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import BrainfuckAnimator from '@/components/BrainfuckAnimator';
import TapeStrip from '@/components/TapeStrip';
import { useHeaderConfig } from '@/components/header-config';

// ── GA config knobs ─────────────────────────────────────────────────────────
// Mirror of the server-side DEFAULT_CONFIG / CONFIG_BOUNDS in lib/brainfuck.ts.
// Kept duplicated here to avoid pulling a server-only module into a client file.

interface GAConfig {
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
  lexicase: number;
  share_strength: number;
  repair_every: number;
  run_mut_rate: number;
  spin_ops: number;
  parallel_runs: number;
}

const DEFAULT_CONFIG: GAConfig = {
  pop_size: 100,
  max_generations: 1_000_000,
  max_prog_len: 300,
  min_prog_len: 10,
  crossover_rate: 0.5,
  mutation_rate: 0.1,
  mut_prob: 0, // 0 = adaptive ~1.5/gene-length
  macro_mut_rate: 0.05,
  restart_every: 250_000,
  restart_keep_frac: 0.2,
  bracket_mut_rate: 0.30,
  islands: 1,
  migration_every: 10_000,
  lexicase: 1,
  share_strength: 0,
  repair_every: 0, // Lamarckian repair is non-GA; off by default
  run_mut_rate: 0.35,
  spin_ops: 40_000,
  parallel_runs: 1,
};

// ── Preset slots ────────────────────────────────────────────────────────────
// Five slots stored in localStorage. Single-click loads, double-click saves
// the current config to that slot. Seeded on first visit with three
// contrasting search strategies — the hyperparameter sweep's starting
// points, each solve-suite-tested (see the bench tab's "preset:" batches).

const PRESET_SLOTS = 5;
// v2: sweep-seed trio replaced the pre-pure-GA seeds (the old "1/L rule"
// slot is obsolete now that mut_prob 0 = adaptive is the default). Bumping
// the key lets the new seeds land despite existing stored slots.
const PRESETS_STORAGE_KEY = 'bf-ga-presets-v2';

const SEED_PRESETS: (GAConfig | null)[] = [
  // 1: "sprint" — small population, aggressive turnover. Frequent restarts
  // trade depth for many cheap attempts; run-jumps and crossover run hot
  // (crossover gate is inverted: lower number = runs more often).
  {
    ...DEFAULT_CONFIG,
    pop_size: 40,
    restart_every: 25_000,
    restart_keep_frac: 0.1,
    run_mut_rate: 0.5,
    crossover_rate: 0.3,
  },
  // 2: "archipelago" — diversity machine. Four islands with fast migration
  // plus output sharing, betting that hard targets fail from attractor
  // takeover rather than lack of raw speed.
  {
    ...DEFAULT_CONFIG,
    pop_size: 160,
    islands: 4,
    migration_every: 5_000,
    share_strength: 0.5,
  },
  // 3: "longform" — structural explorer. More gene budget and hot loop
  // mutation for the 12+ char regime where straight-line printing no
  // longer fits; the spin cap keeps the longer genes affordable.
  {
    ...DEFAULT_CONFIG,
    max_prog_len: 500,
    bracket_mut_rate: 0.5,
    run_mut_rate: 0.5,
    macro_mut_rate: 0.1,
  },
  null,
  null,
];

function configsEqual(a: GAConfig, b: GAConfig): boolean {
  return (Object.keys(DEFAULT_CONFIG) as (keyof GAConfig)[]).every((k) => a[k] === b[k]);
}

function loadPresets(): (GAConfig | null)[] {
  if (typeof window === 'undefined') return SEED_PRESETS;
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return SEED_PRESETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return SEED_PRESETS;
    // Pad/truncate so the slot count is stable even after schema changes.
    const out: (GAConfig | null)[] = [];
    for (let i = 0; i < PRESET_SLOTS; i++) {
      const v = parsed[i];
      out.push(v && typeof v === 'object' ? { ...DEFAULT_CONFIG, ...v } : null);
    }
    return out;
  } catch {
    return SEED_PRESETS;
  }
}

function savePresets(presets: (GAConfig | null)[]): void {
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* localStorage full or disabled — nothing we can do */
  }
}

// Compact diff string — used in slot tooltips so hovering tells you what's
// actually different from defaults without opening the slot.
function summarizeDiff(cfg: GAConfig): string {
  const diffs: string[] = [];
  (Object.keys(DEFAULT_CONFIG) as (keyof GAConfig)[]).forEach((k) => {
    // Old runs predate newer config fields — their config_json has no value
    // there. Skip rather than crash; missing == "matches default" is correct.
    if (cfg[k] == null) return;
    if (cfg[k] !== DEFAULT_CONFIG[k]) {
      const v = Number.isInteger(cfg[k]) ? cfg[k] : (cfg[k] as number).toFixed(2);
      diffs.push(`${k}=${v}`);
    }
  });
  return diffs.length === 0 ? 'matches defaults' : diffs.join(', ');
}

// Accepts plain numbers, decimal numbers, or shorthand with k/m/b suffix
// (case-insensitive). Leading-dot decimals like '.1' parse as 0.1 — handy
// for the 0..1 fraction knobs. Commas/underscores/spaces are stripped so
// '1,000,000' pastes cleanly. Returns null if the input doesn't parse.
function parseShorthandNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s,_]/g, '').toLowerCase();
  const m = cleaned.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))([kmb])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
  return n * mult;
}

interface KnobSpec {
  key: keyof GAConfig;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

interface KnobGroup {
  title: string;
  // Mnemonic in the BF instruction alphabet — drawn beside the title to anchor
  // each section in the language's vocabulary. Crossover gets [] (loop
  // brackets, the swap shape), mutation gets +/-, runtime gets >.
  glyph: string;
  knobs: KnobSpec[];
}

const KNOB_GROUPS: KnobGroup[] = [
  {
    title: 'population & runtime',
    glyph: '>',
    knobs: [
      { key: 'pop_size',        label: 'population', hint: 'Programs alive each generation',
        min: 10,  max: 500,        step: 1,  integer: true },
      { key: 'max_generations', label: 'max gens',   hint: 'Hard ceiling on the run (~3.8k gens/s under PyPy)',
        min: 100, max: 100_000_000, step: 100, integer: true },
      { key: 'min_prog_len',    label: 'min length', hint: 'Lower bound on gene size',
        min: 1,   max: 200,        step: 1,  integer: true },
      { key: 'max_prog_len',    label: 'max length', hint: 'Upper bound on gene size',
        min: 20,  max: 2000,       step: 1,  integer: true },
      { key: 'spin_ops',        label: 'spin cap',   hint: 'Truncate an eval after N ops with no output — silent loops otherwise burn the full 250k-op budget. 0 disables',
        min: 0,   max: 250_000,    step: 5000, integer: true },
    ],
  },
  {
    title: 'mutation',
    glyph: '+/-',
    knobs: [
      { key: 'mutation_rate',  label: 'skip rate',     hint: 'Chance to leave a child untouched',
        min: 0, max: 1, step: 0.01 },
      { key: 'mut_prob',       label: 'per-char prob', hint: '0 = adaptive (~1.5/gene-length, the 1/L regime). Set explicitly to override',
        min: 0, max: 1, step: 0.01 },
      { key: 'macro_mut_rate', label: 'macro rate',    hint: 'Chance of bulk insert/delete pass',
        min: 0, max: 1, step: 0.01 },
      { key: 'run_mut_rate',   label: 'run jumps',     hint: 'Per-child chance of a blind ±k jump on one +/- run (geometric k, mean ≈3.5). Big random byte-space steps; selection decides what survives',
        min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'crossover',
    glyph: '[ ]',
    knobs: [
      { key: 'crossover_rate',     label: 'skip rate', hint: 'Chance to skip recombination (gate is inverted!). Splice crossover: each parent cut at an independent depth-0 point, tails swapped — children stay bracket-balanced',
        min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'loops',
    glyph: '[…]',
    knobs: [
      { key: 'bracket_mut_rate', label: 'bracket rate', hint: 'Per-child chance of a structural loop mutation: insert/delete a balanced [...] pair, peel one iteration ([B] → B[B]), or flatten a loop to straight-line copies',
        min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'diversity',
    glyph: ',',
    knobs: [
      { key: 'restart_every',     label: 'restart every', hint: 'Reseed bottom of pop every N gens (0 = off)',
        min: 0, max: 100_000_000, step: 10_000, integer: true },
      { key: 'restart_keep_frac', label: 'elites kept',   hint: 'Top fraction of pop preserved across restarts',
        min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'islands',
    glyph: '∷',
    knobs: [
      { key: 'islands',         label: 'K',               hint: 'Independent sub-populations evolved in parallel. Total pop_size splits across K. K=1 = single pop',
        min: 1, max: 10, step: 1, integer: true },
      { key: 'migration_every', label: 'migration every', hint: 'Migrate champion → next island every N gens (ring topology). 0 disables',
        min: 0, max: 1_000_000, step: 1000, integer: true },
    ],
  },
  {
    title: 'selection',
    glyph: '?',
    knobs: [
      { key: 'lexicase', label: 'lexicase (0/1)', hint: 'Lexicase parent selection (per-target-position case filtering) instead of tournament. Default ON — averaged fitness is what lets a one-letter loop printer ("ssss…" ≈ 98.5% on 8-char targets) eat the population',
        min: 0, max: 1, step: 1, integer: true },
      { key: 'share_strength', label: 'output sharing', hint: 'Output-fitness-sharing strength. 0 = off. Divides each program\'s selection-fitness by 1/(count of others sharing its output)^strength so dominant clusters can\'t monopolize parents. Try 0.5 (soft) or 1.0 (sharp). Pairs well with lexicase',
        min: 0, max: 2, step: 0.05 },
    ],
  },
  {
    title: 'repair',
    glyph: '.',
    knobs: [
      { key: 'repair_every', label: 'repair every', hint: 'Lamarckian repair — NOT a genetic operator (reads the target to compute exact +/- deltas). 0 = pure GA, the default. Set >0 only for memetic-vs-pure A/B comparisons',
        min: 0, max: 1_000_000, step: 1000, integer: true },
    ],
  },
  {
    title: 'parallelism',
    glyph: '⇉',
    knobs: [
      { key: 'parallel_runs', label: 'racing runs', hint: 'Spawn N independent runner processes in parallel. First to find wins; siblings are killed. Caps at # of CPU cores',
        min: 1, max: 4, step: 1, integer: true },
    ],
  },
];

interface Run {
  id: number;
  target: string;
  status: string;
  pop_size: number;
  max_generations: number;
  generations: number;
  best_fitness: number | null;
  best_gene: string | null;
  best_output: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  config_json: GAConfig | null;
  // Gold-standard flags — populated by LEFT JOIN with brainfuck_solutions.
  // null when the run hasn't solved (no solution row exists).
  halted: boolean | null;
  output_exact_match: boolean | null;
}

interface ProgressPoint { gen: number; best_fitness: number; }

// A tape pulled from the library into the transport. `runId` (when known)
// lets the page fetch that run's progress trail for the strip chart.
interface LoadedTape {
  gene: string;
  target: string;
  label: string;
  runId?: number | null;
}

// Lab-log activity for the active run. Diversity events (restart/migration)
// arrive on the SSE stream; 'best' entries are minted client-side whenever a
// poll surfaces a higher best_fitness — the same improvements that trigger
// the tape splice in the transport. `detail` is a short human-readable note.
interface ActivityEntry {
  key: string;
  kind: 'restart' | 'migration' | 'best';
  gen: number;
  best_fitness: number;
  detail: string;
}

interface Benchmark {
  id: number;
  version_hash: string | null;
  version_subject: string | null;
  version_label: string | null;
  batch_id: string | null;
  suite: string | null; // 'throughput' | 'solve' (null on pre-migration rows)
  lanes: number | null;  // racing lanes for this row (null/1 = single process)
  target: string;
  pop_size: number;
  max_generations: number;
  generations: number;
  evaluations: number;
  wall_seconds: number | null;
  evals_per_sec: number | null;
  gens_per_sec: number | null;
  best_fitness: number | null;
  found: boolean | null;
  status: string;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

interface BenchmarkPresetItem { target: string; popSize: number; maxGen: number; lanes?: number }

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function fmtDuration(startISO: string, endISO: string | null): string {
  const start = new Date(startISO).getTime();
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function statusBadge(status: string) {
  const map: Record<string, { color: string; label: string; Icon: React.ElementType }> = {
    running:     { color: 'text-chart-4 bg-chart-4/10',       label: 'Running',     Icon: Loader },
    found:       { color: 'text-ok bg-ok/10', label: 'Solved',      Icon: CheckCircle },
    done:        { color: 'text-muted-foreground bg-muted-foreground/10',       label: 'Capped',      Icon: Clock },
    stopped:     { color: 'text-warn bg-warn/10',     label: 'Stopped',     Icon: Square },
    failed:      { color: 'text-destructive bg-destructive/10',         label: 'Failed',      Icon: AlertTriangle },
    interrupted: { color: 'text-warn bg-warn/10',     label: 'Interrupted', Icon: AlertTriangle },
    superseded:  { color: 'text-muted-foreground bg-muted-foreground/10',       label: 'Superseded',  Icon: Square },
  };
  return map[status] ?? { color: 'text-muted-foreground bg-muted-foreground/10', label: status, Icon: Clock };
}

function fitnessPercent(target: string, fitness: number | null): number {
  if (fitness == null) return 0;
  const t = 256 * target.length;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(1, fitness / t));
}

export default function BrainfuckPage() {
  useHeaderConfig({ scopeClass: 'bf-theme' });
  const [runs, setRuns] = useState<Run[]>([]);
  // serverActiveIds: every run id the server reports as currently executing
  // (1 for solo runs, N for parallel races). The display "leader" — the run
  // shown in the active panel — is derived below as the highest-fitness
  // member of this set, recomputed every render.
  const [serverActiveIds, setServerActiveIds] = useState<number[]>([]);
  const [target, setTarget] = useState('hi');
  const [config, setConfig] = useState<GAConfig>(DEFAULT_CONFIG);
  const [presets, setPresets] = useState<(GAConfig | null)[]>(() =>
    Array.from({ length: PRESET_SLOTS }, () => null),
  );
  const [advanced, setAdvanced] = useState(false);
  // Which drawer of the tape library (right column) is open.
  const [libTab, setLibTab] = useState<'history' | 'solutions' | 'bench' | 'ref'>('history');
  // A tape loaded into the transport from the library (history run or
  // archived solution). Overrides the live run's display until cleared —
  // the status strip shows a "return to live" control while a run is on.
  const [loaded, setLoaded] = useState<LoadedTape | null>(null);
  const [loadedTrail, setLoadedTrail] = useState<ProgressPoint[] | null>(null);

  // Hydrate from localStorage after mount so SSR markup matches and the
  // presets survive page reloads. Seeds slots 1+2 if storage is empty.
  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const saveSlot = useCallback((idx: number, cfg: GAConfig) => {
    setPresets((cur) => {
      const next = [...cur];
      next[idx] = cfg;
      savePresets(next);
      return next;
    });
  }, []);
  const clearSlot = useCallback((idx: number) => {
    setPresets((cur) => {
      const next = [...cur];
      next[idx] = null;
      savePresets(next);
      return next;
    });
  }, []);
  // Capture-mode state. Set to {runId, cfg} when the user clicks "Copy config"
  // on a history row; PresetSlots then highlights free slots and assigns to
  // the first one clicked. We snapshot the config (not the run row) so a
  // mid-poll refresh of `runs` can't yank it out from under us, and we keep
  // the runId around for UI affordances on the originating row.
  const [pendingCopy, setPendingCopy] = useState<{ runId: number; cfg: GAConfig } | null>(null);
  const beginCopyConfig = useCallback((runId: number, cfg: GAConfig) => {
    setAdvanced(true); // ensure preset row is visible
    setPendingCopy({ runId, cfg });
  }, []);
  const cancelCopyConfig = useCallback(() => setPendingCopy(null), []);
  const assignPendingToSlot = useCallback((idx: number) => {
    setPendingCopy((cur) => {
      if (cur) saveSlot(idx, cur.cfg);
      return null;
    });
  }, [saveSlot]);
  // ESC cancels capture mode no matter where focus is.
  useEffect(() => {
    if (!pendingCopy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingCopy(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingCopy]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [activeProgress, setActiveProgress] = useState<ProgressPoint[]>([]);
  // Lightweight diversity-event log for the active run — restart/migration
  // events from runner.py that used to be silently dropped. Newest first,
  // capped so a long run can't grow it without bound.
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPerPage, setHistoryPerPage] = useState(10);
  const [benchPage, setBenchPage] = useState(0);
  const [benchPerPage, setBenchPerPage] = useState(10);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [activeBenchId, setActiveBenchId] = useState<number | null>(null);
  const [benchPreset, setBenchPreset] = useState<BenchmarkPresetItem[]>([]);
  const [solvePreset, setSolvePreset] = useState<BenchmarkPresetItem[]>([]);
  const [benchSuite, setBenchSuite] = useState<'throughput' | 'solve'>('solve');
  const [benchLabel, setBenchLabel] = useState('');
  const [benchSubmitting, setBenchSubmitting] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const benchPollRef = useRef<number | null>(null);
  // The gene currently being animated. Updated only at animator-cycle boundaries
  // so a newer best gene from polling doesn't yank the animation mid-execution.
  const [displayedGene, setDisplayedGene] = useState<string | null>(null);
  const latestGeneRef = useRef<string | null>(null);
  // When the server's activeId clears (run finished), we pin the run id
  // locally so the active panel keeps showing while the animator plays
  // through the winning gene at least once. Released on animator cycle-end
  // (or immediately if the run terminated without solving — no point
  // lingering on a stopped/failed program).
  const [pinnedRunId, setPinnedRunId] = useState<number | null>(null);
  const prevActiveIdRef = useRef<number | null>(null);
  // Tracks the highest best_fitness we've observed for the active run. When
  // a poll surfaces a higher one, we force-swap displayedGene immediately
  // (debounced to 1/s) instead of waiting for the animator's cycle to end —
  // otherwise long programs leave the user staring at a stale gene for
  // many seconds while better ones land in the DB.
  const lastBestFitnessRef = useRef<number | null>(null);
  const lastForcedSwapAtRef = useRef<number>(0);
  const pollRef = useRef<number | null>(null);

  const loadTape = useCallback((tape: LoadedTape) => {
    setLoaded(tape);
    // A pinned just-finished run has had its moment — the user asked for
    // a different tape.
    setPinnedRunId(null);
  }, []);
  const returnToLive = useCallback(() => setLoaded(null), []);

  // Trail for a library tape that came from a run — feeds the strip chart.
  useEffect(() => {
    if (loaded?.runId == null) {
      setLoadedTrail(null);
      return;
    }
    let alive = true;
    fetch(`/api/brainfuck/runs/${loaded.runId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive) setLoadedTrail(d.progress ?? []); })
      .catch(() => { if (alive) setLoadedTrail([]); });
    return () => { alive = false; };
  }, [loaded?.runId]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/brainfuck/runs', { cache: 'no-store' });
      const data = await res.json();
      setRuns(data.runs ?? []);
      // Prefer the array (multi-lane). Fall back to the singular for older
      // server snapshots without the field.
      setServerActiveIds(data.activeIds ?? (data.activeId != null ? [data.activeId] : []));
    } catch { /* leave previous state */ }
  }, []);

  // Detail-fetch for the active run: includes the progress trail for the sparkline.
  const refreshActive = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/brainfuck/runs/${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setActiveProgress(data.progress ?? []);
      const newGene: string | null = data.run?.best_gene ?? null;
      const newBest: number | null = data.run?.best_fitness ?? null;
      latestGeneRef.current = newGene;
      // Initial gene assignment — only set on first non-null value to seed the animator.
      setDisplayedGene((cur) => cur ?? newGene);

      // Force-swap on fitness improvement, throttled. The previous best is
      // tracked in a ref so we don't re-fire the swap each poll while the
      // gene/fitness sit unchanged — only the *transition* upward triggers it.
      if (newGene && newBest != null && lastBestFitnessRef.current != null
          && newBest > lastBestFitnessRef.current) {
        const now = Date.now();
        if (now - lastForcedSwapAtRef.current >= 1000) {
          setDisplayedGene(newGene);
          lastForcedSwapAtRef.current = now;
        }
        // Log the improvement — the same event the transport stamps.
        const gen: number = data.run?.generations ?? 0;
        const delta = newBest - lastBestFitnessRef.current;
        const entry: ActivityEntry = {
          key: `b-${newBest}`, kind: 'best', gen, best_fitness: newBest,
          detail: `+${delta} fitness`,
        };
        setActivity((cur) => (cur[0]?.key === entry.key ? cur : [entry, ...cur].slice(0, 30)));
      }
      lastBestFitnessRef.current = newBest;
    } catch { /* leave previous state */ }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshBenchmarks = useCallback(async () => {
    try {
      const res = await fetch('/api/brainfuck/benchmarks', { cache: 'no-store' });
      const data = await res.json();
      setBenchmarks(data.benchmarks ?? []);
      setActiveBenchId(data.activeId ?? null);
      if (Array.isArray(data.preset)) setBenchPreset(data.preset);
      if (Array.isArray(data.solvePreset)) setSolvePreset(data.solvePreset);
    } catch { /* leave previous state */ }
  }, []);

  useEffect(() => {
    refreshBenchmarks();
  }, [refreshBenchmarks]);

  // Poll while a benchmark is running (it produces no events to listen to —
  // the row just appears as 'completed' when the child exits).
  useEffect(() => {
    if (activeBenchId == null) {
      if (benchPollRef.current) {
        window.clearInterval(benchPollRef.current);
        benchPollRef.current = null;
      }
      return;
    }
    if (benchPollRef.current) return;
    benchPollRef.current = window.setInterval(refreshBenchmarks, 1000);
    return () => {
      if (benchPollRef.current) {
        window.clearInterval(benchPollRef.current);
        benchPollRef.current = null;
      }
    };
  }, [activeBenchId, refreshBenchmarks]);

  // Derived: the lane displayed in the active panel. With a single run it's
  // just that run's id. With a parallel race it's the leader — the lane
  // currently winning by best_fitness — so the animator follows whoever is
  // closest to solving. Tie-breaks toward the lane that appeared first in
  // the server's active set.
  const activeId: number | null = (() => {
    if (serverActiveIds.length === 0) return null;
    if (serverActiveIds.length === 1) return serverActiveIds[0];
    let leaderId = serverActiveIds[0];
    let leaderFitness = -Infinity;
    for (const id of serverActiveIds) {
      const r = runs.find((x) => x.id === id);
      const f = r?.best_fitness ?? -Infinity;
      if (f > leaderFitness) {
        leaderFitness = f;
        leaderId = id;
      }
    }
    return leaderId;
  })();

  // Server activeId clears the moment the python child exits, but the run's
  // *status* lags behind by however long the chain takes to drain the final
  // 'done' event. So when activeId goes non-null → null we pin locally and
  // keep polling — the next refresh picks up the terminal status and we
  // either hold (for 'found') or release immediately (for stopped/failed).
  useEffect(() => {
    const prev = prevActiveIdRef.current;
    prevActiveIdRef.current = activeId;

    if (prev != null && activeId == null) {
      setPinnedRunId(prev);
      // Promote the latest known gene to the animator now so it has the
      // winner queued — refreshActive's force-swap path won't fire again
      // post-pin (no more best_fitness deltas), and we don't want the user
      // looking at a stale gene while waiting for cycle-end.
      if (latestGeneRef.current) {
        setDisplayedGene(latestGeneRef.current);
      }
    }
    // Starting a fresh run: release any pin and any library tape — the
    // live run owns the transport from its first generation.
    if (prev == null && activeId != null) {
      setPinnedRunId(null);
      setLoaded(null);
    }
  }, [activeId]);

  // The id the UI is *actually* showing in the active panel — server's
  // active wins when set; pinned takes over after the run finishes.
  const effectiveActiveId = activeId ?? pinnedRunId;

  // Once the pinned run's status row reflects something terminal that isn't
  // 'found', release the pin immediately — no point staring at a stopped or
  // failed program waiting for a cycle that has nothing to celebrate.
  useEffect(() => {
    if (pinnedRunId == null) return;
    const r = runs.find((x) => x.id === pinnedRunId);
    if (!r) return;
    if (r.status === 'running' || r.status === 'queued' || r.status === 'found') return;
    setPinnedRunId(null);
  }, [pinnedRunId, runs]);

  // Reset displayed gene + progress when the *displayed* run changes.
  // Tied to effectiveActiveId so the pin transition (server clears, local
  // pin takes over with the same id) doesn't nuke the gene we just pinned.
  useEffect(() => {
    lastBestFitnessRef.current = null;
    lastForcedSwapAtRef.current = 0;
    setActivity([]); // activity is per-run; drop the previous run's entries
    if (effectiveActiveId == null) {
      setDisplayedGene(null);
      latestGeneRef.current = null;
      setActiveProgress([]);
      return;
    }
    setDisplayedGene(null); // force re-seed from next refreshActive
  }, [effectiveActiveId]);

  // Live updates while *something* is on display — server-active or local pin.
  //
  // Primary path is the SSE stream (/api/brainfuck/runs/stream): the runner's
  // events arrive push-style and trigger a coalesced re-fetch of the run row +
  // progress trail, so the UI tracks the child in real time instead of on a
  // fixed 1s tick. restart/migration events are folded straight into the
  // activity log. A slow 10s poll always runs as a floor (covers the terminal
  // 'done' status that lands after the stream event and the pinned-run window),
  // and if the stream errors we drop to a faster 2s fallback poll.
  useEffect(() => {
    if (effectiveActiveId == null) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const displayedId = effectiveActiveId;
    let cancelled = false;

    // Initial paint.
    refreshActive(displayedId);

    // Coalesce bursts of stream events into at most one refresh per ~400ms so
    // a high-frequency progress cadence doesn't hammer the two fetch endpoints.
    let pending = false;
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (cancelled || pending) return;
      pending = true;
      refreshTimer = window.setTimeout(() => {
        pending = false;
        refreshTimer = null;
        refresh();
        refreshActive(displayedId);
      }, 400);
    };

    // Slow backstop poll. Bumped to a faster cadence only while the stream is
    // known-broken (see onStreamError). Starts at 10s.
    let slowMs = 10_000;
    const startSlowPoll = () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(() => {
        refresh();
        refreshActive(displayedId);
      }, slowMs);
    };
    startSlowPoll();

    const es = new EventSource('/api/brainfuck/runs/stream');
    es.onmessage = (e) => {
      let evt: { type?: string; runId?: number; gen?: number; best_fitness?: number; kept?: number; K?: number };
      try {
        evt = JSON.parse(e.data);
      } catch {
        return;
      }
      if (evt.type === 'hello' || evt.type == null) return;
      // Fold diversity events into the activity log (only for the displayed run).
      if ((evt.type === 'restart' || evt.type === 'migration') && evt.runId === displayedId) {
        const gen = evt.gen ?? 0;
        const best = evt.best_fitness ?? 0;
        const entry: ActivityEntry =
          evt.type === 'restart'
            ? { key: `r-${gen}-${best}`, kind: 'restart', gen, best_fitness: best,
                detail: `${evt.kept ?? 0} elites kept` }
            : { key: `m-${gen}-${best}`, kind: 'migration', gen, best_fitness: best,
                detail: `${evt.K ?? 0} islands` };
        setActivity((cur) => (cur[0]?.key === entry.key ? cur : [entry, ...cur].slice(0, 30)));
      }
      // Any run event is a cue to re-pull the authoritative row + trail.
      scheduleRefresh();
    };
    es.onerror = () => {
      // Stream broke — fall back to a faster poll so the UI still tracks.
      if (slowMs !== 2_000) {
        slowMs = 2_000;
        startSlowPoll();
      }
    };

    return () => {
      cancelled = true;
      es.close();
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [effectiveActiveId, refresh, refreshActive]);

  const onAnimatorCycleEnd = useCallback(() => {
    // Pin release goes first: a finished run has had its winning gene play
    // through; let it slide to history now.
    if (pinnedRunId != null) {
      setPinnedRunId(null);
      return;
    }
    // Mid-run: swap to the newest gene at the natural break in animation.
    if (latestGeneRef.current && latestGeneRef.current !== displayedGene) {
      setDisplayedGene(latestGeneRef.current);
    }
  }, [pinnedRunId, displayedGene]);

  const start = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/brainfuck/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, ...config }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to start');
      } else {
        refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const stop = async (id: number) => {
    // For parallel races, stopping the leader cancels every lane — clicking
    // Stop is "I'm done with this", not "swap leaders". For solo runs the
    // active set is just the one id and this falls through unchanged.
    const ids = serverActiveIds.length > 0 ? serverActiveIds : [id];
    await Promise.all(
      ids.map((i) => fetch(`/api/brainfuck/runs/${i}/stop`, { method: 'POST' })),
    );
    refresh();
  };

  const remove = async (id: number) => {
    await fetch(`/api/brainfuck/runs/${id}`, { method: 'DELETE' });
    refresh();
  };

  const startBenchmark = async () => {
    setBenchError(null);
    setBenchSubmitting(true);
    try {
      const res = await fetch('/api/brainfuck/benchmarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: benchLabel.trim() || null, suite: benchSuite }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBenchError(data.error ?? 'Benchmark failed to start');
      } else {
        refreshBenchmarks();
      }
    } catch (e) {
      setBenchError(String(e));
    } finally {
      setBenchSubmitting(false);
    }
  };

  const stopBenchmarkApi = async (id: number) => {
    await fetch(`/api/brainfuck/benchmarks/${id}`, { method: 'POST' });
    refreshBenchmarks();
  };

  const deleteBenchmark = async (id: number) => {
    await fetch(`/api/brainfuck/benchmarks/${id}`, { method: 'DELETE' });
    refreshBenchmarks();
  };

  const active = runs.find((r) => r.id === effectiveActiveId) ?? null;
  // History is *finished* runs only. Excludes:
  //   - the active panel's displayed run (server-active leader, or pinned)
  //   - all *other* active racing lanes (so a race-of-4 hides all 4 from
  //     history while running, only the leader is shown above)
  //   - stale 'running' / 'queued' rows (service died before bootstrap
  //     could mark them interrupted) — surfacing them crashes on partial
  //     config_json and is misleading regardless
  const activeLaneSet = new Set<number>(serverActiveIds);
  if (effectiveActiveId != null) activeLaneSet.add(effectiveActiveId);
  const history = runs.filter(
    (r) => !activeLaneSet.has(r.id) && r.status !== 'running' && r.status !== 'queued',
  );

  // Memoized so the array reference is stable across polls — otherwise it
  // forces the BrainfuckAnimator's rAF effect to tear down and re-setup
  // every 1s for the entire life of a run.
  const animatorTrail = useMemo(
    () => activeProgress.map((p) => ({ gen: p.gen, fitness: p.best_fitness })),
    [activeProgress],
  );
  const targetFitness = active ? 256 * active.target.length : 0;

  // What the transport is showing:
  //  - a library tape the user loaded (wins even over a live run),
  //  - else the live run,
  //  - else the most recent finished run's champion, auto-threaded so the
  //    machine is never dark when there's anything at all to play.
  const champion = useMemo<LoadedTape | null>(() => {
    const r = history.find((x) => x.best_gene);
    return r
      ? {
          gene: r.best_gene!,
          target: r.target,
          label: `run #${r.id} · ${statusBadge(r.status).label.toLowerCase()}`,
          runId: r.id,
        }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, effectiveActiveId]);
  const showingLive = loaded == null && effectiveActiveId != null;
  const libraryTape = loaded ?? (showingLive ? null : champion);
  // Champion fallback has no explicit load action, so fetch its trail too.
  const shownTrailRunId = loaded != null ? loaded.runId : showingLive ? null : champion?.runId;
  const [championTrail, setChampionTrail] = useState<ProgressPoint[] | null>(null);
  useEffect(() => {
    if (loaded != null || shownTrailRunId == null) {
      setChampionTrail(null);
      return;
    }
    let alive = true;
    fetch(`/api/brainfuck/runs/${shownTrailRunId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive) setChampionTrail(d.progress ?? []); })
      .catch(() => { if (alive) setChampionTrail([]); });
    return () => { alive = false; };
  }, [loaded, shownTrailRunId]);
  const libraryTrail = useMemo(() => {
    const src = loaded != null ? loadedTrail : championTrail;
    return src?.map((p) => ({ gen: p.gen, fitness: p.best_fitness }));
  }, [loaded, loadedTrail, championTrail]);

  return (
    <PageTransition>
      {/* The workbench: one viewport on desktop, no page scroll — the job
          card, the transport, and the tape library each manage their own
          space. Below lg the bench stacks and scrolls like a normal page. */}
      <div className="bf-theme flex flex-col lg:h-[calc(100vh-57px)] lg:overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-2">
          <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            <span>RM 07</span>
            <span className="text-muted-foreground/60">·</span>
          </div>
          <h1 className="shrink-0 font-mono text-sm font-semibold tracking-tight text-foreground">
            The Tape Lab
          </h1>
          <p className="hidden min-w-0 truncate text-[11px] text-muted-foreground md:block">
            programs are strips of punched tape — the GA splices and re-punches them until one prints the target
          </p>
          {/* Masthead offcut — a real strip that prints "hi", the lab's hello. */}
          <TapeStrip
            gene="++++++++++[>++++++++++<-]>++++.+."
            maxFrames={33}
            height={16}
            className="ml-auto hidden shrink-0 opacity-80 sm:block"
          />
        </header>

        <div className="grid flex-1 grid-cols-1 gap-3 p-3 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)_360px] xl:grid-cols-[310px_minmax(0,1fr)_410px]">

          {/* ── Job card: target + knobs + start ── */}
          <FadeIn className="lg:min-h-0" delay={0}>
          <aside className="flex h-full flex-col rounded-lg bg-card border border-border/60 lg:min-h-0">
            <div className="shrink-0 p-3">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Target string
              </label>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={submitting || activeId != null}
                maxLength={64}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border/60 font-mono text-base focus:border-primary/60 focus:outline-none disabled:opacity-50"
                placeholder="hi"
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {target.length}/64 chars · target fitness {256 * target.length}
              </div>
            </div>

            <div className="flex items-center justify-between shrink-0 px-3">
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 font-mono uppercase tracking-[0.15em]"
              >
                {advanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="text-primary/70">{'{'}</span>
                hyperparameters
                <span className="text-primary/70">{'}'}</span>
              </button>
              {advanced && !configEqualsDefault(config) && (
                <button
                  type="button"
                  onClick={() => setConfig(DEFAULT_CONFIG)}
                  disabled={submitting || activeId != null}
                  className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 disabled:opacity-40 font-mono uppercase tracking-[0.15em]"
                  title="Reset all knobs to repo defaults"
                >
                  <RotateCcw className="h-3 w-3" /> reset all
                </button>
              )}
            </div>

            {/* Knob bank — scrolls inside the card so the bench never grows. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
            <AnimatePresence initial={false}>
              {advanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3.5 pt-1 font-mono">
                    <PresetSlots
                      presets={presets}
                      currentConfig={config}
                      disabled={submitting || activeId != null}
                      onLoad={(cfg) => setConfig(cfg)}
                      onSave={(idx) => saveSlot(idx, config)}
                      onClear={(idx) => clearSlot(idx)}
                      pendingCopyConfig={pendingCopy?.cfg ?? null}
                      onAssignPending={assignPendingToSlot}
                      onCancelPending={cancelCopyConfig}
                    />
                    {KNOB_GROUPS.map((group) => (
                      <div key={group.title} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-primary/70 text-[10px] tabular-nums shrink-0">
                            {group.glyph}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.15em] text-foreground/60 shrink-0">
                            {group.title}
                          </span>
                          <div className="h-px flex-1 bg-foreground/10" />
                        </div>
                        <div className="grid grid-cols-1 gap-y-3">
                          {group.knobs.map((spec) => (
                            <KnobRow
                              key={spec.key}
                              spec={spec}
                              value={config[spec.key]}
                              defaultValue={DEFAULT_CONFIG[spec.key]}
                              disabled={submitting || activeId != null}
                              onChange={(v) => setConfig((c) => ({ ...c, [spec.key]: v }))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            </div>

            <div className="shrink-0 space-y-2 border-t border-border/40 p-3">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</div>
              )}
              <button
                onClick={start}
                disabled={submitting || activeId != null || !target.trim()}
                className="w-full px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {activeId != null ? 'Run in progress…' : 'Start run'}
              </button>
            </div>
          </aside>
          </FadeIn>

          {/* ── The transport: one machine, whatever tape is threaded ── */}
          <FadeIn className="lg:min-h-0" delay={0.05}>
          <section className="flex h-full flex-col gap-2 lg:min-h-0">
            <div
              className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 font-mono text-[11px] ${
                showingLive ? 'border-primary/30 bg-card' : 'border-border/60 bg-card'
              }`}
            >
              {showingLive && active ? (
                <>
                  {active.status === 'found' ? (
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 text-ok" />
                  ) : (
                    <Loader className="h-3.5 w-3.5 shrink-0 animate-spin text-chart-4" />
                  )}
                  <span className="font-semibold uppercase tracking-[0.12em] text-foreground">
                    {active.status === 'found' ? 'Solved' : 'Live'} · run #{active.id}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    &quot;{active.target}&quot;
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    gen <span className="text-foreground">{active.generations.toLocaleString()}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    fit <span className="text-foreground">{active.best_fitness ?? 0}/{targetFitness}</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {fmtDuration(active.started_at, null)}
                  </span>
                  {active.status !== 'found' && (
                    <button
                      onClick={() => stop(active.id)}
                      className="ml-auto flex items-center gap-1 rounded bg-warn/10 px-2 py-1 text-warn hover:bg-warn/20"
                    >
                      <Square className="h-3 w-3" /> Stop
                    </button>
                  )}
                </>
              ) : libraryTape ? (
                <>
                  <span className="shrink-0 text-primary">▤</span>
                  <span className="font-semibold uppercase tracking-[0.12em] text-foreground">
                    {loaded ? 'Loaded tape' : 'Last champion'}
                  </span>
                  <span className="text-muted-foreground">{libraryTape.label}</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    &quot;{libraryTape.target}&quot;
                  </span>
                  <span className="text-muted-foreground tabular-nums">{libraryTape.gene.length} ch</span>
                  {effectiveActiveId != null && (
                    <button
                      onClick={returnToLive}
                      className="ml-auto flex animate-pulse items-center gap-1.5 rounded bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20"
                    >
                      <span className="text-[9px]">●</span> return to live run
                    </button>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">
                  transport idle — punch a target on the job card and start a run
                </span>
              )}
            </div>

            {showingLive && active && (
              <div className="h-1 shrink-0 overflow-hidden rounded-full bg-muted/60">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  animate={{ width: `${fitnessPercent(active.target, active.best_fitness) * 100}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            )}

            {/* Fixed height below lg — a percentage-height canvas inside an
                auto-height flex chain feeds back into itself and never
                stabilizes. Desktop gets the definite viewport chain. */}
            <div className="h-[460px] lg:h-auto lg:min-h-0 lg:flex-1">
              {showingLive ? (
                displayedGene ? (
                  <BrainfuckAnimator
                    gene={displayedGene}
                    target={active?.target}
                    fitnessTrail={animatorTrail}
                    targetFitness={targetFitness}
                    stampLabel={
                      active
                        ? `gen ${active.generations.toLocaleString()} · ${active.best_fitness ?? 0}/${targetFitness}`
                        : null
                    }
                    pendingGene={latestGeneRef.current}
                    pendingLabel={
                      latestGeneRef.current && latestGeneRef.current !== displayedGene && active
                        ? `gen ${active.generations}`
                        : undefined
                    }
                    fill
                    fullscreenable
                    onCycleEnd={onAnimatorCycleEnd}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-lg bg-background/40 border border-border/40 text-sm text-muted-foreground">
                    Waiting for the first tape to feed in…
                  </div>
                )
              ) : libraryTape ? (
                <BrainfuckAnimator
                  gene={libraryTape.gene}
                  target={libraryTape.target}
                  fitnessTrail={libraryTrail}
                  targetFitness={256 * libraryTape.target.length}
                  fill
                  fullscreenable
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-background/30 text-sm text-muted-foreground">
                  <TapeStrip gene=",,,,,,,,,,,,,,,," maxFrames={16} height={22} className="opacity-50" />
                  No tapes in the lab yet — the transport will thread the first run automatically.
                </div>
              )}
            </div>

            <ActivityLog entries={activity} />
          </section>
          </FadeIn>

          {/* ── Tape library: history, solved tapes, bench, reference ── */}
          <FadeIn className="lg:min-h-0" delay={0.1}>
          <aside className="flex h-[560px] flex-col rounded-lg bg-card border border-border/60 lg:h-full lg:min-h-0">
            <div className="flex shrink-0 items-center border-b border-border/60 px-2">
              {(
                [
                  { id: 'history',   label: 'History' },
                  { id: 'solutions', label: 'Solutions' },
                  { id: 'bench',     label: 'Bench' },
                  { id: 'ref',       label: 'Ref' },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setLibTab(id)}
                  className={`-mb-px border-b-2 px-2.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] transition-colors ${
                    libTab === id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto pr-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                {libTab === 'history'
                  ? `${history.length} run${history.length === 1 ? '' : 's'}`
                  : libTab === 'bench'
                    ? `${benchmarks.length} row${benchmarks.length === 1 ? '' : 's'}`
                    : ''}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {libTab === 'history' && (
                history.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No previous runs. Punch one on the job card.
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      {history
                        .slice(
                          Math.min(historyPage, Math.max(0, Math.ceil(history.length / historyPerPage) - 1)) * historyPerPage,
                          Math.min(historyPage, Math.max(0, Math.ceil(history.length / historyPerPage) - 1)) * historyPerPage + historyPerPage,
                        )
                        .map((r) => (
                        <HistoryRow
                          key={r.id}
                          run={r}
                          open={expanded === r.id}
                          isThreaded={loaded?.runId === r.id}
                          onToggle={() => {
                            setExpanded((cur) => (cur === r.id ? null : r.id));
                            // Opening a run threads its champion tape into
                            // the transport — the row itself stays compact.
                            if (r.best_gene) {
                              loadTape({
                                gene: r.best_gene,
                                target: r.target,
                                label: `run #${r.id} · ${statusBadge(r.status).label.toLowerCase()}`,
                                runId: r.id,
                              });
                            }
                          }}
                          onDelete={() => remove(r.id)}
                          onCopyConfig={(cfg) => beginCopyConfig(r.id, cfg)}
                          copyArmed={pendingCopy?.runId === r.id}
                        />
                      ))}
                    </div>
                    <Pagination
                      page={historyPage}
                      perPage={historyPerPage}
                      total={history.length}
                      onPageChange={setHistoryPage}
                      onPerPageChange={(n) => { setHistoryPerPage(n); setHistoryPage(0); }}
                    />
                  </>
                )
              )}

              {libTab === 'solutions' && (
                <SolutionsPanel onLoad={loadTape} loadedGene={loaded?.gene ?? null} />
              )}

              {libTab === 'bench' && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {benchSuite === 'solve'
                      ? 'Solve-rate suite: repeated racing runs per target (first lane to solve wins the row) — did it solve, and at what generation.'
                      : 'Throughput suite: timed silent runs measuring raw evals/s at a few operating points.'}
                    {' '}Auto-tagged with the current BF repo commit.
                  </p>

                  <div className="flex items-center gap-1">
                    {(['solve', 'throughput'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setBenchSuite(s)}
                        className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
                          benchSuite === s
                            ? 'border-primary/50 bg-primary/10 text-primary'
                            : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {s === 'solve' ? 'solve rate' : 'throughput'}
                      </button>
                    ))}
                  </div>

                  <div className="rounded-lg bg-background/40 border border-border/40 px-3 py-2 space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Configs in each batch
                    </div>
                    <div className="font-mono text-[11px] text-foreground/70 space-y-0.5">
                      {(() => {
                        const list = benchSuite === 'solve' ? solvePreset : benchPreset;
                        if (list.length === 0) {
                          return <span className="italic text-muted-foreground">loading…</span>;
                        }
                        // Collapse consecutive identical configs (rep runs of
                        // one ladder rung) into a single "×N" line.
                        const grouped: { c: BenchmarkPresetItem; n: number }[] = [];
                        for (const c of list) {
                          const last = grouped[grouped.length - 1];
                          if (last && last.c.target === c.target && last.c.popSize === c.popSize
                            && last.c.maxGen === c.maxGen && (last.c.lanes ?? 1) === (c.lanes ?? 1)) {
                            last.n++;
                          } else {
                            grouped.push({ c, n: 1 });
                          }
                        }
                        return grouped.map(({ c, n }, i) => (
                          <div key={i}>
                            <span className="text-primary">{i + 1}.</span>{' '}
                            <span className="text-foreground/90">&quot;{c.target}&quot;</span>
                            {n > 1 && <span className="text-foreground/90"> ×{n}</span>}
                            {' · '}pop <span className="text-foreground/90">{c.popSize}</span>
                            {' · '}<span className="text-foreground/90">{c.maxGen.toLocaleString()}</span> cap
                            {(c.lanes ?? 1) > 1 && (
                              <span className="text-primary/70"> · ×{c.lanes} lanes</span>
                            )}
                          </div>
                        ));
                      })()}
                    </div>
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        Label (optional)
                      </label>
                      <input
                        type="text"
                        value={benchLabel}
                        onChange={(e) => setBenchLabel(e.target.value)}
                        disabled={benchSubmitting || activeBenchId != null}
                        maxLength={64}
                        placeholder="e.g. init, trim-dead"
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-background border border-border/60 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    {activeBenchId != null ? (
                      <button
                        onClick={() => stopBenchmarkApi(activeBenchId)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-warn/10 px-3 py-1.5 text-sm text-warn hover:bg-warn/20"
                      >
                        <Loader className="h-3.5 w-3.5 animate-spin" /> Stop #{activeBenchId}
                      </button>
                    ) : (
                      <button
                        onClick={startBenchmark}
                        disabled={benchSubmitting || activeId != null}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary/90 px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                        title={activeId != null ? 'Stop the active run first' : undefined}
                      >
                        {benchSubmitting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
                        Run
                      </button>
                    )}
                  </div>

                  {benchError && (
                    <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{benchError}</div>
                  )}

                  {benchmarks.length > 0 && (() => {
                    const groups = groupBenchmarksByBatch(benchmarks);
                    const totalPages = Math.max(1, Math.ceil(groups.length / benchPerPage));
                    const safePage = Math.min(benchPage, totalPages - 1);
                    const start = safePage * benchPerPage;
                    const visible = groups.slice(start, start + benchPerPage);
                    return (
                      <div className="space-y-3">
                        {visible.map((group) => (
                          <BenchmarkBatchCard
                            key={group.key}
                            group={group}
                            onDelete={(id) => deleteBenchmark(id)}
                          />
                        ))}
                        <Pagination
                          page={benchPage}
                          perPage={benchPerPage}
                          total={groups.length}
                          onPageChange={setBenchPage}
                          onPerPageChange={(n) => { setBenchPerPage(n); setBenchPage(0); }}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}

              {libTab === 'ref' && <BFReference />}
            </div>
          </aside>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}

// ── Pagination ──
// Shared between History and Benchmarks. Page is 0-indexed; clamps internally
// so callers don't need to worry about deletes shrinking total below page*perPage.
function Pagination({
  page, perPage, total, onPageChange, onPerPageChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (p: number) => void;
  onPerPageChange: (n: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * perPage;
  const endIdx = Math.min(total, startIdx + perPage);

  // Compact page list with ellipses for >7 pages: 1 … 4 5 6 … 12
  const pages: (number | 'gap')[] = [];
  if (totalPages <= 7) {
    for (let i = 0; i < totalPages; i++) pages.push(i);
  } else {
    pages.push(0);
    if (safePage > 2) pages.push('gap');
    const lo = Math.max(1, safePage - 1);
    const hi = Math.min(totalPages - 2, safePage + 1);
    for (let i = lo; i <= hi; i++) pages.push(i);
    if (safePage < totalPages - 3) pages.push('gap');
    pages.push(totalPages - 1);
  }

  const btnBase =
    'min-w-[26px] px-1.5 h-7 rounded-md border tabular-nums text-[11px] flex items-center justify-center transition-colors';
  const btnIdle =
    'border-border/60 bg-background/40 text-foreground/80 hover:border-primary/60 hover:text-primary';
  const btnActive =
    'border-primary bg-primary/90 text-primary-foreground';
  const navBase =
    'h-7 w-7 rounded-md border border-border/60 bg-background/40 text-foreground/80 hover:border-primary/60 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-border/60 disabled:hover:text-foreground/80 transition-colors flex items-center justify-center';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-1 border-t border-border/40 text-[11px]">
      <div className="text-muted-foreground tabular-nums">
        {total === 0 ? '0' : `${startIdx + 1}–${endIdx}`}{' '}
        <span className="text-muted-foreground/60">of</span>{' '}
        <span className="text-foreground/80">{total}</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(0, safePage - 1))}
          disabled={safePage === 0}
          className={navBase}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`gap${i}`} className="px-1 text-muted-foreground/60 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`${btnBase} ${p === safePage ? btnActive : btnIdle}`}
            >
              {p + 1}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(Math.min(totalPages - 1, safePage + 1))}
          disabled={safePage >= totalPages - 1}
          className={navBase}
          aria-label="Next page"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <label className="flex items-center gap-2 text-muted-foreground">
        <span className="text-[10px] uppercase tracking-wider">Per page</span>
        <select
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
          className="h-7 px-2 rounded-md bg-background border border-border/60 text-foreground/90 text-[11px] focus:border-primary/60 focus:outline-none cursor-pointer"
        >
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ── BF reference sidebar ──

const BF_INSTRUCTIONS: { sym: string; desc: string }[] = [
  { sym: '>', desc: 'move pointer right' },
  { sym: '<', desc: 'move pointer left' },
  { sym: '+', desc: 'increment cell' },
  { sym: '-', desc: 'decrement cell' },
  { sym: '.', desc: 'output cell as ASCII' },
  { sym: ',', desc: 'read input (no-op here)' },
  { sym: '[', desc: 'jump past ] if cell == 0' },
  { sym: ']', desc: 'jump back to [ if cell ≠ 0' },
];

const BF_IDIOMS: { code: string; what: string }[] = [
  { code: '[-]',     what: 'zero the current cell' },
  { code: '[->+<]',  what: 'move cell into next cell' },
  { code: '+++.',    what: 'print char with code 3' },
  { code: '+[+++++.]', what: 'print incrementing chars forever' },
];

interface BenchmarkGroup {
  key: string;          // either the batch_id, or `solo:<id>` for unbatched legacy rows
  batchId: string | null;
  suite: string;        // 'throughput' | 'solve' — pre-migration rows default to throughput
  rows: Benchmark[];    // ordered by id ASC so the suite reads in the order it was queued
  versionHash: string | null;
  versionSubject: string | null;
  versionLabel: string | null;
  startedAt: string;    // earliest started_at in the group
}

function groupBenchmarksByBatch(rows: Benchmark[]): BenchmarkGroup[] {
  const map = new Map<string, BenchmarkGroup>();
  for (const r of rows) {
    const key = r.batch_id ?? `solo:${r.id}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        batchId: r.batch_id,
        suite: r.suite ?? 'throughput',
        rows: [],
        versionHash: r.version_hash,
        versionSubject: r.version_subject,
        versionLabel: r.version_label,
        startedAt: r.started_at,
      };
      map.set(key, g);
    }
    g.rows.push(r);
    if (r.started_at < g.startedAt) g.startedAt = r.started_at;
  }
  for (const g of map.values()) g.rows.sort((a, b) => a.id - b.id);
  return Array.from(map.values()).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

function BenchmarkBatchCard({
  group, onDelete,
}: { group: BenchmarkGroup; onDelete: (id: number) => void }) {
  // Aggregate stats for the batch where possible
  const completed = group.rows.filter((r) => r.status === 'completed' && r.evals_per_sec != null);
  const avgEps = completed.length
    ? completed.reduce((sum, r) => sum + (r.evals_per_sec ?? 0), 0) / completed.length
    : null;
  const totalWall = group.rows.reduce((s, r) => s + (r.wall_seconds ?? 0), 0);
  const inFlight = group.rows.some((r) => r.status === 'running' || r.status === 'queued');
  const isSolve = group.suite === 'solve';
  // Solve-suite headline: solved n/m plus median gens-to-solve among solves.
  const finished = group.rows.filter((r) => r.status === 'completed' && r.found != null);
  const solvedRows = finished.filter((r) => r.found);
  const medianGens = (() => {
    if (solvedRows.length === 0) return null;
    const gens = solvedRows.map((r) => r.generations).sort((a, b) => a - b);
    return gens[Math.floor(gens.length / 2)];
  })();

  return (
    <div className="rounded-lg bg-background/30 border border-border/30 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 bg-background/40 text-[11px]">
        <div className="font-mono text-primary flex items-center gap-1" title={group.versionSubject ?? ''}>
          <GitCommit className="h-3 w-3" />
          {group.versionHash ?? '—'}
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-[0.1em] ${
          isSolve ? 'bg-ok/10 text-ok' : 'bg-foreground/[0.06] text-muted-foreground'
        }`}>
          {isSolve ? 'solve' : 'evals/s'}
          {(group.rows[0]?.lanes ?? 1) > 1 ? ` ×${group.rows[0].lanes}` : ''}
        </span>
        {group.versionLabel && (
          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
            {group.versionLabel}
          </span>
        )}
        {inFlight && <Loader className="h-3 w-3 text-chart-4 animate-spin" />}
        <div className="ml-auto flex items-center gap-3 text-muted-foreground tabular-nums">
          {isSolve ? (
            finished.length > 0 && (
              <span>
                solved <span className={solvedRows.length === finished.length ? 'text-ok' : 'text-foreground/90'}>
                  {solvedRows.length}/{finished.length}
                </span>
                {medianGens != null && (
                  <span> · med <span className="text-foreground/90">{medianGens.toLocaleString()}</span> gen</span>
                )}
              </span>
            )
          ) : (
            avgEps != null && (
              <span>
                avg <span className="text-foreground/90">{avgEps.toFixed(1)}</span> evals/s
              </span>
            )
          )}
          <span>{totalWall.toFixed(1)}s wall</span>
          <span className="text-[10px]">{fmtTime(group.startedAt)}</span>
        </div>
      </div>
      {isSolve ? (
        <SolveTargetAggList rows={group.rows} onDelete={onDelete} />
      ) : (
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-1 px-3 py-2 text-[11px] items-center">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
            Config
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-right">
            Evals/s
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-right">
            Gens/s
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-right">
            Wall
          </div>
          <div></div>
          {group.rows.map((r) => (
            <BenchmarkConfigRow key={r.id} b={r} onDelete={() => onDelete(r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Solve batches show one line per ladder rung — reps averaged — instead of
// every row (8 rungs × 3 reps would dwarf the card). Click a rung to unfold
// its individual reps (with their delete buttons).
function SolveTargetAggList({
  rows, onDelete,
}: { rows: Benchmark[]; onDelete: (id: number) => void }) {
  const [openTarget, setOpenTarget] = useState<string | null>(null);

  // Group consecutive same-target rows (the queue preserves ladder order).
  const groups: { target: string; rows: Benchmark[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.target === r.target) last.rows.push(r);
    else groups.push({ target: r.target, rows: [r] });
  }

  return (
    <div className="px-3 py-2 space-y-0.5 text-[11px]">
      {groups.map((g) => {
        const finished = g.rows.filter((r) => r.status === 'completed' && r.found != null);
        const solved = finished.filter((r) => r.found);
        const running = g.rows.some((r) => r.status === 'running' || r.status === 'queued');
        const avgGens = solved.length
          ? Math.round(solved.reduce((s, r) => s + r.generations, 0) / solved.length)
          : null;
        const avgWall = finished.length
          ? finished.reduce((s, r) => s + (r.wall_seconds ?? 0), 0) / finished.length
          : null;
        // Nothing solved: the closest miss is the informative number.
        const bestFit = !solved.length && finished.length
          ? Math.max(...finished.map((r) => r.best_fitness ?? 0))
          : null;
        const open = openTarget === g.target;
        return (
          <div key={g.target}>
            <button
              onClick={() => setOpenTarget((cur) => (cur === g.target ? null : g.target))}
              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-foreground/5 transition-colors"
            >
              {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate font-mono text-foreground/90">
                &quot;{g.target}&quot;
              </span>
              {running && <Loader className="h-3 w-3 shrink-0 animate-spin text-chart-4" />}
              <span className="flex shrink-0 items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                {finished.length > 0 && (
                  <span className={solved.length === finished.length ? 'text-ok'
                    : solved.length === 0 ? 'text-warn' : 'text-foreground/80'}>
                    {solved.length}/{finished.length}
                  </span>
                )}
                {avgGens != null && <span>avg {avgGens.toLocaleString()} gen</span>}
                {bestFit != null && (
                  <span>best {bestFit}/{256 * g.target.length}</span>
                )}
                {avgWall != null && <span>{avgWall.toFixed(1)}s</span>}
              </span>
            </button>
            {open && (
              <div className="ml-5 grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-3 gap-y-1 border-l border-border/40 py-1 pl-2">
                {g.rows.map((r) => (
                  <BenchmarkConfigRow key={r.id} b={r} onDelete={() => onDelete(r.id)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BenchmarkConfigRow({ b, onDelete }: { b: Benchmark; onDelete: () => void }) {
  const evalsPerSec = b.evals_per_sec != null ? b.evals_per_sec.toFixed(1) : '—';
  const gensPerSec = b.gens_per_sec != null ? b.gens_per_sec.toFixed(1) : '—';
  const wall = b.wall_seconds != null ? `${b.wall_seconds.toFixed(1)}s` : '—';
  const statusColor =
    b.status === 'completed' ? 'text-ok/80'
    : b.status === 'running' ? 'text-chart-4'
    : b.status === 'queued' ? 'text-muted-foreground/80'
    : b.status === 'stopped' ? 'text-warn'
    : 'text-destructive';
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-mono text-foreground/90 truncate">&quot;{b.target}&quot;</span>
        {b.status === 'completed' && b.found != null ? (
          b.found ? (
            <span className="text-[10px] text-ok tabular-nums whitespace-nowrap">
              ✓ gen {b.generations.toLocaleString()}
            </span>
          ) : (
            <span className="text-[10px] text-warn whitespace-nowrap">✗ capped</span>
          )
        ) : (
          <span className={`text-[10px] ${statusColor}`}>{b.status}</span>
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
          pop {b.pop_size} · {b.max_generations.toLocaleString()} cap
          {(b.lanes ?? 1) > 1 && <span className="text-primary/70"> · ×{b.lanes}</span>}
        </span>
      </div>
      <div className="text-right tabular-nums font-mono text-foreground/90">{evalsPerSec}</div>
      <div className="text-right tabular-nums font-mono text-muted-foreground">{gensPerSec}</div>
      <div className="text-right tabular-nums font-mono text-muted-foreground">{wall}</div>
      <button
        onClick={onDelete}
        disabled={b.status === 'running' || b.status === 'queued'}
        className="text-muted-foreground/60 hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Delete benchmark"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono text-[10px] bg-background/60 border border-border/60 rounded px-1.5 py-0.5 text-foreground/80 min-w-[1.4rem] text-center">
      {children}
    </kbd>
  );
}

// The punch code the tape motif uses everywhere (animator, TapeStrip, the
// legend below). ',' sits at 000 — the blank frame, like NUL on real tape.
const REFERENCE_PUNCH_CODE: Record<string, number> = {
  ',': 0, '>': 1, '<': 2, '+': 3, '-': 4, '.': 5, '[': 6, ']': 7,
};

// Three dots reading the instruction's punch column, bit2 → bit0.
function PunchDots({ sym }: { sym: string }) {
  const code = REFERENCE_PUNCH_CODE[sym] ?? 0;
  return (
    <span className="flex w-7 shrink-0 items-center gap-[3px] pt-[7px]" aria-hidden>
      {[2, 1, 0].map((bit) => (
        <span
          key={bit}
          className={`inline-block h-[6px] w-[6px] rounded-full ${
            (code >> bit) & 1 ? 'bg-foreground/70' : 'border border-foreground/25'
          }`}
        />
      ))}
    </span>
  );
}

function BFReference() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-card border border-border/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">BrainFuck</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          A minimal Turing-complete language. Programs are strings made
          of just 8 instructions, operating on a tape of{' '}
          <span className="text-foreground/80 tabular-nums">65,535</span> byte
          cells, all initialized to{' '}
          <span className="font-mono text-foreground/80">0</span>. Cells wrap
          symmetrically in the 7-bit ASCII range (0..127).
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Eight instructions fit a 3-bit punch code exactly — the dots below
          are the hole pattern each symbol gets on the tape.
        </p>
      </div>

      <div className="rounded-lg bg-card border border-border/60 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Instructions
        </div>
        <div className="space-y-1">
          {BF_INSTRUCTIONS.map((i) => (
            <div key={i.sym} className="flex items-start gap-2 text-xs">
              <PunchDots sym={i.sym} />
              <span className="font-mono text-primary w-5 text-center text-sm leading-5 shrink-0">
                {i.sym}
              </span>
              <span className="text-muted-foreground leading-5">{i.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-card border border-border/60 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Common idioms
        </div>
        <div className="space-y-1.5">
          {BF_IDIOMS.map((i) => (
            <div key={i.code} className="space-y-0.5">
              <div className="font-mono text-xs text-primary/90">{i.code}</div>
              <div className="text-[11px] text-muted-foreground leading-snug">{i.what}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-card border border-border/60 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Animator tips
        </div>
        <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
          <div className="flex items-center gap-2">
            <Kbd>Space</Kbd>
            <span>play / pause</span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd>R</Kbd>
            <span>restart from gen 0</span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd>F</Kbd>
            <span>fullscreen <span className="text-muted-foreground/60">(Esc to exit)</span></span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd>←</Kbd><Kbd>→</Kbd>
            <span>step (when paused)</span>
          </div>
          <div className="pt-1">
            The colored boxes in the output are the chars the GA actually
            scores — first N output chars, where N is your target length.
          </div>
        </div>
      </div>
    </div>
  );
}

function configEqualsDefault(c: GAConfig): boolean {
  return (Object.keys(DEFAULT_CONFIG) as (keyof GAConfig)[]).every(
    (k) => c[k] === DEFAULT_CONFIG[k],
  );
}

function PresetSlots({
  presets, currentConfig, disabled, onLoad, onSave, onClear,
  pendingCopyConfig, onAssignPending, onCancelPending,
}: {
  presets: (GAConfig | null)[];
  currentConfig: GAConfig;
  disabled: boolean;
  onLoad: (cfg: GAConfig) => void;
  onSave: (idx: number) => void;
  onClear: (idx: number) => void;
  pendingCopyConfig: GAConfig | null;
  onAssignPending: (idx: number) => void;
  onCancelPending: () => void;
}) {
  // Click vs double-click: schedule the load on a short timer so a follow-up
  // double-click can cancel it and trigger the save instead. 220ms is short
  // enough to feel responsive on single-click and long enough to catch
  // typical double-click cadence reliably.
  const clickTimerRef = useRef<number | null>(null);
  const [savedFlash, setSavedFlash] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const capture = pendingCopyConfig != null;

  // Click-outside cancels capture mode. The trigger button (in HistoryRow)
  // also lives outside, so the mousedown that opened capture would itself
  // dismiss it — guard against same-tick cancellation by checking the event
  // target against the originating button via [data-copy-config-trigger].
  useEffect(() => {
    if (!capture) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (rowRef.current?.contains(t)) return;
      if (t?.closest('[data-copy-config-trigger]')) return;
      onCancelPending();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [capture, onCancelPending]);

  const handleClick = (idx: number) => {
    if (capture) {
      const slot = presets[idx];
      if (!slot) onAssignPending(idx);
      return;
    }
    if (disabled) return;
    const slot = presets[idx];
    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      if (slot) onLoad(slot);
    }, 220);
  };

  const handleDoubleClick = (idx: number) => {
    if (capture || disabled) return;
    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onSave(idx);
    setSavedFlash(idx);
    window.setTimeout(() => setSavedFlash((cur) => (cur === idx ? null : cur)), 600);
  };

  const handleClear = (idx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClear(idx);
  };

  return (
    <div ref={rowRef} className="flex items-center gap-2">
      <span className="text-primary/70 text-[10px] shrink-0">{'>>>'}</span>
      <span className="text-[10px] uppercase tracking-[0.15em] text-foreground/60 shrink-0">
        presets
      </span>
      <div className="flex items-center gap-1 ml-1">
        {Array.from({ length: PRESET_SLOTS }, (_, i) => {
          const slot = presets[i];
          const isFilled = !!slot;
          const isActive = !capture && isFilled && configsEqual(slot!, currentConfig);
          const isFlashing = savedFlash === i;
          // In capture mode, free slots are the receivers; filled ones are
          // visibly out of play.
          const isReceiver = capture && !isFilled;
          const isOccupiedDuringCapture = capture && isFilled;
          const baseTitle = isFilled
            ? `Slot ${i + 1} — ${summarizeDiff(slot!)}\nClick to load · double-click to overwrite · right-click to clear`
            : `Slot ${i + 1} — empty\nDouble-click to save current config`;
          const title = capture
            ? (isFilled
                ? `Slot ${i + 1} — already in use\nPick an empty slot, or right-click to clear this one first`
                : `Slot ${i + 1} — empty\nClick to copy the pending config here`)
            : baseTitle;
          // Capture-mode receivers stay enabled even when `disabled` is true
          // (a run can be in progress without blocking a save to localStorage).
          const buttonDisabled = capture ? false : disabled;
          return (
            <div key={i} className="relative">
              <button
                type="button"
                onClick={() => handleClick(i)}
                onDoubleClick={() => handleDoubleClick(i)}
                onContextMenu={isFilled && !capture ? (e) => handleClear(i, e) : undefined}
                disabled={buttonDisabled}
                title={title}
                className={`
                  relative flex items-center justify-center
                  w-7 h-6 rounded-sm border tabular-nums text-[11px] leading-none
                  transition-colors select-none
                  ${
                    isReceiver
                      ? 'border-primary/80 bg-primary/[0.10] text-primary cursor-pointer animate-pulse hover:bg-primary/20'
                      : isOccupiedDuringCapture
                        ? 'border-foreground/15 bg-foreground/[0.02] text-foreground/30 cursor-not-allowed'
                        : isActive
                          ? 'border-primary/70 bg-primary/15 text-primary'
                          : isFilled
                            ? 'border-primary/30 bg-primary/[0.04] text-primary/85 hover:border-primary/55 hover:bg-primary/[0.08]'
                            : 'border-foreground/10 bg-foreground/[0.02] text-foreground/40 hover:border-foreground/25 hover:text-foreground/60'
                  }
                  ${isFlashing ? 'ring-1 ring-primary/70' : ''}
                  disabled:opacity-40 disabled:cursor-not-allowed
                `}
              >
                <span className="text-primary/45 text-[9px] mr-px">[</span>
                {i + 1}
                <span className="text-primary/45 text-[9px] ml-px">]</span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex-1" />
      {capture ? (
        <span className="text-[9px] text-primary/90 flex items-center gap-1.5">
          pick an empty slot
          <button
            type="button"
            onClick={onCancelPending}
            className="text-foreground/50 hover:text-foreground/90 underline-offset-2 hover:underline"
            title="Cancel (esc)"
          >
            cancel
          </button>
        </span>
      ) : (
        // Slot semantics live in each slot's tooltip — an inline hint has no
        // room in the job card's narrow column.
        <span
          className="cursor-help text-[10px] text-muted-foreground/50"
          title="click to load · double-click to save · right-click to clear"
        >
          ?
        </span>
      )}
    </div>
  );
}

function KnobRow({
  spec, value, defaultValue, disabled, onChange,
}: {
  spec: KnobSpec;
  value: number;
  defaultValue: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const isDefault = value === defaultValue;
  const fmtValue = (v: number) =>
    spec.integer ? v.toLocaleString() : v.toFixed(2);
  const clamp = (v: number) => Math.max(spec.min, Math.min(spec.max, v));
  const onText = (raw: string) => {
    if (raw === '') return;
    const v = spec.integer ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(v)) return;
    onChange(clamp(v));
  };

  // Draft state for the text readout — lets the user type "250k" without the
  // controlled-input fight (we'd otherwise have to parse mid-keystroke). Null
  // means "show the formatted current value"; a string means the user is
  // editing. Committed on blur or Enter.
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const commitText = (raw: string) => {
    const parsed = parseShorthandNumber(raw);
    if (parsed != null) {
      onChange(clamp(spec.integer ? Math.round(parsed) : parsed));
    }
    setTextDraft(null);
  };
  // Position of the default-value tick along the slider track, in %.
  // Slider thumb is 6px wide; the track has ~3px of padding on each side
  // because of the thumb's native overhang — for the tick to land on the same
  // pixel column as the thumb when value === default, we inset it by that
  // amount. Calc keeps it sane on responsive widths.
  const defaultPct = ((defaultValue - spec.min) / (spec.max - spec.min)) * 100;

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 mb-1">
        <label
          className="text-[10.5px] text-foreground/75 cursor-help truncate flex-1 lowercase tracking-wide"
          title={`${spec.hint} · range ${fmtValue(spec.min)}–${fmtValue(spec.max)}`}
        >
          {spec.label}
        </label>
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          {!isDefault && (
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              disabled={disabled}
              className="text-muted-foreground/50 hover:text-primary disabled:opacity-30 transition-colors"
              title={`Reset to default (${fmtValue(defaultValue)})`}
              tabIndex={-1}
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        {/* Counter-style value readout: thin border, monospace, stamp ink
            when off-default. Mirrors the counter bank in the transport. */}
        <div
          className={`flex items-center gap-0.5 px-1 py-0 rounded-sm border tabular-nums shrink-0 ${
            isDefault
              ? 'border-foreground/10 bg-foreground/[0.02] text-foreground/60'
              : 'border-primary/40 bg-primary/[0.06] text-primary'
          }`}
        >
          <span className="text-primary/40 text-[9px] leading-none select-none">[</span>
          <input
            type="text"
            inputMode={spec.integer ? 'numeric' : 'decimal'}
            value={textDraft ?? fmtValue(value)}
            onChange={(e) => setTextDraft(e.target.value)}
            onFocus={(e) => { setTextDraft(String(value)); e.target.select(); }}
            onBlur={(e) => commitText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              else if (e.key === 'Escape') { setTextDraft(null); (e.target as HTMLInputElement).blur(); }
            }}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            className="w-[58px] bg-transparent text-[10.5px] focus:outline-none disabled:opacity-50 text-right tabular-nums"
            title={spec.integer ? 'Accepts shorthand: 250k = 250,000, 1m = 1,000,000, 2b = 2,000,000,000' : undefined}
          />
          <span className="text-primary/40 text-[9px] leading-none select-none">]</span>
        </div>
      </div>
      <div className="relative pt-0.5">
        <input
          type="range"
          value={value}
          onChange={(e) => onText(e.target.value)}
          disabled={disabled}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          className="bf-knob-slider"
          aria-label={spec.label}
        />
        {/* Default-value mark: a small stamp-ink chevron sitting just below the
            tape track, pointing up at the default position. Reads as a
            "bookmark" the way the animator marks the target output column. */}
        <div
          className="absolute left-0 right-0 top-full -mt-px h-1.5 pointer-events-none"
          aria-hidden
        >
          <div
            className="absolute w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[3px] border-b-primary/45 -translate-x-1/2"
            style={{ left: `calc(3px + (100% - 6px) * ${defaultPct / 100})` }}
          />
        </div>
      </div>
    </div>
  );
}

function ConfigSummary({ cfg }: { cfg: GAConfig }) {
  // Compact one-line representation of the knobs that differ from defaults,
  // plus the always-shown pop/gens. Keeps history rows scannable.
  const diffs: string[] = [];
  (Object.keys(DEFAULT_CONFIG) as (keyof GAConfig)[]).forEach((k) => {
    if (k === 'pop_size' || k === 'max_generations') return;
    if (cfg[k] == null) return;
    if (cfg[k] !== DEFAULT_CONFIG[k]) {
      const v = Number.isInteger(cfg[k]) ? cfg[k] : (cfg[k] as number).toFixed(2);
      diffs.push(`${k}=${v}`);
    }
  });
  return (
    <div className="rounded bg-background/40 border border-border/40 px-2 py-1.5 text-[10px] font-mono text-foreground/70 leading-snug">
      <div className="text-muted-foreground/80 uppercase tracking-wider text-[9px] mb-0.5">
        Config
      </div>
      pop {cfg.pop_size} · gens {cfg.max_generations.toLocaleString()}
      {diffs.length > 0 && (
        <span className="text-primary/80">{' · ' + diffs.join(' · ')}</span>
      )}
      {diffs.length === 0 && <span className="text-muted-foreground/60"> · defaults</span>}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-background/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
        {icon}{label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// The lab log — a subtle live strip for the active run. New-best punches
// (the same improvements the transport stamps) in green ink, diversity
// events (restart / migration) in stamp ink. Newest first; renders nothing
// until the first event lands so it stays out of the way on quiet runs.
function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="rounded-lg bg-background/40 border border-border/40 px-2.5 py-2 space-y-1">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground/80 font-mono">
        <span className="text-primary/60">,</span> lab log
      </div>
      <div className="flex flex-wrap gap-1">
        {entries.slice(0, 8).map((e) => (
          <span
            key={e.key}
            title={`gen ${e.gen.toLocaleString()} · best ${e.best_fitness} · ${e.detail}`}
            className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-mono tabular-nums ${
              e.kind === 'best'
                ? 'border-ok/35 bg-ok/[0.06] text-ok'
                : 'border-primary/25 bg-primary/[0.05] text-primary/85'
            }`}
          >
            {e.kind === 'best' ? (
              <Sparkles className="h-2.5 w-2.5" />
            ) : e.kind === 'restart' ? (
              <RotateCcw className="h-2.5 w-2.5" />
            ) : (
              <InfinityIcon className="h-2.5 w-2.5" />
            )}
            <span>{e.kind === 'best' ? e.detail : e.kind}</span>
            <span className="text-muted-foreground/70">g{e.gen.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HistoryRow({
  run, open, isThreaded, onToggle, onDelete, onCopyConfig, copyArmed,
}: {
  run: Run;
  open: boolean;
  // True when this run's tape is the one threaded into the transport —
  // the row carries a stamp-ink edge so you can see what's playing.
  isThreaded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onCopyConfig: (cfg: GAConfig) => void;
  // True when this row is the one whose config_json is currently pending —
  // used to keep the trigger button visibly active while the user picks a slot.
  copyArmed: boolean;
}) {
  const badge = statusBadge(run.status);
  const pct = fitnessPercent(run.target, run.best_fitness);
  // Gold standard: solved AND halted naturally before MAX_OPS AND output is
  // an exact match (no trailing junk). Rare across runs — celebrate it.
  const isPerfect =
    run.status === 'found' && run.halted === true && run.output_exact_match === true;

  return (
    <motion.div
      className={`rounded-lg border ${
        isPerfect
          ? 'bg-warn/[0.04] border-warn/60'
          : 'bg-background/30 border-border/30'
      } ${isThreaded ? 'border-l-2 border-l-primary' : ''}`}
      animate={isPerfect ? {
        boxShadow: [
          '0 0 0 0 rgba(196,150,42,0)',
          '0 0 14px 1px rgba(196,150,42,0.22)',
          '0 0 0 0 rgba(196,150,42,0)',
        ],
      } : undefined}
      transition={isPerfect ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <button
        onClick={onToggle}
        title={run.best_gene ? 'Thread this run’s best tape into the transport' : undefined}
        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-background/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.color} flex items-center gap-1 shrink-0`}>
          <badge.Icon className={`h-3 w-3 ${run.status === 'running' ? 'animate-spin' : ''}`} />
          {badge.label}
        </span>
        {isPerfect && (
          <motion.span
            className="shrink-0 text-warn"
            title="Gold standard: solved, halted, exact-match output"
            animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </motion.span>
        )}
        <span className="font-mono text-sm flex-1 truncate">&quot;{run.target}&quot;</span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {run.generations.toLocaleString()} gen
        </span>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {Math.round(pct * 100)}%
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 pt-1 space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 text-center">
                <Stat label="Fitness" value={`${run.best_fitness ?? 0}/${256 * run.target.length}`} />
                <Stat label="Pop" value={run.pop_size.toString()} />
                <Stat label="Max gen" value={run.max_generations.toLocaleString()} />
                <Stat label="Elapsed" value={fmtDuration(run.started_at, run.completed_at)} />
              </div>
              <div className="text-[10px] text-muted-foreground">
                started {fmtTime(run.started_at)}
                {run.best_gene && <span> · tape on the transport ◂</span>}
              </div>
              {run.config_json && <ConfigSummary cfg={run.config_json} />}
              {run.error && (
                <div className="text-destructive bg-destructive/10 rounded px-2 py-1.5 break-all">
                  {run.error}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                {run.config_json && (
                  <button
                    type="button"
                    data-copy-config-trigger
                    onClick={() => onCopyConfig(run.config_json!)}
                    className={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors ${
                      copyArmed
                        ? 'bg-primary/20 text-primary ring-1 ring-primary/60'
                        : 'bg-primary/10 text-primary hover:bg-primary/20'
                    }`}
                    title={copyArmed
                      ? 'Pick an empty preset slot above (esc to cancel)'
                      : 'Copy this run’s config to a preset slot'}
                  >
                    <Copy className="h-3 w-3" /> {copyArmed ? 'Pick a slot…' : 'Copy config'}
                  </button>
                )}
                <button
                  onClick={onDelete}
                  className="text-xs px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Solutions tab ──────────────────────────────────────────────────────────

interface TargetRollup {
  target: string;
  solution_count: number;
  shortest_gene: number;
  fastest_ops: number;
  halting_count: number;
  exact_match_count: number;
  gold_count: number;
  last_seen_at: string;
  total_discoveries: number;
}

interface Solution {
  id: number;
  target: string;
  gene: string;
  output: string;
  gene_length: number;
  loop_count: number;
  max_loop_depth: number;
  unique_instructions: number;
  ops_executed: number;
  halted: boolean;
  output_length: number;
  cells_used: number;
  output_exact_match: boolean;
  run_id: number | null;
  generations_to_solve: number | null;
  config_json: GAConfig | null;
  bf_version_hash: string | null;
  first_seen_at: string;
  last_seen_at: string;
  times_found: number;
}

// The solved-tape drawer of the library. Targets are folders; each solution
// inside is a physical strip you can thread straight into the transport —
// the strip itself is the row, stats ride along, details unfold on demand.
function SolutionsPanel({
  onLoad, loadedGene,
}: {
  onLoad: (tape: LoadedTape) => void;
  loadedGene: string | null;
}) {
  const [targets, setTargets] = useState<TargetRollup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [loading, setLoading] = useState(false);
  const [openSolution, setOpenSolution] = useState<number | null>(null);

  const refreshTargets = useCallback(async () => {
    try {
      const res = await fetch('/api/brainfuck/solutions', { cache: 'no-store' });
      const data = await res.json();
      setTargets(data.targets ?? []);
    } catch { /* network blip — leave previous state */ }
  }, []);

  useEffect(() => {
    refreshTargets();
  }, [refreshTargets]);

  const loadTarget = useCallback(async (t: string) => {
    setSelected(t);
    setOpenSolution(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/brainfuck/solutions?target=${encodeURIComponent(t)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      setSolutions(data.solutions ?? []);
    } catch {
      setSolutions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Every program that ever printed its target, deduped by (target, gene).
        Click a strip to thread it into the transport.
      </p>

      {targets.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No solved targets yet. Start a run that finds one and it will appear here.
        </div>
      ) : (
        <div className="space-y-1">
          {targets.map((t) => (
            <TargetRow
              key={t.target}
              row={t}
              open={selected === t.target}
              solutions={selected === t.target ? solutions : []}
              loading={selected === t.target && loading}
              onToggle={() => {
                if (selected === t.target) {
                  setSelected(null);
                  setSolutions([]);
                } else {
                  loadTarget(t.target);
                }
              }}
              openSolution={openSolution}
              onToggleSolution={(sol) => {
                setOpenSolution((cur) => (cur === sol.id ? null : sol.id));
                onLoad({
                  gene: sol.gene,
                  target: sol.target,
                  label: `solution #${sol.id}${sol.run_id != null ? ` · run #${sol.run_id}` : ''}`,
                  runId: sol.run_id,
                });
              }}
              loadedGene={loadedGene}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TargetRow({
  row, open, solutions, loading, onToggle, openSolution, onToggleSolution, loadedGene,
}: {
  row: TargetRollup;
  open: boolean;
  solutions: Solution[];
  loading: boolean;
  onToggle: () => void;
  openSolution: number | null;
  onToggleSolution: (sol: Solution) => void;
  loadedGene: string | null;
}) {
  // At least one solution that's both halted and exact-match → target row
  // gets the gold flair too. Doesn't pulse as strong as the per-strip glow,
  // since not every solution underneath is necessarily gold.
  const hasGold = row.gold_count > 0;
  return (
    <motion.div
      className={`rounded-lg border overflow-hidden ${
        hasGold ? 'border-warn/60 bg-warn/[0.03]' : 'border-border/40'
      }`}
      animate={hasGold ? {
        boxShadow: [
          '0 0 0 0 rgba(196,150,42,0)',
          '0 0 12px 0 rgba(196,150,42,0.16)',
          '0 0 0 0 rgba(196,150,42,0)',
        ],
      } : undefined}
      transition={hasGold ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <button
        onClick={onToggle}
        className="w-full px-2.5 py-2 flex items-center gap-2 hover:bg-foreground/5 transition-colors text-left"
      >
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
              : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        {hasGold && (
          <motion.span
            className="text-warn shrink-0"
            title={`${row.gold_count} gold-standard solution${row.gold_count === 1 ? '' : 's'}`}
            animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </motion.span>
        )}
        <span className="font-mono text-sm text-foreground/90 truncate">
          &quot;{row.target}&quot;
        </span>
        <div className="ml-auto flex items-center gap-2.5 text-[11px] text-muted-foreground tabular-nums shrink-0">
          <span title="Distinct (target,gene) solutions">
            <span className="text-foreground/80">{row.solution_count}</span>
            {' '}shape{row.solution_count === 1 ? '' : 's'}
          </span>
          {hasGold && (
            <span title="Solutions that both halt and match exactly" className="text-warn">
              <span className="font-semibold">{row.gold_count}</span> gold
            </span>
          )}
          <span title="Shortest gene length">
            min <span className="text-foreground/80">{row.shortest_gene}</span> ch
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-border/40 px-2 py-2 bg-background/30">
          {loading ? (
            <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>
          ) : solutions.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">No solutions.</div>
          ) : (
            <div className="space-y-1.5">
              {solutions.map((s) => (
                <SolutionRow
                  key={s.id}
                  sol={s}
                  open={openSolution === s.id}
                  isThreaded={loadedGene === s.gene}
                  onToggle={() => onToggleSolution(s)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// One archived tape. The collapsed row IS the strip — punch pattern first,
// headline stats after; opening it unfolds the full measurement card.
function SolutionRow({
  sol, open, isThreaded, onToggle,
}: {
  sol: Solution;
  open: boolean;
  isThreaded: boolean;
  onToggle: () => void;
}) {
  // Same trifecta as the History gold-standard: halted naturally + output
  // matches target exactly. Solutions table only stores rows where the GA
  // declared a solve, so 'status=found' is implied and not re-checked.
  const isPerfect = sol.halted && sol.output_exact_match;
  return (
    <motion.div
      className={`rounded-lg border ${
        isPerfect
          ? 'border-warn/60 bg-warn/[0.04]'
          : 'border-border/40 bg-card/60'
      } ${isThreaded ? 'border-l-2 border-l-primary' : ''}`}
      animate={isPerfect ? {
        boxShadow: [
          '0 0 0 0 rgba(196,150,42,0)',
          '0 0 14px 1px rgba(196,150,42,0.22)',
          '0 0 0 0 rgba(196,150,42,0)',
        ],
      } : undefined}
      transition={isPerfect ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <button
        onClick={onToggle}
        title="Thread this tape into the transport"
        className="w-full px-2.5 py-2 text-left hover:bg-foreground/5 transition-colors space-y-1"
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 overflow-hidden">
            <TapeStrip gene={sol.gene} maxFrames={40} height={16} />
          </div>
          {isPerfect && (
            <motion.span
              className="shrink-0 text-warn"
              title="Gold standard: halts + exact-match output"
              animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.15, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </motion.span>
          )}
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground/85">
            {sol.gene_length} ch
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
          <span>{sol.ops_executed.toLocaleString()} ops</span>
          <span className={sol.halted ? 'text-ok' : 'text-warn'}>
            {sol.halted ? 'halts' : 'runs on'}
          </span>
          <span className={sol.output_exact_match ? 'text-ok' : ''}>
            {sol.output_exact_match ? 'exact' : 'trailing output'}
          </span>
          {sol.generations_to_solve != null && <span>gen {sol.generations_to_solve.toLocaleString()}</span>}
          {sol.times_found > 1 && <span>found ×{sol.times_found}</span>}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border/40 px-2.5 pb-2.5 pt-2">
              {isPerfect && (
                <span className="bf-stamp text-warn">
                  <Sparkles className="h-3 w-3" />
                  gold standard
                </span>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
                <SolStat
                  label="halts"
                  value={sol.halted ? 'yes' : 'no'}
                  accent={sol.halted ? 'good' : 'warn'}
                  icon={sol.halted ? CheckCircle : InfinityIcon}
                />
                <SolStat
                  label="exact"
                  value={sol.output_exact_match ? 'yes' : 'trail'}
                  accent={sol.output_exact_match ? 'good' : 'neutral'}
                  title={sol.output_exact_match
                    ? 'output == target'
                    : 'output starts with target then prints more'}
                />
                <SolStat label="loops"    value={String(sol.loop_count)} />
                <SolStat label="depth"    value={String(sol.max_loop_depth)} />
                <SolStat label="cells"    value={String(sol.cells_used)} />
                <SolStat label="alphabet" value={`${sol.unique_instructions}/7`} title="distinct BF instructions used" />
              </div>
              <div className="font-mono text-[11px] break-all bg-background/60 rounded px-2 py-1.5 text-foreground/85">
                {sol.gene}
              </div>
              {!sol.output_exact_match && (
                <div className="font-mono text-[10px] text-muted-foreground">
                  out: <span className="text-foreground/70">{truncateWithEllipsis(sol.output, 96)}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                {sol.run_id != null && <span>run #{sol.run_id}</span>}
                {sol.bf_version_hash && (
                  <span className="flex items-center gap-1">
                    <GitCommit className="h-2.5 w-2.5" />
                    {sol.bf_version_hash}
                  </span>
                )}
                <span className="ml-auto">first seen {fmtTime(sol.first_seen_at)}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SolStat({
  label, value, accent, icon: Icon, title,
}: {
  label: string;
  value: string;
  accent?: 'good' | 'warn' | 'neutral';
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
}) {
  const colour =
    accent === 'good' ? 'text-ok'
    : accent === 'warn' ? 'text-warn'
    : 'text-foreground/80';
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      <span className="text-muted-foreground uppercase tracking-wider text-[9px]">{label}</span>
      {Icon && <Icon className={`h-2.5 w-2.5 ${colour}`} />}
      <span className={colour}>{value}</span>
    </span>
  );
}

function truncateWithEllipsis(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
