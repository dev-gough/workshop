'use client';

// TRIP view: the active ledger — name/save/share, cost params, totals,
// waypoints with day-ends, per-day itinerary, GPX. Future: leg timing
// buttons (underway/landed) and photo strip render alongside the ledger,
// all fed by the use-trip-plan hook.

import { fmtKm, fmtLatLon } from '../_lib/model';
import { fmtHours } from '../_lib/route';
import type { TripPlan } from '../_lib/use-trip-plan';

export default function TripPanel({ plan }: { plan: TripPlan }) {
  const { waypoints, totals, days, legs, cost } = plan;
  return (
    <>
      <div className="flex gap-1.5">
        <input
          value={plan.tripName}
          onChange={(e) => plan.setTripName(e.target.value)}
          placeholder="trip name"
          maxLength={80}
          className="min-w-0 flex-1 rounded-sm border border-border bg-transparent px-2 py-1 text-xs placeholder:text-muted-foreground"
        />
        <button
          onClick={() => void plan.saveTrip()}
          disabled={!waypoints.length}
          className={`rounded-sm border px-2.5 py-1 text-xs ${
            waypoints.length
              ? 'border-primary text-primary'
              : 'cursor-default border-border text-muted-foreground opacity-60'
          }`}
        >
          save
        </button>
      </div>
      {plan.tripSlug && (
        <button
          onClick={plan.copyShareLink}
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
          title="Copy a link that opens this trip"
        >
          share · ?trip={plan.tripSlug}
        </button>
      )}

      {waypoints.length === 0 && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Tap the map to drop waypoints along your route. Shift-click copies coordinates instead.
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>paddle</span>
        <input
          type="number"
          min={1}
          max={12}
          step={0.5}
          value={cost.paddleKmh}
          onChange={(e) => plan.setCost((c) => ({ ...c, paddleKmh: Math.max(1, Number(e.target.value) || 1) }))}
          className="pd-readout w-12 rounded-sm border border-border bg-transparent px-1 py-0.5 text-right text-xs"
          aria-label="Paddling speed km/h"
        />
        <span>· walk</span>
        <input
          type="number"
          min={1}
          max={8}
          step={0.5}
          value={cost.walkKmh}
          onChange={(e) => plan.setCost((c) => ({ ...c, walkKmh: Math.max(1, Number(e.target.value) || 1) }))}
          className="pd-readout w-12 rounded-sm border border-border bg-transparent px-1 py-0.5 text-right text-xs"
          aria-label="Walking speed km/h"
        />
        <span>km/h</span>
        <button
          onClick={() => plan.setCost((c) => ({ ...c, doubleCarry: !c.doubleCarry }))}
          className={`ml-auto rounded-sm border px-2 py-1 text-xs transition-colors ${
            cost.doubleCarry ? 'border-primary text-primary' : 'border-border'
          }`}
          title="Double-carrying walks every portage three times"
        >
          {cost.doubleCarry ? '×3' : '×1'}
        </button>
      </div>

      {legs.length > 0 && (
        <dl className="mt-2.5 space-y-1 border-t border-border pt-2">
          <div className="flex items-baseline justify-between">
            <dt className="text-[11px] text-muted-foreground">Paddling</dt>
            <dd className="pd-readout text-xs" style={{ color: 'var(--pd-blue)' }}>
              {fmtKm(totals.paddleM)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-[11px] text-muted-foreground">
              Carrying · {totals.carries} {totals.carries === 1 ? 'carry' : 'carries'}
            </dt>
            <dd className="pd-readout text-xs" style={{ color: 'var(--pd-red)' }}>
              {fmtKm(totals.portageM)}
            </dd>
          </div>
          {totals.trackM > 0 && (
            <div className="flex items-baseline justify-between">
              <dt className="text-[11px] text-muted-foreground">of it on tracks</dt>
              <dd className="pd-readout text-xs" style={{ color: 'var(--pd-track)' }}>
                {fmtKm(totals.trackM)}
              </dd>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <dt className="text-[11px] text-muted-foreground">Underway</dt>
            <dd className="pd-readout text-xs">{fmtHours(totals.timeH)}</dd>
          </div>
        </dl>
      )}
      {totals.unreachable > 0 && (
        <p className="mt-1.5 text-[10px]" style={{ color: 'var(--pd-red)' }}>
          {totals.unreachable} {totals.unreachable === 1 ? 'leg has' : 'legs have'} no connecting route —
          the network is split there.
        </p>
      )}

      {waypoints.length > 0 && (
        <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
          {waypoints.map((wp, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              <span className="pd-readout w-4 shrink-0 text-right">{i + 1}</span>
              <span className="pd-readout min-w-0 flex-1 truncate text-muted-foreground">
                {fmtLatLon(wp.snap.point)}
              </span>
              <button
                onClick={() => plan.toggleDayEnd(i)}
                title="End the day here"
                className={`rounded-sm border px-1.5 py-0.5 leading-4 transition-colors ${
                  wp.dayEnd ? 'border-primary text-primary' : 'border-border text-muted-foreground'
                }`}
              >
                ◗
              </button>
              <button
                onClick={() => plan.removeWaypoint(i)}
                title="Remove waypoint"
                className="rounded-sm border border-border px-1.5 py-0.5 leading-4 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {days.length > 1 && (
        <div className="mt-2 space-y-0.5 border-t border-border pt-2">
          {days.map((d, i) => (
            <p key={i} className="flex items-baseline justify-between text-[10px]">
              <span className="pd-etch">Day {i + 1}</span>
              <span className="pd-readout text-muted-foreground">
                {fmtKm(d.paddleM + d.portageM)} · {d.carries} {d.carries === 1 ? 'carry' : 'carries'} ·{' '}
                {fmtHours(d.timeH)}
              </span>
            </p>
          ))}
        </div>
      )}

      {waypoints.length > 0 && (
        <div className="mt-2.5 flex gap-1.5">
          <button
            onClick={plan.undoWaypoint}
            className="rounded-sm border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            undo
          </button>
          <button
            onClick={plan.clearWaypoints}
            className="rounded-sm border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            clear
          </button>
          {legs.length > 0 && totals.unreachable === 0 && (
            <button
              onClick={plan.exportGpx}
              className="ml-auto rounded-sm border border-primary px-2.5 py-1 text-xs text-primary"
            >
              GPX ↓
            </button>
          )}
        </div>
      )}
    </>
  );
}
