import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { generateToken, setAuthCookie } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

const COLOR_RE = /^#[0-9a-f]{6}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invite_token, name, color } = body as {
      invite_token?: unknown;
      name?: unknown;
      color?: unknown;
    };

    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 60) {
      return NextResponse.json({ error: 'name required (1-60 chars)' }, { status: 400 });
    }
    if (typeof color !== 'string' || !COLOR_RE.test(color)) {
      return NextResponse.json({ error: 'color must be a hex like #22d3ee' }, { status: 400 });
    }

    let groupId: number | null = null;

    if (typeof invite_token === 'string' && invite_token.length > 0) {
      const { rows } = await pool.query(
        `SELECT id FROM splitwiser_groups
         WHERE invite_token = $1 AND invite_enabled = TRUE AND archived_at IS NULL`,
        [invite_token],
      );
      if (rows.length === 0) {
        return NextResponse.json({ error: 'invalid or disabled invite' }, { status: 404 });
      }
      groupId = rows[0].id;
    } else {
      // Bootstrap path: only allowed when no users exist yet (first-time setup).
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM splitwiser_users`);
      if (rows[0].n > 0) {
        return NextResponse.json({ error: 'invite_token required' }, { status: 400 });
      }
    }

    const loginToken = generateToken();
    const { rows: userRows } = await pool.query(
      `INSERT INTO splitwiser_users (name, color, login_token, last_seen_at)
       VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [name.trim(), color, loginToken],
    );
    const user = userRows[0];

    if (groupId !== null) {
      await pool.query(
        `INSERT INTO splitwiser_group_members (group_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [groupId, user.id],
      );
    }

    const res = NextResponse.json({ user, group_id: groupId });
    setAuthCookie(res, loginToken);
    return res;
  } catch (error) {
    return NextResponse.json({ error: 'signup failed', detail: String(error) }, { status: 500 });
  }
}
