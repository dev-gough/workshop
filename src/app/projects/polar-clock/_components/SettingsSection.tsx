'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// ── A drawer in the control desk ─────────────────────────────────
// Etched heading, a hairline running out to the edge of the plate, and
// the contents folded away underneath.
export function SettingsSection({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="group flex w-full cursor-pointer items-center gap-2.5"
      >
        <h3 className="pc-etch shrink-0 transition-colors group-hover:text-foreground">{title}</h3>
        <span
          className="h-px flex-1"
          style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--pc-verd) 40%, transparent), transparent)' }}
        />
        <motion.div animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-2.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
