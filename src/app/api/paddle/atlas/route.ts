import { NextResponse } from 'next/server';
import { buildOutlines } from '@/lib/paddle/atlas';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const parks = await buildOutlines();
    return NextResponse.json({ parks });
  } catch (error) {
    console.error('paddle atlas error:', error);
    return NextResponse.json({ error: 'Failed to load atlas', detail: String(error) }, { status: 500 });
  }
}
