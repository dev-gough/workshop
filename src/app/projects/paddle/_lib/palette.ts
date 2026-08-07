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
  },
  dark: {
    land: '#18211d',
    water: '#274653',
    waterOff: '#1e2f33',
    shore: '#3a565f',
    paddle: '#5da0c0',
    portage: '#e0664a',
    campsite: '#c86a86',
  },
};
