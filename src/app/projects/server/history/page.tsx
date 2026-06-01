'use client';

import { useMemo, useCallback } from 'react';
import { Suspense } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import UplotChart from '@/components/charts/uplot-chart';
import { useSyncCursor } from '@/components/charts/sync-cursor';
import type { Series } from 'uplot';
import ChartCard, { type CardStatus } from './_components/chart-card';
import NavigatorStrip from './_components/navigator-strip';
import RangeControls from './_components/range-controls';
import ProcessExplorer from './_components/process-explorer';
import GaugeCluster from './_components/gauge-cluster';
import { useMetrics, useUrlWindow } from './_lib/use-metrics';
import { alignFields, alignSeries, lastValue, formatBytes, formatRate, formatPercent, formatNumber } from './_lib/align';

// Phosphor palette — hard-coded so canvas resolves them (canvas doesn't
// reliably evaluate var() in strokeStyle). Mirrors --cc-* in globals.css.
const CC = {
  cyan:   'hsl(184 95% 58%)',
  amber:  'hsl(38 100% 62%)',
  rose:   'hsl(350 88% 64%)',
  lime:   'hsl(140 72% 58%)',
  violet: 'hsl(265 90% 72%)',
} as const;
const CC_CHART = [CC.cyan, CC.amber, CC.rose, CC.lime, CC.violet];
const fill = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

export default function ServerHistoryPage() {
  // useSearchParams must live under a Suspense boundary in Next 15.
  return (
    <Suspense fallback={null}>
      <HistoryInner />
    </Suspense>
  );
}

function HistoryInner() {
  const { fromMs, toMs, setWindow, clearWindow, setRangeFromNow } = useUrlWindow();
  const { setActiveTs } = useSyncCursor();
  const onHover = useCallback((ts: number | null) => setActiveTs(ts), [setActiveTs]);
  const onZoom = useCallback((f: number, t: number) => setWindow(f * 1000, t * 1000), [setWindow]);

  // Fetches — all in parallel.
  const cpu = useMetrics('system.cpu', fromMs, toMs, { maxPoints: 500 });
  const cpuCore = useMetrics('system.cpu_core', fromMs, toMs, { maxPoints: 400 });
  const mem = useMetrics('system.mem', fromMs, toMs, { maxPoints: 500 });
  const misc = useMetrics('system.misc', fromMs, toMs, { maxPoints: 500 });
  const net = useMetrics('net', fromMs, toMs, { maxPoints: 400 });
  const disk = useMetrics('disk', fromMs, toMs, { maxPoints: 400 });

  // ── CPU load ───────────────────────────────────────────────────────────
  const loadData = useMemo(() => alignFields(cpu.data, ['load1', 'load5', 'load15']), [cpu.data]);
  const loadSeries: Series[] = useMemo(() => ([
    {},
    { label: '1m',  stroke: CC.cyan,   fill: fill(CC.cyan, 14),   width: 2,    points: { show: false } },
    { label: '5m',  stroke: CC.amber,  width: 1.25, points: { show: false } },
    { label: '15m', stroke: CC.violet, width: 1.25, points: { show: false } },
  ]), []);
  const load1Now = lastValue(cpu.data, 'load1');

  // ── Per-core CPU ───────────────────────────────────────────────────────
  // % busy per core, computed from totalJiffies (rate) minus idleJiffies (rate).
  const cpuCoreData = useMemo(() => {
    if (!cpuCore.data) return { data: [[]] as ReturnType<typeof alignFields>['data'], labels: [] as string[] };
    const labels = Object.keys(cpuCore.data.series).sort((a, b) => parseInt(a) - parseInt(b));
    const tsSet = new Set<string>();
    for (const lbl of labels) for (const p of cpuCore.data.series[lbl]) tsSet.add(p.ts as string);
    const xs = Array.from(tsSet).sort();
    const xsNums = xs.map((s) => Math.round(new Date(s).getTime() / 1000));
    const ys = labels.map((lbl) => {
      const map = new Map<string, number | null>();
      for (const p of cpuCore.data!.series[lbl]) {
        const total = typeof p.totalJiffies === 'number' ? p.totalJiffies : null;
        const idle  = typeof p.idleJiffies  === 'number' ? p.idleJiffies  : null;
        let v: number | null = null;
        if (total != null && idle != null && total > 0) v = Math.max(0, Math.min(100, (1 - idle / total) * 100));
        map.set(p.ts as string, v);
      }
      return xs.map((t) => map.get(t) ?? null);
    });
    return { data: [xsNums, ...ys] as ReturnType<typeof alignFields>['data'], labels };
  }, [cpuCore.data]);

  const cpuCoreSeries: Series[] = useMemo(() => ([
    {},
    ...cpuCoreData.labels.map((lbl, i) => ({
      label: `core ${lbl}`,
      stroke: CC_CHART[i % CC_CHART.length],
      width: 1.5,
      points: { show: false },
    })),
  ]), [cpuCoreData.labels]);

  // ── Memory ─────────────────────────────────────────────────────────────
  const memData = useMemo(() => alignFields(mem.data, ['memUsed', 'swapUsed', 'cached']), [mem.data]);
  const memSeries: Series[] = useMemo(() => ([
    {},
    { label: 'used',   stroke: CC.amber, fill: fill(CC.amber, 16), width: 2,    points: { show: false } },
    { label: 'swap',   stroke: CC.rose,  fill: fill(CC.rose, 14),  width: 1.5,  points: { show: false } },
    { label: 'cached', stroke: CC.cyan,  width: 1.25, points: { show: false } },
  ]), []);
  const memNow = lastValue(mem.data, 'memUsed');
  const memTotal = lastValue(mem.data, 'memTotal');

  // ── Temperature ────────────────────────────────────────────────────────
  const tempData = useMemo(() => alignFields(misc.data, ['cpuTempC']), [misc.data]);
  const tempSeries: Series[] = useMemo(() => ([
    {},
    { label: '°C', stroke: CC.amber, fill: fill(CC.amber, 16), width: 2, points: { show: false } },
  ]), []);
  const tempNow = lastValue(misc.data, 'cpuTempC');

  // ── Network ───────────────────────────────────────────────────────────
  const netRxData = useMemo(() => alignSeries(net.data, 'rxBytesRate'), [net.data]);
  const netTxData = useMemo(() => alignSeries(net.data, 'txBytesRate'), [net.data]);
  const netSeries: Series[] = useMemo(() => ([
    {},
    ...netRxData.labels.map((lbl, i) => ({
      label: lbl,
      stroke: CC_CHART[i % CC_CHART.length],
      width: 1.75,
      points: { show: false },
    })),
  ]), [netRxData.labels]);

  // ── Disk IO (sectors → bytes, 512 each) ───────────────────────────────
  const diskReadData = useMemo(() => {
    const aligned = alignSeries(disk.data, 'readBytesRate');
    return { ...aligned, data: scaleData(aligned.data, 512) };
  }, [disk.data]);
  const diskWriteData = useMemo(() => {
    const aligned = alignSeries(disk.data, 'writeBytesRate');
    return { ...aligned, data: scaleData(aligned.data, 512) };
  }, [disk.data]);

  // ── Misc gauges ────────────────────────────────────────────────────────
  const tcpNow = lastValue(misc.data, 'tcpEstablished');
  const fdNow  = lastValue(misc.data, 'fdOpen');

  // ── Derived status / accents ──────────────────────────────────────────
  const cpuCores = cpuCoreData.labels.length || 4;
  const cpuStatus: CardStatus =
    load1Now == null ? 'idle' :
    load1Now < cpuCores ? 'ok' :
    load1Now < cpuCores * 1.5 ? 'warn' : 'crit';

  const memPct = (memNow != null && memTotal && memTotal > 0) ? (memNow / memTotal) * 100 : null;
  const memStatus: CardStatus =
    memPct == null ? 'idle' : memPct < 70 ? 'ok' : memPct < 90 ? 'warn' : 'crit';

  const tempStatus: CardStatus =
    tempNow == null ? 'idle' : tempNow < 65 ? 'ok' : tempNow < 80 ? 'warn' : 'crit';

  const rxTotal = sumLastValues(net.data, 'rxBytesRate');
  const txTotal = sumLastValues(net.data, 'txBytesRate');
  const netTotal = rxTotal + txTotal;
  const netStatus: CardStatus = netTotal === 0 ? 'idle' : 'ok';

  const diskRTotal = sumLastValues(disk.data, 'readBytesRate', 512);
  const diskWTotal = sumLastValues(disk.data, 'writeBytesRate', 512);

  return (
    <PageTransition>
      <FadeIn>
        <div className="space-y-4">
          <NavigatorStrip fromMs={fromMs} toMs={toMs} onSelect={setWindow} />

          <RangeControls
            fromMs={fromMs}
            toMs={toMs}
            onPreset={setRangeFromNow}
            onReset={clearWindow}
            bucketSec={cpu.data?.bucketSec}
          />

          {/* ╭─ Instrument cluster ───────────────────────────────────────╮ */}
          <GaugeCluster
            cpuLoad={load1Now}
            cpuCores={cpuCores}
            cpuSub={`5m ${formatNumber(lastValue(cpu.data, 'load5'), 2)}  ·  15m ${formatNumber(lastValue(cpu.data, 'load15'), 2)}`}
            memPct={memPct}
            memSub={memNow != null && memTotal ? `${formatBytes(memNow)} / ${formatBytes(memTotal)}` : undefined}
            tempC={tempNow}
            tempSub={lastValue(misc.data, 'cpuTempC') != null ? 'cpu package' : undefined}
            netBytesPerSec={netTotal || null}
            netSub={`rx ${formatRate(rxTotal)}  ·  tx ${formatRate(txTotal)}`}
          />

          {/* ╭─ CPU + memory row ────────────────────────────────────────╮ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard
              label="CPU LOAD"
              value={load1Now != null ? load1Now.toFixed(2) : '—'}
              sub={`1m · 5m ${formatNumber(lastValue(cpu.data, 'load5'), 2)} · 15m ${formatNumber(lastValue(cpu.data, 'load15'), 2)}`}
              badge={`bucket ${cpu.data?.bucketSec ?? '—'}s`}
              status={cpuStatus}
              accent="var(--cc-cyan)"
            >
              <UplotChart
                data={loadData.data}
                series={loadSeries}
                height={150}
                onZoom={onZoom}
                onHover={onHover}
              />
            </ChartCard>

            <ChartCard
              label="MEMORY"
              value={formatBytes(memNow)}
              sub={memTotal ? `of ${formatBytes(memTotal)}  ·  ${memPct != null ? memPct.toFixed(0) + '%' : '—'}` : undefined}
              badge={`swap ${formatBytes(lastValue(mem.data, 'swapUsed'))}`}
              status={memStatus}
              accent="var(--cc-amber)"
            >
              <UplotChart
                data={memData.data}
                series={memSeries}
                height={150}
                onZoom={onZoom}
                onHover={onHover}
              />
            </ChartCard>
          </div>

          {/* ╭─ CPU per-core (full width) ───────────────────────────────╮ */}
          <ChartCard
            label="CPU PER-CORE %"
            value={cpuCoreData.labels.length ? `${cpuCoreData.labels.length}` : '—'}
            sub={cpuCoreData.labels.length ? 'cores · 0–100% busy' : undefined}
            badge="LIVE"
            status={cpuStatus}
            accent="var(--cc-violet)"
          >
            <UplotChart
              data={cpuCoreData.data}
              series={cpuCoreSeries}
              height={180}
              onZoom={onZoom}
              onHover={onHover}
              opts={{
                scales: { y: { range: [0, 100] } },
              }}
            />
          </ChartCard>

          {/* ╭─ Network + temp row ──────────────────────────────────────╮ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <ChartCard
              label="NETWORK · RX"
              value={formatRate(rxTotal)}
              sub={netRxData.labels.length ? `${netRxData.labels.length} interfaces` : undefined}
              status={netStatus}
              accent="var(--cc-cyan)"
            >
              <UplotChart
                data={netRxData.data}
                series={netSeries}
                height={130}
                onZoom={onZoom}
                onHover={onHover}
              />
            </ChartCard>

            <ChartCard
              label="NETWORK · TX"
              value={formatRate(txTotal)}
              sub={netRxData.labels.length ? `${netRxData.labels.length} interfaces` : undefined}
              status={netStatus}
              accent="var(--cc-violet)"
            >
              <UplotChart
                data={netTxData.data}
                series={netSeries}
                height={130}
                onZoom={onZoom}
                onHover={onHover}
              />
            </ChartCard>

            <ChartCard
              label="THERMAL · CPU"
              value={tempNow != null ? `${tempNow.toFixed(1)}°C` : '—'}
              sub={tempNow != null ? (tempNow >= 80 ? 'critical zone' : tempNow >= 65 ? 'warning zone' : 'nominal') : undefined}
              badge={tempNow != null && tempNow >= 75 ? 'HOT' : undefined}
              status={tempStatus}
              accent="var(--cc-amber)"
            >
              <UplotChart
                data={tempData.data}
                series={tempSeries}
                height={130}
                onZoom={onZoom}
                onHover={onHover}
              />
            </ChartCard>
          </div>

          {/* ╭─ Disk IO ─────────────────────────────────────────────────╮ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ChartCard
              label="DISK · READ"
              value={formatRate(diskRTotal)}
              sub={diskReadData.labels.length ? `${diskReadData.labels.length} devices` : undefined}
              status={diskRTotal > 0 ? 'ok' : 'idle'}
              accent="var(--cc-lime)"
            >
              <UplotChart
                data={diskReadData.data}
                series={[
                  {},
                  ...diskReadData.labels.map((lbl, i) => ({
                    label: lbl,
                    stroke: CC_CHART[i % CC_CHART.length],
                    width: 1.75,
                    points: { show: false } as const,
                  })),
                ]}
                height={130}
                onZoom={onZoom}
                onHover={onHover}
              />
            </ChartCard>

            <ChartCard
              label="DISK · WRITE"
              value={formatRate(diskWTotal)}
              sub={diskWriteData.labels.length ? `${diskWriteData.labels.length} devices` : undefined}
              status={diskWTotal > 0 ? 'ok' : 'idle'}
              accent="var(--cc-rose)"
            >
              <UplotChart
                data={diskWriteData.data}
                series={[
                  {},
                  ...diskWriteData.labels.map((lbl, i) => ({
                    label: lbl,
                    stroke: `var(--color-chart-${(i % 5) + 1})`,
                    width: 1.25,
                    points: { show: false } as const,
                  })),
                ]}
                height={130}
                onZoom={onZoom}
                onHover={onHover}
              />
            </ChartCard>
          </div>

          {/* ╭─ Mini telemetry strip ────────────────────────────────────╮ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MiniReadout label="TCP ESTABLISHED" value={formatNumber(tcpNow)} accent="var(--cc-cyan)" />
            <MiniReadout label="TCP TIME_WAIT"   value={formatNumber(lastValue(misc.data, 'tcpTimeWait'))} accent="var(--cc-amber)" />
            <MiniReadout label="OPEN FILE DESC"  value={formatNumber(fdNow)} accent="var(--cc-lime)" />
            <MiniReadout label="PROCS RUNNING"   value={formatNumber(lastValue(misc.data, 'procsRunning'))} accent="var(--cc-violet)" />
          </div>

          <ProcessExplorer fromMs={fromMs} toMs={toMs} onZoom={onZoom} onHover={onHover} />
        </div>
      </FadeIn>
    </PageTransition>
  );
}

function MiniReadout({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="cc-card relative px-4 py-3">
      <span className="cc-corner cc-corner-tl" aria-hidden />
      <span className="cc-corner cc-corner-tr" aria-hidden />
      <span className="cc-corner cc-corner-bl" aria-hidden />
      <span className="cc-corner cc-corner-br" aria-hidden />
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="cc-led cc-led-ok cc-led-pulse" style={{ color: accent ?? undefined }} aria-hidden />
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[color:var(--cc-dim)]">{label}</div>
        </div>
        <div className="cc-readout text-2xl leading-none" style={{ color: accent ?? 'var(--cc-text)' }}>
          {value}
        </div>
      </div>
    </div>
  );
}

// Multiply every Y in an AlignedData by `factor` (skipping the x-axis at index 0).
function scaleData(data: ReturnType<typeof alignFields>['data'], factor: number): ReturnType<typeof alignFields>['data'] {
  if (!data || data.length < 2) return data;
  const out: typeof data = [data[0]];
  for (let i = 1; i < data.length; i++) {
    const arr = data[i] as Array<number | null>;
    out.push(arr.map((v) => v == null ? null : v * factor));
  }
  return out as typeof data;
}

// Sum last value of `field` across all labels (with optional multiplier).
function sumLastValues(resp: ReturnType<typeof useMetrics>['data'], field: string, factor = 1): number {
  if (!resp) return 0;
  let total = 0;
  for (const lbl of Object.keys(resp.series)) {
    const v = lastValue(resp, field, lbl);
    if (v != null) total += v;
  }
  return total * factor;
}
