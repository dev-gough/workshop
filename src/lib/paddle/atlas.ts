/**
 * Park silhouettes for The Outfitter's home cards. The neon outline is the
 * canoe country's real footprint (occupancy of the ingested network), not
 * the rectangular fetch bbox — so Algonquin looks like Algonquin.
 *
 * Occupancy grid → dilate → fill holes → contour → Chaikin-smooth.
 */
import pool from '../db';
import type { ParkOutline } from '@/app/projects/paddle/_lib/model';

export type Pt = [number, number]; // lon, lat

const cache = new Map<string, { builtAt: string | null; outline: ParkOutline }>();

const GRID = 80;
const DILATE = 2;
const CHAIKIN_ROUNDS = 2;

function stride<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(arr[Math.round(i * step)]!);
  out.push(arr[arr.length - 1]!);
  return out;
}

function chaikin(ring: Pt[], rounds: number): Pt[] {
  let cur = ring;
  for (let r = 0; r < rounds; r++) {
    const next: Pt[] = [];
    const n = cur.length;
    if (n < 3) return cur;
    for (let i = 0; i < n; i++) {
      const a = cur[i]!;
      const b = cur[(i + 1) % n]!;
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = next;
  }
  return cur;
}

function occupancyOutline(points: Pt[], bbox: [number, number, number, number]): Pt[] {
  const [w, s, e, n] = bbox;
  const spanX = e - w || 1;
  const spanY = n - s || 1;
  const cols = GRID;
  const rows = Math.max(24, Math.round(GRID * (spanY / spanX) * 0.75));
  const occupied = new Uint8Array(cols * rows);

  const mark = (lon: number, lat: number) => {
    const x = Math.floor(((lon - w) / spanX) * cols);
    const y = Math.floor(((n - lat) / spanY) * rows);
    if (x >= 0 && y >= 0 && x < cols && y < rows) occupied[y * cols + x] = 1;
  };
  for (const [lon, lat] of points) mark(lon, lat);

  const dilated = new Uint8Array(occupied);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!occupied[y * cols + x]) continue;
      for (let dy = -DILATE; dy <= DILATE; dy++) {
        for (let dx = -DILATE; dx <= DILATE; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) dilated[ny * cols + nx] = 1;
        }
      }
    }
  }

  const outside = new Uint8Array(cols * rows);
  const stack: number[] = [];
  const pushEmpty = (i: number) => {
    if (!dilated[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < cols; x++) {
    pushEmpty(x);
    pushEmpty((rows - 1) * cols + x);
  }
  for (let y = 0; y < rows; y++) {
    pushEmpty(y * cols);
    pushEmpty(y * cols + cols - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % cols;
    const y = (i / cols) | 0;
    if (x > 0) pushEmpty(i - 1);
    if (x + 1 < cols) pushEmpty(i + 1);
    if (y > 0) pushEmpty(i - cols);
    if (y + 1 < rows) pushEmpty(i + cols);
  }

  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && !outside[y * cols + x];

  let sx = -1;
  let sy = -1;
  for (let y = 0; y < rows && sx < 0; y++) {
    for (let x = 0; x < cols; x++) {
      if (inside(x, y) && !inside(x, y - 1)) {
        sx = x;
        sy = y;
        break;
      }
    }
  }
  if (sx < 0) return [];

  const N8: [number, number][] = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];
  const cells: [number, number][] = [];
  let x = sx;
  let y = sy;
  let dir = 2;
  const limit = cols * rows * 4;
  for (let step = 0; step < limit; step++) {
    cells.push([x, y]);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const nd = (dir + 6 + i) % 8;
      const nx = x + N8[nd]![0];
      const ny = y + N8[nd]![1];
      if (inside(nx, ny)) {
        x = nx;
        y = ny;
        dir = nd;
        found = true;
        break;
      }
    }
    if (!found) break;
    if (x === sx && y === sy && cells.length > 2) break;
  }
  if (cells.length < 6) return [];

  const lonOf = (cx: number) => w + ((cx + 0.5) / cols) * spanX;
  const latOf = (cy: number) => n - ((cy + 0.5) / rows) * spanY;
  const raw: Pt[] = cells.map(([cx, cy]) => [lonOf(cx), latOf(cy)]);
  return chaikin(stride(raw, 80), CHAIKIN_ROUNDS);
}

async function buildOutline(slug: string, name: string, bbox: [number, number, number, number], builtAt: string | null): Promise<ParkOutline> {
  const hit = cache.get(slug);
  if (hit && hit.builtAt === builtAt) return hit.outline;

  const segRes = await pool.query(`SELECT coords FROM paddle_segments WHERE park = $1`, [slug]);
  const occupancy: Pt[] = [];
  for (const row of segRes.rows as { coords: Pt[] }[]) {
    const c = row.coords;
    const step = Math.max(1, Math.floor(c.length / 8));
    for (let i = 0; i < c.length; i += step) occupancy.push(c[i]!);
  }

  let outline = occupancyOutline(occupancy, bbox);
  if (outline.length < 4) {
    const [w, s, e, n] = bbox;
    outline = [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
    ];
  }

  const card: ParkOutline = { slug, name, outline };
  cache.set(slug, { builtAt, outline: card });
  return card;
}

/** Every ingested park's silhouette — one round-trip for the card grid. */
export async function buildOutlines(): Promise<ParkOutline[]> {
  const { rows } = await pool.query(
    `SELECT slug, name, bbox, built_at FROM paddle_parks ORDER BY name`,
  );
  return Promise.all(
    rows.map((p) =>
      buildOutline(p.slug, p.name, p.bbox as [number, number, number, number], p.built_at),
    ),
  );
}
