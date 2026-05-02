import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { setAuthCookie } from '@/lib/splitwiser-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const { rows } = await pool.query(
      `UPDATE splitwiser_users SET last_seen_at = NOW() WHERE login_token = $1 RETURNING *`,
      [token],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'invalid token' }, { status: 404 });
    }
    const res = NextResponse.json({ user: rows[0] });
    setAuthCookie(res, token);
    return res;
  } catch (error) {
    return NextResponse.json({ error: 'login failed', detail: String(error) }, { status: 500 });
  }
}
