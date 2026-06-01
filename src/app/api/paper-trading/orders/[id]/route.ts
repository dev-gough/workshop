import { NextRequest, NextResponse } from 'next/server';
import { cancelOrder } from '@/lib/trading';

export const dynamic = 'force-dynamic';

// DELETE — cancel a resting order.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = parseInt((await params).id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid order id' }, { status: 400 });
    const result = await cancelOrder(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error('paper-trading order DELETE error:', error);
    return NextResponse.json({ error: 'Failed to cancel order' }, { status: 500 });
  }
}
