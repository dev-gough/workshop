/**
 * Applying approved kind overrides (the imagery review queue) to
 * paddle_segments. Overrides are geometry-anchored — segment ids reassign on
 * every re-ingest — so applying means: find the segment the flagged section
 * lives on today, split it at the piece boundaries if needed, and set each
 * piece's kind. Called from the approve API (immediate effect) and from the
 * end of ingestPark (so decisions survive rebuilds, same rule as trips).
 */
import type { Pool } from 'pg';
import { haversineM } from './classify';

export interface OverridePiece {
  coords: [number, number][];
  kind: 'paddle' | 'portage' | 'track';
}

export interface OverrideRow {
  id: number;
  park: string;
  before_kind: string;
  coords: [number, number][];
  pieces: OverridePiece[];
}

/** How far the section's anchor points may sit from the target segment.
 *  OTN geometry wobbles a few metres between pulls; 80 m rejects wrong-
 *  segment matches while surviving generalization drift. */
const MATCH_M = 80;

export function polylineLenM(coords: [number, number][]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += haversineM(coords[i - 1], coords[i]);
  return len;
}

/** Arc-length position (m) of the closest approach of `p` to the polyline,
 *  plus the offset distance. Planar per-edge math on metre-scaled deltas —
 *  fine at segment scale. */
export function projectArcM(
  coords: [number, number][],
  p: [number, number],
): { arcM: number; distM: number; point: [number, number] } {
  const cosLat = Math.cos((p[1] * Math.PI) / 180);
  const mx = (c: [number, number]) => c[0] * 111_320 * cosLat;
  const my = (c: [number, number]) => c[1] * 110_540;
  const px = mx(p);
  const py = my(p);
  let best = { arcM: 0, distM: Infinity, point: coords[0] };
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const ax = mx(coords[i - 1]);
    const ay = my(coords[i - 1]);
    const bx = mx(coords[i]);
    const by = my(coords[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len))) : 0;
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best.distM) {
      best = {
        arcM: walked + len * t,
        distM: d,
        point: [
          coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
          coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
        ],
      };
    }
    walked += len;
  }
  return best;
}

/** Cut a polyline at ascending arc positions (m), keeping cut vertices. */
export function cutAtArcsM(
  coords: [number, number][],
  arcs: number[],
): [number, number][][] {
  const pieces: [number, number][][] = [];
  let piece: [number, number][] = [coords[0]];
  let walked = 0;
  let cut = 0;
  for (let i = 1; i < coords.length; i++) {
    const len = haversineM(coords[i - 1], coords[i]);
    while (cut < arcs.length && arcs[cut] <= walked + len) {
      const t = len ? (arcs[cut] - walked) / len : 0;
      const v: [number, number] = [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
      ];
      piece.push(v);
      pieces.push(piece);
      piece = [v];
      cut++;
    }
    piece.push(coords[i]);
    walked += len;
  }
  pieces.push(piece);
  return pieces;
}

interface SegRow {
  id: number;
  kind: string;
  node_a: number;
  node_b: number;
  coords: [number, number][];
}

/**
 * Apply one approved override. Returns { applied, reason } — a false result
 * leaves the row approved-but-unapplied (e.g. the section no longer matches
 * any segment after a rebuild reshaped the network there).
 */
export async function applyOverride(
  pool: Pool,
  o: OverrideRow,
): Promise<{ applied: boolean; reason: string }> {
  const { rows: segs } = (await pool.query(
    `SELECT id, kind, node_a, node_b, coords FROM paddle_segments WHERE park = $1`,
    [o.park],
  )) as { rows: SegRow[] };

  // The section's endpoints + midpoint must all sit on the same segment.
  const s0 = o.coords[0];
  const s1 = o.coords[o.coords.length - 1];
  const sectionLen = polylineLenM(o.coords);
  const mid = cutAtArcsM(o.coords, [sectionLen / 2])[0].slice(-1)[0];
  let target: SegRow | null = null;
  let anchors: { a0: number; a1: number } | null = null;
  let bestScore = Infinity;
  for (const seg of segs) {
    const p0 = projectArcM(seg.coords, s0);
    const p1 = projectArcM(seg.coords, s1);
    const pm = projectArcM(seg.coords, mid);
    const worst = Math.max(p0.distM, p1.distM, pm.distM);
    if (worst > MATCH_M || worst >= bestScore) continue;
    bestScore = worst;
    target = seg;
    anchors = { a0: Math.min(p0.arcM, p1.arcM), a1: Math.max(p0.arcM, p1.arcM) };
  }
  if (!target || !anchors) return { applied: false, reason: 'no matching segment' };

  const segLen = polylineLenM(target.coords);
  const COVER_SLACK_M = 40; // section ~= whole segment within endpoint noise

  // Piece boundaries as arc positions on the target segment: the section's
  // own ends, plus each internal junction between proposed pieces.
  const boundaries: { arcM: number; }[] = [];
  const kinds: string[] = [];
  const wholeStart = anchors.a0 <= COVER_SLACK_M;
  const wholeEnd = anchors.a1 >= segLen - COVER_SLACK_M;
  if (!wholeStart) {
    boundaries.push({ arcM: anchors.a0 });
    kinds.push(target.kind); // untouched head keeps its kind
  }
  for (let i = 0; i < o.pieces.length; i++) {
    kinds.push(o.pieces[i].kind);
    if (i < o.pieces.length - 1) {
      const junction = o.pieces[i].coords[o.pieces[i].coords.length - 1];
      const pj = projectArcM(target.coords, junction);
      if (pj.distM > MATCH_M) return { applied: false, reason: 'piece junction off segment' };
      boundaries.push({ arcM: pj.arcM });
    }
  }
  if (!wholeEnd) {
    boundaries.push({ arcM: anchors.a1 });
    kinds.push(target.kind); // untouched tail
  }

  if (boundaries.length === 0) {
    // Whole-segment flip.
    if (target.kind === kinds[0]) return { applied: true, reason: 'already applied' };
    await pool.query(`UPDATE paddle_segments SET kind = $1 WHERE park = $2 AND id = $3`, [
      kinds[0],
      o.park,
      target.id,
    ]);
    await refreshStats(pool, o.park);
    return { applied: true, reason: 'flipped whole segment' };
  }

  // Split: cut geometry, mint nodes at the cuts, replace the row.
  const arcs = boundaries.map((b) => b.arcM).sort((a, b) => a - b);
  if (arcs.some((a, i) => i > 0 && a - arcs[i - 1] < 20)) {
    return { applied: false, reason: 'degenerate cut spacing' };
  }
  const geomPieces = cutAtArcsM(target.coords, arcs);
  if (geomPieces.length !== kinds.length) {
    return { applied: false, reason: `piece mismatch (${geomPieces.length} vs ${kinds.length})` };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: nmax } = await client.query(
      `SELECT COALESCE(MAX(id), 0) AS m FROM paddle_nodes WHERE park = $1`,
      [o.park],
    );
    const { rows: smax } = await client.query(
      `SELECT COALESCE(MAX(id), 0) AS m FROM paddle_segments WHERE park = $1`,
      [o.park],
    );
    let nextNode = Number(nmax[0].m) + 1;
    let nextSeg = Number(smax[0].m) + 1;

    // Chain: node_a — [piece0] — n1 — [piece1] — … — node_b
    const nodeIds: number[] = [target.node_a];
    for (let i = 0; i < arcs.length; i++) {
      const v = geomPieces[i][geomPieces[i].length - 1];
      await client.query(
        `INSERT INTO paddle_nodes (park, id, lon, lat) VALUES ($1, $2, $3, $4)`,
        [o.park, nextNode, v[0], v[1]],
      );
      nodeIds.push(nextNode++);
    }
    nodeIds.push(target.node_b);

    await client.query(`DELETE FROM paddle_segments WHERE park = $1 AND id = $2`, [
      o.park,
      target.id,
    ]);
    for (let i = 0; i < geomPieces.length; i++) {
      await client.query(
        `INSERT INTO paddle_segments (park, id, kind, node_a, node_b, length_m, coords)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          o.park,
          nextSeg++,
          kinds[i],
          nodeIds[i],
          nodeIds[i + 1],
          polylineLenM(geomPieces[i]),
          JSON.stringify(geomPieces[i]),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await refreshStats(pool, o.park);
  return { applied: true, reason: `split into ${geomPieces.length} pieces` };
}

/** Keep paddle_parks.stats honest after approve-time edits. */
async function refreshStats(pool: Pool, park: string): Promise<void> {
  await pool.query(
    `UPDATE paddle_parks p SET stats = stats || (
       SELECT jsonb_build_object(
         'paddleKm',  round((COALESCE(SUM(length_m) FILTER (WHERE kind = 'paddle'), 0) / 1000)::numeric, 1),
         'portageKm', round((COALESCE(SUM(length_m) FILTER (WHERE kind = 'portage'), 0) / 1000)::numeric, 1),
         'portages',  COUNT(*) FILTER (WHERE kind = 'portage'),
         'segments',  COUNT(*)
       ) FROM paddle_segments s WHERE s.park = p.slug
     ) WHERE p.slug = $1`,
    [park],
  );
}

/** Re-apply every approved override for a park — the post-ingest pass. */
export async function applyApprovedOverrides(
  pool: Pool,
  park: string,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const { rows } = (await pool.query(
    `SELECT id, park, before_kind, coords, pieces FROM paddle_kind_overrides
      WHERE park = $1 AND status = 'approved' ORDER BY id`,
    [park],
  )) as { rows: OverrideRow[] };
  for (const row of rows) {
    const res = await applyOverride(pool, row);
    log(`  override #${row.id}: ${res.applied ? '✓' : '✗'} ${res.reason}`);
    if (res.applied) {
      await pool.query(`UPDATE paddle_kind_overrides SET applied_at = now() WHERE id = $1`, [
        row.id,
      ]);
    }
  }
}
