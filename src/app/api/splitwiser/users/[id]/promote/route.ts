import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { generateToken, getCurrentUser, unauthorized } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

// POST — promote a ghost user (no login_token) into a real user with a fresh token.
// Allowed for the user who created the ghost. Returns the absolute login URL to share.
export async function POST(
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

  const { rows } = await pool.query(
    `SELECT id, login_token, created_by FROM splitwiser_users WHERE id = $1`,
    [targetId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const target = rows[0];

  if (target.login_token !== null) {
    return NextResponse.json({ error: 'user already has an account' }, { status: 409 });
  }
  if (target.created_by !== me.id) {
    return NextResponse.json({ error: 'only the creator can promote a ghost' }, { status: 403 });
  }

  const token = generateToken();
  await pool.query(
    `UPDATE splitwiser_users SET login_token = $1 WHERE id = $2`,
    [token, targetId],
  );

  const origin = request.nextUrl.origin;
  const url = `${origin}/projects/splitwiser/login/${token}`;
  return NextResponse.json({ login_url: url, login_token: token });
}
