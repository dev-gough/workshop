'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useHeaderConfig } from '@/components/header-config';
import {
  VEHICLE_COLOR,
  cumulativeSeries,
  fmtTonnes,
  isEstimate,
  vehicleStats,
  yearlyTotals,
  type Launch,
  type Mode,
  type UpcomingLaunch,
  type Vehicle,
  type WorldFamily,
} from './_lib/model';
import { CumulativeChart, Legend, YearlyChart } from './_components/charts';
import { Countdown, LaunchLog, ModeToggle, VehicleConsole } from './_components/console';
import { WorldSection } from './_components/world';

interface Payload {
  launches: Launch[];
  upcoming: UpcomingLaunch[];
  lastSync: string | null;
}

export default function SpaceflightPage() {
  useHeaderConfig({ scopeClass: 'sf-theme' });

  const [data, setData] = useState<Payload | null>(null);
  const [world, setWorld] = useState<WorldFamily[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('delivered');
  const [now, setNow] = useState(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/spaceflight/launches');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    // The world range is additive — if it fails, the SpaceX room still works.
    try {
      const res = await fetch('/api/spaceflight/world');
      if (res.ok) setWorld((await res.json()).families);
    } catch {
      /* section simply doesn't render */
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    load();
  }, [load]);

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
  const stats = useMemo(
    () => (ready ? vehicleStats(data.launches, mode, now) : []),
    [ready, data, mode, now]
  );
  const series = useMemo(
    () => (ready ? cumulativeSeries(data.launches, mode) : new Map()),
    [ready, data, mode]
  );
  const years = useMemo(() => (ready ? yearlyTotals(data.launches, mode) : []), [ready, data, mode]);

  const totalT = stats.reduce((s, v) => s + v.tonnes, 0);
  const totalFlights = stats.reduce((s, v) => s + v.flights, 0);
  const totalSuccess = stats.reduce((s, v) => s + v.successes, 0);
  const published = ready ? data.launches.filter((l) => !isEstimate(l)).length : 0;

  return (
    <PageTransition>
      <div className="sf-theme min-h-[calc(100vh-57px)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          {/* ── Masthead ── */}
          <FadeIn>
            <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">
                  RM 03 · Mission Control
                </p>
                <h1 className="ws-serif mt-0.5 text-4xl font-semibold tracking-tight sm:text-5xl">
                  Tonnage to Orbit
                </h1>
                <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
                  Every orbital launch since Sputnik, weighed — with the SpaceX
                  manifest, flight by flight, up front.
                </p>
                <div className="mt-4">
                  <ModeToggle mode={mode} onChange={setMode} />
                </div>
              </div>
              <div className="w-full sm:w-[300px]">
                <Countdown next={data?.upcoming[0] ?? null} />
              </div>
            </div>
          </FadeIn>

          {error && (
            <div className="sf-console mt-6 px-4 py-3 text-sm" style={{ color: 'var(--sf-red)' }}>
              Telemetry link down: {error}
            </div>
          )}
          {!ready && !error && (
            <div className="sf-console mt-6 px-4 py-6 text-center">
              <p className="sf-etch">
                Acquiring telemetry<span className="hall-blink">…</span>
              </p>
            </div>
          )}

          {ready && (
            <>
              {/* ── Range totals ── */}
              <FadeIn delay={0.05}>
                <div className="sf-console mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-5 py-4">
                  <div>
                    <p className="sf-etch">
                      {mode === 'delivered' ? 'Total mass delivered to orbit' : 'Total mass launched'}
                    </p>
                    <p className="sf-readout mt-1 text-4xl font-semibold tracking-tight text-primary sm:text-5xl">
                      {fmtTonnes(totalT)}
                    </p>
                  </div>
                  {[
                    ['Flights', totalFlights.toLocaleString('en-US')],
                    ['Successes', totalSuccess.toLocaleString('en-US')],
                    ['Success rate', `${((totalSuccess / Math.max(totalFlights, 1)) * 100).toFixed(1)}%`],
                    ['First flight', '2006'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="sf-etch">{k}</p>
                      <p className="sf-readout mt-1 text-2xl text-foreground">{v}</p>
                    </div>
                  ))}
                </div>
              </FadeIn>

              {/* ── Vehicle consoles ── */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((s, i) => (
                  <FadeIn key={s.vehicle} delay={0.08 + i * 0.05}>
                    <VehicleConsole s={s} mode={mode} />
                  </FadeIn>
                ))}
              </div>

              {/* ── Cumulative chart ── */}
              <FadeIn delay={0.15}>
                <div className="sf-console mt-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="sf-etch">
                      SpaceX · cumulative tonnes {mode === 'delivered' ? 'to orbit' : 'launched'} · 2006–present
                    </p>
                    <Legend
                      items={stats.map((s) => ({
                        label: s.vehicle,
                        color: VEHICLE_COLOR[s.vehicle as Vehicle],
                      }))}
                    />
                  </div>
                  <div className="mt-3">
                    <CumulativeChart
                      series={stats.map((s) => ({
                        key: s.vehicle,
                        label: s.vehicle,
                        color: VEHICLE_COLOR[s.vehicle as Vehicle],
                        pts: series.get(s.vehicle) ?? [],
                      }))}
                      now={now}
                    />
                  </div>
                </div>
              </FadeIn>

              {/* ── Yearly + log ── */}
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_minmax(300px,360px)]">
                <FadeIn delay={0.2}>
                  <div className="sf-console h-full p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="sf-etch">SpaceX · tonnes per year</p>
                      <Legend
                        items={stats.map((s) => ({
                          label: s.vehicle,
                          color: VEHICLE_COLOR[s.vehicle as Vehicle],
                        }))}
                      />
                    </div>
                    <div className="mt-3">
                      <YearlyChart rows={years} />
                    </div>
                  </div>
                </FadeIn>
                <FadeIn delay={0.25}>
                  <div className="sf-console h-full p-4 sm:p-5">
                    <p className="sf-etch">Launch log · last 9</p>
                    <div className="mt-2">
                      <LaunchLog launches={data.launches} mode={mode} />
                    </div>
                  </div>
                </FadeIn>
              </div>

              {/* ── The world range ── */}
              {world && world.length > 0 && (
                <FadeIn delay={0.3}>
                  <WorldSection families={world} mode={mode} now={now} />
                </FadeIn>
              )}

              {/* ── Methodology + sync ── */}
              <FadeIn delay={0.3}>
                <div className="sf-console mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-3.5">
                  <p className="max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
                    Masses marked <span className="sf-readout text-accent">~</span> are estimates.
                    SpaceX masses use GCAT&apos;s per-launch figures where launches match,
                    then published figures ({published} flights), then Starlink batch count ×
                    per-generation satellite mass, Dragon capsule masses, or a typical mass
                    for the target orbit. Delivered mode counts only mass that reached orbit;
                    launched mode includes failures and Starship&apos;s suborbital test flights.
                    Crewed vehicles that reach orbit count as payload — the Shuttle orbiter&apos;s
                    ~95 t is why that family leads the world table. Live flight data:{' '}
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
                  <div className="flex items-center gap-3">
                    {syncMsg && <span className="text-[11px] text-muted-foreground">{syncMsg}</span>}
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
              </FadeIn>
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
