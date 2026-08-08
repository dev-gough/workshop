'use client';

// The one panel: bottom sheet with a thumb tab bar on phones, left panel on
// md+. Views register as tabs — a future Field tab (GPS/timing) is one more
// entry in `tabs` plus its component in the page's switch.

import type { ReactNode } from 'react';
import type { View } from '../_lib/model';

interface PanelShellProps {
  view: View;
  open: boolean; // mobile only; md+ ignores it
  tabs: { view: View; label: string }[];
  onSelectTab: (v: View) => void;
  children: ReactNode;
}

export default function PanelShell({ view, open, tabs, onSelectTab, children }: PanelShellProps) {
  return (
    <div className="pd-sheet absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-b-none md:inset-x-auto md:bottom-auto md:left-4 md:top-4 md:w-72 md:rounded-b-sm">
      <nav className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.view}
            onClick={() => onSelectTab(t.view)}
            className={`min-w-0 flex-1 py-2.5 text-center pd-etch transition-colors ${
              view === t.view ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="mx-auto block max-w-full truncate px-2">{t.label}</span>
          </button>
        ))}
      </nav>
      <div
        className={`${open ? 'block' : 'hidden'} max-h-[46vh] overflow-y-auto p-3 md:block md:max-h-[calc(100vh-57px-8rem)]`}
      >
        {children}
      </div>
    </div>
  );
}
