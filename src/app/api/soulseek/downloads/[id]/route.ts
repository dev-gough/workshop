import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// DELETE - cancel/remove a download record
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await pool.query(
      "UPDATE soulseek_downloads SET status = 'cancelled' WHERE id = $1",
      [id]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to cancel download', detail: String(error) }, { status: 500 });
  }
}
