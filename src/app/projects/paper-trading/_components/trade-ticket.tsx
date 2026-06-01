'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, RefreshCw } from 'lucide-react';
import { fmtMoney, fmtPct, pnlColor } from '../_lib/format';

interface Quote { symbol: string; priceCents: number; prevCloseCents: number | null; name: string | null }
interface SearchResult { symbol: string; name: string; exchange: string | null }

type Side = 'buy' | 'sell';
type OrderType = 'market' | 'limit';
type EntryMode = 'shares' | 'dollars';

export default function TradeTicket({ accountId, cashCents, onDone }: { accountId: number; cashCents: number; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const [symbol, setSymbol] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [side, setSide] = useState<Side>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [entryMode, setEntryMode] = useState<EntryMode>('shares');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced symbol search.
  useEffect(() => {
    if (!query.trim() || query.trim().toUpperCase() === symbol) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/paper-trading/quote?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setShowResults(true);
      } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, symbol]);

  // Close the results dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowResults(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function loadQuote(sym: string) {
    setQuoteLoading(true);
    try {
      const res = await fetch(`/api/paper-trading/quote?symbol=${encodeURIComponent(sym)}`);
      const data = await res.json();
      setQuote(data.quote ?? null);
      if (data.quote?.priceCents && type === 'limit' && !limitPrice) {
        setLimitPrice((data.quote.priceCents / 100).toFixed(2));
      }
    } finally { setQuoteLoading(false); }
  }

  function pickSymbol(sym: string) {
    setSymbol(sym);
    setQuery(sym);
    setShowResults(false);
    setResults([]);
    setMessage(null);
    loadQuote(sym);
  }

  const refPriceCents = type === 'limit' ? Math.round(Number(limitPrice) * 100) : quote?.priceCents ?? 0;
  const preview = useMemo(() => {
    const amt = Number(amount);
    if (!refPriceCents || !Number.isFinite(amt) || amt <= 0) return null;
    if (entryMode === 'shares') {
      const shares = Math.floor(amt);
      if (shares < 1) return null;
      return { shares, estCents: shares * refPriceCents, leftoverCents: null as number | null };
    }
    const shares = Math.floor(Math.round(amt * 100) / refPriceCents);
    if (shares < 1) return null;
    const estCents = shares * refPriceCents;
    return { shares, estCents, leftoverCents: Math.round(amt * 100) - estCents };
  }, [amount, entryMode, refPriceCents]);

  const dayChangeCents = quote && quote.prevCloseCents != null ? quote.priceCents - quote.prevCloseCents : null;
  const dayChangePct = quote && quote.prevCloseCents ? ((quote.priceCents - quote.prevCloseCents) / quote.prevCloseCents) * 100 : null;

  async function submit() {
    if (!symbol) return;
    setMessage(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setMessage({ ok: false, text: 'Enter an amount' }); return; }
    if (type === 'limit' && !(Number(limitPrice) > 0)) { setMessage({ ok: false, text: 'Enter a limit price' }); return; }

    const body: Record<string, unknown> = { symbol, side, type };
    if (entryMode === 'shares') body.qty = Math.floor(amt); else body.dollars = amt;
    if (type === 'limit') body.limitPrice = Number(limitPrice);

    setSubmitting(true);
    try {
      const res = await fetch(`/api/paper-trading/accounts/${accountId}/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      setMessage({ ok: !!data.ok, text: data.message ?? data.error ?? 'Done' });
      if (data.ok) { setAmount(''); onDone(); }
    } catch {
      setMessage({ ok: false, text: 'Network error' });
    } finally { setSubmitting(false); }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-semibold">Place an order</div>

      {/* Symbol search */}
      <div ref={boxRef} className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value.toUpperCase()); setSymbol(null); setQuote(null); }}
          onFocus={() => results.length && setShowResults(true)}
          placeholder="Search symbol (e.g. AAPL)"
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-9 text-sm uppercase outline-none focus:ring-2 focus:ring-ring"
        />
        {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {showResults && results.length > 0 && (
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
            {results.map((r) => (
              <button key={r.symbol} onClick={() => pickSymbol(r.symbol)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60">
                <span className="font-medium">{r.symbol}</span>
                <span className="truncate text-xs text-muted-foreground">{r.name}{r.exchange ? ` · ${r.exchange}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quote */}
      {symbol && (
        <div className="mb-3 flex items-center justify-between rounded-md bg-background/50 px-3 py-2">
          <div>
            <div className="text-sm font-semibold">{symbol}{quote?.name ? <span className="ml-2 text-xs font-normal text-muted-foreground">{quote.name}</span> : null}</div>
            {quote ? (
              <div className="text-xs tabular-nums">
                <span className="font-medium">{fmtMoney(quote.priceCents)}</span>
                {dayChangeCents != null && (
                  <span className={`ml-2 ${pnlColor(dayChangeCents)}`}>
                    {fmtMoney(dayChangeCents, { sign: true })}{dayChangePct != null ? ` (${fmtPct(dayChangePct, { sign: true })})` : ''}
                  </span>
                )}
              </div>
            ) : <div className="text-xs text-muted-foreground">{quoteLoading ? 'Loading quote…' : 'No quote available'}</div>}
          </div>
          <button onClick={() => loadQuote(symbol)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label="Refresh quote">
            <RefreshCw className={`h-3.5 w-3.5 ${quoteLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* Side + type toggles */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Segmented value={side} onChange={(v) => setSide(v as Side)} options={[{ v: 'buy', l: 'Buy' }, { v: 'sell', l: 'Sell' }]}
          activeClass={side === 'buy' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'} />
        <Segmented value={type} onChange={(v) => setType(v as OrderType)} options={[{ v: 'market', l: 'Market' }, { v: 'limit', l: 'Limit' }]}
          activeClass="bg-primary text-primary-foreground" />
      </div>

      {/* Limit price */}
      {type === 'limit' && (
        <div className="mb-3">
          <label className="mb-1 block text-xs text-muted-foreground">Limit price</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal"
              className="w-full rounded-md border border-input bg-background py-2 pl-7 pr-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
      )}

      {/* Entry mode + amount */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Amount</label>
          <Segmented small value={entryMode} onChange={(v) => { setEntryMode(v as EntryMode); setAmount(''); }}
            options={[{ v: 'shares', l: 'Shares' }, { v: 'dollars', l: 'Dollars' }]} activeClass="bg-secondary text-secondary-foreground" />
        </div>
        <div className="relative">
          {entryMode === 'dollars' && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
            placeholder={entryMode === 'shares' ? 'Number of shares' : 'Dollar amount'}
            className={`w-full rounded-md border border-input bg-background py-2 pr-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-ring ${entryMode === 'dollars' ? 'pl-7' : 'pl-3'}`} />
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="mb-3 rounded-md bg-background/50 px-3 py-2 text-xs tabular-nums text-muted-foreground">
          {entryMode === 'dollars'
            ? <>Buys <span className="font-medium text-foreground">{preview.shares}</span> whole share{preview.shares !== 1 ? 's' : ''} ≈ <span className="font-medium text-foreground">{fmtMoney(preview.estCents)}</span>{preview.leftoverCents != null ? <> · {fmtMoney(preview.leftoverCents)} left over</> : null}</>
            : <>Estimated {side === 'buy' ? 'cost' : 'proceeds'}: <span className="font-medium text-foreground">{fmtMoney(preview.estCents)}</span></>}
          {side === 'buy' && <> · cash {fmtMoney(cashCents)}</>}
        </div>
      )}

      <button onClick={submit} disabled={submitting || !symbol}
        className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${side === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
        {submitting ? 'Placing…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol ?? ''}`.trim()}
      </button>

      {message && <p className={`mt-3 text-sm ${message.ok ? 'text-emerald-500' : 'text-red-500'}`}>{message.text}</p>}
    </div>
  );
}

function Segmented({ value, onChange, options, activeClass, small }: {
  value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; activeClass: string; small?: boolean;
}) {
  return (
    <div className={`inline-flex w-full rounded-md border border-border bg-background p-0.5 ${small ? 'text-xs' : 'text-sm'}`}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`flex-1 rounded px-2 ${small ? 'py-0.5' : 'py-1.5'} font-medium transition-colors ${value === o.v ? activeClass : 'text-muted-foreground hover:text-foreground'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}
