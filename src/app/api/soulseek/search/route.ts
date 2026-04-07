import { NextRequest, NextResponse } from 'next/server';
import { slskdPost, slskdGet } from '@/lib/slskd';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST - submit a new search
export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 });
    }

    // Submit search to slskd
    const result = await slskdPost<{ id: string }>('/api/v0/searches', {
      searchText: query.trim(),
    });

    // Record in DB
    await pool.query(
      'INSERT INTO soulseek_searches (query, slskd_search_id) VALUES ($1, $2)',
      [query.trim(), result.id]
    );

    return NextResponse.json({ searchId: result.id, query: query.trim() });
  } catch (error) {
    return NextResponse.json({ error: 'Search failed', detail: String(error) }, { status: 500 });
  }
}

// GET - list recent searches
export async function GET() {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM soulseek_searches ORDER BY created_at DESC LIMIT 20'
    );
    return NextResponse.json({ searches: rows });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch searches', detail: String(error) }, { status: 500 });
  }
}
