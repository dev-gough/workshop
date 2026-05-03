'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Code2, Play, Square, Trash2, Loader, ChevronDown, ChevronRight,
  Target, Hash, Zap, CheckCircle, AlertTriangle, Clock, Gauge, GitCommit,
  RotateCcw,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import BrainfuckAnimator from '@/components/BrainfuckAnimator';

// ── GA config knobs ─────────────────────────────────────────────────────────
// Mirror of the server-side DEFAULT_CONFIG / CONFIG_BOUNDS in lib/brainfuck.ts.
// Kept duplicated here to avoid pulling a server-only module into a client file.

interface GAConfig {
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

const DEFAULT_CONFIG: GAConfig = {
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
      { key: 'max_generations', label: 'max gens',   hint: 'Hard ceiling on the run',
        min: 100, max: 10_000_000, step: 100, integer: true },
      { key: 'min_prog_len',    label: 'min length', hint: 'Lower bound on gene size',
        min: 1,   max: 200,        step: 1,  integer: true },
      { key: 'max_prog_len',    label: 'max length', hint: 'Upper bound on gene size',
        min: 20,  max: 2000,       step: 1,  integer: true },
    ],
  },
  {
    title: 'mutation',
    glyph: '+/-',
    knobs: [
      { key: 'mutation_rate',  label: 'skip rate',     hint: 'Chance to leave a child untouched',
        min: 0, max: 1, step: 0.01 },
      { key: 'mut_prob',       label: 'per-char prob', hint: 'Per-character mutation probability — try ≈ 1/L',
        min: 0, max: 1, step: 0.01 },
      { key: 'macro_mut_rate', label: 'macro rate',    hint: 'Chance of bulk insert/delete pass',
        min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'crossover',
    glyph: '[ ]',
    knobs: [
      { key: 'crossover_rate',     label: 'skip rate', hint: 'Chance to skip recombination (gate is inverted!)',
        min: 0, max: 1, step: 0.01 },
      { key: 'max_crossover_dist', label: 'span',      hint: 'Number of adjacent positions swapped',
        min: 1, max: 100, step: 1, integer: true },
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
}

interface ProgressPoint { gen: number; best_fitness: number; }

interface Benchmark {
  id: number;
  version_hash: string | null;
  version_subject: string | null;
  version_label: string | null;
  batch_id: string | null;
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

interface BenchmarkPresetItem { target: string; popSize: number; maxGen: number }

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
    running:     { color: 'text-blue-400 bg-blue-400/10',       label: 'Running',     Icon: Loader },
    found:       { color: 'text-emerald-400 bg-emerald-400/10', label: 'Solved',      Icon: CheckCircle },
    done:        { color: 'text-zinc-400 bg-zinc-400/10',       label: 'Capped',      Icon: Clock },
    stopped:     { color: 'text-amber-400 bg-amber-400/10',     label: 'Stopped',     Icon: Square },
    failed:      { color: 'text-red-400 bg-red-400/10',         label: 'Failed',      Icon: AlertTriangle },
    interrupted: { color: 'text-amber-400 bg-amber-400/10',     label: 'Interrupted', Icon: AlertTriangle },
  };
  return map[status] ?? { color: 'text-zinc-400 bg-zinc-400/10', label: status, Icon: Clock };
}

function fitnessPercent(target: string, fitness: number | null): number {
  if (fitness == null) return 0;
  const t = 256 * target.length;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(1, fitness / t));
}

export default function BrainfuckPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [target, setTarget] = useState('hi');
  const [config, setConfig] = useState<GAConfig>(DEFAULT_CONFIG);
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [activeProgress, setActiveProgress] = useState<ProgressPoint[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [activeBenchId, setActiveBenchId] = useState<number | null>(null);
  const [benchPreset, setBenchPreset] = useState<BenchmarkPresetItem[]>([]);
  const [benchLabel, setBenchLabel] = useState('');
  const [benchSubmitting, setBenchSubmitting] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const benchPollRef = useRef<number | null>(null);
  // The gene currently being animated. Updated only at animator-cycle boundaries
  // so a newer best gene from polling doesn't yank the animation mid-execution.
  const [displayedGene, setDisplayedGene] = useState<string | null>(null);
  const latestGeneRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/brainfuck/runs', { cache: 'no-store' });
      const data = await res.json();
      setRuns(data.runs ?? []);
      setActiveId(data.activeId ?? null);
    } catch { /* leave previous state */ }
  }, []);

  // Detail-fetch for the active run: includes the progress trail for the sparkline.
  const refreshActive = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/brainfuck/runs/${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setActiveProgress(data.progress ?? []);
      latestGeneRef.current = data.run?.best_gene ?? null;
      // Initial gene assignment — only set on first non-null value to seed the animator.
      setDisplayedGene((cur) => cur ?? data.run?.best_gene ?? null);
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

  // Reset displayed gene + progress when active run changes
  useEffect(() => {
    if (activeId == null) {
      setDisplayedGene(null);
      latestGeneRef.current = null;
      setActiveProgress([]);
      return;
    }
    setDisplayedGene(null); // force re-seed from next refreshActive
  }, [activeId]);

  // Poll while a run is active
  useEffect(() => {
    if (activeId == null) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    refreshActive(activeId);
    pollRef.current = window.setInterval(() => {
      refresh();
      refreshActive(activeId);
    }, 1000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeId, refresh, refreshActive]);

  const onAnimatorCycleEnd = useCallback(() => {
    // Swap to the newest gene at the natural break in animation.
    if (latestGeneRef.current && latestGeneRef.current !== displayedGene) {
      setDisplayedGene(latestGeneRef.current);
    }
  }, [displayedGene]);

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
    await fetch(`/api/brainfuck/runs/${id}/stop`, { method: 'POST' });
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
        body: JSON.stringify({ label: benchLabel.trim() || null }),
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

  const active = runs.find((r) => r.id === activeId) ?? null;
  const history = runs.filter((r) => r.id !== activeId);

  const animatorTrail = activeProgress.map((p) => ({ gen: p.gen, fitness: p.best_fitness }));
  const targetFitness = active ? 256 * active.target.length : 0;

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6 relative">
        <FadeIn>
          <div className="flex items-center gap-3">
            <Code2 className="h-7 w-7 text-fuchsia-400" />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">BrainFuck Genetic Algorithm</h1>
              <p className="text-sm text-muted-foreground">
                Evolve a BrainFuck program that prints a target string. Watch the best gene execute as a Turing machine — instructions, tape, output.
              </p>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={0.05}>
          <div className="rounded-xl bg-card border border-border/60 p-4 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Target string
              </label>
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={submitting || activeId != null}
                maxLength={64}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border/60 font-mono text-base focus:border-fuchsia-400/60 focus:outline-none disabled:opacity-50"
                placeholder="hi"
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {target.length}/64 chars · target fitness {256 * target.length}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 font-mono uppercase tracking-[0.15em]"
              >
                {advanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="text-fuchsia-400/70">{'{'}</span>
                hyperparameters
                <span className="text-fuchsia-400/70">{'}'}</span>
              </button>
              {advanced && !configEqualsDefault(config) && (
                <button
                  type="button"
                  onClick={() => setConfig(DEFAULT_CONFIG)}
                  disabled={submitting || activeId != null}
                  className="text-[10px] text-muted-foreground hover:text-fuchsia-400 flex items-center gap-1 disabled:opacity-40 font-mono uppercase tracking-[0.15em]"
                  title="Reset all knobs to repo defaults"
                >
                  <RotateCcw className="h-3 w-3" /> reset all
                </button>
              )}
            </div>

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
                    {KNOB_GROUPS.map((group) => (
                      <div key={group.title} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-fuchsia-400/70 text-[10px] tabular-nums shrink-0">
                            {group.glyph}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.15em] text-foreground/60 shrink-0">
                            {group.title}
                          </span>
                          <div className="h-px flex-1 bg-foreground/10" />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
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

            {error && (
              <div className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{error}</div>
            )}

            <button
              onClick={start}
              disabled={submitting || activeId != null || !target.trim()}
              className="w-full px-4 py-2.5 rounded-lg bg-fuchsia-500 hover:bg-fuchsia-400 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {activeId != null ? 'Run in progress…' : 'Start run'}
            </button>
          </div>
        </FadeIn>

        <AnimatePresence>
          {active && (
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-xl bg-card border border-fuchsia-400/30 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Loader className="h-4 w-4 text-blue-400 animate-spin" />
                  <span className="text-sm font-semibold">Active run #{active.id}</span>
                  <span className="text-xs text-muted-foreground">
                    target <span className="font-mono text-foreground/80">&quot;{active.target}&quot;</span>
                  </span>
                </div>
                <button
                  onClick={() => stop(active.id)}
                  className="text-xs px-2 py-1 rounded bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 flex items-center gap-1"
                >
                  <Square className="h-3 w-3" /> Stop
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Gen" value={active.generations.toLocaleString()} icon={<Hash className="h-3 w-3" />} />
                <Stat
                  label="Fitness"
                  value={`${active.best_fitness ?? 0}/${targetFitness}`}
                  icon={<Zap className="h-3 w-3" />}
                />
                <Stat
                  label="Elapsed"
                  value={fmtDuration(active.started_at, null)}
                  icon={<Clock className="h-3 w-3" />}
                />
              </div>

              <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-fuchsia-400 rounded-full"
                  animate={{ width: `${fitnessPercent(active.target, active.best_fitness) * 100}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>

              {displayedGene ? (
                <BrainfuckAnimator
                  gene={displayedGene}
                  target={active.target}
                  fitnessTrail={animatorTrail}
                  targetFitness={targetFitness}
                  pendingGene={latestGeneRef.current}
                  pendingLabel={
                    latestGeneRef.current && latestGeneRef.current !== displayedGene
                      ? `gen ${active.generations}`
                      : undefined
                  }
                  height={420}
                  fullscreenable
                  onCycleEnd={onAnimatorCycleEnd}
                />
              ) : (
                <div className="rounded-xl bg-background/40 border border-border/40 h-[420px] flex items-center justify-center text-muted-foreground text-sm">
                  Waiting for first program…
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <FadeIn delay={0.1}>
          <div className="rounded-xl bg-card border border-border/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Target className="h-4 w-4 text-fuchsia-400" />
                History
              </h2>
              <span className="text-xs text-muted-foreground">{history.length} run{history.length === 1 ? '' : 's'}</span>
            </div>

            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                No previous runs. Start one above.
              </div>
            ) : (
              <div className="space-y-1">
                {history.map((r) => (
                  <HistoryRow
                    key={r.id}
                    run={r}
                    open={expanded === r.id}
                    onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                    onDelete={() => remove(r.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </FadeIn>

        <FadeIn delay={0.15}>
          <div className="rounded-xl bg-card border border-border/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Gauge className="h-4 w-4 text-fuchsia-400" />
                Benchmarks
              </h2>
              <span className="text-xs text-muted-foreground">{benchmarks.length} row{benchmarks.length === 1 ? '' : 's'}</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed -mt-1">
              Timed silent suite for measuring raw GA throughput. Each click sweeps a fixed
              set of configs (short → longer targets, varying pop/gens) so we capture
              throughput at multiple operating points. Auto-tagged with the current BF repo
              commit so versions are comparable.
            </p>

            <div className="rounded-lg bg-background/40 border border-border/40 px-3 py-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Configs in each batch
              </div>
              <div className="font-mono text-[11px] text-foreground/70 space-y-0.5">
                {benchPreset.length === 0 ? (
                  <span className="italic text-muted-foreground">loading…</span>
                ) : (
                  benchPreset.map((c, i) => (
                    <div key={i}>
                      <span className="text-fuchsia-400">{i + 1}.</span>{' '}
                      target <span className="text-foreground/90">&quot;{c.target}&quot;</span>
                      {' · '}pop <span className="text-foreground/90">{c.popSize}</span>
                      {' · '}gens <span className="text-foreground/90">{c.maxGen}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
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
                className="mt-1 w-full px-2.5 py-1.5 rounded-lg bg-background border border-border/60 text-sm focus:border-fuchsia-400/60 focus:outline-none disabled:opacity-50"
              />
            </div>

            {benchError && (
              <div className="text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">{benchError}</div>
            )}

            {activeBenchId != null ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-fuchsia-400/10 border border-fuchsia-400/30">
                <div className="flex items-center gap-2 text-sm text-fuchsia-300">
                  <Loader className="h-4 w-4 animate-spin" />
                  Benchmark #{activeBenchId} running…
                </div>
                <button
                  onClick={() => stopBenchmarkApi(activeBenchId)}
                  className="text-xs px-2 py-1 rounded bg-amber-400/10 text-amber-400 hover:bg-amber-400/20 flex items-center gap-1"
                >
                  <Square className="h-3 w-3" /> Stop
                </button>
              </div>
            ) : (
              <button
                onClick={startBenchmark}
                disabled={benchSubmitting || activeId != null}
                className="w-full px-4 py-2 rounded-lg bg-fuchsia-500/90 hover:bg-fuchsia-400 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={activeId != null ? 'Stop the active run first' : undefined}
              >
                {benchSubmitting ? <Loader className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
                Run benchmark
              </button>
            )}

            {benchmarks.length > 0 && (
              <div className="pt-2 space-y-3">
                {groupBenchmarksByBatch(benchmarks).map((group) => (
                  <BenchmarkBatchCard
                    key={group.key}
                    group={group}
                    onDelete={(id) => deleteBenchmark(id)}
                  />
                ))}
              </div>
            )}
          </div>
        </FadeIn>

        {/*
          Reference panel lives in the right slack area beside the centered
          main content. Absolutely positioned so main stays exactly where it
          was, with a width that caps based on the available slack to prevent
          horizontal scroll on any viewport size. Inner sticky div keeps it in
          view while the user scrolls the main column.
        */}
        <aside
          className="hidden absolute top-0 pointer-events-auto min-[1500px]:block"
          style={{
            left: 'calc(100% + 1.5rem)',
            width: 'min(18rem, calc(50vw - 32rem - 2.5rem))',
          }}
        >
          <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-1">
            <BFReference />
          </div>
        </aside>
      </div>
    </PageTransition>
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

  return (
    <div className="rounded-lg bg-background/30 border border-border/30 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2 bg-background/40 text-[11px]">
        <div className="font-mono text-fuchsia-400 flex items-center gap-1" title={group.versionSubject ?? ''}>
          <GitCommit className="h-3 w-3" />
          {group.versionHash ?? '—'}
        </div>
        {group.versionLabel && (
          <span className="px-1.5 py-0.5 rounded bg-fuchsia-400/10 text-fuchsia-300 text-[10px] font-medium">
            {group.versionLabel}
          </span>
        )}
        <span className="text-muted-foreground tabular-nums">
          {group.rows.length} config{group.rows.length === 1 ? '' : 's'}
        </span>
        {inFlight && <Loader className="h-3 w-3 text-blue-400 animate-spin" />}
        <div className="ml-auto flex items-center gap-3 text-muted-foreground tabular-nums">
          {avgEps != null && (
            <span>
              avg <span className="text-foreground/90">{avgEps.toFixed(1)}</span> evals/s
            </span>
          )}
          <span>{totalWall.toFixed(1)}s wall</span>
          <span className="text-[10px]">{fmtTime(group.startedAt)}</span>
        </div>
      </div>
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
    </div>
  );
}

function BenchmarkConfigRow({ b, onDelete }: { b: Benchmark; onDelete: () => void }) {
  const evalsPerSec = b.evals_per_sec != null ? b.evals_per_sec.toFixed(1) : '—';
  const gensPerSec = b.gens_per_sec != null ? b.gens_per_sec.toFixed(1) : '—';
  const wall = b.wall_seconds != null ? `${b.wall_seconds.toFixed(1)}s` : '—';
  const statusColor =
    b.status === 'completed' ? 'text-emerald-400/80'
    : b.status === 'running' ? 'text-blue-400'
    : b.status === 'queued' ? 'text-zinc-500'
    : b.status === 'stopped' ? 'text-amber-400'
    : 'text-red-400';
  return (
    <>
      <div className="flex items-center gap-2 truncate">
        <span className="font-mono text-foreground/90 truncate">&quot;{b.target}&quot;</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          pop {b.pop_size} · gens {b.max_generations}
        </span>
        <span className={`text-[10px] ${statusColor}`}>{b.status}</span>
      </div>
      <div className="text-right tabular-nums font-mono text-foreground/90">{evalsPerSec}</div>
      <div className="text-right tabular-nums font-mono text-muted-foreground">{gensPerSec}</div>
      <div className="text-right tabular-nums font-mono text-muted-foreground">{wall}</div>
      <button
        onClick={onDelete}
        disabled={b.status === 'running' || b.status === 'queued'}
        className="text-muted-foreground/60 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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

function BFReference() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-card border border-border/60 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-fuchsia-400" />
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
      </div>

      <div className="rounded-xl bg-card border border-border/60 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Instructions
        </div>
        <div className="space-y-1">
          {BF_INSTRUCTIONS.map((i) => (
            <div key={i.sym} className="flex items-start gap-2 text-xs">
              <span className="font-mono text-fuchsia-400 w-5 text-center text-sm leading-5 shrink-0">
                {i.sym}
              </span>
              <span className="text-muted-foreground leading-5">{i.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-card border border-border/60 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Common idioms
        </div>
        <div className="space-y-1.5">
          {BF_IDIOMS.map((i) => (
            <div key={i.code} className="space-y-0.5">
              <div className="font-mono text-xs text-fuchsia-300/90">{i.code}</div>
              <div className="text-[11px] text-muted-foreground leading-snug">{i.what}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-card border border-border/60 p-4 space-y-2">
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
              className="text-muted-foreground/50 hover:text-fuchsia-400 disabled:opacity-30 transition-colors"
              title={`Reset to default (${fmtValue(defaultValue)})`}
              tabIndex={-1}
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        {/* Memory-cell-style value readout: thin border, monospace, fuchsia
            when off-default. Mirrors the tape cells in the animator. */}
        <div
          className={`flex items-center gap-0.5 px-1 py-0 rounded-sm border tabular-nums shrink-0 ${
            isDefault
              ? 'border-foreground/10 bg-foreground/[0.02] text-foreground/60'
              : 'border-fuchsia-400/40 bg-fuchsia-400/[0.06] text-fuchsia-300'
          }`}
        >
          <span className="text-fuchsia-400/40 text-[9px] leading-none select-none">[</span>
          <input
            type="number"
            value={value}
            onChange={(e) => onText(e.target.value)}
            disabled={disabled}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            className="w-[58px] bg-transparent text-[10.5px] focus:outline-none disabled:opacity-50 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-fuchsia-400/40 text-[9px] leading-none select-none">]</span>
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
        {/* Default-value mark: a small fuchsia chevron sitting just below the
            tape track, pointing up at the default position. Reads as a
            "bookmark" the way the animator marks the target output column. */}
        <div
          className="absolute left-0 right-0 top-full -mt-px h-1.5 pointer-events-none"
          aria-hidden
        >
          <div
            className="absolute w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[3px] border-b-fuchsia-400/45 -translate-x-1/2"
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
        <span className="text-fuchsia-300/80">{' · ' + diffs.join(' · ')}</span>
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

function HistoryRow({
  run, open, onToggle, onDelete,
}: {
  run: Run; open: boolean; onToggle: () => void; onDelete: () => void;
}) {
  const badge = statusBadge(run.status);
  const pct = fitnessPercent(run.target, run.best_fitness);
  const [trail, setTrail] = useState<ProgressPoint[] | null>(null);

  useEffect(() => {
    if (!open || trail !== null) return;
    let alive = true;
    fetch(`/api/brainfuck/runs/${run.id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive) setTrail(d.progress ?? []); })
      .catch(() => { if (alive) setTrail([]); });
    return () => { alive = false; };
  }, [open, run.id, trail]);

  return (
    <div className="rounded-lg bg-background/30 border border-border/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-background/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.color} flex items-center gap-1`}>
          <badge.Icon className={`h-3 w-3 ${run.status === 'running' ? 'animate-spin' : ''}`} />
          {badge.label}
        </span>
        <span className="font-mono text-sm flex-1 truncate">&quot;{run.target}&quot;</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {run.generations.toLocaleString()} gen
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {Math.round(pct * 100)}%
        </span>
        <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
          {fmtTime(run.started_at)}
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
            <div className="px-3 pb-3 pt-1 space-y-2 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <Stat label="Fitness" value={`${run.best_fitness ?? 0}/${256 * run.target.length}`} />
                <Stat label="Pop" value={run.pop_size.toString()} />
                <Stat label="Max gen" value={run.max_generations.toLocaleString()} />
                <Stat label="Elapsed" value={fmtDuration(run.started_at, run.completed_at)} />
              </div>
              {run.config_json && <ConfigSummary cfg={run.config_json} />}
              {run.best_gene && (
                <BrainfuckAnimator
                  gene={run.best_gene}
                  target={run.target}
                  fitnessTrail={trail ? trail.map((p) => ({ gen: p.gen, fitness: p.best_fitness })) : undefined}
                  targetFitness={256 * run.target.length}
                  height={240}
                  compact
                />
              )}
              {run.error && (
                <div className="text-red-400 bg-red-400/10 rounded px-2 py-1.5 break-all">
                  {run.error}
                </div>
              )}
              <div className="flex justify-end pt-1">
                <button
                  onClick={onDelete}
                  className="text-xs px-2 py-1 rounded bg-red-400/10 text-red-400 hover:bg-red-400/20 flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
