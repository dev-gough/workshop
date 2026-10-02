'use client';

import { useMemo } from 'react';
import {
  formatStat, sourceShares, statRows,
  type LiveSnapshot, type LiveStack,
} from '../_lib/live';

export type DpsPoint = { t: number; dps: number };

export function LiveRun({ snap, history }: { snap: LiveSnapshot; history: DpsPoint[] }) {
  const dealt = useMemo(() => sourceShares(snap.dealt), [snap.dealt]);
  const run = useMemo(() => sourceShares(snap.run), [snap.run]);
  const power = useMemo(() => powerShares(snap.items), [snap.items]);
  const powerById = useMemo(() => new Map(power.map(row => [row.id, row.percent])), [power]);
  const stats = useMemo(() => statRows(snap), [snap]);
  const combat = snap.stats;

  return (
    <div className="grid h-full min-h-0 grid-cols-12 grid-rows-[auto_minmax(0,1.05fr)_minmax(0,1fr)] gap-2">
      <section className="mb-plate col-span-12 flex items-center gap-6 px-4 py-2">
        <div className="min-w-[9rem]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">DPS</p>
          <p className="mb-readout text-3xl font-bold leading-none">{snap.dps != null ? fmtDps(snap.dps) : '—'}</p>
          <p className="text-[10px] text-muted-foreground">last 10 seconds</p>
        </div>
        <dl className="flex flex-1 flex-wrap gap-x-5 gap-y-1">
          <Fact label="HP" value={pair(snap.hp, snap.maxHp)} />
          <Fact label="Shield" value={num(snap.shield)} />
          <Fact label="Level" value={snap.level != null ? String(snap.level) : '—'} />
          <Fact label="Gold" value={snap.gold != null ? Math.round(snap.gold).toLocaleString() : '—'} />
          <Fact label="Damage" value={mult(combat?.damageMultiplier)} />
          <Fact label="Crit" value={combat?.critChance != null ? `${trim(combat.critChance * 100)}%` : '—'} />
          <Fact label="Crit dmg" value={combat?.critDamage != null ? `×${trim(combat.critDamage * 2)}` : '—'} />
          <Fact label="Atk speed" value={combat?.attackSpeed != null ? `${trim(combat.attackSpeed * 100)}%` : '—'} />
          <Fact label="Elite" value={mult(combat?.eliteDamage)} />
          <Fact label="Poison" value={mult(combat?.poisonDamage)} />
        </dl>
      </section>

      <section className="mb-plate col-span-5 flex min-h-0 flex-col px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">DPS over time</p>
        <div className="min-h-0 flex-1">
          <DpsChart history={history} />
        </div>
      </section>

      <section className="mb-plate col-span-7 grid min-h-0 grid-cols-2 gap-3 px-3 py-2">
        <DamageColumn title="Last 10s" rows={dealt} empty="No hits in the last 10 seconds." share />
        <DamageColumn title="This run" rows={run} empty="No damage yet this run." />
      </section>

      <section className="mb-plate col-span-4 min-h-0 overflow-hidden px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Items{snap.items ? ` · ${snap.items.length}` : ''}
        </p>
        <StackGrid
          rows={snap.items}
          empty={Array.isArray(snap.items) ? 'None' : 'Waiting for bridge 0.2'}
          detail={item => {
            const share = powerById.get(item.id);
            return `×${item.n ?? 1}${share != null ? ` · ${share.toFixed(0)}% power` : ''}`;
          }}
        />
      </section>

      <section className="mb-plate col-span-3 flex min-h-0 flex-col gap-2 overflow-hidden px-3 py-2">
        <div className="min-h-0 flex-1 overflow-hidden">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Weapons</p>
          <StackGrid
            rows={snap.weapons}
            empty={Array.isArray(snap.weapons) ? 'None' : '—'}
            detail={item => `Lv ${item.level ?? 0} · ${trim(item.damage ?? 0)}${item.on === false ? ' · off' : ''}`}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tomes</p>
          <StackGrid
            rows={snap.tomes}
            empty={Array.isArray(snap.tomes) ? 'None' : '—'}
            detail={item => `Lv ${item.level ?? 0}`}
          />
        </div>
      </section>

      <section className="mb-plate col-span-5 min-h-0 overflow-hidden px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Stats{stats.length ? ` · ${stats.length}` : ''}
        </p>
        {stats.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">No stat block yet.</p>
        ) : (
          <dl className="mt-1 grid grid-cols-2 content-start gap-x-3 gap-y-0.5 overflow-hidden lg:grid-cols-3">
            {stats.map(stat => {
              const shown = formatStat(stat.id, stat.v);
              return (
                <div key={stat.id} className="flex min-w-0 items-baseline justify-between gap-2 text-[10px] leading-4">
                  <dt className="truncate text-muted-foreground">{shown.label}</dt>
                  <dd className="mb-readout shrink-0 font-medium">{shown.text}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </section>
    </div>
  );
}

function powerShares(items: LiveStack[] | undefined) {
  const rows = (items ?? []).filter(item => typeof item.power === 'number' && item.power > 0);
  const total = rows.reduce((sum, item) => sum + (item.power ?? 0), 0);
  return rows.map(item => ({ ...item, percent: total > 0 ? ((item.power ?? 0) / total) * 100 : 0 }));
}

function StackGrid({ rows, empty, detail }: {
  rows: LiveStack[] | undefined;
  empty: string;
  detail: (item: LiveStack) => string;
}) {
  if (!rows || rows.length === 0) {
    return <p className="mt-1 text-[11px] text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="mt-1 grid grid-cols-2 content-start gap-x-3 gap-y-0.5 overflow-hidden">
      {rows.map(item => (
        <li key={item.id} className="flex min-w-0 items-baseline justify-between gap-2 text-[10px] leading-4">
          <span className={`flex min-w-0 items-center gap-1 font-medium ${item.on === false ? 'text-muted-foreground' : ''}`}>
            <Icon src={item.icon} />
            <span className="truncate">{item.id}</span>
          </span>
          <span className="shrink-0 text-muted-foreground">{detail(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function DamageColumn({ title, rows, empty, share }: {
  title: string;
  rows: { source: string; damage: number; percent: number; icon?: string }[];
  empty: string;
  share?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-hidden">
          {rows.map(row => (
            <li key={row.source} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  <Icon src={row.icon} />
                  <span className="truncate">{row.source}</span>
                </span>
                <span className="mb-readout shrink-0 text-muted-foreground">
                  {share ? `${row.percent.toFixed(0)}%` : fmtDps(row.damage)}
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-border/70">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, row.percent)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Icon({ src }: { src?: string }) {
  if (!src) return null;
  return <img src={src} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />;
}

function DpsChart({ history }: { history: DpsPoint[] }) {
  if (history.length < 2) {
    return <p className="mt-6 text-[11px] text-muted-foreground">The line starts after a second of the run.</p>;
  }
  const ys = history.map(point => point.dps);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const width = 100;
  const height = 36;
  const line = history.map((point, index) => {
    const x = (index / (history.length - 1)) * width;
    const y = height - ((point.dps - min) / span) * (height - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full min-h-[8rem] w-full">
      <polygon points={area} fill="color-mix(in oklab, var(--color-primary) 18%, transparent)" />
      <polyline points={line} fill="none" stroke="var(--color-primary)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className="mb-readout text-sm font-semibold leading-tight">{value}</dd>
    </div>
  );
}

function pair(current: number | undefined, max: number | undefined): string {
  if (current == null && max == null) return '—';
  if (max == null) return String(current);
  return `${current ?? '—'} / ${max}`;
}

function num(value: number | undefined): string {
  return value == null ? '—' : trim(value);
}

function mult(value: number | undefined): string {
  return value == null ? '—' : `×${trim(value)}`;
}

function fmtDps(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return Math.round(value).toLocaleString();
  if (value >= 100) return value.toFixed(0);
  return value.toFixed(1);
}

function trim(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}
