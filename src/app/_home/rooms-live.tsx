'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtBytes } from '@/lib/format';
import { Door } from './door';
import {
  cleanSongName, timeAgo,
  type ServerStats, type ServiceInfo, type MusicStats, type AlbumRow,
  type ChallengeData, type GameData, type PtAccount, type FetchRow,
  type SwActivity, type BfRun, type SlskStats, type SpaceflightStats,
} from './use-home-data';

// ── 01 · Control Center — a window into the phosphor instrument wall ──

export function ServerRoom({ server, services, className }: {
  server: ServerStats | null;
  services: ServiceInfo[];
  className?: string;
}) {
  const running = services.filter(s => s.status === 'running').length;
  const failed = services.some(s => s.status === 'failed');
  const load = server ? server.loadAverage['1m'] : null;
  const loadPct = server && load !== null ? Math.min((load / server.cpuCount) * 100, 100) : 0;
  const disk = server?.disks[0];

  return (
    <Door href="/projects/server" number="RM 01" room="Control Center" className={className}>
      <div className="cc-scope bg-scroll flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`cc-led cc-led-pulse ${failed ? 'cc-led-crit' : server ? 'cc-led-ok' : 'cc-led-idle'}`} />
            <span className="cc-readout text-[10px] uppercase tracking-[0.2em]" style={{ color: 'var(--cc-cyan)' }}>
              Control Center
            </span>
          </div>
          <span className="cc-readout text-[10px]" style={{ color: 'var(--cc-dim)' }}>
            {server ? server.hostname : 'LINK…'}
          </span>
        </div>

        <div className="grid flex-1 grid-cols-2 content-center gap-x-4 gap-y-3">
          <Readout label="LOAD" value={load !== null ? load.toFixed(2) : '—'} color="var(--cc-cyan)" pct={loadPct} />
          <Readout label="MEM" value={server ? `${server.memory.percentUsed}%` : '—'} color="var(--cc-amber)" pct={server?.memory.percentUsed ?? 0} />
          <Readout label="DISK" value={disk ? `${disk.percentUsed}%` : '—'} color="var(--cc-violet)" pct={disk?.percentUsed ?? 0} />
          <Readout
            label="TEMP"
            value={server?.cpuTemp != null ? `${server.cpuTemp.toFixed(0)}°C` : '—'}
            color={server?.cpuTemp != null && server.cpuTemp > 60 ? 'var(--cc-rose)' : 'var(--cc-lime)'}
            pct={server?.cpuTemp != null ? Math.min((server.cpuTemp / 80) * 100, 100) : 0}
          />
        </div>

        <div className="flex items-center justify-between border-t pt-2.5" style={{ borderColor: 'var(--cc-border)' }}>
          <span className="cc-readout text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--cc-dim)' }}>
            Services
          </span>
          <div className="flex items-center gap-2">
            {services.slice(0, 8).map(s => (
              <span
                key={s.name}
                className={`cc-led ${s.status === 'running' ? 'cc-led-ok' : s.status === 'failed' ? 'cc-led-crit' : 'cc-led-idle'}`}
                style={{ width: 5, height: 5 }}
              />
            ))}
            <span className="cc-readout text-[10px]" style={{ color: 'var(--cc-text)' }}>
              {running}/{services.length}
            </span>
          </div>
        </div>
      </div>
    </Door>
  );
}

function Readout({ label, value, color, pct }: { label: string; value: string; color: string; pct: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="cc-readout text-[9px] uppercase tracking-[0.18em]" style={{ color: 'var(--cc-muted)' }}>{label}</span>
        <span className="cc-readout text-base" style={{ color }}>{value}</span>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full" style={{ background: 'var(--cc-grid)' }}>
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
    </div>
  );
}

// ── 02 · BarFoo — a record wall of real album covers ──

export function MusicRoom({ music, albums, className }: {
  music: MusicStats | null;
  albums: AlbumRow[];
  className?: string;
}) {
  // Most-played covers first, then backfill with the rest of the library.
  const covers = useMemo(() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const a of music?.topAlbums ?? []) {
      if (a.coverUrl && !seen.has(a.coverUrl)) { seen.add(a.coverUrl); urls.push(a.coverUrl); }
    }
    for (const a of albums) {
      if (urls.length >= 16) break;
      if (a.coverUrl && !seen.has(a.coverUrl)) { seen.add(a.coverUrl); urls.push(a.coverUrl); }
    }
    return urls.slice(0, 16);
  }, [music, albums]);

  const last = music?.recentPlays[0];

  return (
    <Door href="/projects/barfoo" number="RM 02" room="BarFoo Records" className={className}>
      <div className="relative h-full bg-zinc-950">
        {covers.length > 0 && (
          <div className="absolute inset-0 grid grid-cols-4 grid-rows-4">
            {covers.map(url => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
            ))}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 space-y-1 p-4 pb-9">
          {last ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-400">Last spin · {timeAgo(last.played_at)}</p>
              <p className="truncate text-sm font-semibold text-zinc-50">{cleanSongName(last.song)}</p>
              <p className="truncate text-xs text-zinc-400">
                {last.artist}
                {music && (
                  <span className="text-zinc-500"> · {music.summary.total_plays.toLocaleString()} plays · {music.summary.unique_artists} artists</span>
                )}
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-500">The record wall is quiet…</p>
          )}
        </div>
      </div>
    </Door>
  );
}

// ── 03 · Paper Trading — warm paper, serif money ──

function fmtDollars(cents: number, alwaysCents = false): string {
  const abs = Math.abs(cents) / 100;
  const opts = alwaysCents || abs < 1000
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 };
  return `${cents < 0 ? '-' : ''}$${abs.toLocaleString(undefined, opts)}`;
}

export function TradingRoom({ accounts, className }: { accounts: PtAccount[]; className?: string }) {
  const total = accounts.reduce((s, a) => s + a.totalValueCents, 0);
  const pnl = accounts.reduce((s, a) => s + a.totalPnlCents, 0);
  const positions = accounts.reduce((s, a) => s + a.positionCount, 0);

  return (
    <Door href="/projects/paper-trading" number="RM 17" room="Paper Trading" className={className}>
      <div className="ws-theme flex h-full flex-col justify-between p-4 pb-9">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--ws-ink-soft)' }}>
          Portfolio — all accounts
        </p>
        {accounts.length > 0 ? (
          <div>
            <p className="ws-serif text-3xl font-semibold leading-none tracking-tight">{fmtDollars(total)}</p>
            <p className="mt-1.5 text-xs" style={{ color: 'var(--ws-ink-soft)' }}>
              <span className={pnl >= 0 ? 'pt-gain' : 'pt-loss'}>
                {pnl >= 0 ? '▲' : '▼'} {fmtDollars(Math.abs(pnl))} all-time
              </span>
              {' · '}{accounts.length} account{accounts.length !== 1 ? 's' : ''} · {positions} position{positions !== 1 ? 's' : ''}
            </p>
          </div>
        ) : (
          <p className="ws-serif text-2xl" style={{ color: 'var(--ws-ink-soft)' }}>Market's closed…</p>
        )}
      </div>
    </Door>
  );
}

// ── 04 · Challenges — hextech gold ──

/**
 * Tier colour comes from the `.lol-theme` ramp, which the tile sits inside —
 * the tile used to carry its own hex map that had drifted out of step with the
 * room's. One palette now, defined in globals.css.
 */
const tierVar = (level: string | null | undefined) =>
  `var(--lol-tier-${(level || 'NONE').toLowerCase()})`;

export function ChallengesRoom({ challenges, games, className }: {
  challenges: ChallengeData | null;
  games: GameData[];
  className?: string;
}) {
  const tp = challenges?.totalPoints;
  const tierColor = tierVar(tp?.level);
  const g = games[0];

  return (
    <Door href="/projects/challenges" number="RM 04" room="Challenges" className={className}>
      <div
        className="lol-theme relative flex h-full flex-col justify-between p-4 pb-9"
        style={{
          background: 'linear-gradient(160deg, var(--lol-bg-surface), var(--lol-bg-deep))',
          color: 'var(--lol-text-primary)',
        }}
      >
        <div className="pointer-events-none absolute inset-1.5 border opacity-50" style={{ borderColor: 'var(--lol-border-gold)' }} />
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--lol-gold)' }}>
            Challenges
          </span>
          {tp && (
            <span
              className="rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em]"
              // color-mix, not an `#rrggbb55` alpha suffix — tierColor is a
              // var() reference now, so string concatenation would not parse.
              style={{
                color: tierColor,
                border: `1px solid color-mix(in srgb, ${tierColor} 35%, transparent)`,
                background: `color-mix(in srgb, ${tierColor} 10%, transparent)`,
              }}
            >
              {tp.level}
            </span>
          )}
        </div>
        {tp ? (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold leading-none" style={{ color: 'var(--lol-gold)' }}>
                {tp.current.toLocaleString()}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--lol-text-muted)' }}>/ {tp.max.toLocaleString()}</span>
              {g && (
                <span className="ml-auto truncate text-[11px]" style={{ color: 'var(--lol-text-secondary)' }}>
                  <span style={{ color: g.win ? 'var(--lol-blue)' : 'var(--lol-red)' }}>{g.win ? 'W' : 'L'}</span>
                  {' '}{g.champion} <span className="font-mono">{g.kills}/{g.deaths}/{g.assists}</span>
                </span>
              )}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'var(--lol-bg-elevated)' }}>
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${Math.min((tp.current / tp.max) * 100, 100)}%`, background: `linear-gradient(90deg, var(--lol-gold-dark), var(--lol-gold))` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--lol-text-muted)' }}>Summoner offline…</p>
        )}
      </div>
    </Door>
  );
}

// ── 07 · BrainFuck — the tape lab's transport window in miniature ──
// A strip of punched tape (BF's 3-bit punch code — this strip really prints
// "hi") running under the magenta read head, with the latest run's stats
// printed along the bench. Colors are the transport's own, hardcoded like
// every tile diorama.

const BF_TILE_PUNCH: Record<string, number> = {
  ',': 0, '>': 1, '<': 2, '+': 3, '-': 4, '.': 5, '[': 6, ']': 7,
};
const BF_TILE_GENE = '++++++++++[>++++++++++<-]>++++.+.'; // prints "hi"

function TileTape() {
  const cellW = 8;
  const h = 24;
  const frames = BF_TILE_GENE.length;
  const w = frames * cellW;
  const rowGap = h / 4.6;
  const holes: React.ReactNode[] = [];
  for (let i = 0; i < frames; i++) {
    const code = BF_TILE_PUNCH[BF_TILE_GENE[i]] ?? 0;
    const cx = (i + 0.5) * cellW;
    for (let bit = 0; bit < 3; bit++) {
      const punched = (code >> (2 - bit)) & 1;
      holes.push(
        <circle key={`${i}-${bit}`} cx={cx} cy={rowGap * (bit + 0.9)}
          r={punched ? 2 : 0.9} fill={punched ? '#151009' : 'rgba(58,44,30,0.18)'} />,
      );
    }
    holes.push(<circle key={`${i}-s`} cx={cx} cy={rowGap * 3.9} r={0.9} fill="#151009" />);
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      height={h}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <rect x="0" y="0" width={w} height={h} rx="1.5" fill="#e4d6b2" />
      {holes}
      {/* read head clamped mid-strip */}
      <rect x={w * 0.42} y="-2" width={cellW} height={h + 4} fill="rgba(239,121,211,0.18)"
        stroke="#ef79d3" strokeWidth="1" />
    </svg>
  );
}

export function BrainfuckRoom({ brainfuck, className }: { brainfuck: BfRun[]; className?: string }) {
  const run = brainfuck[0];
  const statusColor =
    run?.status === 'found' ? 'text-[#93d8a4]' :
    run?.status === 'stopped' ? 'text-[#eebc62]' :
    run?.status === 'failed' ? 'text-[#e57f6b]' : 'text-[#a89a7d]';
  const statusWord =
    run?.status === 'found' ? 'solved' :
    run?.status === 'stopped' ? 'stopped' :
    run?.status === 'failed' ? 'failed' : run?.status ?? '';

  return (
    <Door href="/projects/brainfuck" number="RM 07" room="The Tape Lab" className={className}>
      <div className="flex h-full flex-col justify-center gap-2 bg-[#151009] p-4 pb-9 font-mono text-[11px] leading-relaxed">
        <p className="truncate text-[10px] uppercase tracking-[0.18em] text-[#ef79d3]/80">
          target <span className="text-[#e4d6b2]/80 normal-case tracking-normal">&quot;{run?.target ?? 'hi'}&quot;</span>
        </p>
        <TileTape />
        {run ? (
          <p className="truncate text-[#8d7f66]">
            <span className={statusColor}>{statusWord}</span>
            {' · '}gen {run.generations.toLocaleString()}
            {' · '}fit {run.best_fitness ?? 0}/{256 * run.target.length}
            <span className="hall-blink ml-1 text-[#ef79d3]">▊</span>
          </p>
        ) : (
          <p className="text-[#8d7f66]">awaiting first tape<span className="hall-blink ml-1 text-[#ef79d3]">▊</span></p>
        )}
      </div>
    </Door>
  );
}

// ── 08 · Jellyfin — a strip of film ──

function fetchDisplay(row: FetchRow): string {
  if (row.final_path) {
    const name = row.final_path.split('/').pop() || row.final_path;
    return name.replace(/\.[a-z0-9]{2,4}$/i, '');
  }
  return (row.cleaned_title || row.original_name || '(unknown)').replace(/\+/g, ' ');
}

export function JellyfinRoom({ fetches, className }: { fetches: FetchRow[]; className?: string }) {
  const latest = fetches[0];
  const statusColor =
    latest?.status === 'ingested' ? 'text-emerald-400' :
    latest?.status === 'downloading' ? 'text-sky-400' : 'text-amber-400';

  return (
    <Door href="/projects/jellyfin" number="RM 08" room="Screening Room" className={className}>
      <div className="flex h-full flex-col bg-zinc-950" style={{ ['--hall-hole' as string]: 'hsl(240 6% 3%)' }}>
        <div className="hall-sprockets shrink-0 bg-zinc-900" />
        <div className="flex flex-1 flex-col justify-center gap-1 px-4 pb-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-400">Now showing</p>
          {latest ? (
            <>
              <p className="truncate text-sm font-medium text-zinc-100">{fetchDisplay(latest)}</p>
              <p className="text-[11px] text-zinc-500">
                {latest.mode === 'tv' ? 'TV' : 'Movie'} · <span className={statusColor}>{latest.status}</span>
                {' · '}{timeAgo(latest.ingested_at || latest.submitted_at)}
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-600">Projector idle…</p>
          )}
        </div>
        <div className="hall-sprockets shrink-0 bg-zinc-900" />
      </div>
    </Door>
  );
}

// ── 09 · SplitWiser — a till receipt ──

function fmtMoneyCents(cents: number): string {
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function SplitwiserRoom({ splitwiser, className }: { splitwiser: SwActivity[]; className?: string }) {
  const latest = splitwiser[0];

  return (
    <Door href="/projects/splitwiser" number="RM 09" room="SplitWiser" className={className}>
      {/* Receipts are white even at night — the tear reveals the hallway wall. */}
      <div className="hall-tear flex h-[calc(100%-8px)] flex-col justify-center gap-1 bg-[#fdfbf5] p-4 pb-8 font-mono text-[11px] text-[#3a3733]">
        <p className="text-center text-[9px] font-bold uppercase tracking-[0.3em] text-[#8a857c]">★ SplitWiser ★</p>
        <div className="border-t border-dashed border-[#c9c3b8]" />
        {latest ? latest.kind === 'expense' ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{latest.description}</span>
              <span className="shrink-0 font-semibold">{fmtMoneyCents(parseInt(latest.total_cents || '0', 10))}</span>
            </div>
            <p className="truncate text-[10px] text-[#8a857c]">{latest.payer_name} paid · {latest.group_name} · {timeAgo(latest.created_at)}</p>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">{latest.from_name} → {latest.to_name}</span>
              <span className="shrink-0 font-semibold">{fmtMoneyCents(parseInt(latest.amount_cents || '0', 10))}</span>
            </div>
            <p className="truncate text-[10px] text-[#8a857c]">settle-up · {latest.group_name} · {timeAgo(latest.created_at)}</p>
          </>
        ) : (
          <p className="text-center text-[10px] text-[#8a857c]">no items on the tab</p>
        )}
        <div className="border-t border-dashed border-[#c9c3b8]" />
      </div>
    </Door>
  );
}

// ── 10 · Soulseek — the wire ──

export function SoulseekRoom({ soulseek, className }: { soulseek: SlskStats | null; className?: string }) {
  const s = soulseek?.downloads.summary;
  const u = soulseek?.uploads?.summary;
  const top = soulseek?.downloads.topSources[0];

  // Miniature of the wire room: green-black exchange wall, emerald down-wire,
  // copper up-wire (colors match .slsk-theme in globals.css).
  return (
    <Door href="/projects/soulseek" number="RM 10" room="Soulseek Wire" className={className}>
      <div className="flex h-full flex-col justify-center gap-2 bg-[hsl(160_20%_5%)] p-4 pb-9">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[hsl(158_72%_52%)]">The wire room</p>
        {s ? (
          <>
            <div className="flex items-center gap-2 text-[hsl(158_72%_52%)]">
              <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">▼ {fmtBytes(Number(s.total_bytes))}</span>
              <span className="shrink-0 text-[10px] text-zinc-500">{s.completed} files in</span>
              <span className="slsk-wire min-w-0 flex-1 opacity-50" />
            </div>
            <div className="flex items-center gap-2 text-[hsl(28_72%_58%)]">
              <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">▲ {fmtBytes(Number(u?.total_bytes ?? 0))}</span>
              <span className="shrink-0 text-[10px] text-zinc-500">{u?.completed ?? 0} files out</span>
              <span className="slsk-wire min-w-0 flex-1 opacity-50" />
            </div>
            {top && (
              <p className="truncate text-[11px] text-zinc-500">
                best peer: <span className="text-zinc-300">{top.username}</span> ({top.count} files)
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-zinc-600">No peers on the line…</p>
        )}
      </div>
    </Door>
  );
}

// ── 17 · Mission Control — tonnes to orbit on the firing-room wall ──

// Hex values mirror the .sf-theme vehicle/chrome vars in globals.css; the
// tile renders outside that scope so it carries its own copies.
const SF_VEHICLE: Record<string, string> = {
  'Falcon 1': '#3987e5',
  'Falcon 9': '#199e70',
  'Falcon Heavy': '#c98500',
  Starship: '#9085e9',
};

function fmtTMinus(deltaMs: number): string {
  const past = deltaMs < 0;
  const s = Math.floor(Math.abs(deltaMs) / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const sign = past ? 'T+' : 'T-';
  return d > 0 ? `${sign}${d}d ${hh}:${mm}:${ss}` : `${sign}${hh}:${mm}:${ss}`;
}

export function SpaceflightRoom({ spaceflight, className }: {
  spaceflight: SpaceflightStats | null;
  className?: string;
}) {
  const vehicles = spaceflight?.vehicles ?? [];
  const totalT = vehicles.reduce((s, v) => s + v.tonnes_delivered, 0);
  const next = spaceflight?.nextLaunch ?? null;

  // The clock ticks locally at 1 Hz off the launch time we already have —
  // it never touches the API (the timer/room sync keep the time fresh).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!next) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [next]);

  const go = next?.status === 'Go';

  return (
    <Door href="/projects/spaceflight" number="RM 03" room="Mission Control" className={className}>
      <div className="flex h-full flex-col justify-center gap-1.5 bg-[#060a08] p-4 pb-9">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#46d17e]">The firing room</p>
          {next && (
            <span
              className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.14em]"
              style={{ color: go ? '#46d17e' : '#d9a13c' }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: 'currentcolor', boxShadow: '0 0 5px currentcolor' }}
              />
              {go ? 'GO' : next.status.toUpperCase()}
            </span>
          )}
        </div>
        {vehicles.length > 0 ? (
          <>
            {next ? (
              <>
                <p className="font-mono text-2xl font-semibold tabular-nums text-[#46d17e]">
                  {fmtTMinus(new Date(next.net).getTime() - now)}
                </p>
                <p className="truncate text-[11px] text-zinc-400">
                  {next.name.split('|').pop()?.trim() ?? next.name}
                </p>
              </>
            ) : (
              <p className="font-mono text-2xl font-semibold tabular-nums text-[#46d17e]">
                {Math.round(totalT).toLocaleString('en-US')}
                <span className="text-sm font-normal text-zinc-500"> t to orbit</span>
              </p>
            )}
            {/* One stacked bar, vehicles in fixed order — a 3px floor keeps
                Falcon 1's sliver visible next to Falcon 9's wall. */}
            <div className="flex h-1.5 w-full items-stretch gap-[2px]">
              {vehicles.map((v) => (
                <span
                  key={v.vehicle}
                  title={`${v.vehicle}: ${Math.round(v.tonnes_delivered).toLocaleString('en-US')} t`}
                  className="rounded-[2px]"
                  style={{
                    background: SF_VEHICLE[v.vehicle] ?? '#57685e',
                    flexGrow: Math.max(v.tonnes_delivered / Math.max(totalT, 1), 0.012),
                    flexBasis: 3,
                  }}
                />
              ))}
            </div>
            <p className="truncate text-[11px] text-zinc-500">
              {next && (
                <>
                  <span className="text-zinc-300">{Math.round(totalT).toLocaleString('en-US')} t</span>
                  {' to orbit · '}
                </>
              )}
              {vehicles.reduce((s, v) => s + v.flights, 0)} flights
            </p>
          </>
        ) : (
          <p className="text-xs text-zinc-600">Telemetry dark…</p>
        )}
      </div>
    </Door>
  );
}
