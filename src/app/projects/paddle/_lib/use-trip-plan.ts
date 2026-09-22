'use client';

/**
 * The trip domain, as one hook: waypoints and their day-ends, the cost
 * model, computed legs/totals/days, and persistence (save/load/delete,
 * share links, GPX). The page composes this with the map and panel shell.
 *
 * Future field features live HERE, not in components: leg timing stamps,
 * geotagged photos, and imported Garmin tracks are all trip data — give
 * them state + persistence in this hook and render them from its outputs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TripData, TripStats, TripSummary } from './model';
import { DEFAULT_COST, toGpx, type CostParams, type Leg, type Snap, type TripRouter } from './route';
import { copyText } from '@/lib/clipboard';

const SNAP_MAX_M = 300;    // map-click waypoint snapping
const RESNAP_MAX_M = 400;  // stored-trip waypoints get a little more slack
const defaultExpedition = (): ExpeditionSettings => {
  const now = new Date();
  const startDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return { startDate, launchMin: 8 * 60 };
};

export interface Waypoint {
  snap: Snap;
  dayEnd: boolean;
}

export interface DayTotals {
  paddleM: number;
  portageM: number;
  carries: number;
  timeH: number;
}

export interface ExpeditionSettings {
  startDate: string;
  launchMin: number;
}

export interface TripPlan {
  waypoints: Waypoint[];
  cost: CostParams;
  setCost: React.Dispatch<React.SetStateAction<CostParams>>;
  tripName: string;
  setTripName: (name: string) => void;
  tripSlug: string | null;
  trips: TripSummary[] | null;
  legs: Leg[];
  totals: { paddleM: number; portageM: number; trackM: number; carries: number; timeH: number; unreachable: number };
  days: DayTotals[];
  expedition: ExpeditionSettings;
  setExpedition: React.Dispatch<React.SetStateAction<ExpeditionSettings>>;
  routeFC: GeoJSON.FeatureCollection | null;
  /** Bounds to fly to after a trip loads; consumed via `focus` on TripMap. */
  focus: [number, number, number, number] | null;
  /** Snap a map click into a waypoint. False = nothing within range. */
  addWaypointAt: (lngLat: [number, number]) => boolean;
  removeWaypoint: (i: number) => void;
  toggleDayEnd: (i: number) => void;
  undoWaypoint: () => void;
  clearWaypoints: () => void;
  newTrip: () => void;
  saveTrip: () => Promise<void>;
  loadTrip: (slug: string) => Promise<void>;
  deleteTrip: (slug: string, name: string) => Promise<void>;
  copyShareLink: () => void;
  exportGpx: () => void;
}

export function useTripPlan(opts: {
  park: string;
  setPark: (slug: string) => void;
  router: TripRouter | null;
  showFlash: (text: string, tone: 'ok' | 'warn', ms: number) => void;
  /** A trip was opened (loaded or created) — the page adjusts view/panel. */
  onTripOpened: (kind: 'loaded' | 'new') => void;
}): TripPlan {
  const { park, setPark, router, showFlash, onTripOpened } = opts;

  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [cost, setCost] = useState<CostParams>(DEFAULT_COST);
  const [tripName, setTripName] = useState('');
  const [tripSlug, setTripSlug] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [focus, setFocus] = useState<[number, number, number, number] | null>(null);
  const [expedition, setExpedition] = useState<ExpeditionSettings>(defaultExpedition);

  const parkRef = useRef(park);
  parkRef.current = park;
  const routerRef = useRef(router);
  routerRef.current = router;

  // Park switch invalidates snaps (they index the old park's segments).
  useEffect(() => {
    setWaypoints([]);
    setTripSlug(null);
    setTripName('');
  }, [park]);

  // The logbook spans every park — one list, filtered in the UI.
  const refreshTrips = useCallback(async () => {
    const d = await fetch('/api/paddle/trips')
      .then((r) => r.json())
      .catch(() => null);
    if (d?.trips) setTrips(d.trips);
  }, []);
  useEffect(() => {
    void refreshTrips();
  }, [refreshTrips]);

  // ── waypoint ops ──
  const addWaypointAt = useCallback((lngLat: [number, number]): boolean => {
    const snap = routerRef.current?.snap(lngLat, SNAP_MAX_M);
    if (!snap) return false;
    setWaypoints((wps) => [...wps, { snap, dayEnd: false }]);
    return true;
  }, []);
  const removeWaypoint = useCallback((i: number) => {
    setWaypoints((wps) => wps.filter((_, k) => k !== i));
  }, []);
  const toggleDayEnd = useCallback((i: number) => {
    setWaypoints((wps) => wps.map((w, k) => (k === i ? { ...w, dayEnd: !w.dayEnd } : w)));
  }, []);
  const undoWaypoint = useCallback(() => setWaypoints((wps) => wps.slice(0, -1)), []);
  const clearWaypoints = useCallback(() => setWaypoints([]), []);

  // ── routing ──
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

  // A waypoint marked "day end" closes the day after the leg that arrives at
  // it; the final waypoint closes the last day implicitly.
  const days = useMemo<DayTotals[]>(() => {
    if (!legs.length) return [];
    const out: DayTotals[] = [];
    let cur: DayTotals = { paddleM: 0, portageM: 0, carries: 0, timeH: 0 };
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

  // ── persistence ──
  const focusOnLoadRef = useRef(false);
  const pendingTrip = useRef<TripData | null>(null);
  const applyPending = useCallback(() => {
    const trip = pendingTrip.current;
    const r = routerRef.current;
    if (!trip || !r) return;
    pendingTrip.current = null;
    const wps: Waypoint[] = [];
    let missed = 0;
    for (const [lon, lat, dayEnd] of trip.waypoints) {
      const snap = r.snap([lon, lat], RESNAP_MAX_M);
      if (snap) wps.push({ snap, dayEnd: !!dayEnd });
      else missed++;
    }
    setWaypoints(wps);
    setTripName(trip.name);
    setTripSlug(trip.slug);
    setCost((c) => ({ ...c, ...(trip.cost as Partial<CostParams>) }));
    const savedExpedition = trip.cost.expedition as Partial<ExpeditionSettings> | undefined;
    const savedDate = savedExpedition?.startDate;
    const parsedDate = typeof savedDate === 'string'
      ? new Date(`${savedDate}T12:00:00Z`)
      : null;
    const validDate = parsedDate != null
      && /^\d{4}-\d{2}-\d{2}$/.test(savedDate!)
      && !Number.isNaN(parsedDate.getTime())
      && parsedDate.toISOString().slice(0, 10) === savedDate;
    if (
      validDate &&
      typeof savedExpedition?.launchMin === 'number' &&
      Number.isFinite(savedExpedition.launchMin)
    ) {
      setExpedition({
        startDate: savedDate!,
        launchMin: Math.max(0, Math.min(1439, Math.round(savedExpedition.launchMin))),
      });
    } else setExpedition(defaultExpedition());
    focusOnLoadRef.current = true;
    onTripOpened('loaded');
    showFlash(
      missed ? `trip loaded — ${missed} waypoint${missed > 1 ? 's' : ''} off-network` : `trip loaded · ${trip.name}`,
      missed ? 'warn' : 'ok',
      2500,
    );
  }, [showFlash, onTripOpened]);
  useEffect(() => {
    applyPending();
  }, [router, applyPending]);

  // a freshly loaded trip flies the table to its path
  useEffect(() => {
    if (!focusOnLoadRef.current) return;
    const pts = legs.length ? legs.flatMap((l) => l.coords) : waypoints.map((w) => w.snap.point);
    if (!pts.length) return;
    focusOnLoadRef.current = false;
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    setFocus([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
  }, [legs, waypoints]);

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
    [applyPending, setPark, showFlash],
  );

  // share links: /projects/paddle/map?trip=<slug>
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('trip');
    if (slug) void loadTrip(slug);
  }, [loadTrip]);

  const newTrip = useCallback(() => {
    setWaypoints([]);
    setTripName('');
    setTripSlug(null);
    setExpedition(defaultExpedition());
    onTripOpened('new');
  }, [onTripOpened]);

  const saveTrip = useCallback(async () => {
    if (!waypoints.length) return;
    const stats: TripStats = {
      paddleM: Math.round(totals.paddleM),
      portageM: Math.round(totals.portageM),
      trackM: Math.round(totals.trackM),
      carries: totals.carries,
      timeH: Math.round(totals.timeH * 100) / 100,
      days: Math.max(1, days.length),
    };
    const d = await fetch('/api/paddle/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        park,
        name: tripName.trim() || 'Untitled trip',
        slug: tripSlug ?? undefined,
        waypoints: waypoints.map((w) => [w.snap.point[0], w.snap.point[1], w.dayEnd ? 1 : 0]),
        cost: { ...cost, expedition },
        stats,
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
  }, [waypoints, park, tripName, tripSlug, cost, expedition, totals, days, showFlash, refreshTrips]);

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
    const url = `${window.location.origin}/projects/paddle/map?trip=${tripSlug}`;
    void copyText(url).then((ok) => showFlash(ok ? 'share link copied' : url, ok ? 'ok' : 'warn', ok ? 1800 : 6000));
  }, [tripSlug, showFlash]);

  const exportGpx = useCallback(() => {
    const coords: [number, number][] = [];
    for (const leg of legs) {
      for (const c of leg.coords) {
        const last = coords[coords.length - 1];
        if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
      }
    }
    const gpx = toGpx(coords, waypoints.map((w) => w.snap.point), `The Outfitter — ${tripName || park}`);
    const url = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `outfitter-${park}-${(tripName || 'route').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [legs, waypoints, park, tripName]);

  return {
    waypoints,
    cost,
    setCost,
    tripName,
    setTripName,
    tripSlug,
    trips,
    legs,
    totals,
    days,
    expedition,
    setExpedition,
    routeFC,
    focus,
    addWaypointAt,
    removeWaypoint,
    toggleDayEnd,
    undoWaypoint,
    clearWaypoints,
    newTrip,
    saveTrip,
    loadTrip,
    deleteTrip,
    copyShareLink,
    exportGpx,
  };
}
