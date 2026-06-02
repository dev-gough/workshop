'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Settings2, ChevronDown, ArrowLeftRight } from 'lucide-react';
import { AccountProvider, useAccounts } from './_lib/account-context';
import { TradeProvider, useTrade } from './_lib/trade-context';
import { useHeaderConfig } from '@/components/header-config';
import { isMarketOpen } from '@/lib/market';
import ManageAccounts from './_components/manage-accounts';
import TradeSheet from './_components/trade-sheet';

const TABS = [
  { href: '/projects/paper-trading', label: 'Portfolio' },
  { href: '/projects/paper-trading/orders', label: 'Orders' },
  { href: '/projects/paper-trading/history', label: 'History' },
] as const;

export default function PaperTradingLayout({ children }: { children: ReactNode }) {
  // Recolor + refont the global site header to match the Wealthsimple scope.
  useHeaderConfig({ scopeClass: 'ws-theme' });
  return (
    <AccountProvider>
      <TradeProvider>
        <div className="ws-theme min-h-[calc(100vh-57px)]">
          <div className="px-4 py-6 sm:px-8 sm:py-10">
            <div className="container mx-auto max-w-3xl">
              <Header />
              {children}
            </div>
          </div>
          <TradeSheet />
        </div>
      </TradeProvider>
    </AccountProvider>
  );
}

function MarketStatus() {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const tick = () => setOpen(isMarketOpen());
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  if (open == null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${open ? 'pt-bg-gain animate-pulse' : 'bg-muted-foreground/50'}`} />
      {open ? 'Markets open' : 'Markets closed'}
    </span>
  );
}

function Header() {
  const pathname = usePathname();
  const { accounts, selected, select } = useAccounts();
  const { openTrade } = useTrade();
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <header className="mb-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="ws-serif text-3xl font-semibold tracking-tight sm:text-4xl">Paper Trading</h1>
          <MarketStatus />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={selected?.id ?? ''}
              onChange={(e) => select(Number(e.target.value))}
              className="appearance-none rounded-full border border-border bg-card py-2 pl-4 pr-9 text-sm font-medium outline-none transition-colors hover:border-foreground/30 focus:border-foreground/40 disabled:opacity-50"
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 && <option value="">No accounts</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <button
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center justify-center rounded-full border border-border bg-card p-2.5 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            aria-label="Manage accounts"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => openTrade()}
            disabled={!selected}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowLeftRight className="h-4 w-4" /> Trade
          </button>
        </div>
      </div>

      <nav className="relative flex gap-6 border-b border-border">
        {TABS.map((tab) => {
          const active = tab.href === '/projects/paper-trading'
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href}
              className="relative -mb-px py-2.5 text-sm font-medium transition-colors"
              style={{ color: active ? 'var(--color-foreground)' : 'var(--color-muted-foreground)' }}>
              {tab.label}
              {active && (
                <motion.span layoutId="pt-tab-underline" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
              )}
            </Link>
          );
        })}
      </nav>

      <ManageAccounts open={manageOpen} onClose={() => setManageOpen(false)} />
    </header>
  );
}
