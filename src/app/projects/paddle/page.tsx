'use client';

// RM 18 home — a night of park cards. Outline + name, hover lifts the
// plate, click unrolls that chart. Built to grow as Ontario parks join.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useHeaderConfig } from '@/components/header-config';
import type { ParkOutline } from './_lib/model';
import { LAST_PARK_KEY } from './_lib/model';
import ParkOutlineSvg from './_components/park-outline';

function ParkCard({ park, last, delay }: { park: ParkOutline; last: boolean; delay: number }) {
  const reduce = useReducedMotion();
  const enter = () => {
    try {
      localStorage.setItem(LAST_PARK_KEY, park.slug);
    } catch {
      /* resume is best-effort */
    }
  };

  return (
    <FadeIn delay={delay}>
      <motion.div
        whileHover={reduce ? undefined : { y: -3 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      >
        <Link
          href="/projects/paddle/map"
          onClick={enter}
          className={`pd-park-card group block ${last ? 'is-last' : ''}`}
        >
          <h2 className="pd-park-name">{park.name}</h2>
          <div className="aspect-[3/4] px-6 pb-7">
            <ParkOutlineSvg park={park} />
          </div>
        </Link>
      </motion.div>
    </FadeIn>
  );
}

export default function OutfitterHome() {
  useHeaderConfig({ scopeClass: 'pd-theme pd-radar' });
  const router = useRouter();
  const [parks, setParks] = useState<ParkOutline[] | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trip = new URLSearchParams(window.location.search).get('trip');
    if (trip) router.replace(`/projects/paddle/map?trip=${encodeURIComponent(trip)}`);
  }, [router]);

  useEffect(() => {
    try {
      setLast(localStorage.getItem(LAST_PARK_KEY));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch('/api/paddle/atlas')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setParks(d.parks as ParkOutline[]);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <PageTransition>
      <div className="pd-theme pd-radar pd-room overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="pd-etch">RM 18 · The Outfitter</p>
          {error ? (
            <p className="mt-8 text-sm text-muted-foreground">radar dark — {error}</p>
          ) : parks === null ? (
            <p className="pd-etch mt-8">unrolling the cards…</p>
          ) : parks.length === 0 ? (
            <p className="mt-8 text-sm text-muted-foreground">No parks ingested yet.</p>
          ) : (
            <div
              className={`mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 ${parks.length >= 3 ? 'lg:grid-cols-3' : ''}`}
            >
              {parks.map((p, i) => (
                <ParkCard key={p.slug} park={p} last={p.slug === last} delay={0.05 * i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
