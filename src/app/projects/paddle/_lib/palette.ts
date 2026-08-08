/**
 * The map canvas's paint, per mode. MapLibre can't read CSS custom
 * properties, so the room's palette is mirrored here — keep in step with
 * `.pd-theme` in globals.css (same inks, same canoe red).
 */
export interface MapPalette {
  land: string;
  water: string;
  waterOff: string; // lakes the route never touches — faded into the paper
  shore: string;
  paddle: string;
  portage: string;
  /** Walkable-but-not-a-carry lines (hydro corridors, walk-ins) — pencilled in. */
  track: string;
  campsite: string;
  /** Halo under the planned route so it reads over the busy chart. */
  routeCasing: string;
  waypoint: string;
  waypointStroke: string;
  /** Raster paint for the purchased paper chart — dimmed under lamplight in dark mode. */
  chartBrightnessMax: number;
  chartSaturation: number;
  /** Raster paint for the aerial imagery — same lamplight treatment. */
  imageryBrightnessMax: number;
  imagerySaturation: number;
  /** Hillshade paint — the relief pressed into the paper when terrain is on. */
  hillshadeShadow: string;
  hillshadeHighlight: string;
  hillshadeExaggeration: number;
}

export const MAP_PALETTES: Record<'light' | 'dark', MapPalette> = {
  light: {
    land: '#ece4d0',
    water: '#a9c9d4',
    waterOff: '#c6d6da',
    shore: '#8fa9b0',
    paddle: '#276a8c',
    portage: '#b0402c',
    track: '#8f8871',
    campsite: '#8c334d',
    routeCasing: '#fffdf2',
    waypoint: '#26332c',
    waypointStroke: '#fffdf2',
    chartBrightnessMax: 1,
    chartSaturation: 0,
    imageryBrightnessMax: 1,
    imagerySaturation: 0,
    hillshadeShadow: '#8a7a5c',
    hillshadeHighlight: '#fffdf0',
    hillshadeExaggeration: 0.35,
  },
  dark: {
    land: '#18211d',
    water: '#274653',
    waterOff: '#1e2f33',
    shore: '#3a565f',
    paddle: '#5da0c0',
    portage: '#e0664a',
    track: '#6e7566',
    campsite: '#c86a86',
    routeCasing: '#0c1210',
    waypoint: '#e8e2cf',
    waypointStroke: '#0c1210',
    chartBrightnessMax: 0.72,
    chartSaturation: -0.2,
    // The boreal mosaic is dark already — dim less than the paper chart.
    imageryBrightnessMax: 0.85,
    imagerySaturation: -0.15,
    hillshadeShadow: '#060a08',
    hillshadeHighlight: '#3e5348',
    hillshadeExaggeration: 0.5,
  },
};
