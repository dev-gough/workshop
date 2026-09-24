import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  colorForName,
  hashPassword,
  hashSession,
  nameKey,
  newSessionToken,
  normalizeName,
  verifyPassword,
} from '@/lib/parlor';
import { clearParlorCookie, getParlorUser, parlorUnauthorized, setParlorCookie } from '@/lib/parlor-auth';
import { openSession } from '@/lib/parlor-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getParlorUser();
  if (!user) return parlorUnauthorized();
  return NextResponse.json({ user });
}

export async function POST(request: Request) {
  let body: { name?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Send a name and a password.' }, { status: 400 });
  }
  const name = normalizeName(body.name ?? '');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name) return NextResponse.json({ error: 'Use a name, up to 32 characters.' }, { status: 400 });
  if (password.length < 4 || password.length > 200) {
    return NextResponse.json({ error: 'Password needs at least 4 characters.' }, { status: 400 });
  }

  const key = nameKey(name);
  const existing = await pool.query<{ id: number; name: string; color: string; password_hash: string }>(
    `SELECT id, name, color, password_hash FROM parlor_users WHERE name_key = $1`,
    [key],
  );
  let user = existing.rows[0];
  if (user) {
    if (!verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: 'That password doesn’t match this name.' }, { status: 401 });
    }
  } else {
    try {
      const created = await pool.query<{ id: number; name: string; color: string }>(
        `INSERT INTO parlor_users (name, name_key, password_hash, color)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, color`,
        [name, key, hashPassword(password), colorForName(name)],
      );
      user = { ...created.rows[0], password_hash: '' };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== '23505') throw err;
      return NextResponse.json({ error: 'That name was just taken. Try the password again.' }, { status: 409 });
    }
  }

  const token = newSessionToken();
  await openSession({ id: user.id, name: user.name, color: user.color }, hashSession(token));
  const res = NextResponse.json({ user: { id: user.id, name: user.name, color: user.color } });
  setParlorCookie(res, token);
  return res;
}

export async function DELETE() {
  const token = (await cookies()).get('parlor_session')?.value;
  if (token) {
    await pool.query(`DELETE FROM parlor_sessions WHERE token_hash = $1`, [hashSession(token)]);
  }
  const res = NextResponse.json({ ok: true });
  clearParlorCookie(res);
  return res;
}
