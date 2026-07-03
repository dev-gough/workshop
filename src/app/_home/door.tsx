'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * A door off the hallway. Wraps one project tile with the link, the 3D
 * "door cracking open" hover, and the brass room-number plaque that
 * unifies every tile regardless of the theme rendered inside it.
 */
export function Door({ href, number, room, className = '', children }: {
  href: string;
  number: string;
  room: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`group block ${className}`}>
      <motion.article
        whileHover={{ rotateY: -3.5, scale: 1.012 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        style={{ transformPerspective: 900 }}
        className="hall-door relative h-full overflow-hidden rounded-lg border border-border bg-card"
      >
        {children}
        <div className="hall-plaque absolute bottom-2 left-2 z-10">
          <span className="opacity-55">{number}</span>
          <span>{room}</span>
        </div>
      </motion.article>
    </Link>
  );
}
