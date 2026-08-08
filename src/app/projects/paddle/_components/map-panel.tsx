'use client';

// MAP view: park identity + picker, network stats, legend, and the layer
// controls (chart, terrain). Future layer toggles (tracks, photos) go here.

import type { ParkInfo } from '../_lib/model';

interface MapPanelProps {
  parks: ParkInfo[] | null;
  park: string;
  setPark: (slug: string) => void;
  current: ParkInfo | null;
  showChart: boolean;
  setShowChart: (fn: (v: boolean) => boolean) => void;
  showRelief: boolean;
  setShowRelief: (fn: (v: boolean) => boolean) => void;
  reliefScale: number;
  setReliefScale: (v: number) => void;
}

export default function MapPanel({
  parks,
  park,
  setPark,
  current,
  showChart,
  setShowChart,
  showRelief,
  setShowRelief,
  reliefScale,
  setReliefScale,
}: MapPanelProps) {
  const stats = current?.stats ?? null;
  return (
    <>
      <p className="pd-etch">RM 18 · The Outfitter</p>
      <h1 className="ws-serif mt-0.5 text-xl font-semibold leading-tight">
        {current?.name ?? 'Paddle Planner'}
      </h1>
      {parks && parks.length > 1 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {parks.map((p) => (
            <button
              key={p.slug}
              onClick={() => setPark(p.slug)}
              className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
                p.slug === park
                  ? 'border-primary text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {stats && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-2.5">
          <div className="flex items-baseline justify-between">
            <dt className="text-[11px] text-muted-foreground">Water</dt>
            <dd className="pd-readout text-xs" style={{ color: 'var(--pd-blue)' }}>
              {Math.round(stats.paddleKm).toLocaleString()} km
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[11px] text-muted-foreground">Portage</dt>
            <dd className="pd-readout text-xs" style={{ color: 'var(--pd-red)' }}>
              {Math.round(stats.portageKm).toLocaleString()} km
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[11px] text-muted-foreground">Carries</dt>
            <dd className="pd-readout text-xs">{stats.portages.toLocaleString()}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[11px] text-muted-foreground">Campsites</dt>
            <dd className="pd-readout text-xs">{current?.campsites.toLocaleString()}</dd>
          </div>
        </dl>
      )}

      <div className="mt-3 space-y-1 border-t border-border pt-2.5 text-[11px] text-muted-foreground">
        <p>
          <span className="pd-ribbon mr-2" style={{ color: 'var(--pd-blue)' }} /> paddling
          <span className="pd-ribbon ml-4 mr-2" style={{ color: 'var(--pd-red)' }} /> portage
          <span className="pd-ribbon ml-4 mr-2" style={{ color: 'var(--pd-track)' }} /> track
        </p>
      </div>

      {current?.chart && (
        <button
          onClick={() => setShowChart((v) => !v)}
          className="mt-3 flex w-full items-center justify-between border-t border-border pt-2.5 text-left"
          title={current.chart.attribution}
        >
          <span className="pd-etch">Jeff&rsquo;s chart</span>
          <span
            className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
              showChart ? 'border-primary text-primary' : 'border-border text-muted-foreground'
            }`}
          >
            {showChart ? 'unrolled' : 'rolled up'}
          </span>
        </button>
      )}

      {current?.dem && (
        <div className="mt-2.5">
          <button
            onClick={() => setShowRelief((v) => !v)}
            className="flex w-full items-center justify-between text-left"
            title="Right-click / two-finger drag to tilt"
          >
            <span className="pd-etch">Terrain</span>
            <span
              className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
                showRelief ? 'border-primary text-primary' : 'border-border text-muted-foreground'
              }`}
            >
              {showRelief ? 'in relief' : 'pressed flat'}
            </span>
          </button>
          {showRelief && (
            <div className="mt-2 flex items-center gap-2" title="Vertical exaggeration — ×1 is true scale">
              <input
                type="range"
                min={1}
                max={4}
                step={0.25}
                value={reliefScale}
                onChange={(e) => setReliefScale(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer"
                style={{ accentColor: 'var(--color-primary)' }}
                aria-label="Relief exaggeration"
              />
              <span className="pd-readout w-10 shrink-0 text-right text-[11px]">×{reliefScale}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
