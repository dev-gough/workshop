'use client';

// The map itself — the waxed chart on the counter. Fully self-hosted: the
// base is paper (background) and the OHN lakes we ingested, and when a park
// has a purchased Maps by Jeff chart, its tiles rise from our own bundle
// reader — no external tile server is ever consulted. The chart is
// transparent outside the park boundary, so it sits on the vector base and
// blends at the edges; route ribbons render above it in two passes so
// portage red always sits on top of open-water blue.

import { useEffect, useRef } from 'react';
// Pinned to the v5 line: 6.x (ESM-only, external module worker) stalls
// silently in this stack — style never loads, no error fires.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '@/components/ThemeProvider';
import { MAP_PALETTES } from '../_lib/palette';
import type { HoverInfo, Network, ParkInfo } from '../_lib/model';

interface TripMapProps {
  park: ParkInfo;
  lakes: GeoJSON.FeatureCollection;
  network: Network;
  showChart: boolean;
  showRelief: boolean;
  onHover: (info: HoverInfo | null) => void;
}

// Real relief here is gentle (Algonquin's local drops are ~100 m over a km),
// so the table presses it up a touch to make ridgelines readable at a pitch.
const RELIEF_EXAGGERATION = 1.5;

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

export default function TripMap({ park, lakes, network, showChart, showRelief, onHover }: TripMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const showChartRef = useRef(showChart);
  showChartRef.current = showChart;
  const showReliefRef = useRef(showRelief);
  showReliefRef.current = showRelief;

  // init once per park (the page remounts this component on park change)
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const pal = MAP_PALETTES[themeRef.current];
    const bbox = park.bbox;

    const sources: Record<string, maplibregl.SourceSpecification> = {
      lakes: { type: 'geojson', data: lakes },
      network: { type: 'geojson', data: networkToGeoJSON(network) },
    };
    if (park.chart) {
      sources.jeff = {
        type: 'raster',
        tiles: [`/api/paddle/tiles/${park.slug}/{z}/{x}/{y}`],
        tileSize: 256,
        maxzoom: park.chart.maxZoom, // MapLibre overzooms past the package's top level
        bounds: bbox,
      };
    }
    if (park.dem) {
      // Two sources over the same tiles: MapLibre wants the terrain mesh and
      // the hillshade layer fed separately.
      const dem: maplibregl.RasterDEMSourceSpecification = {
        type: 'raster-dem',
        tiles: [`/api/paddle/dem/${park.slug}/{z}/{x}/{y}`],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: park.dem.maxZoom,
        bounds: park.dem.bounds,
      };
      sources.dem = dem;
      sources.demShade = { ...dem };
    }

    const layers: maplibregl.LayerSpecification[] = [
      { id: 'paper', type: 'background', paint: { 'background-color': pal.land } },
    ];
    if (park.dem) {
      // Under the water fills: the land carries the relief, lakes stay flat ink.
      layers.push({
        id: 'relief-shade',
        type: 'hillshade',
        source: 'demShade',
        layout: { visibility: showReliefRef.current ? 'visible' : 'none' },
        paint: {
          'hillshade-shadow-color': pal.hillshadeShadow,
          'hillshade-highlight-color': pal.hillshadeHighlight,
          'hillshade-exaggeration': pal.hillshadeExaggeration,
        },
      });
    }
    layers.push(
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
    );
    if (park.chart) {
      layers.push({
        id: 'jeff-chart',
        type: 'raster',
        source: 'jeff',
        layout: { visibility: showChartRef.current ? 'visible' : 'none' },
        paint: {
          'raster-brightness-max': pal.chartBrightnessMax,
          'raster-saturation': pal.chartSaturation,
          'raster-fade-duration': 150,
        },
      });
    }
    layers.push(
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
    );

    const map = new maplibregl.Map({
      container: container.current,
      attributionControl: false,
      style: { version: 8, sources, layers },
      bounds: [bbox[0], bbox[1], bbox[2], bbox[3]],
      fitBoundsOptions: { padding: 40 },
    });

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: [
          'Water & routes: Ontario GeoHub (OHN/OTN), OGL–Ontario',
          ...(park.chart ? [park.chart.attribution] : []),
          ...(park.dem ? ['Terrain: Mapzen terrarium via AWS Open Data (NRCan CDEM)'] : []),
        ].join(' · '),
      }),
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
      // Ground elevation under the cursor — only meaningful once the terrain
      // mesh is set (queryTerrainElevation returns null without it). MapLibre
      // reports the EXAGGERATED height (verified 1.5× against the raw DEM),
      // so divide the display value back to true meters.
      // An exact 0 is the not-yet-loaded / fallback-tile value, never real
      // ground in these parks — show nothing rather than a fake sea level.
      const rawElev = showReliefRef.current ? map.queryTerrainElevation(e.lngLat) : null;
      const elevM = rawElev ? rawElev / RELIEF_EXAGGERATION : null;
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
          elevM,
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
          elevM,
        });
        return;
      }
      map.getCanvas().style.cursor = '';
      onHover(elevM !== null ? { type: 'ground', elevM } : null);
    });
    map.on('mouseout', () => onHover(null));

    mapRef.current = map;
    // debug handle for headless inspection (harmless in prod)
    (window as unknown as Record<string, unknown>).__pdMap = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once; chart/theme handled below
  }, []);

  // roll the chart on or off the table
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (map.getLayer('jeff-chart')) {
        map.setLayoutProperty('jeff-chart', 'visibility', showChart ? 'visible' : 'none');
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [showChart]);

  // press the relief up out of the paper, or flatten it back down
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getSource('dem')) return;
      map.setTerrain(showRelief ? { source: 'dem', exaggeration: RELIEF_EXAGGERATION } : null);
      map.setLayoutProperty('relief-shade', 'visibility', showRelief ? 'visible' : 'none');
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [showRelief]);

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
      if (map.getLayer('jeff-chart')) {
        map.setPaintProperty('jeff-chart', 'raster-brightness-max', pal.chartBrightnessMax);
        map.setPaintProperty('jeff-chart', 'raster-saturation', pal.chartSaturation);
      }
      if (map.getLayer('relief-shade')) {
        map.setPaintProperty('relief-shade', 'hillshade-shadow-color', pal.hillshadeShadow);
        map.setPaintProperty('relief-shade', 'hillshade-highlight-color', pal.hillshadeHighlight);
        map.setPaintProperty('relief-shade', 'hillshade-exaggeration', pal.hillshadeExaggeration);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [theme]);

  return <div ref={container} className="h-full w-full" />;
}
