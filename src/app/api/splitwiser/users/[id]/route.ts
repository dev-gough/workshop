import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

const COLOR_RE = /^#[0-9a-f]{6}$/i;

// PATCH — rename / change color. Self for real users; creator for ghosts.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return unauthorized();

  const { id } = await params;
  const targetId = parseInt(id, 10);
  if (!Number.isFinite(targetId)) {
    return NextResponse.json({ error: 'invalid user id' }, { status: 400 });
  }

  const { rows: targetRows } = await pool.query(
    `SELECT id, login_token, created_by FROM splitwiser_users WHERE id = $1`,
    [targetId],
  );
  if (targetRows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const target = targetRows[0];
  const isGhost = target.login_token === null;
  const allowed = (!isGhost && target.id === me.id) || (isGhost && target.created_by === me.id);
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const { name, color } = (await request.json()) as { name?: unknown; color?: unknown };
    const updates: string[] = [];
    const values: (string | number)[] = [];
    if (typeof name === 'string') {
      if (name.trim().length === 0 || name.length > 60) {
        return NextResponse.json({ error: 'name must be 1-60 chars' }, { status: 400 });
      }
      values.push(name.trim());
      updates.push(`name = $${values.length}`);
    }
    if (typeof color === 'string') {
      if (!COLOR_RE.test(color)) {
        return NextResponse.json({ error: 'color must be a hex like #22d3ee' }, { status: 400 });
      }
      values.push(color);
      updates.push(`color = $${values.length}`);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }
    values.push(targetId);
    const { rows } = await pool.query(
      `UPDATE splitwiser_users SET ${updates.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, color, created_by, (login_token IS NULL) AS is_ghost`,
      values,
    );
    return NextResponse.json({ user: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: 'update failed', detail: String(error) }, { status: 500 });
  }
}
