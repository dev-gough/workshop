'use client';

// RM 18, The Outfitter — the map table at a canoe outfitter's. The whole
// room is one chart under the header: the ingested Ontario network painted
// on paper, with a pinned trip sheet (stats, legend, parks) and a
// surveyor's readout that follows the cursor. Route planning lands on this
// same table next — the sheet is deliberately built to grow a waypoint list.

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import PageTransition from '@/components/motion/PageTransition';
import { useHeaderConfig } from '@/components/header-config';
import { fmtKm, fmtLatLon, type HoverInfo, type Network, type ParkInfo } from './_lib/model';

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
  // The purchased paper chart starts unrolled on the table when a park has one.
  const [showChart, setShowChart] = useState(true);
  // Terrain starts pressed up in relief when the park's DEM is cached.
  const [showRelief, setShowRelief] = useState(true);
  // Vertical exaggeration — ×1 is true scale; the Shield's relief is real
  // but modest, so the default presses it up a little.
  const [reliefScale, setReliefScale] = useState(1.5);

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

  // Click-to-copy flash: the readout confirms which spot just hit the clipboard.
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCopyCoords = useCallback((coords: string) => {
    setCopied(coords);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1800);
  }, []);

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
            onHover={onHover}
            onCopyCoords={onCopyCoords}
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
          ) : hover?.type === 'ground' ? (
            <p className="text-[11px]">
              <span className="pd-etch">Ground</span>
              {hover.elevM != null && (
                <span className="pd-readout ml-2">{Math.round(hover.elevM)} m ASL</span>
              )}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">tracing the chart…</p>
          )}
          {copied ? (
            <p className="mt-0.5 text-[10px]">
              <span className="pd-etch" style={{ color: 'var(--color-primary)' }}>
                copied · {copied}
              </span>
            </p>
          ) : hover ? (
            <p className="pd-readout mt-0.5 text-[10px] text-muted-foreground">
              {fmtLatLon(hover.lngLat)} · click to copy
            </p>
          ) : null}
        </div>
      </div>
    </PageTransition>
  );
}
