'use client';

// RM 03, Mission Control — a single-screen cockpit. One main display, one
// tracking console that configures it: scope (the world / SpaceX), display
// (cumulative / per year / replay / ledger / log), counting, accounting and
// the year window. On desktop the whole room fits the viewport; the console
// configuration persists across visits.

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useHeaderConfig } from '@/components/header-config';
import {
  RANGE_MIN,
  fmtTonnes,
  isEstimate,
  launchYear,
  rankFamilies,
  vehicleStats,
  type Accounting,
  type Display,
  type Launch,
  type Mode,
  type Scope,
  type UpcomingLaunch,
  type WorldFamily,
  type YearRange,
} from './_lib/model';
import { Countdown } from './_components/console';
import { TrackingConsole } from './_components/controls';
import { MainScreen } from './_components/screen';

interface Payload {
  launches: Launch[];
  upcoming: UpcomingLaunch[];
  lastSync: string | null;
}

// The console remembers how you left it.
const CONFIG_KEY = 'sf-console-v1';
const DISPLAYS: Display[] = ['cumulative', 'yearly', 'replay', 'ledger', 'log'];

export default function SpaceflightPage() {
  useHeaderConfig({ scopeClass: 'sf-theme' });

  const [data, setData] = useState<Payload | null>(null);
  const [world, setWorld] = useState<WorldFamily[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<Scope>('world');
  const [display, setDisplay] = useState<Display>('cumulative');
  const [mode, setMode] = useState<Mode>('delivered');
  const [acct, setAcct] = useState<Accounting>('payload');
  const [range, setRange] = useState<YearRange | null>(null);

  const [now, setNow] = useState(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [methodsOpen, setMethodsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/spaceflight/launches');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    // The world range is additive — if it fails, the SpaceX range still works.
    try {
      const res = await fetch('/api/spaceflight/world');
      if (res.ok) setWorld((await res.json()).families);
    } catch {
      /* the screen shows its offline state */
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    load();
    // Restore the console configuration.
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c.scope === 'world' || c.scope === 'spacex') setScope(c.scope);
        if (DISPLAYS.includes(c.display)) setDisplay(c.display);
        if (c.mode === 'delivered' || c.mode === 'launched') setMode(c.mode);
        if (c.acct === 'payload' || c.acct === 'craft' || c.acct === 'stages') setAcct(c.acct);
        if (
          Array.isArray(c.range) &&
          c.range.length === 2 &&
          c.range.every((y: unknown) => typeof y === 'number' && y >= RANGE_MIN && y <= 2100)
        ) {
          setRange([c.range[0], c.range[1]]);
        }
      }
    } catch {
      /* a corrupt config just means defaults */
    }
  }, [load]);

  useEffect(() => {
    if (now === 0) return; // don't clobber the config before restore
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ scope, display, mode, acct, range }));
    } catch {
      /* private mode etc. */
    }
  }, [now, scope, display, mode, acct, range]);

  // The per-launch log only exists for the SpaceX range.
  useEffect(() => {
    if (scope === 'world' && display === 'log') setDisplay('cumulative');
  }, [scope, display]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/spaceflight/sync', { method: 'POST' });
      const body = await res.json();
      if (body.synced) {
        setSyncMsg(`Telemetry refreshed — ${body.past} launches checked`);
        await load();
      } else if (body.reason === 'cooldown') {
        setSyncMsg(`On cooldown — retry in ${Math.ceil(body.remainingSeconds / 60)} min`);
      } else {
        setSyncMsg('Sync failed');
      }
    } catch {
      setSyncMsg('Sync failed');
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const ready = data !== null && now > 0;
  const maxYear = now > 0 ? new Date(now).getUTCFullYear() : 2026;
  const effRange: YearRange = range ?? [RANGE_MIN, maxYear];
  // The room's clock stops at the window's edge, so consoles and charts read
  // as they would have in that year.
  const rangeEnd = Math.min(now, Date.UTC(effRange[1] + 1, 0, 1));

  const inRange = useMemo(
    () =>
      ready
        ? data.launches.filter((l) => {
            const y = launchYear(l);
            return y >= effRange[0] && y <= effRange[1];
          })
        : [],
    [ready, data, effRange]
  );
  const stats = useMemo(
    () => (ready ? vehicleStats(inRange, mode, acct, rangeEnd) : []),
    [ready, inRange, mode, acct, rangeEnd]
  );
  const ranked = useMemo(
    () => (world ? rankFamilies(world, mode, acct, effRange) : []),
    [world, mode, acct, effRange]
  );

  // ── Stat strip, per scope ──
  const strip = useMemo(() => {
    if (scope === 'spacex') {
      const t = stats.reduce((s, v) => s + v.tonnes, 0);
      const flights = stats.reduce((s, v) => s + v.flights, 0);
      const ok = stats.reduce((s, v) => s + v.successes, 0);
      const firstYear = stats.length > 0 ? Math.min(...stats.map((s) => s.firstYear)) : null;
      return {
        label: `SpaceX · mass ${mode === 'delivered' ? 'delivered to orbit' : 'launched'}`,
        tonnes: t,
        items: [
          ['Flights', flights.toLocaleString('en-US')],
          ['Successes', ok.toLocaleString('en-US')],
          ['Success rate', flights > 0 ? `${((ok / flights) * 100).toFixed(1)}%` : '—'],
          ['First flight', firstYear !== null ? String(firstYear) : '—'],
        ] as Array<[string, string]>,
      };
    }
    let t = 0;
    let flights = 0;
    let ok = 0;
    let sx = 0;
    for (const r of ranked) {
      t += r.t.tonnes;
      flights += r.t.flights;
      ok += r.t.successes;
      if (r.f.spacex) sx += r.t.tonnes;
    }
    return {
      label: `The world range · mass ${mode === 'delivered' ? 'delivered to orbit' : 'launched'}`,
      tonnes: t,
      items: [
        ['Launches', flights.toLocaleString('en-US')],
        ['Success rate', flights > 0 ? `${((ok / flights) * 100).toFixed(1)}%` : '—'],
        ['Families', String(ranked.length)],
        ['SpaceX share', t > 0 ? `${((sx / t) * 100).toFixed(1)}%` : '—'],
      ] as Array<[string, string]>,
    };
  }, [scope, stats, ranked, mode]);

  const recorded = ready ? data.launches.filter((l) => !isEstimate(l)).length : 0;

  return (
    <PageTransition>
      <div className="sf-theme min-h-[calc(100vh-57px)]">
        <div className="sf-cockpit mx-auto flex max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
          {/* ── Masthead ── */}
          <FadeIn>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                  RM 03 · Mission Control
                </p>
                <h1 className="ws-serif mt-0.5 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Tonnage to Orbit
                </h1>
                <p className="mt-1 max-w-xl text-[11px] text-muted-foreground">
                  Every orbital launch since Sputnik, weighed — dial in what the screen tracks,
                  what counts, and when.
                </p>
              </div>
              <div className="w-full sm:w-[300px]">
                <Countdown next={data?.upcoming[0] ?? null} />
              </div>
            </div>
          </FadeIn>

          {error && (
            <div className="sf-console mt-4 px-4 py-3 text-sm" style={{ color: 'var(--sf-red)' }}>
              Telemetry link down: {error}
            </div>
          )}
          {!ready && !error && (
            <div className="sf-console mt-4 flex flex-1 items-center justify-center px-4 py-6">
              <p className="sf-etch">
                Acquiring telemetry<span className="hall-blink">…</span>
              </p>
            </div>
          )}

          {ready && (
            <>
              {/* ── The tracking console ── */}
              <FadeIn delay={0.04}>
                <div className="mt-4">
                  <TrackingConsole
                    scope={scope}
                    onScope={setScope}
                    display={display}
                    onDisplay={setDisplay}
                    mode={mode}
                    onMode={setMode}
                    acct={acct}
                    onAcct={setAcct}
                    range={effRange}
                    onRange={setRange}
                    maxYear={maxYear}
                  />
                </div>
              </FadeIn>

              {/* ── Range totals ── */}
              <FadeIn delay={0.07}>
                <div className="sf-console mt-3 flex flex-wrap items-end justify-between gap-x-10 gap-y-3 px-5 py-3.5">
                  <div>
                    <p className="sf-etch">{strip.label}</p>
                    <p className="sf-readout mt-1 text-3xl font-semibold tracking-tight text-primary sm:text-4xl">
                      {fmtTonnes(strip.tonnes)}
                    </p>
                  </div>
                  {strip.items.map(([k, v]) => (
                    <div key={k}>
                      <p className="sf-etch">{k}</p>
                      <p className="sf-readout mt-1 text-xl text-foreground">{v}</p>
                    </div>
                  ))}
                </div>
              </FadeIn>

              {/* ── The main screen ── */}
              <FadeIn delay={0.1} className="mt-3 flex min-h-0 flex-1 flex-col">
                <MainScreen
                  scope={scope}
                  display={display}
                  mode={mode}
                  acct={acct}
                  range={effRange}
                  maxYear={maxYear}
                  rangeEnd={rangeEnd}
                  launches={inRange}
                  stats={stats}
                  families={world ?? []}
                  ranked={ranked}
                />
              </FadeIn>

              {/* ── Footer: methodology + sync ── */}
              <FadeIn delay={0.14}>
                <div className="relative mt-3">
                  {methodsOpen && (
                    <div className="sf-console absolute bottom-full left-0 right-0 z-20 mb-2 max-h-[55vh] overflow-y-auto px-5 py-4">
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Masses marked <span className="sf-readout text-accent">~</span> are
                        estimates. SpaceX masses use GCAT&apos;s per-launch figures where launches
                        match ({recorded} flights recorded), then published figures, Starlink batch
                        count × per-generation satellite mass, Dragon capsule masses, or a typical
                        mass for the target orbit. <em>Payload</em> counts satellites, cargo and
                        capsules; <em>+ spacecraft</em> adds orbited vehicles — Shuttle orbiters
                        (~94.5 t), Buran, and Starship ships (120 t, on flights GCAT logs as
                        orbital attempts) — matching GCAT&apos;s own convention; <em>+ stages</em>{' '}
                        adds approximate dry masses of orbit-reaching upper stages for the largest
                        families. Delivered counts only mass that reached orbit; launched includes
                        failures. Live flight data:{' '}
                        <a
                          href="https://thespacedevs.com/llapi"
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                        >
                          Launch Library 2
                        </a>
                        ; world history:{' '}
                        <a
                          href="https://planet4589.org/space/gcat/"
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                        >
                          GCAT
                        </a>{' '}
                        (J. McDowell, CC-BY), mirrored weekly.
                      </p>
                    </div>
                  )}
                  <div className="sf-console flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setMethodsOpen((v) => !v)}
                        data-on={methodsOpen}
                        aria-expanded={methodsOpen}
                        className="sf-chip px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                      >
                        Methodology
                      </button>
                      <span className="text-[10px] text-muted-foreground">
                        LL2 · GCAT (CC-BY)
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {syncMsg && (
                        <span className="text-[11px] text-muted-foreground">{syncMsg}</span>
                      )}
                      <button
                        onClick={sync}
                        disabled={syncing}
                        className="sf-chip px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] disabled:opacity-50"
                      >
                        {syncing ? 'Syncing…' : 'Refresh telemetry'}
                      </button>
                      {data.lastSync && (
                        <span className="sf-readout text-[10px] text-muted-foreground">
                          SYNC{' '}
                          {new Date(data.lastSync).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </FadeIn>
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
