/**
 * Routing regression suite for The Outfitter. Real trips are the fixtures —
 * every future trip trace should become one. Run after any ingest/alignment/
 * routing change:
 *
 *   npm run paddle-verify [-- --park algonquin]
 *
 * Reads the network straight from Postgres (no server needed) and routes
 * known trips through the same TripRouter the page uses. Fails loudly on
 * connectivity or cost regressions.
 */
import pool from '../src/lib/db';
import { DEFAULT_COST, TripRouter, fmtHours } from '../src/app/projects/paddle/_lib/route';
import type { Network } from '../src/app/projects/paddle/_lib/model';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const park = arg('--park') ?? 'algonquin';

interface Fixture {
  name: string;
  from: [number, number];
  to: [number, number];
  /** Assertions on the routed leg. */
  expect: {
    found: boolean;
    timeH?: [number, number];
    carries?: [number, number];
    paddleKm?: [number, number];
    minLatAbove?: number; // route must stay north of this (detour detector)
  };
}

// Devon's May 2026 fishing trip: Opeongo N-arm water taxi → Proulx →
// down Crow River to the end of Crow Bay. The P2→P3 leg is the canary for
// the split-severed-chain bug (691ebed): a broken Crow River chain reroutes
// it south through Dickson/Lavieille, tripling the time.
const FIXTURES: Record<string, Fixture[]> = {
  algonquin: [
    {
      name: 'Opeongo N-arm → Proulx',
      from: [-78.42007, 45.75734],
      to: [-78.44324, 45.8221],
      expect: { found: true, timeH: [2, 5], carries: [1, 8] },
    },
    {
      name: 'Proulx → Crow Bay (via Crow River, NOT Lavieille)',
      from: [-78.44324, 45.8221],
      to: [-78.29733, 45.85296],
      expect: { found: true, timeH: [4, 10], carries: [6, 22], minLatAbove: 45.8 },
    },
    {
      name: 'Cauliflower → Rence',
      from: [-78.2503, 45.386586],
      to: [-78.460936, 45.420305],
      expect: { found: true, timeH: [7, 14], paddleKm: [15, 30] },
    },
  ],
  temagami: [],
};

async function loadNetwork(slug: string): Promise<Network> {
  const [nodes, segments] = await Promise.all([
    pool.query(`SELECT id, lon, lat FROM paddle_nodes WHERE park = $1 ORDER BY id`, [slug]),
    pool.query(
      `SELECT id, kind, node_a AS a, node_b AS b, length_m, coords
         FROM paddle_segments WHERE park = $1 ORDER BY id`,
      [slug],
    ),
  ]);
  return { nodes: nodes.rows, segments: segments.rows, campsites: [], accessPoints: [] };
}

async function main() {
  let failures = 0;
  const fail = (msg: string) => {
    failures++;
    console.error(`  ✗ ${msg}`);
  };
  const ok = (msg: string) => console.log(`  ✓ ${msg}`);

  const net = await loadNetwork(park);
  console.log(`${park}: ${net.nodes.length} nodes, ${net.segments.length} segments`);

  // ── structural invariants ──
  const bigLoops = net.segments.filter((s) => s.a === s.b && s.length_m > 300);
  if (bigLoops.length) fail(`${bigLoops.length} self-loop segment(s) > 300 m (splitter regression): ${bigLoops.map((s) => s.id).join(', ')}`);
  else ok('no self-loop segments > 300 m');

  {
    const adj = new Map<number, number[]>();
    for (const s of net.segments) {
      (adj.get(s.a) ?? adj.set(s.a, []).get(s.a)!).push(s.b);
      (adj.get(s.b) ?? adj.set(s.b, []).get(s.b)!).push(s.a);
    }
    const seen = new Set<number>();
    let largest = 0;
    for (const n of net.nodes) {
      if (seen.has(n.id)) continue;
      let size = 0;
      const stack = [n.id];
      seen.add(n.id);
      while (stack.length) {
        const x = stack.pop()!;
        size++;
        for (const y of adj.get(x) ?? []) {
          if (!seen.has(y)) {
            seen.add(y);
            stack.push(y);
          }
        }
      }
      largest = Math.max(largest, size);
    }
    const share = largest / net.nodes.length;
    if (share < 0.85) fail(`largest component only ${(share * 100).toFixed(1)}% of nodes`);
    else ok(`largest component ${(share * 100).toFixed(1)}% of nodes`);
  }

  // ── trip fixtures ──
  const router = new TripRouter(net);
  for (const fx of FIXTURES[park] ?? []) {
    const a = router.snap(fx.from, 300);
    const b = router.snap(fx.to, 300);
    if (!a || !b) {
      fail(`${fx.name}: endpoint failed to snap (${!a ? 'from' : 'to'})`);
      continue;
    }
    const leg = router.route(a, b, DEFAULT_COST);
    const problems: string[] = [];
    if (leg.found !== fx.expect.found) problems.push(`found=${leg.found}`);
    if (fx.expect.timeH && (leg.timeH < fx.expect.timeH[0] || leg.timeH > fx.expect.timeH[1])) {
      problems.push(`time ${fmtHours(leg.timeH)} outside [${fx.expect.timeH.join(', ')}]h`);
    }
    if (fx.expect.carries && (leg.carries < fx.expect.carries[0] || leg.carries > fx.expect.carries[1])) {
      problems.push(`${leg.carries} carries outside [${fx.expect.carries.join(', ')}]`);
    }
    if (fx.expect.paddleKm) {
      const km = leg.paddleM / 1000;
      if (km < fx.expect.paddleKm[0] || km > fx.expect.paddleKm[1]) {
        problems.push(`paddle ${km.toFixed(1)}km outside [${fx.expect.paddleKm.join(', ')}]`);
      }
    }
    if (fx.expect.minLatAbove !== undefined && leg.found) {
      const minLat = Math.min(...leg.coords.map((c) => c[1]));
      if (minLat < fx.expect.minLatAbove) problems.push(`route dips to ${minLat.toFixed(3)} — detoured`);
    }
    if (problems.length) fail(`${fx.name}: ${problems.join('; ')}`);
    else ok(`${fx.name}: ${fmtHours(leg.timeH)}, ${leg.carries} carries, ${(leg.paddleM / 1000).toFixed(1)} km paddle`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
  await pool.end();
}

main();
