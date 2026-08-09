/**
 * Imagery witness for the paddle/portage classifier: sample the z17 ortho
 * corridor under every segment, score each sample water-or-land, and write
 * kind-change PROPOSALS into paddle_kind_overrides for the room's Review
 * tab. The imagery never rewrites the network by itself — Devon does.
 *
 *   npm run flag-imagery-kinds -- --park temagami [--dry-run] [--min-confidence 0.5]
 *   npm run flag-imagery-kinds -- --park temagami --calibrate
 *
 * --calibrate prints water/land feature distributions from unambiguous
 * truth samples (long big-lake paddle reaches vs long verified carries) —
 * rerun it before trusting new thresholds on another mosaic vintage.
 *
 * Water in these orthos: dark and spectrally FLAT (open water has almost no
 * texture at 0.8 m/px). Canopy is the opposite — strong speckle. Shadowed
 * shoreline is the gray zone; the smoothing + length floors keep isolated
 * ambiguous samples from becoming proposals.
 *
 * OHN gate (the lesson of Devon's first review round): samples inside a
 * mapped waterbody polygon COUNT AS WATER regardless of pixels. Leaf-off
 * marsh/beaver-meadow complexes are mapped waterbodies that photograph as
 * bright tan grass with a dark channel — pixel-flagging them proposed
 * portages across the middle of "lakes". The imagery witness only
 * testifies where OHN is weak: stream-proximity calls and unmapped water.
 * The gate only SUPPRESSES dry-flags on paddle segments; it never
 * manufactures wet-flags on portages from OHN alone.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pool from '../src/lib/db';
import { PARKS } from '../src/lib/paddle/parks';
import { haversineM } from '../src/lib/paddle/classify';
import { cutAtArcsM, polylineLenM } from '../src/lib/paddle/overrides';

const Z = 17;
const WORLD = 256 * 2 ** Z;
const STEP_M = 12; // sample spacing along a segment
const WIN = 7; // half-window (px) for local stats — 15×15 ≈ 12 m square
const CACHE_CAP = 512; // decoded tiles (~100 MB)

// Water = dark + flat. Calibrated on the Temagami mosaic (2026-08-08):
// water lum p10–p90 34–83 / std 0–8, carry-canopy lum 73–127 / std 17–34.
// Texture is the real discriminator; the lum cap keeps bright-flat gravel
// roads and bare rock out. Rerun --calibrate on new mosaic vintages.
const WATER_MAX_LUM = 100;
const WATER_MAX_STD = 12;

const SMOOTH_BLIP_M = 60; // flip runs shorter than this to their surroundings
const RUN_MIN_M = 300; // a contradictory run must be this long to propose
const FLIP_FRAC = 0.85; // whole-segment contradiction → flip proposal
const SEG_MIN_M = 120; // ignore shorter segments outright
const NULL_MAX_FRAC = 0.4; // too much missing imagery → skip segment
const DEDUPE_M = 60; // midpoint distance for "already proposed/decided"

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const slug = arg('--park');
if (!slug || !PARKS[slug]) {
  console.error('usage: npm run flag-imagery-kinds -- --park <slug> [--calibrate] [--dry-run]');
  process.exit(1);
}
const calibrate = process.argv.includes('--calibrate');
const dryRun = process.argv.includes('--dry-run');
const minConfidence = Number(arg('--min-confidence') ?? 0.5);

const pxX = (lon: number) => ((lon + 180) / 360) * WORLD;
const pxY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD;
};

interface Tile {
  data: Buffer;
  channels: number;
}
const tileCache = new Map<string, Tile | null>();

async function tile(x: number, y: number): Promise<Tile | null> {
  const key = `${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit !== undefined) return hit;
  let out: Tile | null = null;
  for (const ext of ['jpg', 'png']) {
    const file = path.join(process.cwd(), '.cache', 'paddle', slug!, 'imagery', String(Z), String(x), `${y}.${ext}`);
    try {
      await fs.access(file);
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      out = { data, channels: info.channels };
      break;
    } catch {
      /* try next ext / miss */
    }
  }
  if (tileCache.size >= CACHE_CAP) {
    tileCache.delete(tileCache.keys().next().value!);
  }
  tileCache.set(key, out);
  return out;
}

/** Mean luminance + stddev of the window around a ground point; null where
 *  imagery is missing or transparent (Ontario-boundary voids). */
async function features(lon: number, lat: number): Promise<{ lum: number; std: number } | null> {
  const gx = pxX(lon);
  const gy = pxY(lat);
  const tx = Math.floor(gx / 256);
  const ty = Math.floor(gy / 256);
  const t = await tile(tx, ty);
  if (!t) return null;
  // clamp the window inside this tile — a few px of bias beats 4-tile joins
  const cx = Math.min(255 - WIN, Math.max(WIN, Math.round(gx - tx * 256)));
  const cy = Math.min(255 - WIN, Math.max(WIN, Math.round(gy - ty * 256)));
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let dy = -WIN; dy <= WIN; dy++) {
    for (let dx = -WIN; dx <= WIN; dx++) {
      const i = ((cy + dy) * 256 + (cx + dx)) * t.channels;
      if (t.channels === 4 && t.data[i + 3] < 128) continue; // void
      const l = 0.299 * t.data[i] + 0.587 * t.data[i + 1] + 0.114 * t.data[i + 2];
      sum += l;
      sumSq += l * l;
      n++;
    }
  }
  if (n < 40) return null;
  const mean = sum / n;
  return { lum: mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

/** Evenly spaced sample points (lon/lat) every STEP_M along a polyline. */
function samplePoints(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = [coords[0]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const len = haversineM(coords[i - 1], coords[i]);
    let d = STEP_M - carry;
    while (d <= len) {
      const t = d / len;
      out.push([
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ]);
      d += STEP_M;
    }
    carry = (carry + len) % STEP_M;
  }
  return out;
}

/** Flip runs of `value` no longer than maxLen sitting between opposite runs. */
function fillRuns(flags: boolean[], value: boolean, maxLen: number): boolean {
  let changed = false;
  let i = 0;
  while (i < flags.length) {
    if (flags[i] !== value) {
      i++;
      continue;
    }
    let j = i;
    while (j < flags.length && flags[j] === value) j++;
    if (i > 0 && j < flags.length && j - i <= maxLen) {
      for (let k = i; k < j; k++) flags[k] = !value;
      changed = true;
    }
    i = j;
  }
  return changed;
}

interface Seg {
  id: number;
  kind: string;
  length_m: number;
  coords: [number, number][];
}

interface Lake {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  rings: [number, number][][];
}

/** Even-odd point-in-rings — handles island holes regardless of winding. */
function inRings(rings: [number, number][][], p: [number, number]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

async function loadLakes(): Promise<Lake[]> {
  const { rows } = (await pool.query(`SELECT rings FROM paddle_lakes WHERE park = $1`, [
    slug,
  ])) as { rows: { rings: [number, number][][] }[] };
  return rows.map((l) => {
    let x0 = 180;
    let x1 = -180;
    let y0 = 90;
    let y1 = -90;
    for (const ring of l.rings) {
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return { x0, x1, y0, y1, rings: l.rings };
  });
}

async function main() {
  const { rows: segs } = (await pool.query(
    `SELECT id, kind, length_m, coords FROM paddle_segments WHERE park = $1 ORDER BY id`,
    [slug],
  )) as { rows: Seg[] };
  const lakes = await loadLakes();
  console.log(`${slug}: ${segs.length} segments, ${lakes.length} waterbody polygons for the gate`);

  if (calibrate) {
    await runCalibration(segs);
    await pool.end();
    return;
  }

  const { rows: existing } = (await pool.query(
    `SELECT before_kind, coords FROM paddle_kind_overrides WHERE park = $1`,
    [slug],
  )) as { rows: { before_kind: string; coords: [number, number][] }[] };
  const existingMids = existing.map((e) => ({
    kind: e.before_kind,
    mid: midpoint(e.coords),
  }));

  // tile-locality order keeps the decode cache warm
  const work = segs
    .filter((s) => (s.kind === 'paddle' || s.kind === 'portage') && s.length_m >= SEG_MIN_M)
    .sort((a, b) => pxX(a.coords[0][0]) - pxX(b.coords[0][0]));

  let proposals = 0;
  let skippedNull = 0;
  let deduped = 0;
  let scanned = 0;
  for (const seg of work) {
    if (++scanned % 250 === 0) console.log(`  ${scanned}/${work.length} scanned, ${proposals} proposals`);
    const pts = samplePoints(seg.coords);
    // OHN gate (paddle only): candidate lakes overlapping this segment's bbox
    const pad = 0.0005;
    let sx0 = 180;
    let sx1 = -180;
    let sy0 = 90;
    let sy1 = -90;
    for (const [x, y] of seg.coords) {
      if (x < sx0) sx0 = x;
      if (x > sx1) sx1 = x;
      if (y < sy0) sy0 = y;
      if (y > sy1) sy1 = y;
    }
    const nearby =
      seg.kind === 'paddle'
        ? lakes.filter((l) => l.x1 >= sx0 - pad && l.x0 <= sx1 + pad && l.y1 >= sy0 - pad && l.y0 <= sy1 + pad)
        : [];
    const gated = pts.map(
      (p) => nearby.some((l) => p[0] >= l.x0 && p[0] <= l.x1 && p[1] >= l.y0 && p[1] <= l.y1 && inRings(l.rings, p)),
    );

    const feats = await Promise.all(
      pts.map((p, i) => (gated[i] ? null : features(p[0], p[1]))),
    );
    const nullFrac = feats.filter((f, i) => f === null && !gated[i]).length / feats.length;
    if (nullFrac > NULL_MAX_FRAC) {
      skippedNull++;
      continue;
    }
    // null samples inherit their neighbor so runs stay contiguous
    const flags: boolean[] = [];
    let last = false;
    for (let i = 0; i < feats.length; i++) {
      const f = feats[i];
      if (gated[i]) last = true; // mapped waterbody — OHN outranks pixels
      else if (f) last = f.lum <= WATER_MAX_LUM && f.std <= WATER_MAX_STD;
      flags.push(last);
    }
    const blipN = Math.max(1, Math.round(SMOOTH_BLIP_M / STEP_M));
    for (let guard = 0; guard < 20; guard++) {
      const a = fillRuns(flags, true, blipN);
      const b = fillRuns(flags, false, blipN);
      if (!a && !b) break;
    }

    const wantWater = seg.kind === 'paddle';
    const contra = flags.map((w) => w !== wantWater);
    const contraFrac = contra.filter(Boolean).length / contra.length;
    const toKind = seg.kind === 'paddle' ? 'portage' : 'paddle';

    type Prop = { coords: [number, number][]; lengthM: number; frac: number };
    const props: Prop[] = [];
    if (contraFrac >= FLIP_FRAC) {
      props.push({ coords: seg.coords, lengthM: seg.length_m, frac: contraFrac });
    } else {
      // contradictory runs long enough to stand on their own
      let i = 0;
      while (i < contra.length) {
        if (!contra[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j < contra.length && contra[j]) j++;
        const runM = (j - i) * STEP_M;
        if (runM >= RUN_MIN_M) {
          const a0 = i * STEP_M;
          const a1 = Math.min(j * STEP_M, seg.length_m - 1);
          const cutArcs = [a0, a1].filter((a) => a > 1 && a < seg.length_m - 1);
          const cutPieces = cutAtArcsM(seg.coords, cutArcs);
          const piece = cutArcs.length === 0 ? seg.coords : cutPieces[a0 <= 1 ? 0 : 1];
          props.push({ coords: piece, lengthM: polylineLenM(piece), frac: 1 });
        }
        i = j;
      }
    }

    for (const p of props) {
      const conf = Math.round(p.frac * Math.min(1, p.lengthM / 400) * 100) / 100;
      if (conf < minConfidence) continue;
      const mid = midpoint(p.coords);
      if (existingMids.some((e) => e.kind === seg.kind && haversineM(e.mid, mid) <= DEDUPE_M)) {
        deduped++;
        continue;
      }
      proposals++;
      const evidence = {
        waterFrac: Math.round((flags.filter(Boolean).length / flags.length) * 100) / 100,
        nullFrac: Math.round(nullFrac * 100) / 100,
        samples: flags.length,
        lengthM: Math.round(p.lengthM),
        confidence: conf,
      };
      if (dryRun) {
        console.log(
          `  #${seg.id} ${seg.kind}→${toKind} ${Math.round(p.lengthM)} m conf=${conf} water=${evidence.waterFrac}`,
        );
        continue;
      }
      await pool.query(
        `INSERT INTO paddle_kind_overrides (park, seg_hint, before_kind, coords, pieces, evidence)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          slug,
          seg.id,
          seg.kind,
          JSON.stringify(p.coords),
          JSON.stringify([{ coords: p.coords, kind: toKind }]),
          JSON.stringify(evidence),
        ],
      );
      existingMids.push({ kind: seg.kind, mid });
    }
  }
  console.log(
    `done — ${proposals} proposals${dryRun ? ' (dry run, not written)' : ''}, ` +
      `${deduped} deduped against existing rows, ${skippedNull} segments skipped for missing imagery.`,
  );
  await pool.end();
}

function midpoint(coords: [number, number][]): [number, number] {
  const half = polylineLenM(coords) / 2;
  const cut = cutAtArcsM(coords, [half]);
  return cut[0][cut[0].length - 1];
}

/** Feature distributions from unambiguous ground truth. */
async function runCalibration(segs: Seg[]) {
  const collect = async (kind: string, minM: number, label: string) => {
    const lums: number[] = [];
    const stds: number[] = [];
    const refs = segs.filter((s) => s.kind === kind && s.length_m >= minM).slice(0, 120);
    for (const seg of refs) {
      // middle third only — endpoints sit at shorelines/landings by definition
      const pts = samplePoints(seg.coords);
      for (const [lon, lat] of pts.slice(Math.floor(pts.length / 3), Math.floor((2 * pts.length) / 3))) {
        const f = await features(lon, lat);
        if (f) {
          lums.push(f.lum);
          stds.push(f.std);
        }
      }
    }
    const dec = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      return [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => Math.round(s[Math.floor(q * (s.length - 1))]));
    };
    console.log(`${label}: ${refs.length} refs, ${lums.length} samples`);
    console.log(`  lum p10/p25/p50/p75/p90: ${dec(lums).join(' / ')}`);
    console.log(`  std p10/p25/p50/p75/p90: ${dec(stds).join(' / ')}`);
  };
  await collect('paddle', 800, 'WATER truth (long paddle reaches)');
  await collect('portage', 800, 'LAND truth (long carries)');
  console.log(`current thresholds: lum<=${WATER_MAX_LUM} && std<=${WATER_MAX_STD}`);
}

main();
