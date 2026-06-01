/**
 * Stock quote service for the paper-trading project.
 *
 * Primary source is yahoo-finance2 (no API key, broad coverage). When it errors or
 * returns nothing for a symbol, we fall back to Finnhub if a key is configured.
 * Both free tiers are ~15-minute delayed — fine for paper trading. Live fetches are
 * written through to the pt_quotes cache table so the fill engine and UI can read a
 * single source of truth.
 *
 * Prices are stored and returned as integer cents per share.
 */
import YahooFinance from 'yahoo-finance2';
import pool from './db';
import { getConfig } from './config';

// yahoo-finance2 v3 is instantiated per-client. Suppress the one-time survey notice
// and silence schema-validation warnings for response fields we don't consume, so the
// collector journal stays clean.
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false },
});

export interface Quote {
  symbol: string;
  priceCents: number;
  prevCloseCents: number | null;
  name: string | null;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
}

export interface HistoryPoint {
  ts: number; // unix seconds
  closeCents: number;
}

function toCents(dollars: number | null | undefined): number | null {
  if (dollars == null || !Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

async function fetchFromYahoo(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  if (symbols.length === 0) return out;
  const results = await yahooFinance.quote(symbols);
  const arr = Array.isArray(results) ? results : [results];
  for (const q of arr) {
    if (!q || typeof q.symbol !== 'string') continue;
    const price = toCents(q.regularMarketPrice);
    if (price == null) continue;
    out.set(q.symbol.toUpperCase(), {
      symbol: q.symbol.toUpperCase(),
      priceCents: price,
      prevCloseCents: toCents(q.regularMarketPreviousClose),
      name: q.shortName || q.longName || null,
    });
  }
  return out;
}

async function fetchFromFinnhub(symbol: string): Promise<Quote | null> {
  const cfg = getConfig().services.finnhub;
  if (!cfg) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${cfg.apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { c?: number; pc?: number };
    const price = toCents(data.c);
    if (price == null || price === 0) return null; // finnhub returns c:0 for unknown symbols
    return { symbol: symbol.toUpperCase(), priceCents: price, prevCloseCents: toCents(data.pc), name: null };
  } catch {
    return null;
  }
}

/** Persist freshly-fetched quotes into the cache table. */
async function upsertQuotes(quotes: Quote[]): Promise<void> {
  if (quotes.length === 0) return;
  await pool.query(
    `INSERT INTO pt_quotes (symbol, price_cents, prev_close_cents, name)
     SELECT * FROM UNNEST($1::text[], $2::bigint[], $3::bigint[], $4::text[])
     ON CONFLICT (symbol) DO UPDATE
       SET price_cents = EXCLUDED.price_cents,
           prev_close_cents = EXCLUDED.prev_close_cents,
           name = COALESCE(EXCLUDED.name, pt_quotes.name),
           updated_at = now()`,
    [
      quotes.map((q) => q.symbol),
      quotes.map((q) => q.priceCents),
      quotes.map((q) => q.prevCloseCents),
      quotes.map((q) => q.name),
    ],
  );
}

/**
 * Fetch live quotes for a set of symbols (yahoo first, finnhub fallback per missing
 * symbol), write them through to the cache, and return what we found. Symbols that
 * couldn't be priced anywhere are simply absent from the result map.
 */
export async function getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return new Map();

  let found = new Map<string, Quote>();
  try {
    found = await fetchFromYahoo(wanted);
  } catch (err) {
    console.warn('yahoo quote fetch failed, will try finnhub:', err);
  }

  const missing = wanted.filter((s) => !found.has(s));
  for (const sym of missing) {
    const q = await fetchFromFinnhub(sym);
    if (q) found.set(sym, q);
  }

  await upsertQuotes([...found.values()]).catch((err) => console.error('upsertQuotes failed:', err));
  return found;
}

/** Fetch a single live quote (cache-through). Returns null if unpriceable. */
export async function getQuote(symbol: string): Promise<Quote | null> {
  const map = await getQuotes([symbol]);
  return map.get(symbol.trim().toUpperCase()) ?? null;
}

/** Read the last cached quote without hitting the network. */
export async function getCachedQuote(symbol: string): Promise<Quote | null> {
  const { rows } = await pool.query(
    `SELECT symbol, price_cents, prev_close_cents, name FROM pt_quotes WHERE symbol = $1`,
    [symbol.trim().toUpperCase()],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    symbol: r.symbol,
    priceCents: Number(r.price_cents),
    prevCloseCents: r.prev_close_cents == null ? null : Number(r.prev_close_cents),
    name: r.name,
  };
}

/** Symbol search for the trade ticket. Equities only, best-effort. */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await yahooFinance.search(q, { quotesCount: 10, newsCount: 0 });
    const out: SymbolSearchResult[] = [];
    for (const raw of res.quotes ?? []) {
      const r = raw as Record<string, unknown>;
      if (typeof r.symbol !== 'string') continue;
      if (r.quoteType != null && r.quoteType !== 'EQUITY' && r.quoteType !== 'ETF') continue;
      const symbol = r.symbol.toUpperCase();
      const name = (typeof r.shortname === 'string' && r.shortname)
        || (typeof r.longname === 'string' && r.longname)
        || symbol;
      const exchange = (typeof r.exchDisp === 'string' && r.exchDisp)
        || (typeof r.exchange === 'string' && r.exchange)
        || null;
      out.push({ symbol, name, exchange });
    }
    return out;
  } catch (err) {
    console.warn('symbol search failed:', err);
    return [];
  }
}

/** Daily close history for the symbol-detail sparkline / chart. */
export async function getHistory(symbol: string, range: '1mo' | '3mo' | '6mo' | '1y' | '5y' = '6mo'): Promise<HistoryPoint[]> {
  const days: Record<typeof range, number> = { '1mo': 31, '3mo': 93, '6mo': 186, '1y': 372, '5y': 1830 };
  const period1 = new Date(Date.now() - days[range] * 24 * 60 * 60 * 1000);
  try {
    const chart = await yahooFinance.chart(symbol.trim().toUpperCase(), { period1, interval: '1d' });
    return (chart.quotes ?? [])
      .filter((q) => q.close != null && q.date != null)
      .map((q) => ({ ts: Math.floor(new Date(q.date).getTime() / 1000), closeCents: Math.round((q.close as number) * 100) }));
  } catch (err) {
    console.warn('history fetch failed:', err);
    return [];
  }
}
