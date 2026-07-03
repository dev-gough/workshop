import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import pool from './db';

const COOKIE_NAME = 'sw_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export interface SplitwiserUser {
  id: number;
  name: string;
  color: string;
  login_token: string | null;
  created_by: number | null;
  created_at: string;
  last_seen_at: string | null;
}

// Public shape safe to serialize in API responses: the bearer `login_token`
// (and any future internal-only columns) is stripped.
export type PublicSplitwiserUser = Omit<SplitwiserUser, 'login_token'>;

// Strip internal-only columns before returning a user row to a client.
export function toPublicUser(row: SplitwiserUser): PublicSplitwiserUser {
  // Deliberately omit `login_token` (the permanent bearer credential).
  const { login_token: _login_token, ...pub } = row;
  return pub;
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function getCurrentUser(): Promise<SplitwiserUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const { rows } = await pool.query(
    `UPDATE splitwiser_users SET last_seen_at = NOW() WHERE login_token = $1 RETURNING *`,
    [token],
  );
  return rows[0] || null;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function setAuthCookie(response: NextResponse, token: string): void {
  // No `secure` flag: the workshop is served over HTTP on a private
  // network, and a Secure cookie would be silently dropped by browsers.
  // The unguessable 32-byte token is the security boundary.
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

export function clearAuthCookie(response: NextResponse): void {
  response.cookies.delete(COOKIE_NAME);
}

// Membership check helper used by every group-scoped route.
export async function userIsInGroup(userId: number, groupId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM splitwiser_group_members
     WHERE user_id = $1 AND group_id = $2 AND removed_at IS NULL`,
    [userId, groupId],
  );
  return rows.length > 0;
}
