'use client';

// The surveyor's readout — follows the cursor on desktop, docks above the
// bottom sheet on phones, and carries transient flashes (copies, snap
// misses, trip loads). GPS position/heading will render here in field mode.

import { fmtKm, fmtLatLon, type HoverInfo } from '../_lib/model';

export interface Flash {
  text: string;
  tone: 'ok' | 'warn';
}

interface ReadoutProps {
  hover: HoverInfo | null;
  flash: Flash | null;
  planning: boolean;
  panelOpen: boolean;
}

export default function Readout({ hover, flash, planning, panelOpen }: ReadoutProps) {
  return (
    <div
      className={`pd-sheet pointer-events-none absolute left-3 z-10 min-w-44 px-3 py-2 md:bottom-10 md:left-auto md:right-4 ${
        panelOpen ? 'hidden md:block' : 'bottom-[3.4rem]'
      }`}
    >
      {hover?.type === 'segment' ? (
        <p className="text-[11px]">
          <span
            className="pd-etch"
            style={{
              color:
                hover.kind === 'portage'
                  ? 'var(--pd-red)'
                  : hover.kind === 'track'
                    ? 'var(--pd-track)'
                    : 'var(--pd-blue)',
            }}
          >
            {hover.kind === 'portage' ? 'Portage' : hover.kind === 'track' ? 'Track' : 'Paddle'}
          </span>
          <span className="pd-readout ml-2">{fmtKm(hover.lengthM)}</span>
          {hover.elevM != null && (
            <span className="pd-readout ml-2 text-muted-foreground">{Math.round(hover.elevM)} m ASL</span>
          )}
        </p>
      ) : hover?.type === 'lake' ? (
        <p className="truncate text-[11px]">
          <span className="pd-etch">Lake</span>
          <span className="ml-2">{hover.name ?? 'unnamed'}</span>
          <span className="pd-readout ml-2 text-muted-foreground">
            {hover.areaM2 >= 1_000_000
              ? `${(hover.areaM2 / 1_000_000).toFixed(1)} km²`
              : `${Math.round(hover.areaM2 / 10_000)} ha`}
          </span>
        </p>
      ) : hover?.type === 'campsite' ? (
        <p className="truncate text-[11px]">
          <span className="pd-etch" style={{ color: 'var(--color-brand-maroon)' }}>
            Campsite
          </span>
          <span className="ml-2">{hover.name ?? 'unnamed'}</span>
        </p>
      ) : hover?.type === 'ground' ? (
        <p className="text-[11px]">
          <span className="pd-etch">Ground</span>
          {hover.elevM != null && <span className="pd-readout ml-2">{Math.round(hover.elevM)} m ASL</span>}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {planning ? 'tap the map to drop waypoints' : 'The Outfitter'}
        </p>
      )}
      {flash ? (
        <p className="mt-0.5 text-[10px]">
          <span
            className="pd-etch"
            style={{ color: flash.tone === 'ok' ? 'var(--color-primary)' : 'var(--color-destructive, #b0402c)' }}
          >
            {flash.text}
          </span>
        </p>
      ) : hover ? (
        <p className="pd-readout mt-0.5 hidden text-[10px] text-muted-foreground md:block">
          {fmtLatLon(hover.lngLat)}
          {planning ? ' · click to drop a waypoint' : ' · click to copy'}
        </p>
      ) : null}
    </div>
  );
}
