'use client';

// The house charts — what the bar has been playing and who's been
// listening. Same data as before, re-set on the bar's joinery: etched
// placards, tape-counter numerals, one amber ink for every chart.

import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Calendar, Disc, Disc3, Flame, Music, Play, Trophy } from 'lucide-react';
import { cleanSongDisplay } from '@/lib/songUtils';
import type { Stats } from './shared';

/** Measured width so the plot fills its panel instead of letterboxing. */
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
        <h3 className="bar-etch">Listening activity</h3>
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
              {new Date(filtered[i].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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

function ListeningHeatmap({ data }: { data: { dow: number; hour: number; count: number }[] }) {
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
      <h3 className="bar-etch mb-3">When you listen</h3>
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
  const maxListener = stats.topListeners[0]?.play_count ?? 1;

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

      <PlayActivityChart data={stats.dailyPlays} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ListeningHeatmap data={stats.hourlyHeatmap} />

        <div className="bar-panel flex flex-col gap-4 p-5">
          <h3 className="bar-etch">Highlights</h3>
          <div className="grid flex-1 grid-cols-2 gap-3">
            <div className="flex flex-col items-center justify-center rounded-[4px] bg-muted/40 p-3 text-center">
              <Flame className="mb-1 h-4 w-4 text-primary" />
              <span className="bar-readout text-xl font-bold">{stats.streaks.current}</span>
              <span className="bar-etch">Day streak</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-[4px] bg-muted/40 p-3 text-center">
              <Trophy className="mb-1 h-4 w-4 text-primary" />
              <span className="bar-readout text-xl font-bold">{stats.streaks.longest}</span>
              <span className="bar-etch">Best streak</span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-[4px] bg-muted/40 p-3 text-center">
              <BarChart3 className="mb-1 h-4 w-4 text-primary" />
              <span className="bar-readout text-xl font-bold">{stats.mostActiveDay?.count ?? 0}</span>
              <span className="bar-etch">
                {stats.mostActiveDay ? new Date(stats.mostActiveDay.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Biggest day'}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center rounded-[4px] bg-muted/40 p-3 text-center">
              <Calendar className="mb-1 h-4 w-4 text-primary" />
              <span className="bar-readout text-xs font-semibold">
                {stats.firstPlay ? new Date(stats.firstPlay).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
              </span>
              <span className="bar-etch">First play</span>
            </div>
          </div>
        </div>
      </div>

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

        <div className="bar-panel p-5">
          <h3 className="bar-etch mb-3">Top listeners</h3>
          <div className="space-y-1">
            {stats.topListeners.map((l, i) => (
              <RankRow key={i} rank={i + 1} max={maxListener} count={l.play_count}>
                <span className="min-w-0 flex-1 truncate text-sm">{l.username}</span>
              </RankRow>
            ))}
          </div>
        </div>
      </div>

      <div className="bar-panel p-5">
        <h3 className="bar-etch mb-3">Recent plays</h3>
        <div className="space-y-1">
          {stats.recentPlays.map((p, i) => (
            <div key={i} className="flex items-center gap-2 rounded-[4px] px-2 py-1.5 transition-colors hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate text-sm">{cleanSongDisplay(p.song, p.artist, p.album)}</span>
              <span className="max-w-28 truncate text-xs text-muted-foreground">{p.artist}</span>
              <span className="text-xs text-muted-foreground">{p.username}</span>
              <span className="bar-readout text-xs text-muted-foreground">
                {new Date(p.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
