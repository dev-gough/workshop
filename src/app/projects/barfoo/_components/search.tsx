'use client';

// The card catalogue — fuzzy search over artists, albums and songs.
// The matching engine is unchanged from the old page; only the counter
// it sits on is new.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Clock, Music, Play, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAudio } from '@/components/AudioProvider';
import { cleanSongDisplay } from '@/lib/songUtils';

interface SearchEntry {
  type: 'artist' | 'album' | 'song';
  label: string;
  sub: string;
  albumIndex: number;
  songIndex?: number;
  tokens: string[];
}

// Check if two strings are within edit distance 1
function editDist1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let diffs = 0;
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) diffs++; if (diffs > 1) return false; }
    return diffs === 1;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let si = 0;
  for (let li = 0; li < longer.length; li++) {
    if (shorter[si] === longer[li]) si++;
    else { diffs++; if (diffs > 1) return false; }
  }
  return true;
}

function fuzzyMatch(entryTokens: string[], queryTokens: string[]): number {
  let score = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const et of entryTokens) {
      if (et === qt) { best = Math.max(best, 3); }
      else if (et.startsWith(qt)) { best = Math.max(best, 2); }
      else if (qt.length >= 3 && et.includes(qt)) { best = Math.max(best, 1); }
      else if (qt.length >= 3 && editDist1(et, qt)) { best = Math.max(best, 1); }
    }
    if (best === 0) return 0; // every query token must land somewhere
    score += best;
  }
  return score;
}

export function SearchBox({ onOpenAlbum, onOpenArtist }: {
  onOpenAlbum: (index: number) => void;
  onOpenArtist: (artist: string) => void;
}) {
  const { albums, playTrack } = useAudio();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('barfoo_recent_searches') || '[]'); } catch { return []; }
  });
  const addRecent = useCallback((q: string) => {
    setRecent(prev => {
      const next = [q, ...prev.filter(s => s !== q)].slice(0, 8);
      localStorage.setItem('barfoo_recent_searches', JSON.stringify(next));
      return next;
    });
  }, []);

  const index = useMemo(() => {
    if (!albums.length) return [] as SearchEntry[];
    const entries: SearchEntry[] = [];
    const seenArtists = new Set<string>();
    albums.forEach((album, ai) => {
      if (!seenArtists.has(album.artist.toLowerCase())) {
        seenArtists.add(album.artist.toLowerCase());
        entries.push({ type: 'artist', label: album.artist, sub: `${albums.filter(a => a.artist === album.artist).length} albums`, albumIndex: ai, tokens: album.artist.toLowerCase().split(/\s+/) });
      }
      entries.push({ type: 'album', label: album.name, sub: album.artist, albumIndex: ai, tokens: [...album.name.toLowerCase().split(/\s+/), ...album.artist.toLowerCase().split(/\s+/)] });
      album.songs.forEach((song, si) => {
        const clean = cleanSongDisplay(song, album.artist, album.name);
        entries.push({ type: 'song', label: clean, sub: `${album.artist} — ${album.name}`, albumIndex: ai, songIndex: si, tokens: [...clean.toLowerCase().split(/\s+/), ...album.artist.toLowerCase().split(/\s+/)] });
      });
    });
    return entries;
  }, [albums]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const qTokens = q.split(/\s+/);
    return index
      .map(entry => ({ ...entry, score: fuzzyMatch(entry.tokens, qTokens) }))
      .filter(e => e.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const typeOrder = { artist: 0, album: 1, song: 2 };
        return typeOrder[a.type] - typeOrder[b.type];
      })
      .slice(0, 12);
  }, [query, index]);

  const dismiss = () => { setQuery(''); setFocused(false); inputRef.current?.blur(); };

  const open = useCallback((r: SearchEntry) => {
    addRecent(query.trim());
    if (r.type === 'song' && r.songIndex !== undefined) playTrack(r.albumIndex, r.songIndex);
    else if (r.type === 'artist') onOpenArtist(r.label);
    else onOpenAlbum(r.albumIndex);
    dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRecent, query, playTrack, onOpenArtist, onOpenAlbum]);

  if (albums.length === 0) return null;

  return (
    <>
      <div className="relative mx-4 hidden max-w-xs flex-1 sm:block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={e => {
            if (e.key === 'Escape') dismiss();
            if (e.key === 'Enter' && results.length > 0) open(results[0]);
          }}
          placeholder="Search the shelves…"
          className="w-full rounded-[4px] border border-border bg-muted/40 py-1.5 pl-8 pr-3 text-xs text-foreground transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <AnimatePresence>
          {focused && (results.length > 0 || (query.trim().length < 2 && recent.length > 0)) && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="bar-panel absolute top-full z-50 mt-1.5 w-80 overflow-hidden"
            >
              {query.trim().length < 2 && recent.length > 0 && (
                <div>
                  <div className="border-b border-border/60 px-3 py-1.5">
                    <span className="bar-etch">Recent</span>
                  </div>
                  {recent.map((q, i) => (
                    <button
                      key={i}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setQuery(q)}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-muted/60"
                    >
                      <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="text-xs text-foreground">{q}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-72 overflow-y-auto">
                {results.map((r, i) => (
                  <button
                    key={`${r.type}-${r.albumIndex}-${r.songIndex ?? ''}-${i}`}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => open(r)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-bold uppercase ${
                      r.type === 'artist' ? 'bg-primary/15 text-primary' :
                      r.type === 'album' ? 'bg-muted text-foreground/80' :
                      'bg-muted/60 text-muted-foreground'
                    }`}>
                      {r.type === 'artist' ? 'A' : r.type === 'album' ? 'LP' : <Music className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">{r.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{r.sub}</span>
                    </span>
                    {r.type === 'song' && <Play className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {focused && <div className="fixed inset-0 z-40" onClick={() => setFocused(false)} />}
    </>
  );
}
