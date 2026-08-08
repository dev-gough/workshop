'use client';

// RM 18, The Outfitter — a field tool. The chart owns the screen; one
// dockable panel (bottom sheet on phones, left panel on md+) hosts the
// views; the trip domain lives in use-trip-plan. This page is composition
// only: park data fetching, view state, and wiring between the pieces.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import type { HoverInfo, Network, ParkInfo, View } from './_lib/model';
import { TripRouter } from './_lib/route';
import { copyText } from './_lib/clipboard';
import { useTripPlan } from './_lib/use-trip-plan';
import PanelShell from './_components/panel-shell';
import MapPanel from './_components/map-panel';
import TripsPanel from './_components/trips-panel';
import TripPanel from './_components/trip-panel';
import Readout, { type Flash } from './_components/readout';

const TripMap = dynamic(() => import('./_components/trip-map'), { ssr: false });

const LAKE_MIN_AREA = 10_000; // m² — fades sub-hectare off-route ponds out of the chart

export default function PaddlePage() {
  useHeaderConfig({ scopeClass: 'pd-theme' });

  // ── park data ──
  const [parks, setParks] = useState<ParkInfo[] | null>(null);
  const [park, setPark] = useState<string>('temagami');
  const [lakes, setLakes] = useState<GeoJSON.FeatureCollection | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const router = useMemo(() => (network ? new TripRouter(network) : null), [network]);

  // ── map display ──
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [showChart, setShowChart] = useState(true);
  const [showRelief, setShowRelief] = useState(true);
  const [reliefScale, setReliefScale] = useState(1.5);
  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);

  // ── panel shell ──
  const [view, setView] = useState<View>('map');
  const [panelOpen, setPanelOpen] = useState(true); // mobile only; md+ always open
  const planning = view === 'trip';
  const planningRef = useRef(planning);
  planningRef.current = planning;

  // ── flashes ──
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFlash = useCallback((text: string, tone: 'ok' | 'warn', ms: number) => {
    setFlash({ text, tone });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }, []);

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
            showRelief={showRelief}
            reliefScale={reliefScale}
            route={plan.routeFC}
            waypoints={plan.waypoints.map((w) => w.snap.point)}
            focus={plan.focus}
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
              showRelief={showRelief}
              setShowRelief={setShowRelief}
              reliefScale={reliefScale}
              setReliefScale={setReliefScale}
            />
          )}
          {view === 'trips' && (
            <TripsPanel
              parkName={current?.name}
              trips={plan.trips}
              activeSlug={plan.tripSlug}
              onNew={plan.newTrip}
              onLoad={(slug) => void plan.loadTrip(slug)}
              onDelete={(slug, name) => void plan.deleteTrip(slug, name)}
            />
          )}
          {view === 'trip' && <TripPanel plan={plan} />}
        </PanelShell>
      </div>
    </PageTransition>
  );
}
