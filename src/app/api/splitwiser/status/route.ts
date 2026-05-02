import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Public, no auth — returns just enough for the unauthed home page to decide
// between "first-time bootstrap" and "ask for an invite".
export async function GET() {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM splitwiser_users`);
    return NextResponse.json({ user_count: rows[0].n });
  } catch (error) {
    return NextResponse.json({ user_count: 0, error: String(error) }, { status: 200 });
  }
}
