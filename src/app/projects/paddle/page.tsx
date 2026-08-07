'use client';

// RM 18, The Outfitter — the map table at a canoe outfitter's. The whole
// room is one chart under the header: the ingested Ontario network painted
// on paper, with a pinned trip sheet (stats, legend, parks) and a
// surveyor's readout that follows the cursor. Route planning lands on this
// same table next — the sheet is deliberately built to grow a waypoint list.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import { fmtKm, type HoverInfo, type Network, type ParkInfo } from './_lib/model';

const TripMap = dynamic(() => import('./_components/trip-map'), { ssr: false });

const LAKE_MIN_AREA = 10_000; // m² — fades sub-hectare off-route ponds out of the chart

export default function PaddlePage() {
  useHeaderConfig({ scopeClass: 'pd-theme' });

  const [parks, setParks] = useState<ParkInfo[] | null>(null);
  const [park, setPark] = useState<string>('temagami');
  const [lakes, setLakes] = useState<GeoJSON.FeatureCollection | null>(null);
  const [network, setNetwork] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

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

  const onHover = useCallback((info: HoverInfo | null) => setHover(info), []);

  const current = parks?.find((p) => p.slug === park) ?? null;
  const stats = current?.stats ?? null;

  return (
    <PageTransition>
      <div className="pd-theme pd-room relative overflow-hidden">
        {lakes && network && current ? (
          <TripMap bbox={current.bbox} lakes={lakes} network={network} onHover={onHover} />
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

          {stats && (
            <dl className="mt-4 space-y-2">
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
            </div>
          </div>

          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            Surveyed from Ontario&rsquo;s open hydro &amp; trail data. Route planning
            arrives on this table next.
          </p>
        </div>

        {/* ── surveyor's readout, bottom-left, follows the cursor ── */}
        <div className="pd-sheet pointer-events-none absolute bottom-6 left-4 min-w-44 px-3 py-2">
          {hover?.type === 'segment' ? (
            <p className="text-[11px]">
              <span
                className="pd-etch"
                style={{ color: hover.kind === 'portage' ? 'var(--pd-red)' : 'var(--pd-blue)' }}
              >
                {hover.kind === 'portage' ? 'Portage' : 'Paddle'}
              </span>
              <span className="pd-readout ml-2">{fmtKm(hover.lengthM)}</span>
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
          ) : (
            <p className="text-[11px] text-muted-foreground">tracing the chart…</p>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
