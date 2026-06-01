'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef, type ReactNode } from 'react';

interface SyncCursorState {
  activeTs: number | null;            // unix seconds; null when no chart is hovered
  setActiveTs: (ts: number | null) => void;
}

const SyncCursorCtx = createContext<SyncCursorState | null>(null);

export function SyncCursorProvider({ children }: { children: ReactNode }) {
  const [activeTs, setActiveTsState] = useState<number | null>(null);
  // Debounce null-set by one frame so brief gaps between charts don't flicker the pill.
  const clearRaf = useRef<number | null>(null);
  const setActiveTs = useCallback((ts: number | null) => {
    if (ts == null) {
      if (clearRaf.current != null) cancelAnimationFrame(clearRaf.current);
      clearRaf.current = requestAnimationFrame(() => { setActiveTsState(null); clearRaf.current = null; });
    } else {
      if (clearRaf.current != null) { cancelAnimationFrame(clearRaf.current); clearRaf.current = null; }
      setActiveTsState(ts);
    }
  }, []);
  const value = useMemo(() => ({ activeTs, setActiveTs }), [activeTs, setActiveTs]);
  return <SyncCursorCtx.Provider value={value}>{children}</SyncCursorCtx.Provider>;
}

export function useSyncCursor(): SyncCursorState {
  const v = useContext(SyncCursorCtx);
  if (!v) throw new Error('useSyncCursor must be used inside <SyncCursorProvider>');
  return v;
}

/**
 * Floating pill that follows the mouse along the top of the viewport while a
 * chart is being hovered. Subscribes to SyncCursorProvider state.
 */
export function FloatingTimestampPill() {
  const { activeTs } = useSyncCursor();
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (activeTs == null) { setMouse(null); return; }
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [activeTs]);

  if (activeTs == null || mouse == null) return null;
  const date = new Date(activeTs * 1000);
  const iso = date.toISOString().replace('T', ' ').slice(0, 19);

  // Offset from cursor; flip sides when near the viewport edges so the pill
  // never sits under the cursor or runs off-screen.
  const OFFSET = 14;
  const W = 180; // rough max width incl. padding
  const H = 26;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const flipX = mouse.x + OFFSET + W > vw;
  const flipY = mouse.y + OFFSET + H > vh;
  const left = flipX ? mouse.x - OFFSET - W : mouse.x + OFFSET;
  const top  = flipY ? mouse.y - OFFSET - H : mouse.y + OFFSET;

  return (
    <div
      className="pointer-events-none fixed z-50 px-2.5 py-1 rounded-md bg-card/95 backdrop-blur border border-border/60 font-mono text-xs tabular-nums text-foreground shadow-lg"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      {iso}
    </div>
  );
}
