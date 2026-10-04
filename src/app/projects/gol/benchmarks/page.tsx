'use client';

import Link from 'next/link';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import benchmarks from '@/data/gol-benchmarks.json';

// Numbers come from `gol-census --bench` on the laptop 3060.
// Append a run to history in src/data/gol-benchmarks.json; the latest
// entry's issue ceiling is the right-hand edge of the track.

type Run = (typeof benchmarks.history)[number];

const HISTORY = benchmarks.history as Run[];

function fmtRate(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return Math.round(n).toLocaleString('en-US');
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export default function GolBenchmarksPage() {
  useHeaderConfig({ scopeClass: 'gol-theme' });
  const latest = HISTORY[HISTORY.length - 1];
  const ceiling = latest.issueCeiling;
  const symFrac = latest.sym7 / ceiling;
  const bruteFrac = latest.brute7 / ceiling;
  const hours = Math.pow(2, 49) / latest.sym7 / 3600;

  const strata = latest.strata7;
  const maxStratum = Math.max(...strata);
  const time = strata.map(r => Math.pow(2, 42) / r);
  const timeTotal = time.reduce((a, b) => a + b, 0);
  const slowTime = time.reduce((a, t, i) => a + (strata[i] < 2e9 ? t : 0), 0);

  return (
    <PageTransition>
      <div className="gol-theme min-h-[calc(100vh-57px)]">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            RM 06 · Conway&apos;s Blackboard
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <h1 className="ws-serif text-3xl font-semibold leading-tight sm:text-4xl">Census speed</h1>
            <Link
              href="/projects/gol"
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground hover:text-primary"
            >
              Back to the board
            </Link>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            How fast the 3060 can classify every state of a bounded Life board, scored against the
            integer pipes it actually held during the run. A full 7×7 at the current rate is about{' '}
            <span className="gol-readout text-foreground">{hours.toFixed(0)} hours</span>.
          </p>

          <section className="gol-panel mt-8 px-5 py-5 sm:px-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              7×7 · {latest.label}
            </p>
            <p className="gol-readout mt-2 text-4xl text-primary sm:text-5xl">
              {fmtRate(latest.sym7)}
              <span className="ml-2 text-lg text-muted-foreground">states/s</span>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {fmtPct(symFrac)} of the issue ceiling · {fmtRate(ceiling)} states/s
            </p>

            <div className="relative mt-6 h-3 rounded-sm bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-sm bg-primary"
                style={{ width: `${Math.min(100, symFrac * 100)}%` }}
              />
              <div
                className="absolute top-[-4px] h-5 w-px bg-foreground"
                style={{ left: `${Math.min(100, bruteFrac * 100)}%` }}
                title="Brute force"
              />
            </div>
            <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>Brute {fmtRate(latest.brute7)}</span>
              <span>Issue ceiling</span>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Stat label="5×5 brute" value={fmtRate(latest.brute5)} />
              <Stat label="5×5 symmetry" value={fmtRate(latest.sym5)} />
              <Stat label="7×7 brute" value={fmtRate(latest.brute7)} />
              <Stat label="Step pipes used" value={fmtPct(latest.innerFractionOfPeak)} />
            </dl>
          </section>

          <section className="mt-10">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Runs</h2>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {HISTORY.map(run => {
                const frac = run.sym7 / run.issueCeiling;
                return (
                  <li key={run.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                    <div>
                      <p className="text-sm">{run.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {run.at.slice(0, 10)} · {run.smClockSustainedMHz} MHz · {run.powerWatts.toFixed(0)}W
                      </p>
                    </div>
                    <p className="gol-readout text-sm text-primary">
                      {fmtRate(run.sym7)}
                      <span className="ml-2 text-muted-foreground">{fmtPct(frac)}</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="mt-10">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              7×7 by top row
            </h2>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
              Each bar is one of the 128 values of the most significant row. The short yellow bars are
              where the canonical states sit. They are {(slowTime / timeTotal * 100).toFixed(0)}% of the
              time in a full census.
            </p>
            <div className="mt-4 flex h-28 items-end gap-px">
              {strata.map((rate, top) => (
                <div
                  key={top}
                  className={rate < 2e9 ? 'bg-primary' : 'bg-foreground/25'}
                  style={{ height: `${Math.max(2, (rate / maxStratum) * 100)}%`, flex: '1 1 0' }}
                  title={`top ${top}: ${fmtRate(rate)} states/s`}
                />
              ))}
            </div>
          </section>

          <section className="mt-10 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              What the ceiling is
            </h2>
            <p className="mt-2">
              The chip is a {latest.device}, {latest.sms} SMs, {latest.cudaCores.toLocaleString('en-US')} CUDA
              cores, {latest.memoryBusBits}-bit memory at {latest.memoryBandwidthGBps} GB/s. Under this
              benchmark it held {latest.smClockSustainedMHz} MHz and {latest.powerWatts.toFixed(0)}W of an{' '}
              {latest.powerLimitW}W limit, at {latest.tempC}°C. The advertised peak is {latest.smClockMaxMHz}{' '}
              MHz; the run never got there.
            </p>
            <p className="mt-2">
              A 7×7 generation is {latest.opsPerGeneration} bitwise ops ({latest.opsPerRow} per row). Those
              ops issue on all {latest.int32PerSmPerClock} CUDA cores per SM per clock — integer multiply is
              only half that, but AND, XOR, and shifts are not. A kernel that does nothing but step the
              board reached {fmtPct(latest.innerFractionOfPeak)} of that rate, so the step itself is not the
              gap.
            </p>
            <p className="mt-2">
              Only {fmtPct(latest.minimaFraction)} of states are orbit minima, and a minimum takes{' '}
              {latest.avgSteps.toFixed(1)} generations to classify. The issue ceiling divides the measured
              integer peak by that work and pretends the other states are free. Memory is not the bound:
              streaming every index once would allow {fmtRate(latest.memoryBandwidthGBps * 1e9 / 8)} states/s,
              and the kernel never loads a board. It computes the index from the thread id.
            </p>
            <p className="mt-2">
              The practical ceiling, using the step rate the bare kernel just demonstrated, is{' '}
              {fmtRate(latest.practicalCeiling)} states/s. Symmetry is at {fmtPct(latest.sym7 / latest.practicalCeiling)}{' '}
              of that. The rest is orbit tests, packing, and warps that finish at different times.
            </p>
          </section>
        </div>
      </div>
    </PageTransition>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</dt>
      <dd className="gol-readout mt-0.5 text-lg text-foreground">{value}</dd>
    </div>
  );
}
