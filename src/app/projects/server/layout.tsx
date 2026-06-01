'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { SyncCursorProvider, FloatingTimestampPill } from '@/components/charts/sync-cursor';

const SEGMENTS = [
  { href: '/projects/server/services', label: 'Services' },
  { href: '/projects/server/history',  label: 'History'  },
] as const;

export default function ServerLayout({ children }: { children: ReactNode }) {
  return (
    <SyncCursorProvider>
      <FloatingTimestampPill />
      <div className="cc-scope relative min-h-[calc(100vh-57px)]">
        <div className="p-4 sm:p-8">
          <div className="container mx-auto max-w-7xl relative">
            <ServerHeading />
            {children}
          </div>
        </div>
      </div>
    </SyncCursorProvider>
  );
}

function ServerHeading() {
  const pathname = usePathname();
  return (
    <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div className="flex items-end gap-4">
        <h1
          className="text-5xl sm:text-6xl italic leading-none tracking-tight"
          style={{
            fontFamily: 'var(--font-display), serif',
            color: 'var(--color-brand-maroon)',
            fontVariationSettings: '"SOFT" 100',
            textShadow: '0 0 26px color-mix(in srgb, var(--color-brand-maroon) 25%, transparent)',
          }}
        >
          Server
        </h1>
        <div className="hidden sm:flex flex-col gap-1 pb-1">
          <div className="flex items-center gap-2">
            <span className="cc-led cc-led-ok cc-led-pulse" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-[color:var(--cc-dim)]">
              telemetry &amp; control
            </span>
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-[color:var(--cc-muted)] tabular-nums">
            mode · nominal · realtime
          </div>
        </div>
      </div>
      <SegmentedNav pathname={pathname} />
    </header>
  );
}

function SegmentedNav({ pathname }: { pathname: string }) {
  return (
    <nav
      role="tablist"
      className="relative inline-flex rounded-lg border border-border/50 bg-card/60 backdrop-blur-sm p-1"
    >
      {SEGMENTS.map((seg) => {
        const isActive = pathname.startsWith(seg.href);
        return (
          <Link
            key={seg.href}
            href={seg.href}
            role="tab"
            aria-selected={isActive}
            className="relative isolate px-4 py-1.5 text-[11px] font-mono uppercase tracking-[0.2em] transition-colors"
            style={{ color: isActive ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)' }}
          >
            {isActive && (
              <motion.span
                layoutId="server-segmented-bg"
                className="absolute inset-0 -z-10 rounded-md bg-primary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-brand-maroon)_30%,transparent)]"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            )}
            {seg.label}
          </Link>
        );
      })}
    </nav>
  );
}
