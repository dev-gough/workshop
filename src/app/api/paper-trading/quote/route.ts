import { NextRequest, NextResponse } from 'next/server';
import { getQuote, searchSymbols, getHistory } from '@/lib/quotes';

export const dynamic = 'force-dynamic';

// GET — three modes:
//   ?q=<text>                     → symbol search (for the trade ticket)
//   ?symbol=<SYM>                 → a single live quote (cache-through)
//   ?symbol=<SYM>&history=<range> → quote + daily close history for a sparkline
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q')?.trim();
    if (q) {
      const results = await searchSymbols(q);
      return NextResponse.json({ results });
    }

    const symbol = sp.get('symbol')?.trim();
    if (!symbol) return NextResponse.json({ error: 'provide a symbol or search query' }, { status: 400 });

    const quote = await getQuote(symbol);
    const historyRange = sp.get('history');
    let history = undefined;
    if (historyRange) {
      const valid = ['1mo', '3mo', '6mo', '1y', '5y'] as const;
      const range = (valid as readonly string[]).includes(historyRange) ? (historyRange as (typeof valid)[number]) : '6mo';
      history = await getHistory(symbol, range);
    }
    return NextResponse.json({ quote, history });
  } catch (error) {
    console.error('paper-trading quote GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch quote' }, { status: 500 });
  }
}
