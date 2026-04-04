import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { artist, album, song, username } = await request.json();

    if (!artist || !album || !song || !username) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await pool.query(
      'INSERT INTO plays (artist, album, song, username) VALUES ($1, $2, $3, $4)',
      [artist, album, song, username]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error recording play:', error);
    return NextResponse.json({ error: 'Failed to record play' }, { status: 500 });
  }
}
