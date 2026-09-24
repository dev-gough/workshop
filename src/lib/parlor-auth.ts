import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import pool from './db';
import { hashSession, type PublicUser } from './parlor';

const COOKIE = 'parlor_session';
const YEAR = 60 * 60 * 24 * 365;

export async function getParlorUser(): Promise<PublicUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.color
     FROM parlor_sessions s
     JOIN parlor_users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [hashSession(token)],
  );
  return rows[0] ?? null;
}

export function parlorUnauthorized(): NextResponse {
  return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
}

export function setParlorCookie(response: NextResponse, token: string): void {
  // No Secure flag: the workshop is served over HTTP on the house network.
  response.cookies.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: YEAR,
    path: '/',
  });
}

export function clearParlorCookie(response: NextResponse): void {
  response.cookies.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', maxAge: 0, path: '/' });
}
