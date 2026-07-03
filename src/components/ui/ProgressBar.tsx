'use client';

import { motion } from 'motion/react';

/**
 * Thin animated progress bar extracted from the jellyfin and soulseek pages.
 *
 * `percent` is a 0–100 percentage (soulseek's convention). The jellyfin copy
 * passed a 0–1 fraction and multiplied inline — that caller should pass
 * `fraction * 100` when it migrates.
 */
export function ProgressBar({
  percent,
  color = 'bg-blue-500',
}: {
  percent: number;
  color?: string;
}) {
  return (
    <div className="h-1 bg-muted/60 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(percent, 100)}%` }}
        transition={{ duration: 0.3 }}
      />
    </div>
  );
}
