import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Saved trips: list per park, create, or update-by-slug. Waypoints are bare
// geometry ([[lon, lat, dayEnd], ...]) — see migration 026 for why.

const MAX_WAYPOINTS = 200;

function validWaypoints(w: unknown): w is [number, number, number][] {
  return (
    Array.isArray(w) &&
    w.length <= MAX_WAYPOINTS &&
    w.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 3 &&
        p.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
        Math.abs(p[0]) <= 180 &&
        Math.abs(p[1]) <= 90,
    )
  );
}

export async function GET(request: Request) {
  // The logbook is park-agnostic — pass ?park= only to scope it down.
  const park = new URL(request.url).searchParams.get('park');
  try {
    const { rows } = await pool.query(
      park
        ? `SELECT park, slug, name, jsonb_array_length(waypoints) AS waypoints, stats, updated_at
             FROM paddle_trips WHERE park = $1 ORDER BY updated_at DESC LIMIT 200`
        : `SELECT park, slug, name, jsonb_array_length(waypoints) AS waypoints, stats, updated_at
             FROM paddle_trips ORDER BY updated_at DESC LIMIT 200`,
      park ? [park] : [],
    );
    return NextResponse.json({ trips: rows });
  } catch (error) {
    console.error('paddle trips list error:', error);
    return NextResponse.json({ error: 'Failed to list trips' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { park, name, waypoints, cost, slug, stats } = body ?? {};
    if (
      typeof park !== 'string' ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80 ||
      !validWaypoints(waypoints) ||
      typeof cost !== 'object'
    ) {
      return NextResponse.json({ error: 'Bad trip payload' }, { status: 400 });
    }
    const statsJson = stats && typeof stats === 'object' ? JSON.stringify(stats) : null;

    if (typeof slug === 'string' && slug) {
      const { rowCount } = await pool.query(
        `UPDATE paddle_trips
            SET name = $2, waypoints = $3, cost = $4, stats = $5, updated_at = now()
          WHERE slug = $1`,
        [slug, name.trim(), JSON.stringify(waypoints), JSON.stringify(cost), statsJson],
      );
      if (rowCount) return NextResponse.json({ slug });
      // fall through to create when the slug vanished (deleted elsewhere)
    }

    const newSlug = `${name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'trip'}-${randomBytes(3).toString('hex')}`;
    await pool.query(
      `INSERT INTO paddle_trips (park, slug, name, waypoints, cost, stats)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [park, newSlug, name.trim(), JSON.stringify(waypoints), JSON.stringify(cost), statsJson],
    );
    return NextResponse.json({ slug: newSlug });
  } catch (error) {
    console.error('paddle trip save error:', error);
    return NextResponse.json({ error: 'Failed to save trip' }, { status: 500 });
  }
}
