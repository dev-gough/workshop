'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Calculator, Crosshair, Rocket, Infinity, Sparkles, Zap, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { LucideIcon } from 'lucide-react';

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

const CATEGORY_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  gun:       { label: 'Guns',       icon: Crosshair, color: '#ef4444' },
  spaceship: { label: 'Spaceships', icon: Rocket,    color: '#3b82f6' },
  math:      { label: 'Math',       icon: Calculator, color: '#f59e0b' },
  infinite:  { label: 'Infinite Growth', icon: Infinity, color: '#10b981' },
  other:     { label: 'Other',      icon: Sparkles,  color: '#8b5cf6' },
};

const CATEGORIES = ['gun', 'spaceship', 'math', 'infinite', 'other'] as const;

const PatternSelector = ({ open, onOpenChange, onSelect }: PatternSelectorProps) => {
  const [loading, setLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const handleSelect = async (filename: string) => {
    setLoading(filename);
    try {
      const response = await fetch(`/patterns/${filename}`);
      const content = await response.text();
      onSelect(content);
    } catch (error) {
      console.error('Failed to load pattern:', error);
    } finally {
      setLoading(null);
    }
  };

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pattern Library</DialogTitle>
          <DialogDescription>
            Browse and load classic Conway&apos;s Game of Life patterns.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
            placeholder="Search patterns..."
          />
        </div>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-4 pr-3">
            {grouped.map(({ category, label, icon: Icon, color, patterns }) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-3.5 w-3.5" style={{ color }} />
                  <span className="text-xs font-medium uppercase tracking-wider" style={{ color }}>{label}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {patterns.map((pattern) => (
                    <button
                      key={pattern.file}
                      onClick={() => handleSelect(pattern.file)}
                      disabled={loading === pattern.file}
                      className="group relative text-left p-3 rounded-lg border border-border bg-card hover:bg-muted/50 hover:border-border/80 transition-all disabled:opacity-50"
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                          style={{ backgroundColor: `${color}15`, color }}
                        >
                          <Zap className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate group-hover:text-foreground transition-colors">
                            {loading === pattern.file ? 'Loading...' : pattern.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                            {pattern.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {grouped.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No patterns match your search</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default PatternSelector;
