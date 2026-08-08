/**
 * Pulls portage centerlines out of a park's Maps-by-Jeff raster chart.
 *
 * None of the chart's purchasable formats carry vector data, but the
 * cartography is machine-readable: portages are drawn as ~4 px near-black
 * dots riding a saturated-yellow route ribbon (v6 style), a color pairing
 * used nowhere else on the map — distance-label boxes are *pale* yellow and
 * their text fails the ribbon-adjacency test. For a requested bbox this
 * module composites the z15 tiles, masks dark dot components that sit on
 * ribbon yellow, morphologically closes the dot chain, and thins it to a
 * 1 px skeleton that chartalign.ts traces paths along.
 */
import sharp from 'sharp';
import { readChartTile } from './jefftiles';

export const CHART_Z = 15;
const TILE = 256;

// v6 palette. Route ribbons come in three maintenance classes: maintained =
// saturated yellow ≈ #F0D838, low-maintenance = salmon ≈ #E08090–#D08080,
// unmaintained = orange ≈ #E0A060–#D09050. Each class's distance-label boxes
// are a paler tint of the same hue and must NOT match (yellow boxes have
// B ≥ 104, pink boxes have R−G ≈ 32, orange boxes have B ≥ 128).
// Portage dots/dashes ≈ #212121, up to #606060 with anti-aliasing.
const isRibbon = (r: number, g: number, b: number) =>
  (r > 200 && g > 170 && b < 95) ||
  (r > 195 && g > 100 && g < 175 && b > 100 && b < 185 && r - g > 50) ||
  (r > 195 && g > 130 && g < 185 && b < 115 && r - g > 40 && g - b > 40);
const isDark = (r: number, g: number, b: number) => r < 100 && g < 100 && b < 100;

// Neighboring dots anti-alias together, so a portage's dot chain usually
// arrives as ONE long dark component — it can't be filtered by area. What
// separates chains from label wedges / end triangles is stroke thickness,
// and what separates them from label text is how much ribbon they touch.
const THICK_R = 3;         // a dark px whose full (2r+1)² block is dark marks a thick shape
const RIBBON_NEAR_R = 3;   // px — anti-aliasing separates dots from ribbon by a mid-tone ring
const RIBBON_NEAR_FRAC = 0.5; // component pixels that must sit within RIBBON_NEAR_R of ribbon

// Distance-label boxes are pale-tinted plates whose interiors carry
// elevation-profile graphs — a dark skyline stroke on a profile fill that
// color-matches the salmon ribbon, which reads as a bogus dot chain. Pale
// fills this size get their whole bounding box struck from the masks (the
// paper margin outside the park is pale too, hence the area cap).
const LABEL_PALE_MIN = 800;    // px²
const LABEL_PALE_MAX = 60000;  // px²
const LABEL_PAD = 3;           // px around the box bbox
const isPale = (r: number, g: number, b: number) => r > 230 && g > 190 && b > 90;
const CLOSE_R = 6;         // px — bridges dot gaps plus stretches occluded by label wedges
const MIN_SKEL_PX = 8;     // drop skeleton crumbs smaller than this

export const mercPxX = (lon: number) => ((lon + 180) / 360) * 2 ** CHART_Z * TILE;
export const mercPxY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** CHART_Z * TILE;
};
export const mercLon = (px: number) => (px / (2 ** CHART_Z * TILE)) * 360 - 180;
export const mercLat = (py: number) => {
  const n = Math.PI - (2 * Math.PI * py) / (2 ** CHART_Z * TILE);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** Decoded-tile cache; null marks tiles with no bundle coverage. */
export type TileCache = Map<string, Uint8Array | null>;

async function tileRGB(
  slug: string,
  x: number,
  y: number,
  cache: TileCache,
): Promise<Uint8Array | null> {
  const key = `${x}/${y}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let rgb: Uint8Array | null = null;
  const buf = await readChartTile(slug, CHART_Z, x, y);
  if (buf) {
    // Composite onto a white canvas so palette/greyscale/alpha PNGs all
    // normalize to plain 3-channel RGB.
    // .removeAlpha() matters: compositing an alpha PNG promotes the canvas
    // to 4 channels, and the mask loops below assume a 3-byte stride.
    const raw = await sharp({ create: { width: TILE, height: TILE, channels: 3, background: '#fff' } })
      .composite([{ input: buf, left: 0, top: 0 }])
      .removeAlpha()
      .raw()
      .toBuffer();
    rgb = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
  }
  if (cache.size >= 600) cache.clear(); // segments arrive tile-sorted, so a crude cap is fine
  cache.set(key, rgb);
  return rgb;
}

/** Separable Chebyshev dilate/erode used to close the dot chain. */
function maxFilter(src: Uint8Array, w: number, h: number, r: number, invert: boolean): Uint8Array {
  const mid = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const val = (v: number) => (invert ? 1 - v : v);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) {
        if (val(src[row + k])) { m = 1; break; }
      }
      mid[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) {
        if (mid[k * w + x]) { m = 1; break; }
      }
      out[y * w + x] = invert ? 1 - m : m;
    }
  }
  return out;
}

/** Zhang–Suen thinning, in place. */
function thin(mask: Uint8Array, w: number, h: number): void {
  const toClear: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (!mask[i]) continue;
          const p2 = mask[i - w], p3 = mask[i - w + 1], p4 = mask[i + 1], p5 = mask[i + w + 1];
          const p6 = mask[i + w], p7 = mask[i + w - 1], p8 = mask[i - 1], p9 = mask[i - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          let a = 0;
          if (!p2 && p3) a++;
          if (!p3 && p4) a++;
          if (!p4 && p5) a++;
          if (!p5 && p6) a++;
          if (!p6 && p7) a++;
          if (!p7 && p8) a++;
          if (!p8 && p9) a++;
          if (!p9 && p2) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          toClear.push(i);
        }
      }
      if (toClear.length) {
        changed = true;
        for (const i of toClear) mask[i] = 0;
      }
    }
  }
}

// Open-water fill ≈ #A0D0F0 (streams render in the same family). Lake-name
// text (#20A0E0-ish) and rapids arrows fail the G floor; label boxes fail B.
const isWaterPx = (r: number, g: number, b: number) =>
  b > 200 && b - r > 40 && g > 160 && g < 235;

/**
 * Fraction of the given global-z15-pixel samples that sit on chart water.
 * Arbitration input for segments the dot chain disowns: water underneath
 * means "paddle", dry paper means "track". Null if no tiles cover the line.
 */
export async function chartWaterFraction(
  slug: string,
  samples: [number, number][],
  cache: TileCache,
): Promise<number | null> {
  // A 2 px window: creeks draw as 2–3 px blue lines the route wiggles along.
  const WIN = 2;
  let n = 0;
  let water = 0;
  for (const [gx, gy] of samples) {
    n++;
    hit: for (let dy = -WIN; dy <= WIN; dy++) {
      for (let dx = -WIN; dx <= WIN; dx++) {
        const sx = gx + dx;
        const sy = gy + dy;
        const tx = Math.floor(sx / TILE);
        const ty = Math.floor(sy / TILE);
        const rgb = await tileRGB(slug, tx, ty, cache);
        if (!rgb) continue;
        const px = Math.min(TILE - 1, Math.floor(sx - tx * TILE));
        const py = Math.min(TILE - 1, Math.floor(sy - ty * TILE));
        const i = (py * TILE + px) * 3;
        if (isWaterPx(rgb[i], rgb[i + 1], rgb[i + 2])) {
          water++;
          break hit;
        }
      }
    }
  }
  return n ? water / n : null;
}

export interface ChartSkeleton {
  w: number;
  h: number;
  gx0: number; // global z15 pixel coords of this raster's (0,0)
  gy0: number;
  px: Uint8Array;     // 1 = portage centerline pixel
  ribbon: Uint8Array; // 1 = route-ribbon pixel (any maintenance class) — a
                      // ribbon with no dots under a line means paddling
}

export async function extractPortageSkeleton(
  slug: string,
  bbox: [number, number, number, number], // [w, s, e, n] lon/lat
  cache: TileCache,
): Promise<ChartSkeleton | null> {
  const tx0 = Math.floor(mercPxX(bbox[0]) / TILE);
  const tx1 = Math.floor(mercPxX(bbox[2]) / TILE);
  const ty0 = Math.floor(mercPxY(bbox[3]) / TILE);
  const ty1 = Math.floor(mercPxY(bbox[1]) / TILE);
  const w = (tx1 - tx0 + 1) * TILE;
  const h = (ty1 - ty0 + 1) * TILE;

  const ribbon = new Uint8Array(w * h);
  const dark = new Uint8Array(w * h);
  const pale = new Uint8Array(w * h);
  let covered = false;
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const rgb = await tileRGB(slug, tx, ty, cache);
      if (!rgb) continue;
      covered = true;
      const ox = (tx - tx0) * TILE;
      const oy = (ty - ty0) * TILE;
      for (let y = 0; y < TILE; y++) {
        let s = (y * TILE) * 3;
        let d = (oy + y) * w + ox;
        for (let x = 0; x < TILE; x++, s += 3, d++) {
          const r = rgb[s], g = rgb[s + 1], b = rgb[s + 2];
          if (isRibbon(r, g, b)) ribbon[d] = 1;
          else if (isDark(r, g, b)) dark[d] = 1;
          if (isPale(r, g, b)) pale[d] = 1;
        }
      }
    }
  }
  if (!covered) return null;

  // Strike label-box bounding boxes from the masks.
  {
    const seenPale = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let i = 0; i < pale.length; i++) {
      if (!pale[i] || seenPale[i]) continue;
      stack.length = 0;
      stack.push(i);
      seenPale[i] = 1;
      let area = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      while (stack.length) {
        const p = stack.pop()!;
        area++;
        const x = p % w;
        const y = (p / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && pale[p - 1] && !seenPale[p - 1]) { seenPale[p - 1] = 1; stack.push(p - 1); }
        if (x < w - 1 && pale[p + 1] && !seenPale[p + 1]) { seenPale[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && pale[p - w] && !seenPale[p - w]) { seenPale[p - w] = 1; stack.push(p - w); }
        if (y < h - 1 && pale[p + w] && !seenPale[p + w]) { seenPale[p + w] = 1; stack.push(p + w); }
      }
      if (area < LABEL_PALE_MIN || area > LABEL_PALE_MAX) continue;
      const x0 = Math.max(0, minX - LABEL_PAD);
      const x1 = Math.min(w - 1, maxX + LABEL_PAD);
      const y0 = Math.max(0, minY - LABEL_PAD);
      const y1 = Math.min(h - 1, maxY + LABEL_PAD);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          ribbon[y * w + x] = 0;
          dark[y * w + x] = 0;
        }
      }
    }
  }

  // Dot chains anti-alias into the thick marks they touch (label wedges,
  // end triangles), so thick shapes are erased pixel-wise first: any dark
  // pixel whose full (2r+1)² block is dark seeds a thick core, dilated to
  // swallow the whole shape. What survives is thin strokes only.
  const thickCore = new Uint8Array(w * h);
  for (let y = THICK_R; y < h - THICK_R; y++) {
    px: for (let x = THICK_R; x < w - THICK_R; x++) {
      if (!dark[y * w + x]) continue;
      for (let dy = -THICK_R; dy <= THICK_R; dy++) {
        for (let dx = -THICK_R; dx <= THICK_R; dx++) {
          if (!dark[(y + dy) * w + x + dx]) continue px;
        }
      }
      thickCore[y * w + x] = 1;
    }
  }
  const thickZone = maxFilter(thickCore, w, h, THICK_R + 1, false);
  const darkThin = new Uint8Array(w * h);
  for (let i = 0; i < dark.length; i++) darkThin[i] = dark[i] && !thickZone[i] ? 1 : 0;

  // Of the thin strokes, keep components hugging the ribbon: the dot chains.
  // Strokes with little ribbon contact are label text and box casings.
  const ribbonNear = maxFilter(ribbon, w, h, RIBBON_NEAR_R, false);
  const dots = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let i = 0; i < darkThin.length; i++) {
    if (!darkThin[i] || seen[i]) continue;
    stack.length = 0;
    comp.length = 0;
    stack.push(i);
    seen[i] = 1;
    let nearRibbon = 0;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      if (ribbonNear[p]) nearRibbon++;
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (darkThin[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (nearRibbon >= Math.max(2, comp.length * RIBBON_NEAR_FRAC)) {
      for (const p of comp) dots[p] = 1;
    }
  }

  if (process.env.CHART_DEBUG) {
    const n = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
    console.error(`[chartvector] dark=${n(dark)} ribbon=${n(ribbon)} thickCore=${n(thickCore)} darkThin=${n(darkThin)} dots=${n(dots)}`);
  }

  // Close the chain, thin to a centerline, and drop isolated crumbs.
  const dilated = maxFilter(dots, w, h, CLOSE_R, false);
  const closed = maxFilter(dilated, w, h, CLOSE_R, true);
  for (let x = 0; x < w; x++) closed[x] = closed[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) closed[y * w] = closed[y * w + w - 1] = 0;
  thin(closed, w, h);

  seen.fill(0);
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i] || seen[i]) continue;
    stack.length = 0;
    comp.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (closed[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (comp.length < MIN_SKEL_PX) for (const p of comp) closed[p] = 0;
  }

  return { w, h, gx0: tx0 * TILE, gy0: ty0 * TILE, px: closed, ribbon };
}
