'use client';

// RM 18, The Outfitter — a field tool. The chart owns the screen; one
// dockable panel (bottom sheet on phones, left panel on md+) hosts the
// views; the trip domain lives in use-trip-plan. This page is composition
// only: park data fetching, view state, and wiring between the pieces.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import type { HoverInfo, Network, ParkInfo, ReviewItem, View } from '../_lib/model';
import { LAST_PARK_KEY } from '../_lib/model';
import { TripRouter } from '../_lib/route';
import { copyText } from '@/lib/clipboard';
import { useTripPlan } from '../_lib/use-trip-plan';
import PanelShell from '../_components/panel-shell';
import MapPanel from '../_components/map-panel';
import TripsPanel from '../_components/trips-panel';
import TripPanel from '../_components/trip-panel';
import ReviewPanel from '../_components/review-panel';
import Readout, { type Flash } from '../_components/readout';

const TripMap = dynamic(() => import('../_components/trip-map'), { ssr: false });

const LAKE_MIN_AREA = 10_000; // m² — fades sub-hectare off-route ponds out of the chart

export default function PaddlePage() {
  useHeaderConfig({ scopeClass: 'pd-theme' });

  // ── park data ──
  const [parks, setParks] = useState<ParkInfo[] | null>(null);
  const [park, setPark] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem(LAST_PARK_KEY)) || 'temagami',
  );
  const [lakes, setLakes] = useState<GeoJSON.FeatureCollection | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_PARK_KEY, park);
    } catch {
      /* storage unavailable — resume is best-effort */
    }
  }, [park]);

  useEffect(() => {
    fetch('/api/paddle/parks')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setParks(d.parks);
        setPark((cur) =>
          d.parks.length && !d.parks.some((p: ParkInfo) => p.slug === cur) ? d.parks[0].slug : cur,
        );
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let stale = false;
    setLakes(null);
    setNetwork(null);
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

  // Re-pull just the network after an approved review edits segments.
  const [netNonce, setNetNonce] = useState(0);
  useEffect(() => {
    if (netNonce === 0) return;
    let stale = false;
    fetch(`/api/paddle/network?park=${park}`)
      .then((r) => r.json())
      .then((d) => {
        if (stale || d.error) return;
        setNetwork(d);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [netNonce, park]);

  const router = useMemo(() => (network ? new TripRouter(network) : null), [network]);

  // ── map display ──
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [showChart, setShowChart] = useState(true);
  const [showImagery, setShowImagery] = useState(false);
  const [showRelief, setShowRelief] = useState(true);
  const [reliefScale, setReliefScale] = useState(1.5);
  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);

  // ── panel shell ──
  const [view, setView] = useState<View>('map');
  const [panelOpen, setPanelOpen] = useState(true); // mobile only; md+ always open
  const planning = view === 'trip';
  const planningRef = useRef(planning);
  planningRef.current = planning;

  // ── imagery review queue ──
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const reviewsRef = useRef<ReviewItem[] | null>(null);
  reviewsRef.current = reviews;
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [reviewFocus, setReviewFocus] = useState<[number, number, number, number] | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  useEffect(() => {
    if (view !== 'review') return;
    let stale = false;
    fetch(`/api/paddle/reviews?park=${park}`)
      .then((r) => r.json())
      .then((d) => !stale && !d.error && setReviews(d.reviews))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [view, park]);
  useEffect(() => {
    // park switch invalidates the queue and any selection
    setReviews(null);
    setReviewId(null);
    setReviewFocus(null);
  }, [park]);

  const selectReview = useCallback((r: ReviewItem) => {
    setReviewId(r.id);
    setShowImagery(true); // the whole point is to look at the photo
    const lons = r.coords.map((c) => c[0]);
    const lats = r.coords.map((c) => c[1]);
    // pad the section's bbox so the fly-to shows context around it
    const pad = 0.004;
    setReviewFocus([
      Math.min(...lons) - pad,
      Math.min(...lats) - pad,
      Math.max(...lons) + pad,
      Math.max(...lats) + pad,
    ]);
  }, []);

  const reviewFC = useMemo<GeoJSON.FeatureCollection | null>(() => {
    const r = reviews?.find((x) => x.id === reviewId);
    if (!r) return null;
    return {
      type: 'FeatureCollection',
      features: r.pieces.map((p) => ({
        type: 'Feature',
        properties: { kind: p.kind },
        geometry: { type: 'LineString', coordinates: p.coords },
      })),
    };
  }, [reviews, reviewId]);

  // ── flashes ──
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((text: string, tone: 'ok' | 'warn', ms: number) => {
    setFlash({ text, tone });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }, []);

  const decideReview = useCallback(
    async (r: ReviewItem, status: ReviewItem['status']) => {
      setReviewBusy(true);
      try {
        const res = await fetch(`/api/paddle/reviews/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        const updated =
          reviewsRef.current?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? null;
        setReviews(updated);
        // verdict in — slide the next open suspect onto the table (list
        // order, wrapping past the end); none left → stay put, selection off
        if (updated) {
          const idx = updated.findIndex((x) => x.id === r.id);
          const next = [...updated.slice(idx + 1), ...updated.slice(0, idx)].find(
            (x) => x.status === 'proposed',
          );
          if (next) selectReview(next);
          else setReviewId(null);
        }
        if (d.applied?.applied) {
          setNetNonce((n) => n + 1); // the ribbon just changed — redraw it
          showFlash(`applied — ${d.applied.reason}`, 'ok', 2200);
        } else if (status === 'approved') {
          showFlash(`approved, not applied: ${d.applied?.reason ?? 'unknown'}`, 'warn', 4500);
        }
      } catch (e) {
        showFlash(String(e), 'warn', 4000);
      }
      setReviewBusy(false);
    },
    [showFlash, selectReview],
  );

  // ── the trip domain ──
  const onTripOpened = useCallback((kind: 'loaded' | 'new') => {
    setView('trip');
    // loaded trips land collapsed on phones so the path shows; a fresh trip
    // keeps the sheet open for the "tap the map" hint
    setPanelOpen(kind === 'new');
  }, []);
  const plan = useTripPlan({ park, setPark, router, showFlash, onTripOpened });

  const onMapClick = useCallback(
    (lngLat: [number, number], shiftKey: boolean) => {
      if (planningRef.current && !shiftKey) {
        if (!plan.addWaypointAt(lngLat)) showFlash('no route within 300 m', 'warn', 2000);
        return;
      }
      const coords = `${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`;
      void copyText(coords).then((ok) =>
        showFlash(ok ? `copied · ${coords}` : `clipboard blocked · ${coords}`, ok ? 'ok' : 'warn', ok ? 1800 : 6000),
      );
    },
    [plan, showFlash],
  );

  const selectTab = useCallback((v: View) => {
    setView((cur) => {
      if (v === cur) {
        setPanelOpen((o) => !o);
        return cur;
      }
      setPanelOpen(true);
      return v;
    });
  }, []);

  const current = parks?.find((p) => p.slug === park) ?? null;
  const tripTabLabel = view === 'trip' || plan.tripName ? plan.tripName || 'new trip' : 'Trip';

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
            showImagery={showImagery}
            showRelief={showRelief}
            reliefScale={reliefScale}
            route={plan.routeFC}
            waypoints={plan.waypoints.map((w) => w.snap.point)}
            review={view === 'review' ? reviewFC : null}
            focus={view === 'review' ? reviewFocus : plan.focus}
            onHover={onHover}
            onMapClick={onMapClick}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="pd-etch">{error ? `chart unavailable — ${error}` : 'unrolling the chart…'}</p>
          </div>
        )}

        <Readout hover={hover} flash={flash} planning={planning} panelOpen={panelOpen} />

        <PanelShell
          view={view}
          open={panelOpen}
          tabs={[
            { view: 'map', label: 'Map' },
            { view: 'trips', label: 'Trips' },
            { view: 'trip', label: tripTabLabel },
            { view: 'review', label: 'Review' },
          ]}
          onSelectTab={selectTab}
        >
          {view === 'map' && (
            <MapPanel
              parks={parks}
              park={park}
              setPark={setPark}
              current={current}
              showChart={showChart}
              setShowChart={setShowChart}
              showImagery={showImagery}
              setShowImagery={setShowImagery}
              showRelief={showRelief}
              setShowRelief={setShowRelief}
              reliefScale={reliefScale}
              setReliefScale={setReliefScale}
            />
          )}
          {view === 'trips' && (
            <TripsPanel
              parks={parks}
              trips={plan.trips}
              activeSlug={plan.tripSlug}
              onNew={plan.newTrip}
              onLoad={(slug) => void plan.loadTrip(slug)}
              onDelete={(slug, name) => void plan.deleteTrip(slug, name)}
            />
          )}
          {view === 'trip' && <TripPanel plan={plan} />}
          {view === 'review' && (
            <ReviewPanel
              reviews={reviews}
              selectedId={reviewId}
              onSelect={selectReview}
              onDecide={decideReview}
              busy={reviewBusy}
            />
          )}
        </PanelShell>
      </div>
    </PageTransition>
  );
}
