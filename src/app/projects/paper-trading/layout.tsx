'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Settings2, ChevronDown } from 'lucide-react';
import { AccountProvider, useAccounts } from './_lib/account-context';
import { isMarketOpen } from '@/lib/market';
import ManageAccounts from './_components/manage-accounts';

const TABS = [
  { href: '/projects/paper-trading', label: 'Portfolio' },
  { href: '/projects/paper-trading/orders', label: 'Orders' },
  { href: '/projects/paper-trading/history', label: 'History' },
] as const;

export default function PaperTradingLayout({ children }: { children: ReactNode }) {
  return (
    <AccountProvider>
      <div className="min-h-[calc(100vh-57px)]">
        <div className="p-4 sm:p-8">
          <div className="container mx-auto max-w-6xl">
            <Header />
            {children}
          </div>
        </div>
      </div>
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
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
      <span className={`h-2 w-2 rounded-full ${open ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50'}`} />
      <span className={open ? 'text-emerald-500' : 'text-muted-foreground'}>{open ? 'Market open' : 'Market closed'}</span>
    </span>
  );
}

function Header() {
  const pathname = usePathname();
  const { accounts, selected, select } = useAccounts();
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <header className="mb-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Paper Trading</h1>
          <MarketStatus />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={selected?.id ?? ''}
              onChange={(e) => select(Number(e.target.value))}
              className="appearance-none rounded-lg border border-border bg-card py-2 pl-3 pr-9 text-sm font-medium outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              disabled={accounts.length === 0}
            >
              {accounts.length === 0 && <option value="">No accounts</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <button
            onClick={() => setManageOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted/50"
          >
            <Settings2 className="h-4 w-4" /> Manage
          </button>
        </div>
      </div>

      <nav className="relative inline-flex rounded-lg border border-border bg-card/60 p-1">
        {TABS.map((tab) => {
          const active = tab.href === '/projects/paper-trading'
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} className="relative isolate px-4 py-1.5 text-sm font-medium transition-colors"
              style={{ color: active ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)' }}>
              {active && (
                <motion.span layoutId="pt-tab-bg" className="absolute inset-0 -z-10 rounded-md bg-primary"
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }} />
              )}
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <ManageAccounts open={manageOpen} onClose={() => setManageOpen(false)} />
    </header>
  );
}
