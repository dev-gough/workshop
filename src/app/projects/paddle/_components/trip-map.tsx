'use client';

// The map itself — the waxed chart on the counter. Fully self-hosted: the
// only "basemap" is paper (background) and the OHN lakes we ingested; no
// external tile server is consulted. Route ribbons render in two passes so
// portage red always sits above open-water blue.

import { useEffect, useRef } from 'react';
// Pinned to the v5 line: 6.x (ESM-only, external module worker) stalls
// silently in this stack — style never loads, no error fires.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '@/components/ThemeProvider';
import { MAP_PALETTES } from '../_lib/palette';
import type { HoverInfo, Network } from '../_lib/model';

interface TripMapProps {
  bbox: [number, number, number, number];
  lakes: GeoJSON.FeatureCollection;
  network: Network;
  onHover: (info: HoverInfo | null) => void;
}

function networkToGeoJSON(network: Network): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: network.segments.map((s) => ({
      type: 'Feature',
      properties: { kind: s.kind, length_m: s.length_m },
      geometry: { type: 'LineString', coordinates: s.coords },
    })),
  };
}

export default function TripMap({ bbox, lakes, network, onHover }: TripMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // init once
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const pal = MAP_PALETTES[themeRef.current];

    const map = new maplibregl.Map({
      container: container.current,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          lakes: { type: 'geojson', data: lakes },
          network: { type: 'geojson', data: networkToGeoJSON(network) },
        },
        layers: [
          { id: 'paper', type: 'background', paint: { 'background-color': pal.land } },
          {
            id: 'lakes-off',
            type: 'fill',
            source: 'lakes',
            filter: ['!', ['get', 'onNetwork']],
            paint: { 'fill-color': pal.waterOff, 'fill-opacity': 0.55 },
          },
          {
            id: 'lakes-on',
            type: 'fill',
            source: 'lakes',
            filter: ['get', 'onNetwork'],
            paint: { 'fill-color': pal.water },
          },
          {
            id: 'shore',
            type: 'line',
            source: 'lakes',
            filter: ['get', 'onNetwork'],
            paint: { 'line-color': pal.shore, 'line-width': 0.7, 'line-opacity': 0.8 },
          },
          {
            id: 'net-paddle',
            type: 'line',
            source: 'network',
            filter: ['==', ['get', 'kind'], 'paddle'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': pal.paddle,
              'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 11, 2.2, 14, 3.5],
              'line-opacity': 0.85,
            },
          },
          {
            id: 'net-portage',
            type: 'line',
            source: 'network',
            filter: ['==', ['get', 'kind'], 'portage'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': pal.portage,
              'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 11, 3, 14, 4.5],
            },
          },
        ],
      },
      bounds: [bbox[0], bbox[1], bbox[2], bbox[3]],
      fitBoundsOptions: { padding: 40 },
    });

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'Water & routes: Ontario GeoHub (OHN/OTN), OGL–Ontario',
      }),
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
      const pad = 5;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ];
      const seg = map.queryRenderedFeatures(box, { layers: ['net-portage', 'net-paddle'] })[0];
      if (seg) {
        map.getCanvas().style.cursor = 'crosshair';
        onHover({
          type: 'segment',
          kind: seg.properties.kind as 'paddle' | 'portage',
          lengthM: Number(seg.properties.length_m),
        });
        return;
      }
      const lake = map.queryRenderedFeatures(e.point, { layers: ['lakes-on', 'lakes-off'] })[0];
      if (lake) {
        map.getCanvas().style.cursor = '';
        onHover({
          type: 'lake',
          name: (lake.properties.name as string | null) ?? null,
          areaM2: Number(lake.properties.area),
        });
        return;
      }
      map.getCanvas().style.cursor = '';
      onHover(null);
    });
    map.on('mouseout', () => onHover(null));

    mapRef.current = map;
    // debug handle for headless inspection (harmless in prod)
    (window as unknown as Record<string, unknown>).__pdMap = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; data/theme handled below
  }, []);

  // repaint on theme change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pal = MAP_PALETTES[theme];
    const apply = () => {
      map.setPaintProperty('paper', 'background-color', pal.land);
      map.setPaintProperty('lakes-off', 'fill-color', pal.waterOff);
      map.setPaintProperty('lakes-on', 'fill-color', pal.water);
      map.setPaintProperty('shore', 'line-color', pal.shore);
      map.setPaintProperty('net-paddle', 'line-color', pal.paddle);
      map.setPaintProperty('net-portage', 'line-color', pal.portage);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [theme]);

  return <div ref={container} className="h-full w-full" />;
}
