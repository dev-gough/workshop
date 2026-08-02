'use client';

// The house charts — what the bar has been playing and who's been
// listening, laid out as a read: the eras up top, the clock and the
// heatmap for rhythm, the records wall, then the shelves and the
// regulars. Every mark is computed from real plays; nothing estimated.

import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Calendar, Disc, Disc3, Flame, Music, Play, Repeat, Sofa, Trophy } from 'lucide-react';
import { cleanSongDisplay } from '@/lib/songUtils';
import type { Stats } from './shared';

/** Measured width so plots fill their panel instead of letterboxing. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtDay = (d: string | Date) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtDayYear = (d: string | Date) =>
  new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/* ─── The eras — weekly plays, stacked by the all-time top five ─── */

// Warm categorical ramp for the dark wall: lamp, copper, wine (the
// hall's maroon lineage), olive, cream. "Everything else" stays wood.
const ERA_COLORS = ['#f6a831', '#c2602e', '#a04458', '#8f9a4a', '#e3cfa0'];
const ERA_OTHER = '#4a4038';

function ErasChart({ rows }: { rows: Stats['weeklyEras'] }) {
  const [wrapRef, measuredW] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const { weeks, series, other } = useMemo(() => {
    const byArtist = new Map<string, Map<string, number>>();
    const weekSet = new Set<string>();
    for (const r of rows) {
      const wk = new Date(r.week).toISOString().slice(0, 10);
      weekSet.add(wk);
      if (!byArtist.has(r.artist)) byArtist.set(r.artist, new Map());
      byArtist.get(r.artist)!.set(wk, r.count);
    }
    const sorted = [...weekSet].sort();
    if (sorted.length === 0) return { weeks: [] as string[], series: [], other: [] as number[] };
    // Fill silent weeks so gaps read as gaps, not joins.
    const weeks: string[] = [];
    const start = new Date(sorted[0] + 'T00:00:00Z').getTime();
    const end = new Date(sorted[sorted.length - 1] + 'T00:00:00Z').getTime();
    for (let t = start; t <= end; t += 7 * 24 * 3600 * 1000) {
      weeks.push(new Date(t).toISOString().slice(0, 10));
    }
    const names = [...byArtist.keys()].filter(a => a !== '__other')
      .sort((a, b) => {
        const tot = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
        return tot(byArtist.get(b)!) - tot(byArtist.get(a)!);
      });
    // The long tail is ~60% of plays — stacked, it buries the artist
    // story under one brown mass. So the areas show the top five only;
    // the tail stays in the tooltip as "everything else".
    const series = names.map((name, i) => ({
      name,
      label: name,
      color: ERA_COLORS[i % ERA_COLORS.length],
      values: weeks.map(wk => byArtist.get(name)!.get(wk) ?? 0),
    }));
    const other = weeks.map(wk => byArtist.get('__other')?.get(wk) ?? 0);
    return { weeks, series, other };
  }, [rows]);

  if (weeks.length < 2) return null;

  const W = Math.max(measuredW, 320), H = 230, PX = 34, PT = 14, PB = 20;
  const plotW = W - PX - 8, plotH = H - PT - PB;
  const totals = weeks.map((_, i) => series.reduce((s, sr) => s + sr.values[i], 0));
  const maxTotal = Math.max(...totals, 1);
  const x = (i: number) => PX + (i / (weeks.length - 1)) * plotW;
  const y = (v: number) => PT + plotH - (v / maxTotal) * plotH;

  // Stack bottom-up: biggest artist sits on the floor.
  const stacked = series.map(() => new Array<number>(weeks.length).fill(0));
  const base = new Array<number>(weeks.length).fill(0);
  series.forEach((sr, si) => {
    for (let i = 0; i < weeks.length; i++) {
      base[i] += sr.values[i];
      stacked[si][i] = base[i];
    }
  });

  const area = (si: number) => {
    const top = stacked[si];
    const bottom = si === 0 ? new Array(weeks.length).fill(0) : stacked[si - 1];
    const fwd = top.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const back = [...bottom.keys()].reverse().map(i => `L${x(i).toFixed(1)},${y(bottom[i]).toFixed(1)}`).join(' ');
    return `${fwd} ${back} Z`;
  };

  const labelStep = Math.max(1, Math.ceil(weeks.length / 6));

  return (
    <div className="bar-panel p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="bar-etch">The eras</h3>
        <p className="text-[11px] text-muted-foreground">plays per week · the all-time top five, stacked</p>
      </div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map(sr => (
          <span key={sr.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: sr.color }} />
            {sr.label}
          </span>
        ))}
      </div>
      <div ref={wrapRef} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = (e.clientX - rect.left) / rect.width * W;
            if (px < PX || px > PX + plotW) { setHover(null); return; }
            setHover(Math.max(0, Math.min(weeks.length - 1, Math.round(((px - PX) / plotW) * (weeks.length - 1)))));
          }}
          onMouseLeave={() => setHover(null)}
        >
          {[0.25, 0.5, 0.75, 1].map(f => (
            <g key={f}>
              <line x1={PX} x2={W - 8} y1={y(f * maxTotal)} y2={y(f * maxTotal)} stroke="var(--bar-line)" strokeOpacity={0.55} />
              <text x={PX - 4} y={y(f * maxTotal) + 3} textAnchor="end" fontSize={9} fill="var(--bar-dim)" fontFamily="var(--font-readout), monospace">
                {Math.round(f * maxTotal)}
              </text>
            </g>
          ))}
          {series.map((sr, si) => (
            <path key={sr.name} d={area(si)} fill={sr.color} fillOpacity={0.82} />
          ))}
          {weeks.map((wk, i) => (i % labelStep === 0 && weeks.length - 1 - i >= labelStep * 0.6) || i === weeks.length - 1 ? (
            <text key={wk} x={x(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="var(--bar-dim)" fontFamily="var(--font-readout), monospace">
              {fmtDay(wk)}
            </text>
          ) : null)}
          {hover !== null && (
            <line x1={x(hover)} x2={x(hover)} y1={PT} y2={PT + plotH} stroke="var(--bar-ink)" strokeOpacity={0.35} strokeDasharray="3,3" />
          )}
        </svg>
        {hover !== null && (
          <div
            className="bar-panel pointer-events-none absolute top-2 z-10 min-w-[150px] px-3 py-2"
            style={{ left: `${Math.min(Math.max((x(hover) / W) * 100, 12), 82)}%`, transform: 'translateX(-50%)' }}
          >
            <p className="bar-etch mb-1">Week of {fmtDay(weeks[hover])}</p>
            {series.filter(sr => sr.values[hover] > 0).sort((a, b) => b.values[hover] - a.values[hover]).map(sr => (
              <p key={sr.name} className="flex items-center gap-1.5 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: sr.color }} />
                <span className="max-w-[130px] truncate text-foreground">{sr.label}</span>
                <span className="bar-readout ml-auto pl-2 text-muted-foreground">{sr.values[hover]}</span>
              </p>
            ))}
            {other[hover] > 0 && (
              <p className="flex items-center gap-1.5 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: ERA_OTHER }} />
                <span className="text-muted-foreground">everything else</span>
                <span className="bar-readout ml-auto pl-2 text-muted-foreground">{other[hover]}</span>
              </p>
            )}
            <p className="bar-readout mt-1 border-t border-border pt-1 text-right text-[11px] text-primary">{totals[hover] + other[hover]} plays</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── The listening clock — 24 hours around the dial ─── */

function ListeningClock({ heatmap }: { heatmap: Stats['hourlyHeatmap'] }) {
  const hours = useMemo(() => {
    const h = new Array<number>(24).fill(0);
    heatmap.forEach(d => { h[d.hour] += d.count; });
    return h;
  }, [heatmap]);

  const max = Math.max(...hours, 1);
  const peak = hours.indexOf(Math.max(...hours));
  const total = hours.reduce((s, v) => s + v, 0);
  const S = 248, cx = S / 2, cy = S / 2, r0 = 42, r1 = 100;

  const wedge = (h: number) => {
    const v = hours[h];
    // sqrt so the wedge AREA tracks the count, not just its length
    const r = r0 + Math.sqrt(v / max) * (r1 - r0);
    const a0 = ((h * 15) - 90 + 1.5) * Math.PI / 180;
    const a1 = ((h * 15) - 90 + 13.5) * Math.PI / 180;
    const p = (rr: number, a: number) => `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
    return `M${p(r0, a0)} A${r0},${r0} 0 0 1 ${p(r0, a1)} L${p(r, a1)} A${r},${r} 0 0 0 ${p(r, a0)} Z`;
  };

  return (
    <div className="bar-panel p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="bar-etch">The listening clock</h3>
        <p className="text-[11px] text-muted-foreground">all plays, around the dial</p>
      </div>
      <div className="flex justify-center">
        <svg viewBox={`0 0 ${S} ${S}`} className="max-w-[260px]" role="img" aria-label={`Listening by hour; peak at ${peak}:00`}>
          {/* dial rings */}
          <circle cx={cx} cy={cy} r={r0 - 3} fill="none" stroke="var(--bar-line)" strokeOpacity={0.8} />
          <circle cx={cx} cy={cy} r={r1 + 3} fill="none" stroke="var(--bar-line)" strokeOpacity={0.5} strokeDasharray="2,4" />
          {hours.map((v, h) => (
            <path key={h} d={wedge(h)}
              fill={h === peak ? 'var(--bar-lamp)' : 'var(--bar-lamp-deep)'}
              fillOpacity={v === 0 ? 0 : h === peak ? 0.95 : 0.28 + 0.55 * (v / max)}
            >
              <title>{`${h}:00 — ${v} play${v !== 1 ? 's' : ''}`}</title>
            </path>
          ))}
          {/* cardinal hour marks */}
          {[0, 6, 12, 18].map(h => {
            const a = ((h * 15) - 90 + 7.5) * Math.PI / 180;
            return (
              <text key={h}
                x={cx + (r1 + 12) * Math.cos(a)} y={cy + (r1 + 12) * Math.sin(a) + 3}
                textAnchor="middle" fontSize={9} fill="var(--bar-dim)" fontFamily="var(--font-readout), monospace"
              >{h}</text>
            );
          })}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={16} fontWeight={700}
            fill="var(--bar-lamp)" fontFamily="var(--font-readout), monospace">{peak}:00</text>
          <text x={cx} y={cy + 10} textAnchor="middle" fontSize={8} fill="var(--bar-dim)"
            style={{ letterSpacing: '0.18em' }}>PEAK HOUR</text>
        </svg>
      </div>
      <p className="mt-1 text-center text-[11px] text-muted-foreground">
        {hours[peak].toLocaleString()} of {total.toLocaleString()} plays land in the {peak}:00 hour
      </p>
    </div>
  );
}

/* ─── When you listen — weekday × hour heatmap (kept from v1) ─── */

function ListeningHeatmap({ data }: { data: Stats['hourlyHeatmap'] }) {
  const grid = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    data.forEach(d => { g[d.dow][d.hour] = d.count; });
    return g;
  }, [data]);

  const maxCount = Math.max(...data.map(d => d.count), 1);
  // Remap DOW: postgres DOW is 0=Sun, we want Mon-Sun order
  const dayOrder = [1, 2, 3, 4, 5, 6, 0];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="bar-panel p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="bar-etch">Week in, week out</h3>
        <p className="text-[11px] text-muted-foreground">weekday × hour</p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[400px]">
          <div className="mb-1 ml-9 flex">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="bar-readout flex-1 text-center text-[9px] text-muted-foreground">
                {h % 3 === 0 ? `${h}` : ''}
              </div>
            ))}
          </div>
          {dayOrder.map((dow, rowIdx) => (
            <div key={dow} className="mb-0.5 flex items-center gap-1">
              <span className="w-8 text-right text-[10px] text-muted-foreground">{dayLabels[rowIdx]}</span>
              <div className="flex flex-1 gap-px">
                {Array.from({ length: 24 }, (_, h) => {
                  const count = grid[dow][h];
                  const intensity = count / maxCount;
                  return (
                    <div
                      key={h}
                      className={`aspect-square flex-1 rounded-[2px] ${count === 0 ? 'bg-muted/40' : ''}`}
                      style={count > 0 ? { backgroundColor: `color-mix(in srgb, var(--bar-lamp) ${Math.round(15 + intensity * 85)}%, transparent)` } : undefined}
                      title={`${dayLabels[rowIdx]} ${h}:00 — ${count} play${count !== 1 ? 's' : ''}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── House records — the plaques behind the bar ─── */

function RecordPlaque({ icon: Icon, value, label, detail }: {
  icon: React.ComponentType<{ className?: string }>;
  value: string; label: string; detail: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[4px] bg-muted/40 p-3 text-center">
      <Icon className="mb-1 h-4 w-4 text-primary" />
      <span className="bar-readout text-lg font-bold leading-tight">{value}</span>
      <span className="bar-etch mt-0.5">{label}</span>
      <span className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted-foreground">{detail}</span>
    </div>
  );
}

function HouseRecords({ stats }: { stats: Stats }) {
  const { records, streaks, mostActiveDay, firstPlay } = stats;
  const sit = records.longestSitting;
  const binge = records.biggestBinge;
  return (
    <div className="bar-panel p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="bar-etch">House records</h3>
        <p className="text-[11px] text-muted-foreground">a sitting: one listener, no half-hour silence</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {sit && (
          <RecordPlaque icon={Sofa}
            value={`${sit.songs}`}
            label="Longest sitting"
            detail={`${sit.hours} h · ${sit.username} · ${fmtDay(sit.startedAt)}`}
          />
        )}
        {binge && (
          <RecordPlaque icon={Repeat}
            value={`×${binge.count}`}
            label="On repeat"
            detail={`${cleanSongDisplay(binge.song, binge.artist, binge.album)} · ${binge.username} · ${fmtDay(binge.date)}`}
          />
        )}
        {mostActiveDay && (
          <RecordPlaque icon={BarChart3}
            value={mostActiveDay.count.toLocaleString()}
            label="Busiest day"
            detail={fmtDayYear(mostActiveDay.date)}
          />
        )}
        <RecordPlaque icon={Flame}
          value={`${streaks.current}`}
          label="Day streak"
          detail={`best run ${streaks.longest} days`}
        />
        <RecordPlaque icon={Trophy}
          value={records.totalSittings.toLocaleString()}
          label="Sittings"
          detail={`about ${records.avgSittingSongs} songs each`}
        />
        <RecordPlaque icon={Calendar}
          value={firstPlay ? fmtDay(firstPlay) : '—'}
          label="First play"
          detail={firstPlay ? `the wall opened ${fmtDayYear(firstPlay)}` : 'no plays yet'}
        />
      </div>
    </div>
  );
}

/* ─── Front to back — albums explored end to end ─── */

function FrontToBack({ rows }: { rows: Stats['frontToBack'] }) {
  if (rows.length === 0) return null;
  return (
    <div className="bar-panel p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="bar-etch">Front to back</h3>
        <p className="text-[11px] text-muted-foreground">how much of each track list has hit the platter</p>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        {rows.map((a, i) => {
          const done = Math.min(a.played_tracks, a.total_tracks);
          const pct = Math.round((done / a.total_tracks) * 100);
          const complete = done >= a.total_tracks;
          return (
            <div key={i} className="flex items-center gap-3">
              {a.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.coverUrl} alt="" className="h-11 w-11 shrink-0 rounded-[3px] object-cover" />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] bg-muted">
                  <Music className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium">{a.album}</p>
                  <span className={`bar-readout shrink-0 text-[11px] ${complete ? 'text-primary' : 'text-muted-foreground'}`}>
                    {done}/{a.total_tracks}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${complete ? 'bg-primary shadow-[0_0_6px_color-mix(in_srgb,var(--bar-lamp)_60%,transparent)]' : 'bg-primary/55'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {a.artist} · {a.plays.toLocaleString()} plays{complete ? ' · every track' : ''}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── The regulars — one card per listener ─── */

function Regulars({ profiles }: { profiles: Stats['listenerProfiles'] }) {
  if (profiles.length === 0) return null;
  return (
    <div className="bar-panel p-5">
      <h3 className="bar-etch mb-3">The regulars</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {profiles.map(p => (
          <div key={p.username} className="rounded-[4px] bg-muted/40 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="bar-serif truncate text-sm font-semibold">{p.username}</p>
              <p className="bar-readout shrink-0 text-sm font-bold text-primary">{p.plays.toLocaleString()}</p>
            </div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {p.top_artist ? `mostly ${p.top_artist}` : 'no favourite yet'}
            </p>
            <p className="bar-readout mt-0.5 text-[10px] text-muted-foreground">
              {p.peak_hour !== null ? `peak ${p.peak_hour}:00 · ` : ''}{p.days_active} day{p.days_active !== 1 ? 's' : ''} on the stool · since {fmtDay(p.first_play)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Daily activity (kept from v1, 30/90/all) ─── */

function PlayActivityChart({ data }: { data: { date: string; count: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [range, setRange] = useState<'30' | '90' | 'all'>('30');
  const [wrapRef, measuredW] = useWidth();

  const filtered = useMemo(() => {
    if (range === 'all') return data;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (range === '30' ? 30 : 90));
    return data.filter(d => new Date(d.date) >= cutoff);
  }, [data, range]);

  const maxCount = Math.max(...filtered.map(d => d.count), 1);
  const W = Math.max(measuredW, 320), H = 160, PX = 40, PY = 32, PB = 20;
  const plotW = W - PX - 10, plotH = H - PY - PB;

  const xScale = (i: number) => PX + (i / Math.max(filtered.length - 1, 1)) * plotW;
  const yScale = (v: number) => PY + plotH - (v / maxCount) * plotH;

  const linePath = filtered.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(d.count).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${xScale(filtered.length - 1).toFixed(1)},${yScale(0).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(0).toFixed(1)} Z`;

  const tickCount = Math.min(5, filtered.length);
  const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(i * (filtered.length - 1) / (tickCount - 1)));

  return (
    <div className="bar-panel p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="bar-etch">Day by day</h3>
        <div className="flex gap-1">
          {(['30', '90', 'all'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="bar-tab px-2 py-0.5 text-xs"
              data-on={range === r}
            >{r === 'all' ? 'All' : `${r}D`}</button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No plays in this window yet.</p>
      ) : (
        <div ref={wrapRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width * W;
            if (x < PX || x > PX + plotW) { setHoverIdx(null); return; }
            const idx = Math.round(((x - PX) / plotW) * (filtered.length - 1));
            setHoverIdx(Math.max(0, Math.min(filtered.length - 1, idx)));
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <g key={f}>
              <line x1={PX} x2={W - 10} y1={yScale(f * maxCount)} y2={yScale(f * maxCount)} stroke="var(--bar-line)" strokeOpacity={0.6} />
              <text x={PX - 4} y={yScale(f * maxCount) + 3} textAnchor="end" fontSize={9} fill="var(--bar-dim)" fontFamily="var(--font-readout), monospace">
                {Math.round(f * maxCount)}
              </text>
            </g>
          ))}
          {ticks.map(i => (
            <text key={i} x={xScale(i)} y={H - 2} textAnchor="middle" fontSize={9} fill="var(--bar-dim)" fontFamily="var(--font-readout), monospace">
              {fmtDay(filtered[i].date)}
            </text>
          ))}
          <path d={areaPath} fill="var(--bar-lamp)" fillOpacity={0.09} />
          <path d={linePath} fill="none" stroke="var(--bar-lamp-deep)" strokeWidth={1.5} />
          {hoverIdx !== null && filtered[hoverIdx] && (() => {
            const cx = xScale(hoverIdx);
            const cy = yScale(filtered[hoverIdx].count);
            const tooltipY = cy < PY + 30 ? cy + 8 : cy - 28;
            const textY = cy < PY + 30 ? cy + 22 : cy - 14;
            return (
              <g>
                <line x1={cx} x2={cx} y1={PY} y2={yScale(0)} stroke="var(--bar-dim)" strokeOpacity={0.4} strokeDasharray="3,3" />
                <circle cx={cx} cy={cy} r={3} fill="var(--bar-lamp)" />
                <rect x={cx - 40} y={tooltipY} width={80} height={22} rx={3} fill="var(--bar-raise)" stroke="var(--bar-line)" />
                <text x={cx} y={textY} textAnchor="middle" fontSize={10} fill="var(--bar-ink)" fontFamily="var(--font-readout), monospace">
                  {filtered[hoverIdx].count} plays
                </text>
              </g>
            );
          })()}
        </svg>
        </div>
      )}
    </div>
  );
}

/* ─── Rank rows (top lists) ─── */

function RankRow({ rank, max, count, children }: {
  rank: number; max: number; count: number; children: React.ReactNode;
}) {
  return (
    <div className="group flex items-center gap-2">
      <span className="bar-readout w-5 shrink-0 text-right text-xs text-muted-foreground">{rank}</span>
      <div className="relative min-w-0 flex-1">
        <div
          className="absolute inset-y-0 left-0 rounded-[3px] bg-primary/10 transition-colors group-hover:bg-primary/15"
          style={{ width: `${(count / max) * 100}%` }}
        />
        <div className="relative flex items-center gap-2 px-2 py-1.5">
          {children}
          <span className="bar-readout shrink-0 text-xs text-muted-foreground">{count}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── The whole read ─── */

export function StatsView({ stats }: { stats: Stats }) {
  const summaryCards = [
    { label: 'Total plays', value: stats.summary.total_plays, icon: Play },
    { label: 'Artists', value: stats.summary.unique_artists, icon: Music },
    { label: 'Albums', value: stats.summary.unique_albums, icon: Disc },
    { label: 'Songs', value: stats.summary.unique_songs, icon: Disc3 },
    { label: 'Listeners', value: stats.summary.active_listeners, icon: BarChart3 },
  ];

  const maxArtist = stats.topArtists[0]?.play_count ?? 1;
  const maxSong = stats.topSongs[0]?.play_count ?? 1;
  const maxAlbum = stats.topAlbums[0]?.play_count ?? 1;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {summaryCards.map(c => (
          <div key={c.label} className="bar-panel flex flex-col items-center gap-1 p-4">
            <c.icon className="h-4 w-4 text-primary/80" />
            <span className="bar-readout text-2xl font-bold">{c.value.toLocaleString()}</span>
            <span className="bar-etch">{c.label}</span>
          </div>
        ))}
      </div>

      <ErasChart rows={stats.weeklyEras} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ListeningClock heatmap={stats.hourlyHeatmap} />
        <ListeningHeatmap data={stats.hourlyHeatmap} />
      </div>

      <HouseRecords stats={stats} />

      <FrontToBack rows={stats.frontToBack} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="bar-panel p-5">
          <h3 className="bar-etch mb-3">Top artists</h3>
          <div className="space-y-1.5">
            {stats.topArtists.map((a, i) => (
              <RankRow key={i} rank={i + 1} max={maxArtist} count={a.play_count}>
                <span className="min-w-0 flex-1 truncate text-sm">{a.artist}</span>
              </RankRow>
            ))}
          </div>
        </div>

        <div className="bar-panel p-5">
          <h3 className="bar-etch mb-3">Top songs</h3>
          <div className="space-y-1">
            {stats.topSongs.map((s, i) => (
              <RankRow key={i} rank={i + 1} max={maxSong} count={s.play_count}>
                <span className="min-w-0 flex-1 truncate text-sm">{cleanSongDisplay(s.song, s.artist, s.album)}</span>
                <span className="max-w-28 truncate text-xs text-muted-foreground">{s.artist}</span>
              </RankRow>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="bar-panel p-5">
          <h3 className="bar-etch mb-3">Top albums</h3>
          <div className="space-y-1">
            {stats.topAlbums.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="bar-readout w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                {a.coverUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.coverUrl} alt="" className="h-7 w-7 shrink-0 rounded-[3px] object-cover" />
                )}
                <div className="relative min-w-0 flex-1">
                  <div
                    className="absolute inset-y-0 left-0 rounded-[3px] bg-primary/10"
                    style={{ width: `${(a.play_count / maxAlbum) * 100}%` }}
                  />
                  <div className="relative flex items-center gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{a.album}</span>
                    <span className="max-w-28 truncate text-xs text-muted-foreground">{a.artist}</span>
                    <span className="bar-readout shrink-0 text-xs text-muted-foreground">{a.play_count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Regulars profiles={stats.listenerProfiles} />
      </div>

      <PlayActivityChart data={stats.dailyPlays} />

      <div className="bar-panel p-5">
        <h3 className="bar-etch mb-3">Recent plays</h3>
        <div className="space-y-1">
          {stats.recentPlays.map((p, i) => (
            <div key={i} className="flex items-center gap-2 rounded-[4px] px-2 py-1.5 transition-colors hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate text-sm">{cleanSongDisplay(p.song, p.artist, p.album)}</span>
              <span className="max-w-28 truncate text-xs text-muted-foreground">{p.artist}</span>
              <span className="text-xs text-muted-foreground">{p.username}</span>
              <span className="bar-readout text-xs text-muted-foreground">{fmtDay(p.played_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
