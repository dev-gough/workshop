'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Code2, Play, Square, Trash2, Loader, ChevronDown, ChevronRight,
  Target, Hash, Zap, CheckCircle, AlertTriangle, Clock,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

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

function fitnessPercent(run: Run): number {
  if (run.best_fitness == null) return 0;
  const target = 256 * run.target.length;
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, run.best_fitness / target));
}

function escapeChar(c: string): string {
  const cp = c.codePointAt(0) ?? 0;
  if (cp < 0x20 || cp === 0x7f) return `\\x${cp.toString(16).padStart(2, '0')}`;
  return c;
}

function escapeOutput(s: string | null): string {
  if (!s) return '';
  return Array.from(s).map(escapeChar).join('');
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
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/brainfuck/runs', { cache: 'no-store' });
      const data = await res.json();
      setRuns(data.runs ?? []);
      setActiveId(data.activeId ?? null);
    } catch {
      // network blip — leave previous state
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll every 1s while a run is active
  useEffect(() => {
    if (activeId == null) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(refresh, 1000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeId, refresh]);

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

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
        <FadeIn>
          <div className="flex items-center gap-3">
            <Code2 className="h-7 w-7 text-fuchsia-400" />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">BrainFuck Genetic</h1>
              <p className="text-sm text-muted-foreground">
                Evolve a BrainFuck program that prints a target string. Initial naive implementation —
                expect slow runs on anything past a few characters.
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
                <div className="rounded-lg bg-background/40 px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                    <Hash className="h-3 w-3" /> Gen
                  </div>
                  <div className="text-lg font-semibold tabular-nums">
                    {active.generations.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg bg-background/40 px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                    <Zap className="h-3 w-3" /> Fitness
                  </div>
                  <div className="text-lg font-semibold tabular-nums">
                    {active.best_fitness ?? 0}
                    <span className="text-xs text-muted-foreground"> / {256 * active.target.length}</span>
                  </div>
                </div>
                <div className="rounded-lg bg-background/40 px-2 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                    <Clock className="h-3 w-3" /> Elapsed
                  </div>
                  <div className="text-lg font-semibold tabular-nums">
                    {fmtDuration(active.started_at, null)}
                  </div>
                </div>
              </div>

              <div className="h-1.5 bg-muted/60 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-fuchsia-400 rounded-full"
                  animate={{ width: `${fitnessPercent(active) * 100}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Best output
                </div>
                <div className="font-mono text-sm bg-background/40 rounded px-2 py-1.5 break-all min-h-[1.75rem]">
                  {escapeOutput(active.best_output) || <span className="text-muted-foreground italic">—</span>}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Best program ({(active.best_gene ?? '').length} chars)
                </div>
                <div className="font-mono text-xs bg-background/40 rounded px-2 py-1.5 break-all max-h-32 overflow-y-auto">
                  {active.best_gene || <span className="text-muted-foreground italic">—</span>}
                </div>
              </div>
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
                {history.map((r) => {
                  const badge = statusBadge(r.status);
                  const open = expanded === r.id;
                  const pct = fitnessPercent(r);
                  return (
                    <div key={r.id} className="rounded-lg bg-background/30 border border-border/30">
                      <button
                        onClick={() => setExpanded(open ? null : r.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-background/50 transition-colors text-left"
                      >
                        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.color} flex items-center gap-1`}>
                          <badge.Icon className={`h-3 w-3 ${r.status === 'running' ? 'animate-spin' : ''}`} />
                          {badge.label}
                        </span>
                        <span className="font-mono text-sm flex-1 truncate">&quot;{r.target}&quot;</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {r.generations.toLocaleString()} gen
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {Math.round(pct * 100)}%
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
                          {fmtTime(r.started_at)}
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
                                <Stat label="Fitness" value={`${r.best_fitness ?? 0}/${256 * r.target.length}`} />
                                <Stat label="Pop" value={r.pop_size.toString()} />
                                <Stat label="Max gen" value={r.max_generations.toLocaleString()} />
                                <Stat label="Elapsed" value={fmtDuration(r.started_at, r.completed_at)} />
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Output</div>
                                <div className="font-mono bg-background/40 rounded px-2 py-1.5 break-all min-h-[1.5rem]">
                                  {escapeOutput(r.best_output) || <span className="text-muted-foreground italic">—</span>}
                                </div>
                              </div>
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                                  Program ({(r.best_gene ?? '').length} chars)
                                </div>
                                <div className="font-mono bg-background/40 rounded px-2 py-1.5 break-all max-h-40 overflow-y-auto">
                                  {r.best_gene || <span className="text-muted-foreground italic">—</span>}
                                </div>
                              </div>
                              {r.error && (
                                <div className="text-red-400 bg-red-400/10 rounded px-2 py-1.5 break-all">
                                  {r.error}
                                </div>
                              )}
                              <div className="flex justify-end pt-1">
                                <button
                                  onClick={() => remove(r.id)}
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
                })}
              </div>
            )}
          </div>
        </FadeIn>
      </div>
    </PageTransition>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-background/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
