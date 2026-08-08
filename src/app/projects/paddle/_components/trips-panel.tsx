'use client';

// TRIPS view: the logbook. Saved trips as cards with their stats; tap to
// revisit one (loads + lights its path). Future: inReach track badges,
// photo counts, actual-vs-estimate times per trip.

import { fmtKm, type TripSummary } from '../_lib/model';
import { fmtHours } from '../_lib/route';

interface TripsPanelProps {
  parkName: string | undefined;
  trips: TripSummary[] | null;
  activeSlug: string | null;
  onNew: () => void;
  onLoad: (slug: string) => void;
  onDelete: (slug: string, name: string) => void;
}

export default function TripsPanel({ parkName, trips, activeSlug, onNew, onLoad, onDelete }: TripsPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="pd-etch">Logbook · {parkName}</p>
        <button onClick={onNew} className="rounded-sm border border-primary px-2.5 py-1 text-xs text-primary">
          + new trip
        </button>
      </div>
      {trips === null ? (
        <p className="mt-3 text-[11px] text-muted-foreground">opening the logbook…</p>
      ) : trips.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">No trips yet — plot one and save it.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {trips.map((t) => (
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
              <p className="pd-readout mt-0.5 text-[10px] text-muted-foreground">
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
