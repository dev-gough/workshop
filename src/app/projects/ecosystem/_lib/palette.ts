// The instruments draw to canvas, so they need the room's colours as strings
// rather than as utilities. Rather than duplicate the hexes here, read them
// back off the scope element — `globals.css` stays the single source of truth,
// and a theme flip is just a re-read.

export interface EcoPalette {
  ink: string;
  dim: string;
  faint: string;
  line: string;
  panel: string;
  raise: string;
  lamp: string;
  prey: string;
  pred: string;
  plant: string;
  litPrey: string;
  litPred: string;
  litPlant: string;
  peat: string;
  peat2: string;
  glass: string;
  /** Canvas `font` family for instrument numerals — the room's readout face. */
  mono: string;
}

const FALLBACK: EcoPalette = {
  ink: '#e5e9dd',
  dim: '#949c8f',
  faint: '#5c6459',
  line: '#333a32',
  panel: '#171c17',
  raise: '#1f261f',
  lamp: '#dda43f',
  prey: '#6cc190',
  pred: '#e2624e',
  plant: '#d3d089',
  litPrey: '#6cc190',
  litPred: '#e2624e',
  litPlant: '#d3d089',
  peat: '#0d120d',
  peat2: '#141b13',
  glass: 'rgba(140,160,130,0.22)',
  mono: 'ui-monospace, monospace',
};

const VARS: Record<keyof EcoPalette, string> = {
  ink: '--eco-ink',
  dim: '--eco-dim',
  faint: '--eco-faint',
  line: '--eco-line',
  panel: '--eco-panel',
  raise: '--eco-raise',
  lamp: '--eco-lamp',
  prey: '--eco-prey',
  pred: '--eco-pred',
  plant: '--eco-plant',
  litPrey: '--eco-lit-prey',
  litPred: '--eco-lit-pred',
  litPlant: '--eco-lit-plant',
  peat: '--eco-peat',
  peat2: '--eco-peat-2',
  glass: '--eco-glass',
  mono: '--font-readout',
};

export function readPalette(el: Element | null): EcoPalette {
  if (!el || typeof window === 'undefined') return FALLBACK;
  const cs = getComputedStyle(el);
  const out = {} as EcoPalette;
  for (const key of Object.keys(VARS) as (keyof EcoPalette)[]) {
    const v = cs.getPropertyValue(VARS[key]).trim();
    out[key] = v || FALLBACK[key];
  }
  out.mono = out.mono === FALLBACK.mono ? FALLBACK.mono : `${out.mono}, ${FALLBACK.mono}`;
  return out;
}

/** `#rrggbb` or any CSS colour → an `rgba()` string at the given alpha. */
export function alpha(color: string, a: number): string {
  const hex = color.trim();
  if (hex.startsWith('#')) {
    const n = hex.length === 4
      ? [hex[1] + hex[1], hex[2] + hex[2], hex[3] + hex[3]]
      : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
    const [r, g, b] = n.map(h => parseInt(h, 16));
    return `rgba(${r},${g},${b},${a})`;
  }
  return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`;
}
