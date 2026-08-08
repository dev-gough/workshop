'use client';

// TRIPS view: the logbook — every trip across every park, filterable by
// park / year / length. Opening a trip switches parks automatically when
// needed (the trip domain re-snaps its waypoints). Future: inReach track
// badges, photo counts, actual-vs-estimate times per trip.

import { useMemo, useState } from 'react';
import { fmtKm, type ParkInfo, type TripSummary } from '../_lib/model';
import { fmtHours } from '../_lib/route';

type DistBucket = 'all' | 'short' | 'mid' | 'long';
const DIST_LABEL: Record<DistBucket, string> = {
  all: 'any length',
  short: '< 25 km',
  mid: '25–50 km',
  long: '50+ km',
};

function distBucket(t: TripSummary): DistBucket | null {
  if (!t.stats) return null;
  const km = (t.stats.paddleM + t.stats.portageM) / 1000;
  return km < 25 ? 'short' : km < 50 ? 'mid' : 'long';
}

interface TripsPanelProps {
  parks: ParkInfo[] | null;
  trips: TripSummary[] | null;
  activeSlug: string | null;
  onNew: () => void;
  onLoad: (slug: string) => void;
  onDelete: (slug: string, name: string) => void;
}

const selectClass =
  'min-w-0 rounded-sm border border-border bg-transparent px-1 py-1 text-[11px] text-muted-foreground';

export default function TripsPanel({ parks, trips, activeSlug, onNew, onLoad, onDelete }: TripsPanelProps) {
  const [fPark, setFPark] = useState('all');
  const [fYear, setFYear] = useState('all');
  const [fDist, setFDist] = useState<DistBucket>('all');

  const parkName = (slug: string) => parks?.find((p) => p.slug === slug)?.name ?? slug;
  const years = useMemo(
    () =>
      [...new Set((trips ?? []).map((t) => new Date(t.updated_at).getFullYear()))].sort((a, b) => b - a),
    [trips],
  );
  const filtered = useMemo(
    () =>
      (trips ?? []).filter(
        (t) =>
          (fPark === 'all' || t.park === fPark) &&
          (fYear === 'all' || new Date(t.updated_at).getFullYear() === Number(fYear)) &&
          (fDist === 'all' || distBucket(t) === fDist),
      ),
    [trips, fPark, fYear, fDist],
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="pd-etch">Logbook</p>
        <button onClick={onNew} className="rounded-sm border border-primary px-2.5 py-1 text-xs text-primary">
          + new trip
        </button>
      </div>

      <div className="mt-2 flex gap-1.5">
        <select value={fPark} onChange={(e) => setFPark(e.target.value)} className={`${selectClass} flex-1`} aria-label="Filter by park">
          <option value="all">all parks</option>
          {(parks ?? []).map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={fYear} onChange={(e) => setFYear(e.target.value)} className={selectClass} aria-label="Filter by year">
          <option value="all">any year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={fDist}
          onChange={(e) => setFDist(e.target.value as DistBucket)}
          className={selectClass}
          aria-label="Filter by length"
        >
          {(Object.keys(DIST_LABEL) as DistBucket[]).map((k) => (
            <option key={k} value={k}>
              {DIST_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {trips === null ? (
        <p className="mt-3 text-[11px] text-muted-foreground">opening the logbook…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {trips.length === 0 ? 'No trips yet — plot one and save it.' : 'Nothing matches those filters.'}
        </p>
      ) : (
        <div className="mt-2 space-y-1">
          {filtered.map((t) => (
            <div
              key={t.slug}
              className={`rounded-sm border px-2.5 py-1.5 ${t.slug === activeSlug ? 'border-primary' : 'border-border'}`}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onLoad(t.slug)}
                  className="min-w-0 flex-1 truncate text-left text-xs hover:text-primary"
                >
                  {t.name}
                </button>
                <button
                  onClick={() => onDelete(t.slug, t.name)}
                  title="Delete trip"
                  className="shrink-0 rounded-sm border border-border px-1.5 text-xs leading-5 text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
              <p className="pd-readout mt-0.5 truncate text-[10px] text-muted-foreground">
                {parkName(t.park)}
                {' · '}
                {t.stats
                  ? `${fmtKm(t.stats.paddleM + t.stats.portageM)} · ${t.stats.carries} carries · ${fmtHours(t.stats.timeH)}${t.stats.days > 1 ? ` · ${t.stats.days} days` : ''}`
                  : `${t.waypoints} waypoints`}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
