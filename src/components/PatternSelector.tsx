'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { parseLif, type LifCell } from '@/lib/lif';

interface PatternSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (content: string) => void;
}

interface PatternInfo {
  file: string;
  name: string;
  description: string;
  category: 'gun' | 'spaceship' | 'math' | 'infinite' | 'other';
}

const PATTERNS: PatternInfo[] = [
  { file: 'adder.lif.txt', name: 'Binary Adder', description: 'Two glider streams compute a binary sum. By David Buckingham, 1975.', category: 'math' },
  { file: 'ak47.lif.txt', name: 'AK47', description: 'A gun firing at 47 generations per shot. Reaction by Richard Schroeppel, stabilized by Paul Callahan.', category: 'gun' },
  { file: 'aqua40.lif.txt', name: 'Aqua 2c/5', description: 'Pair of 2c/5 spaceships by Hartmut Holzwart and Dean Hickerson.', category: 'spaceship' },
  { file: 'hotel.lif.txt', name: 'Infinite Glider Hotel', description: 'Retreating Corderships create an ever-growing glider track, absorbing a new glider every 1920 generations.', category: 'infinite' },
  { file: 'lonedots.lif.txt', name: 'Lone Dot Agars', description: 'Oscillating agar patterns by Dean Hickerson and Al Hensel.', category: 'other' },
  { file: 'loop.lif.txt', name: 'Glider Loop', description: 'Two-glider loop between retreating Corderships by David Bell.', category: 'spaceship' },
  { file: 'primes.lif.txt', name: 'Prime Sieve', description: 'Emits lightweight spaceships for prime numbers. A LWSS escapes around generation 120n+100 iff n is prime.', category: 'math' },
  { file: 'race.lif.txt', name: 'Glider Race', description: 'A race between two gliders. No winner, but at least equality has been achieved.', category: 'other' },
  { file: 'rakegun.lif.txt', name: 'Rake Gun', description: 'Quadratic growth via rake production. Switch to backward rakes by delaying the westernmost gun.', category: 'gun' },
  { file: 'randgun.lif.txt', name: 'Pseudorandom Gun', description: 'p46 logic emitting a pseudorandom binary sequence satisfying a[n] = a[n-1] XOR a[n-12]. Period 149,730.', category: 'gun' },
  { file: 'switchen.lif.txt', name: 'Switch Engine', description: 'The smallest forever-growing pattern in the Game of Life, by Charles Corderman.', category: 'infinite' },
  { file: 'thingun2.lif.txt', name: 'Thin Gun', description: 'A compact period-120 gun.', category: 'gun' },
];

// Each category gets its own stick from the chalk box.
const CATEGORY_META: Record<PatternInfo['category'], { label: string; chalk: string }> = {
  gun:       { label: 'Guns',            chalk: 'var(--gol-rose)' },
  spaceship: { label: 'Spaceships',      chalk: 'var(--gol-blue)' },
  math:      { label: 'Mathematics',     chalk: 'var(--gol-yellow)' },
  infinite:  { label: 'Infinite growth', chalk: 'var(--gol-green)' },
  other:     { label: 'Curiosities',     chalk: 'var(--gol-violet)' },
};

const CATEGORIES = ['gun', 'spaceship', 'math', 'infinite', 'other'] as const;

interface LoadedPattern {
  content: string;
  cells: LifCell[];
}

// ── Chalk thumbnail — the pattern itself, drawn to fit the card ──────────

const THUMB_W = 560; // 2× internal resolution for crisp chalk at h-20 display
const THUMB_H = 160;

function PatternThumb({ cells }: { cells: LifCell[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0e1513';
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);
    if (cells.length === 0) return;

    let maxX = 0, maxY = 0;
    for (const c of cells) {
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    const s = Math.min(THUMB_W / (maxX + 3), THUMB_H / (maxY + 3), 14);
    const ox = (THUMB_W - (maxX + 1) * s) / 2;
    const oy = (THUMB_H - (maxY + 1) * s) / 2;
    const size = Math.max(s * 0.85, 0.75);

    ctx.fillStyle = '#ece7d8';
    for (const c of cells) {
      ctx.fillRect(ox + c.x * s, oy + c.y * s, size, size);
    }
  }, [cells]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_W}
      height={THUMB_H}
      className="block h-20 w-full"
      aria-hidden
    />
  );
}

// ── The archive ──────────────────────────────────────────────────────────

const PatternSelector = ({ open, onOpenChange, onSelect }: PatternSelectorProps) => {
  const [search, setSearch] = useState('');
  const [lib, setLib] = useState<Record<string, LoadedPattern> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Fetch and parse every card once, on first open.
  useEffect(() => {
    if (!open || lib) return;
    let cancelled = false;
    Promise.all(
      PATTERNS.map(async (p) => {
        const res = await fetch(`/patterns/${p.file}`);
        const content = await res.text();
        return [p.file, { content, cells: parseLif(content) }] as const;
      })
    )
      .then((entries) => { if (!cancelled) setLib(Object.fromEntries(entries)); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [open, lib]);

  const searchLower = search.toLowerCase();
  const filtered = PATTERNS.filter(p =>
    !searchLower || p.name.toLowerCase().includes(searchLower) || p.description.toLowerCase().includes(searchLower)
  );

  const grouped = CATEGORIES.map(cat => ({
    ...CATEGORY_META[cat],
    category: cat,
    patterns: filtered.filter(p => p.category === cat),
  })).filter(g => g.patterns.length > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Portals to <body>, outside the page scope — re-apply the room theme. */}
      <SheetContent side="right" className="gol-theme w-full gap-0 border-border sm:max-w-md">
        <SheetHeader className="pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            The Archive
          </p>
          <SheetTitle className="ws-serif text-xl font-semibold">Pattern index</SheetTitle>
          <SheetDescription>
            Classic constructions from the game&apos;s history. Pick a card to chalk it onto the
            board at the current view.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
              placeholder="Search the index…"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-5">
            {grouped.map(({ category, label, chalk, patterns }) => (
              <div key={category}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-1.5 w-4 rounded-full" style={{ background: chalk }} />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.2em]"
                    style={{ color: chalk }}
                  >
                    {label}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <div className="flex flex-col gap-2">
                  {patterns.map((pattern) => {
                    const loaded = lib?.[pattern.file];
                    return (
                      <button
                        key={pattern.file}
                        onClick={() => loaded && onSelect(loaded.content)}
                        disabled={!loaded}
                        className="group overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent/40 disabled:cursor-wait"
                        style={{ ['--cat-chalk' as string]: chalk }}
                      >
                        <div className="relative border-b border-border/60">
                          {loaded ? (
                            <PatternThumb cells={loaded.cells} />
                          ) : (
                            <div className="flex h-20 w-full items-center justify-center bg-[#0e1513]">
                              <span className="text-[10px] text-muted-foreground">
                                {loadFailed ? 'Could not load this card' : 'Fetching card…'}
                              </span>
                            </div>
                          )}
                          {/* the category's chalk stick, resting on the card */}
                          <span
                            className="absolute left-0 top-0 h-full w-[3px]"
                            style={{ background: 'var(--cat-chalk)', opacity: 0.75 }}
                          />
                        </div>
                        <div className="px-3 py-2.5">
                          <p className="text-sm font-medium transition-colors group-hover:text-[color:var(--cat-chalk)]">
                            {pattern.name}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                            {pattern.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {grouped.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No card in the index matches &ldquo;{search}&rdquo;
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PatternSelector;
