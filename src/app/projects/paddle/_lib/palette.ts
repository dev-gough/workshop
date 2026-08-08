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
  campsite: string;
  /** Raster paint for the purchased paper chart — dimmed under lamplight in dark mode. */
  chartBrightnessMax: number;
  chartSaturation: number;
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
    campsite: '#8c334d',
    chartBrightnessMax: 1,
    chartSaturation: 0,
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
    campsite: '#c86a86',
    chartBrightnessMax: 0.72,
    chartSaturation: -0.2,
    hillshadeShadow: '#060a08',
    hillshadeHighlight: '#3e5348',
    hillshadeExaggeration: 0.5,
  },
};
