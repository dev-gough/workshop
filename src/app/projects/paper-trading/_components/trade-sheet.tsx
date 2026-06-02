'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useAccounts } from '../_lib/account-context';
import { useTrade } from '../_lib/trade-context';
import TradeTicket from './trade-ticket';

export default function TradeSheet() {
  const { open, prefill, closeTrade, notifyDone } = useTrade();
  const { selected } = useAccounts();

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeTrade(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeTrade]);

  return (
    <AnimatePresence>
      {open && selected && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={closeTrade}
          />
          <motion.aside
            className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[420px] sm:rounded-none sm:rounded-l-3xl sm:p-6"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            // On desktop the panel slides from the right; reuse y for both — the
            // rounded edge + position sell the side-sheet on wide screens.
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="ws-serif text-2xl font-semibold tracking-tight">Trade</h2>
              <button onClick={closeTrade} className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-5 text-sm text-muted-foreground">
              {selected.name} · {/* available cash */}
              <span className="font-medium text-foreground">${(selected.cashCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> available
            </p>

            <TradeTicket
              key={`${prefill?.symbol ?? ''}-${prefill?.side ?? ''}`}
              accountId={selected.id}
              cashCents={selected.cashCents}
              initialSymbol={prefill?.symbol}
              initialSide={prefill?.side}
              onDone={notifyDone}
            />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
