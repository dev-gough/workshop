'use client';

// RM 18, The Outfitter — the map table at a canoe outfitter's. The whole
// room is one chart under the header: the ingested Ontario network painted
// on paper, with a pinned trip sheet (stats, legend, parks) and a
// surveyor's readout that follows the cursor. Route planning happens on
// this same table: drop waypoints, and the sheet keeps the ledger — legs,
// carries, day splits, and a GPX to take with you.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import { fmtKm, fmtLatLon, type HoverInfo, type Network, type ParkInfo } from './_lib/model';
import { DEFAULT_COST, fmtHours, toGpx, TripRouter, type CostParams, type Leg, type Snap } from './_lib/route';

const TripMap = dynamic(() => import('./_components/trip-map'), { ssr: false });

const LAKE_MIN_AREA = 10_000; // m² — fades sub-hectare off-route ponds out of the chart
const SNAP_MAX_M = 300;

interface Waypoint {
  snap: Snap;
  dayEnd: boolean;
}

interface TripSummary {
  slug: string;
  name: string;
  waypoints: number;
  updated_at: string;
}

/** Persisted trip: geometry only — waypoints re-snap to the current network
 *  on load, so saved trips survive re-ingests. */
interface TripData {
  park: string;
  slug: string;
  name: string;
  waypoints: [number, number, number][];
  cost: Partial<CostParams>;
}

/**
 * navigator.clipboard only exists in secure contexts — over plain LAN HTTP
 * (or with a browser shield blocking it) it is undefined and the write
 * silently never happens. Fall back to the deprecated-but-working
 * execCommand path, and report honestly whether either took.
 */
async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* blocked — try the legacy path */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function PaddlePage() {
  useHeaderConfig({ scopeClass: 'pd-theme' });

  const [parks, setParks] = useState<ParkInfo[] | null>(null);
  const [park, setPark] = useState<string>('temagami');
  const [lakes, setLakes] = useState<GeoJSON.FeatureCollection | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // The purchased paper chart starts unrolled on the table when a park has one.
  const [showChart, setShowChart] = useState(true);
  // Terrain starts pressed up in relief when the park's DEM is cached.
  const [showRelief, setShowRelief] = useState(true);
  // Vertical exaggeration — ×1 is true scale; the Shield's relief is real
  // but modest, so the default presses it up a little.
  const [reliefScale, setReliefScale] = useState(1.5);

  // ── route planning ──
  const [planning, setPlanning] = useState(false);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [cost, setCost] = useState<CostParams>(DEFAULT_COST);
  const [tripName, setTripName] = useState('');
  const [tripSlug, setTripSlug] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripSummary[] | null>(null);

  useEffect(() => {
    fetch('/api/paddle/parks')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setParks(d.parks);
        if (d.parks.length && !d.parks.some((p: ParkInfo) => p.slug === 'temagami')) {
          setPark(d.parks[0].slug);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let stale = false;
    setLakes(null);
    setNetwork(null);
    setWaypoints([]); // snaps index into the old park's segments
    setTripSlug(null);
    setTripName('');
    Promise.all([
      fetch(`/api/paddle/lakes?park=${park}&minArea=${LAKE_MIN_AREA}`).then((r) => r.json()),
      fetch(`/api/paddle/network?park=${park}`).then((r) => r.json()),
    ])
      .then(([lakesRes, netRes]) => {
        if (stale) return;
        if (lakesRes.error) throw new Error(lakesRes.error);
        if (netRes.error) throw new Error(netRes.error);
        setLakes(lakesRes);
        setNetwork(netRes);
      })
      .catch((e) => !stale && setError(String(e)));
    return () => {
      stale = true;
    };
  }, [park]);

  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);

  // Transient readout flash — copy confirmations, snap misses.
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((text: string, tone: 'ok' | 'warn', ms: number) => {
    setFlash({ text, tone });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }, []);

  const router = useMemo(() => (network ? new TripRouter(network) : null), [network]);
  const planningRef = useRef(planning);
  planningRef.current = planning;
  const routerRef = useRef(router);
  routerRef.current = router;

  const onMapClick = useCallback(
    (lngLat: [number, number], shiftKey: boolean) => {
      if (!planningRef.current || shiftKey) {
        const coords = `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`;
        void copyText(coords).then((ok) =>
          showFlash(ok ? `copied · ${coords}` : `clipboard blocked · ${coords}`, ok ? 'ok' : 'warn', ok ? 1800 : 6000),
        );
        return;
      }
      const snap = routerRef.current?.snap(lngLat, SNAP_MAX_M);
      if (!snap) {
        showFlash(`no route within ${SNAP_MAX_M} m`, 'warn', 2000);
        return;
      }
      setWaypoints((wps) => [...wps, { snap, dayEnd: false }]);
    },
    [showFlash],
  );

  // ── saved trips ──
  const parkRef = useRef(park);
  parkRef.current = park;
  const refreshTrips = useCallback(async () => {
    const d = await fetch(`/api/paddle/trips?park=${parkRef.current}`)
      .then((r) => r.json())
      .catch(() => null);
    if (d?.trips) setTrips(d.trips);
  }, []);
  useEffect(() => {
    if (planning) void refreshTrips();
  }, [planning, park, refreshTrips]);

  const pendingTrip = useRef<TripData | null>(null);
  const applyPending = useCallback(() => {
    const trip = pendingTrip.current;
    const r = routerRef.current;
    if (!trip || !r) return;
    pendingTrip.current = null;
    const wps: Waypoint[] = [];
    let missed = 0;
    for (const [lon, lat, dayEnd] of trip.waypoints) {
      const snap = r.snap([lon, lat], 400);
      if (snap) wps.push({ snap, dayEnd: !!dayEnd });
      else missed++;
    }
    setWaypoints(wps);
    setTripName(trip.name);
    setTripSlug(trip.slug);
    setCost((c) => ({ ...c, ...trip.cost }));
    setPlanning(true);
    showFlash(
      missed ? `trip loaded — ${missed} waypoint${missed > 1 ? 's' : ''} off-network` : `trip loaded · ${trip.name}`,
      missed ? 'warn' : 'ok',
      2500,
    );
  }, [showFlash]);
  useEffect(() => {
    applyPending();
  }, [router, applyPending]);

  const loadTrip = useCallback(
    async (slug: string) => {
      const d = await fetch(`/api/paddle/trips/${slug}`)
        .then((r) => r.json())
        .catch(() => null);
      if (!d?.trip) {
        showFlash('trip not found', 'warn', 2500);
        return;
      }
      pendingTrip.current = d.trip as TripData;
      if (d.trip.park !== parkRef.current) setPark(d.trip.park); // re-snap once the new park's router is up
      else applyPending();
    },
    [applyPending, showFlash],
  );

  // share links: /projects/paddle?trip=<slug>
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('trip');
    if (slug) void loadTrip(slug);
  }, [loadTrip]);

  const saveTrip = useCallback(async () => {
    if (!waypoints.length) return;
    const d = await fetch('/api/paddle/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        park,
        name: tripName.trim() || 'Untitled trip',
        slug: tripSlug ?? undefined,
        waypoints: waypoints.map((w) => [w.snap.point[0], w.snap.point[1], w.dayEnd ? 1 : 0]),
        cost,
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (d?.slug) {
      setTripSlug(d.slug);
      showFlash('trip saved', 'ok', 1800);
      void refreshTrips();
    } else {
      showFlash('save failed', 'warn', 2500);
    }
  }, [waypoints, park, tripName, tripSlug, cost, showFlash, refreshTrips]);

  const deleteTrip = useCallback(
    async (slug: string, name: string) => {
      if (!window.confirm(`Delete trip “${name}”?`)) return;
      await fetch(`/api/paddle/trips/${slug}`, { method: 'DELETE' }).catch(() => null);
      if (slug === tripSlug) setTripSlug(null);
      void refreshTrips();
    },
    [tripSlug, refreshTrips],
  );

  const copyShareLink = useCallback(() => {
    if (!tripSlug) return;
    const url = `${window.location.origin}/projects/paddle?trip=${tripSlug}`;
    void copyText(url).then((ok) => showFlash(ok ? 'share link copied' : url, ok ? 'ok' : 'warn', ok ? 1800 : 6000));
  }, [tripSlug, showFlash]);

  const legs = useMemo<Leg[]>(() => {
    if (!router || waypoints.length < 2) return [];
    const out: Leg[] = [];
    for (let i = 0; i + 1 < waypoints.length; i++) {
      out.push(router.route(waypoints[i].snap, waypoints[i + 1].snap, cost));
    }
    return out;
  }, [router, waypoints, cost]);

  const routeFC = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!legs.length) return null;
    return {
      type: 'FeatureCollection',
      features: legs.flatMap((leg) =>
        leg.pieces
          .filter((p) => p.coords.length >= 2)
          .map((p) => ({
            type: 'Feature' as const,
            properties: { kind: p.kind },
            geometry: { type: 'LineString' as const, coordinates: p.coords },
          })),
      ),
    };
  }, [legs]);

  const totals = useMemo(() => {
    const t = { paddleM: 0, portageM: 0, trackM: 0, carries: 0, timeH: 0, unreachable: 0 };
    for (const leg of legs) {
      if (!leg.found) {
        t.unreachable++;
        continue;
      }
      t.paddleM += leg.paddleM;
      t.portageM += leg.portageM;
      t.trackM += leg.trackM;
      t.carries += leg.carries;
      t.timeH += leg.timeH;
    }
    return t;
  }, [legs]);

  // Day splits: a waypoint marked "day end" closes the day after the leg
  // that arrives at it; the final waypoint closes the last day implicitly.
  const days = useMemo(() => {
    if (!legs.length) return [];
    const out: { paddleM: number; portageM: number; carries: number; timeH: number }[] = [];
    let cur = { paddleM: 0, portageM: 0, carries: 0, timeH: 0 };
    let used = false;
    legs.forEach((leg, i) => {
      if (leg.found) {
        cur.paddleM += leg.paddleM;
        cur.portageM += leg.portageM;
        cur.carries += leg.carries;
        cur.timeH += leg.timeH;
        used = true;
      }
      if (waypoints[i + 1]?.dayEnd && used) {
        out.push(cur);
        cur = { paddleM: 0, portageM: 0, carries: 0, timeH: 0 };
        used = false;
      }
    });
    if (used) out.push(cur);
    return out;
  }, [legs, waypoints]);

  const exportGpx = useCallback(() => {
    const coords: [number, number][] = [];
    for (const leg of legs) {
      for (const c of leg.coords) {
        const last = coords[coords.length - 1];
        if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
      }
    }
    const gpx = toGpx(coords, waypoints.map((w) => w.snap.point), `The Outfitter — ${park}`);
    const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `outfitter-${park}-route.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [legs, waypoints, park]);

  const current = parks?.find((p) => p.slug === park) ?? null;
  const stats = current?.stats ?? null;

  return (
    <PageTransition>
      <div className="pd-theme pd-room relative overflow-hidden">
        {lakes && network && current ? (
          <TripMap
            key={current.slug}
            park={current}
            lakes={lakes}
            network={network}
            showChart={showChart}
            showRelief={showRelief}
            reliefScale={reliefScale}
            route={routeFC}
            waypoints={waypoints.map((w) => w.snap.point)}
            onHover={onHover}
            onMapClick={onMapClick}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="pd-etch">{error ? `chart unavailable — ${error}` : 'unrolling the chart…'}</p>
          </div>
        )}

        {/* ── the trip sheet, pinned top-left ── */}
        <div className="pd-sheet absolute left-4 top-4 w-64 p-4">
          <p className="pd-etch">RM 18 · The Outfitter</p>
          <h1 className="ws-serif mt-1 text-2xl font-semibold leading-tight">
            {current?.name ?? 'Paddle Planner'}
          </h1>

          {parks && parks.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {parks.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => setPark(p.slug)}
                  className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors ${
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

          {/* ── the route ledger ── */}
          <div className="mt-4 border-t border-border pt-3">
            <button
              onClick={() => setPlanning((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="pd-etch">Route planner</span>
              <span
                className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors ${
                  planning ? 'border-primary text-primary' : 'border-border text-muted-foreground'
                }`}
              >
                {planning ? 'plotting' : 'stowed'}
              </span>
            </button>

            {planning && (
              <>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  Click the map to drop waypoints. Shift-click still copies coordinates.
                </p>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>paddle</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    step={0.5}
                    value={cost.paddleKmh}
                    onChange={(e) => setCost((c) => ({ ...c, paddleKmh: Math.max(1, Number(e.target.value) || 1) }))}
                    className="pd-readout w-11 rounded-sm border border-border bg-transparent px-1 py-0 text-right text-[11px]"
                    aria-label="Paddling speed km/h"
                  />
                  <span>· walk</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    step={0.5}
                    value={cost.walkKmh}
                    onChange={(e) => setCost((c) => ({ ...c, walkKmh: Math.max(1, Number(e.target.value) || 1) }))}
                    className="pd-readout w-11 rounded-sm border border-border bg-transparent px-1 py-0 text-right text-[11px]"
                    aria-label="Walking speed km/h"
                  />
                  <span>km/h</span>
                </div>
                <button
                  onClick={() => setCost((c) => ({ ...c, doubleCarry: !c.doubleCarry }))}
                  className="mt-1.5 flex w-full items-center justify-between text-left text-[11px] text-muted-foreground"
                  title="Double-carrying walks every portage three times"
                >
                  <span>carries</span>
                  <span
                    className={`rounded-sm border px-2 py-0.5 transition-colors ${
                      cost.doubleCarry ? 'border-primary text-primary' : 'border-border'
                    }`}
                  >
                    {cost.doubleCarry ? 'double ×3' : 'single ×1'}
                  </span>
                </button>
              </>
            )}

            {waypoints.length > 0 && (
              <>
                {legs.length > 0 && (
                  <dl className="mt-3 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <dt className="text-[11px] text-muted-foreground">Paddling</dt>
                      <dd className="pd-readout text-[12px]" style={{ color: 'var(--pd-blue)' }}>
                        {fmtKm(totals.paddleM)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <dt className="text-[11px] text-muted-foreground">
                        Carrying · {totals.carries} {totals.carries === 1 ? 'carry' : 'carries'}
                      </dt>
                      <dd className="pd-readout text-[12px]" style={{ color: 'var(--pd-red)' }}>
                        {fmtKm(totals.portageM)}
                      </dd>
                    </div>
                    {totals.trackM > 0 && (
                      <div className="flex items-baseline justify-between">
                        <dt className="text-[11px] text-muted-foreground">of it on tracks</dt>
                        <dd className="pd-readout text-[12px]" style={{ color: 'var(--pd-track)' }}>
                          {fmtKm(totals.trackM)}
                        </dd>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between">
                      <dt className="text-[11px] text-muted-foreground">Underway</dt>
                      <dd className="pd-readout text-[12px]">{fmtHours(totals.timeH)}</dd>
                    </div>
                  </dl>
                )}
                {totals.unreachable > 0 && (
                  <p className="mt-1.5 text-[10px]" style={{ color: 'var(--pd-red)' }}>
                    {totals.unreachable} {totals.unreachable === 1 ? 'leg has' : 'legs have'} no connecting
                    route — the network is split there.
                  </p>
                )}

                <div className="mt-2 max-h-36 space-y-0.5 overflow-y-auto pr-1">
                  {waypoints.map((wp, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="pd-readout w-4 shrink-0 text-right">{i + 1}</span>
                      <span className="pd-readout flex-1 truncate text-muted-foreground">
                        {fmtLatLon(wp.snap.point)}
                      </span>
                      <button
                        onClick={() =>
                          setWaypoints((wps) => wps.map((w, k) => (k === i ? { ...w, dayEnd: !w.dayEnd } : w)))
                        }
                        title="End the day here"
                        className={`rounded-sm border px-1 leading-4 transition-colors ${
                          wp.dayEnd ? 'border-primary text-primary' : 'border-border text-muted-foreground'
                        }`}
                      >
                        ◗
                      </button>
                      <button
                        onClick={() => setWaypoints((wps) => wps.filter((_, k) => k !== i))}
                        title="Remove waypoint"
                        className="rounded-sm border border-border px-1 leading-4 text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

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

                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => setWaypoints((wps) => wps.slice(0, -1))}
                    className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    undo
                  </button>
                  <button
                    onClick={() => setWaypoints([])}
                    className="rounded-sm border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    clear
                  </button>
                  {legs.length > 0 && totals.unreachable === 0 && (
                    <button
                      onClick={exportGpx}
                      className="ml-auto rounded-sm border border-primary px-2 py-0.5 text-[11px] text-primary"
                    >
                      GPX ↓
                    </button>
                  )}
                </div>
              </>
            )}

            {planning && (
              <div className="mt-2 border-t border-border pt-2">
                <div className="flex gap-1.5">
                  <input
                    value={tripName}
                    onChange={(e) => setTripName(e.target.value)}
                    placeholder="trip name"
                    maxLength={80}
                    className="min-w-0 flex-1 rounded-sm border border-border bg-transparent px-1.5 py-0.5 text-[11px] placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={() => void saveTrip()}
                    disabled={!waypoints.length}
                    className={`rounded-sm border px-2 py-0.5 text-[11px] ${
                      waypoints.length
                        ? 'border-primary text-primary'
                        : 'cursor-default border-border text-muted-foreground opacity-60'
                    }`}
                  >
                    save
                  </button>
                </div>
                {tripSlug && (
                  <button
                    onClick={copyShareLink}
                    className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
                    title="Copy a link that opens this trip"
                  >
                    share · ?trip={tripSlug}
                  </button>
                )}
                {trips && trips.length > 0 && (
                  <div className="mt-1.5 max-h-24 space-y-0.5 overflow-y-auto pr-1">
                    {trips.map((t) => (
                      <div key={t.slug} className="flex items-center gap-1.5 text-[10px]">
                        <button
                          onClick={() => void loadTrip(t.slug)}
                          className={`flex-1 truncate text-left ${
                            t.slug === tripSlug ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {t.name}
                        </button>
                        <span className="pd-readout shrink-0 text-muted-foreground">{t.waypoints} wp</span>
                        <button
                          onClick={() => void deleteTrip(t.slug, t.name)}
                          title="Delete trip"
                          className="rounded-sm border border-border px-1 leading-4 text-muted-foreground hover:text-foreground"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {stats && !planning && waypoints.length === 0 && (
            <dl className="mt-4 space-y-2 border-t border-border pt-3">
              <div className="flex items-baseline justify-between">
                <dt className="text-[11px] text-muted-foreground">Open water</dt>
                <dd className="pd-readout text-sm" style={{ color: 'var(--pd-blue)' }}>
                  {Math.round(stats.paddleKm).toLocaleString()} km
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-[11px] text-muted-foreground">Portage trail</dt>
                <dd className="pd-readout text-sm" style={{ color: 'var(--pd-red)' }}>
                  {Math.round(stats.portageKm).toLocaleString()} km
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-[11px] text-muted-foreground">Portages</dt>
                <dd className="pd-readout text-sm">{stats.portages.toLocaleString()}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-[11px] text-muted-foreground">Lakes on route</dt>
                <dd className="pd-readout text-sm">
                  {(lakes?.features.filter((f) => f.properties?.onNetwork).length ?? 0).toLocaleString()}
                </dd>
              </div>
            </dl>
          )}

          <div className="mt-4 border-t border-border pt-3">
            <p className="pd-etch mb-2">Legend</p>
            <div className="space-y-1.5 text-[11px] text-muted-foreground">
              <p>
                <span className="pd-ribbon mr-2" style={{ color: 'var(--pd-blue)' }} /> paddling water
              </p>
              <p>
                <span className="pd-ribbon mr-2" style={{ color: 'var(--pd-red)' }} /> portage trail
              </p>
              <p>
                <span className="pd-ribbon mr-2" style={{ color: 'var(--pd-track)' }} /> track — walkable,
                not a carry
              </p>
            </div>
          </div>

          {current?.chart && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                onClick={() => setShowChart((v) => !v)}
                className="flex w-full items-center justify-between text-left"
                title={current.chart.attribution}
              >
                <span className="pd-etch">Jeff&rsquo;s chart</span>
                <span
                  className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors ${
                    showChart
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {showChart ? 'unrolled' : 'rolled up'}
                </span>
              </button>
            </div>
          )}

          {current?.dem && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                onClick={() => setShowRelief((v) => !v)}
                className="flex w-full items-center justify-between text-left"
                title="Right-click and drag to tilt the table"
              >
                <span className="pd-etch">Terrain</span>
                <span
                  className={`rounded-sm border px-2 py-0.5 text-[11px] transition-colors ${
                    showRelief
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {showRelief ? 'in relief' : 'pressed flat'}
                </span>
              </button>
              {showRelief && (
                <div
                  className="mt-2 flex items-center gap-2"
                  title="Vertical exaggeration — ×1 is true scale"
                >
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
                  <span className="pd-readout w-10 shrink-0 text-right text-[11px]">
                    ×{reliefScale}
                  </span>
                </div>
              )}
            </div>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            Surveyed from Ontario&rsquo;s open hydro &amp; trail data; carries traced from the
            paper chart.
          </p>
        </div>

        {/* ── surveyor's readout, bottom-left, follows the cursor ── */}
        <div className="pd-sheet pointer-events-none absolute bottom-6 left-4 min-w-44 px-3 py-2">
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
              {hover.elevM != null && (
                <span className="pd-readout ml-2 text-muted-foreground">{Math.round(hover.elevM)} m ASL</span>
              )}
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
              {hover.elevM != null && (
                <span className="pd-readout ml-2">{Math.round(hover.elevM)} m ASL</span>
              )}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {planning ? 'plotting a route…' : 'tracing the chart…'}
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
            <p className="pd-readout mt-0.5 text-[10px] text-muted-foreground">
              {fmtLatLon(hover.lngLat)}
              {planning ? ' · click to drop a waypoint' : ' · click to copy'}
            </p>
          ) : null}
        </div>
      </div>
    </PageTransition>
  );
}
