'use client';

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Disc3, Swords, Film, Tv, Receipt, HandCoins, Code2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  cleanSongName, timeAgo,
  type MusicStats, type GameData, type FetchRow, type SwActivity, type BfRun,
} from './use-home-data';

interface Note {
  key: string;
  ts: number;
  icon: LucideIcon;
  color: string;
  title: string;
  detail: string;
}

function fmtMoneyCents(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** One pinned note per system — the freshest item from each, newest first. */
export function Noticeboard({ music, games, fetches, splitwiser, brainfuck }: {
  music: MusicStats | null;
  games: GameData[];
  fetches: FetchRow[];
  splitwiser: SwActivity[];
  brainfuck: BfRun[];
}) {
  const notes = useMemo<Note[]>(() => {
    const items: Note[] = [];

    const play = music?.recentPlays[0];
    if (play) {
      items.push({
        key: 'music', ts: new Date(play.played_at).getTime(),
        icon: Disc3, color: '#38bdf8',
        title: cleanSongName(play.song), detail: play.artist,
      });
    }

    const g = games[0];
    if (g) {
      const ts = g.game_creation > 1e12 ? g.game_creation : g.game_creation * 1000;
      items.push({
        key: 'game', ts,
        icon: Swords, color: g.win ? '#34d399' : '#f87171',
        title: `${g.win ? 'Victory' : 'Defeat'} — ${g.champion}`,
        detail: `${g.kills}/${g.deaths}/${g.assists}${g.points_gained > 0 ? ` · +${g.points_gained}pts` : ''}`,
      });
    }

    const f = fetches[0];
    if (f) {
      const name = f.final_path
        ? (f.final_path.split('/').pop() || '').replace(/\.[a-z0-9]{2,4}$/i, '')
        : (f.cleaned_title || f.original_name || '(unknown)').replace(/\+/g, ' ');
      items.push({
        key: 'fetch', ts: new Date(f.ingested_at || f.submitted_at).getTime(),
        icon: f.mode === 'tv' ? Tv : Film, color: '#22d3ee',
        title: name, detail: `${f.mode === 'tv' ? 'TV' : 'Movie'} · ${f.status}`,
      });
    }

    const sw = splitwiser[0];
    if (sw) {
      items.push(sw.kind === 'expense'
        ? {
            key: 'sw', ts: new Date(sw.created_at).getTime(),
            icon: Receipt, color: '#fbbf24',
            title: `${sw.description} — ${fmtMoneyCents(parseInt(sw.total_cents || '0', 10))}`,
            detail: `${sw.payer_name} paid · ${sw.group_name}`,
          }
        : {
            key: 'sw', ts: new Date(sw.created_at).getTime(),
            icon: HandCoins, color: '#34d399',
            title: `${sw.from_name} paid ${sw.to_name} ${fmtMoneyCents(parseInt(sw.amount_cents || '0', 10))}`,
            detail: `settle-up · ${sw.group_name}`,
          });
    }

    const bf = brainfuck[0];
    if (bf) {
      items.push({
        key: 'bf', ts: new Date(bf.completed_at).getTime(),
        icon: Code2, color: '#e879f9',
        title: `${bf.status === 'found' ? 'Solved' : bf.status === 'stopped' ? 'Stopped' : 'Capped'} "${bf.target}"`,
        detail: `${bf.generations.toLocaleString()} generations`,
      });
    }

    return items.sort((a, b) => b.ts - a.ts);
  }, [music, games, fetches, splitwiser, brainfuck]);

  if (notes.length === 0) return null;

  // Deterministic little tilts so the notes read as hand-pinned.
  const tilts = [-1.1, 0.8, -0.6, 1.2, -0.9];

  return (
    <section>
      <h2 className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
        Corridor noticeboard
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {notes.map((n, i) => (
          <motion.div
            key={n.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.06 }}
            style={{ rotate: tilts[i % tilts.length] }}
            className="relative rounded-sm border border-border bg-card px-3 pb-2.5 pt-3.5 shadow-[0_2px_6px_rgb(0_0_0/0.08)]"
          >
            {/* pin */}
            <span
              className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-black/20"
              style={{ background: 'var(--hall-brass)', boxShadow: '0 1px 2px rgb(0 0 0 / 0.4)' }}
            />
            <div className="flex items-start gap-2">
              <n.icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: n.color }} />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{n.title}</p>
                <p className="truncate text-[10px] text-muted-foreground">{n.detail} · {timeAgo(n.ts)}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
