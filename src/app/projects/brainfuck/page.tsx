'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Code2, Play, Square, Trash2, Loader, ChevronDown, ChevronRight,
  Target, Hash, Zap, CheckCircle, AlertTriangle, Clock,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import BrainfuckAnimator from '@/components/BrainfuckAnimator';

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
}

interface ProgressPoint { gen: number; best_fitness: number; }

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
  const [maxGen, setMaxGen] = useState(1_000_000);
  const [popSize, setPopSize] = useState(100);
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [activeProgress, setActiveProgress] = useState<ProgressPoint[]>([]);
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
        body: JSON.stringify({ target, max_generations: maxGen, pop_size: popSize }),
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

            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {advanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Advanced
            </button>

            <AnimatePresence initial={false}>
              {advanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        Max generations
                      </label>
                      <input
                        type="number"
                        value={maxGen}
                        onChange={(e) => setMaxGen(parseInt(e.target.value) || 0)}
                        min={100}
                        max={10_000_000}
                        disabled={submitting || activeId != null}
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border/60 font-mono text-sm focus:border-fuchsia-400/60 focus:outline-none disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        Population
                      </label>
                      <input
                        type="number"
                        value={popSize}
                        onChange={(e) => setPopSize(parseInt(e.target.value) || 0)}
                        min={10}
                        max={500}
                        disabled={submitting || activeId != null}
                        className="mt-1 w-full px-3 py-2 rounded-lg bg-background border border-border/60 font-mono text-sm focus:border-fuchsia-400/60 focus:outline-none disabled:opacity-50"
                      />
                    </div>
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
