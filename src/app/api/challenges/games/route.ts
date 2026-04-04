import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, detected_at, match_id, champion, win, game_mode, kills, deaths, assists, game_duration, game_creation, deltas, tier_ups, points_gained
       FROM challenge_games
       ORDER BY game_creation DESC
       LIMIT 50`
    );
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json([], { status: 500 });
  }
}
