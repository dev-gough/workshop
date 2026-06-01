'use client';

import { motion } from 'motion/react';
import RadialGauge, { type GaugeStatus } from './radial-gauge';

interface GaugeTileProps {
  label: string;
  meta?: string;
  status: GaugeStatus;
  children: React.ReactNode;
  delay: number;
}

function GaugeTile({ label, meta, status, children, delay }: GaugeTileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0.9, 0.2, 1] }}
      className="cc-card relative px-3 pt-3 pb-3"
    >
      <span className="cc-corner cc-corner-tl" aria-hidden />
      <span className="cc-corner cc-corner-tr" aria-hidden />
      <span className="cc-corner cc-corner-bl" aria-hidden />
      <span className="cc-corner cc-corner-br" aria-hidden />

      <div className="relative z-10 flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={`cc-led cc-led-${status} ${status !== 'idle' ? 'cc-led-pulse' : ''}`} aria-hidden />
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-[color:var(--cc-dim)]">
            {label}
          </div>
        </div>
        {meta && (
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[color:var(--cc-muted)] tabular-nums">
            {meta}
          </div>
        )}
      </div>

      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
}

interface GaugeClusterProps {
  cpuLoad: number | null;
  cpuCores: number;
  cpuSub?: string;

  memPct: number | null;
  memSub?: string;

  tempC: number | null;
  tempSub?: string;

  netBytesPerSec: number | null;
  netSub?: string;
  /** Optional auto-scaled max for the net gauge (bytes/s). Default 125 MB/s (gigabit). */
  netMax?: number;
}

function fmtBytesRate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bps;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[u]}`;
}

export default function GaugeCluster({
  cpuLoad, cpuCores, cpuSub,
  memPct, memSub,
  tempC, tempSub,
  netBytesPerSec, netSub,
  netMax = 125_000_000,
}: GaugeClusterProps) {
  // CPU LOAD: max = 2× cores (gives headroom past saturation). Thresholds: warn at 1× cores, crit at 1.5× cores.
  const cpuMax = Math.max(2, cpuCores * 2);
  const cpuT0 = cpuCores / cpuMax;             // saturated
  const cpuT1 = (cpuCores * 1.5) / cpuMax;     // overloaded
  const cpuStatus: GaugeStatus =
    cpuLoad == null ? 'idle' :
    cpuLoad / cpuMax < cpuT0 ? 'ok' :
    cpuLoad / cpuMax < cpuT1 ? 'warn' : 'crit';

  const memStatus: GaugeStatus =
    memPct == null ? 'idle' : memPct < 70 ? 'ok' : memPct < 90 ? 'warn' : 'crit';

  const tempStatus: GaugeStatus =
    tempC == null ? 'idle' : tempC < 65 ? 'ok' : tempC < 80 ? 'warn' : 'crit';

  const netStatus: GaugeStatus =
    netBytesPerSec == null ? 'idle' :
    netBytesPerSec / netMax < 0.5 ? 'ok' :
    netBytesPerSec / netMax < 0.85 ? 'warn' : 'crit';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <GaugeTile label="CPU LOAD" meta={`${cpuCores} CORES`} status={cpuStatus} delay={0.05}>
        <RadialGauge
          value={cpuLoad}
          min={0}
          max={cpuMax}
          thresholds={[cpuT0, cpuT1]}
          format={(v) => v.toFixed(2)}
          sub={cpuSub}
          minLabel="0"
          maxLabel={cpuMax.toFixed(0)}
        />
      </GaugeTile>

      <GaugeTile label="MEMORY" meta="USED %" status={memStatus} delay={0.12}>
        <RadialGauge
          value={memPct}
          min={0}
          max={100}
          thresholds={[0.7, 0.9]}
          format={(v) => v.toFixed(0)}
          unit="%"
          sub={memSub}
          minLabel="0"
          maxLabel="100"
        />
      </GaugeTile>

      <GaugeTile label="THERMAL" meta="CPU PKG" status={tempStatus} delay={0.19}>
        <RadialGauge
          value={tempC}
          min={20}
          max={100}
          thresholds={[(65 - 20) / 80, (80 - 20) / 80]}
          format={(v) => v.toFixed(1)}
          unit="°C"
          sub={tempSub}
          minLabel="20"
          maxLabel="100"
        />
      </GaugeTile>

      <GaugeTile label="NETWORK" meta="RX + TX" status={netStatus} delay={0.26}>
        <RadialGauge
          value={netBytesPerSec}
          min={0}
          max={netMax}
          thresholds={[0.5, 0.85]}
          format={(v) => fmtBytesRate(v)}
          unit="/s"
          sub={netSub}
          minLabel="0"
          maxLabel={fmtBytesRate(netMax)}
        />
      </GaugeTile>
    </div>
  );
}
