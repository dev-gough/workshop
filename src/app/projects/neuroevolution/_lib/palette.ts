// The instruments draw to canvas, so they need the room's colours as strings.
// Rather than duplicate hexes, read them back off the scope element —
// globals.css stays the single source of truth; a theme flip is a re-read.

export interface DrsPalette {
  ink: string;
  dim: string;
  faint: string;
  line: string;
  panel: string;
  raise: string;
  flag: string;
  purple: string;
  crash: string;
  speed: string;
  steer: string;
  throttle: string;
  night: string;
  tarmac: string;
  tarmac2: string;
  lane: string;
  litChamp: string;
  litField: string;
  litDead: string;
  litRay: string;
  litPurple: string;
  /** Canvas `font` family for instrument numerals. */
  mono: string;
}

const FALLBACK: DrsPalette = {
  ink: '#e7e8eb',
  dim: '#979ba4',
  faint: '#5c606a',
  line: '#383b42',
  panel: '#1a1c20',
  raise: '#242731',
  flag: '#e8641a',
  purple: '#a78bfa',
  crash: '#e5533f',
  speed: '#e8641a',
  steer: '#7168e0',
  throttle: '#2f9e5e',
  night: '#101114',
  tarmac: '#1b1d21',
  tarmac2: '#212329',
  lane: 'rgba(220,225,235,0.5)',
  litChamp: '#ff8a3c',
  litField: '#7d90ab',
  litDead: '#43464e',
  litRay: '#ffc46b',
  litPurple: '#a78bfa',
  mono: 'ui-monospace, monospace',
};

const VARS: Record<keyof DrsPalette, string> = {
  ink: '--drs-ink',
  dim: '--drs-dim',
  faint: '--drs-faint',
  line: '--drs-line',
  panel: '--drs-panel',
  raise: '--drs-raise',
  flag: '--drs-flag',
  purple: '--drs-purple',
  crash: '--drs-crash',
  speed: '--drs-speed',
  steer: '--drs-steer',
  throttle: '--drs-throttle',
  night: '--drs-night',
  tarmac: '--drs-tarmac',
  tarmac2: '--drs-tarmac-2',
  lane: '--drs-lane',
  litChamp: '--drs-lit-champ',
  litField: '--drs-lit-field',
  litDead: '--drs-lit-dead',
  litRay: '--drs-lit-ray',
  litPurple: '--drs-lit-purple',
  mono: '--font-readout',
};

export function readPalette(el: Element | null): DrsPalette {
  if (!el || typeof window === 'undefined') return FALLBACK;
  const cs = getComputedStyle(el);
  const out = {} as DrsPalette;
  for (const key of Object.keys(VARS) as (keyof DrsPalette)[]) {
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
