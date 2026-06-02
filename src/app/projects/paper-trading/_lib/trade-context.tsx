'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Side = 'buy' | 'sell';

interface Prefill {
  symbol?: string;
  side?: Side;
}

interface TradeContextValue {
  /** Whether the trade slide-over is open. */
  open: boolean;
  /** Symbol/side to seed the ticket with when opened from a holding row. */
  prefill: Prefill | null;
  /** Bumps on every successful order so views can refetch positions/equity. */
  version: number;
  openTrade: (prefill?: Prefill) => void;
  closeTrade: () => void;
  /** Called by the ticket after a filled/placed order. */
  notifyDone: () => void;
}

const TradeContext = createContext<TradeContextValue | null>(null);

export function TradeProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [version, setVersion] = useState(0);

  const openTrade = useCallback((p?: Prefill) => {
    setPrefill(p ?? null);
    setOpen(true);
  }, []);
  const closeTrade = useCallback(() => setOpen(false), []);
  const notifyDone = useCallback(() => setVersion((v) => v + 1), []);

  const value = useMemo(
    () => ({ open, prefill, version, openTrade, closeTrade, notifyDone }),
    [open, prefill, version, openTrade, closeTrade, notifyDone],
  );

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTrade(): TradeContextValue {
  const ctx = useContext(TradeContext);
  if (!ctx) throw new Error('useTrade must be used within TradeProvider');
  return ctx;
}
