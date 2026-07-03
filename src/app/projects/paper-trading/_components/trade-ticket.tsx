'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, RefreshCw } from 'lucide-react';
import { fmtMoney, fmtPct, pnlColor } from '../_lib/format';

interface Quote { symbol: string; priceCents: number; prevCloseCents: number | null; name: string | null }
interface SearchResult { symbol: string; name: string; exchange: string | null }

type Side = 'buy' | 'sell';
type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
type Tif = 'day' | 'gtc';
type EntryMode = 'shares' | 'dollars';

const NEEDS_LIMIT = (t: OrderType) => t === 'limit' || t === 'stop_limit';
const NEEDS_TRIGGER = (t: OrderType) => t === 'stop' || t === 'stop_limit';

export default function TradeTicket({
  accountId, cashCents, onDone, initialSymbol, initialSide,
}: {
  accountId: number;
  cashCents: number;
  onDone: () => void;
  initialSymbol?: string;
  initialSide?: Side;
}) {
  const [query, setQuery] = useState(initialSymbol ?? '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const [symbol, setSymbol] = useState<string | null>(initialSymbol ?? null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const [side, setSide] = useState<Side>(initialSide ?? 'buy');
  const [type, setType] = useState<OrderType>('market');
  const [tif, setTif] = useState<Tif>('gtc');
  const [entryMode, setEntryMode] = useState<EntryMode>('shares');
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);

  // Seed a quote when opened pre-filled from a holding row.
  useEffect(() => {
    if (initialSymbol) loadQuote(initialSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol]);

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
      if (data.quote?.priceCents && NEEDS_LIMIT(type) && !limitPrice) {
        setLimitPrice((data.quote.priceCents / 100).toFixed(2));
      }
      if (data.quote?.priceCents && NEEDS_TRIGGER(type) && !triggerPrice) {
        setTriggerPrice((data.quote.priceCents / 100).toFixed(2));
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

  // Size the preview against the price this order transacts near: limit for
  // limit/stop-limit, trigger for a plain stop, else the live quote.
  const refPriceCents = NEEDS_LIMIT(type)
    ? Math.round(Number(limitPrice) * 100)
    : type === 'stop'
      ? Math.round(Number(triggerPrice) * 100)
      : quote?.priceCents ?? 0;
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
    if (NEEDS_LIMIT(type) && !(Number(limitPrice) > 0)) { setMessage({ ok: false, text: 'Enter a limit price' }); return; }
    if (NEEDS_TRIGGER(type) && !(Number(triggerPrice) > 0)) { setMessage({ ok: false, text: 'Enter a trigger price' }); return; }

    const body: Record<string, unknown> = { symbol, side, type, tif };
    if (entryMode === 'shares') body.qty = Math.floor(amt); else body.dollars = amt;
    if (NEEDS_LIMIT(type)) body.limitPrice = Number(limitPrice);
    if (NEEDS_TRIGGER(type)) body.triggerPrice = Number(triggerPrice);

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

  const inputCls = 'w-full rounded-xl border border-border bg-card py-2.5 text-[15px] tabular-nums outline-none transition-colors focus:border-foreground/40';

  return (
    <div>
      {/* Symbol search */}
      <div ref={boxRef} className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value.toUpperCase()); setSymbol(null); setQuote(null); }}
          onFocus={() => results.length && setShowResults(true)}
          placeholder="Search a symbol"
          className={`${inputCls} pl-10 pr-10 uppercase`}
        />
        {searching && <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {showResults && results.length > 0 && (
          <div className="absolute z-20 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl">
            {results.map((r) => (
              <button key={r.symbol} onClick={() => pickSymbol(r.symbol)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                <span className="font-semibold">{r.symbol}</span>
                <span className="truncate text-xs text-muted-foreground">{r.name}{r.exchange ? ` · ${r.exchange}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quote */}
      {symbol && (
        <div className="mb-4 flex items-center justify-between rounded-xl bg-muted px-4 py-3">
          <div>
            <div className="text-sm font-semibold">{symbol}{quote?.name ? <span className="ml-2 text-xs font-normal text-muted-foreground">{quote.name}</span> : null}</div>
            {quote ? (
              <div className="mt-0.5 text-xs tabular-nums">
                <span className="font-semibold">{fmtMoney(quote.priceCents)}</span>
                {dayChangeCents != null && (
                  <span className={`ml-2 ${pnlColor(dayChangeCents)}`}>
                    {fmtMoney(dayChangeCents, { sign: true })}{dayChangePct != null ? ` (${fmtPct(dayChangePct, { sign: true })})` : ''}
                  </span>
                )}
              </div>
            ) : <div className="text-xs text-muted-foreground">{quoteLoading ? 'Loading quote…' : 'No quote available'}</div>}
          </div>
          <button onClick={() => loadQuote(symbol)} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-foreground" aria-label="Refresh quote">
            <RefreshCw className={`h-3.5 w-3.5 ${quoteLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {/* Side toggle */}
      <div className="mb-3">
        <Segmented value={side} onChange={(v) => setSide(v as Side)} options={[{ v: 'buy', l: 'Buy' }, { v: 'sell', l: 'Sell' }]}
          activeClass={side === 'buy' ? 'pt-bg-gain text-white' : 'pt-bg-loss text-white'} />
      </div>

      {/* Order type */}
      <div className="mb-4">
        <Segmented small value={type} onChange={(v) => setType(v as OrderType)}
          options={[{ v: 'market', l: 'Market' }, { v: 'limit', l: 'Limit' }, { v: 'stop', l: 'Stop' }, { v: 'stop_limit', l: 'Stop-limit' }]}
          activeClass="bg-primary text-primary-foreground" />
      </div>

      {/* Trigger price (stop / stop-limit) */}
      {NEEDS_TRIGGER(type) && (
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Trigger price</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground">$</span>
            <input value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} inputMode="decimal"
              className={`${inputCls} pl-7 pr-3.5`} />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {side === 'buy' ? 'Triggers when the price rises to or above this.' : 'Triggers when the price falls to or below this.'}
          </p>
        </div>
      )}

      {/* Limit price (limit / stop-limit) */}
      {NEEDS_LIMIT(type) && (
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Limit price</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground">$</span>
            <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal"
              className={`${inputCls} pl-7 pr-3.5`} />
          </div>
        </div>
      )}

      {/* Time in force */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Time in force</label>
          <Segmented small value={tif} onChange={(v) => setTif(v as Tif)}
            options={[{ v: 'day', l: 'Day' }, { v: 'gtc', l: 'GTC' }]} activeClass="bg-secondary text-secondary-foreground" />
        </div>
      </div>

      {/* Entry mode + amount */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Amount</label>
          <Segmented small value={entryMode} onChange={(v) => { setEntryMode(v as EntryMode); setAmount(''); }}
            options={[{ v: 'shares', l: 'Shares' }, { v: 'dollars', l: 'Dollars' }]} activeClass="bg-secondary text-secondary-foreground" />
        </div>
        <div className="relative">
          {entryMode === 'dollars' && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground">$</span>}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
            placeholder={entryMode === 'shares' ? 'Number of shares' : 'Dollar amount'}
            className={`${inputCls} pr-3.5 ${entryMode === 'dollars' ? 'pl-7' : 'pl-3.5'}`} />
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="mb-4 rounded-xl bg-muted px-4 py-3 text-xs tabular-nums text-muted-foreground">
          {entryMode === 'dollars'
            ? <>Buys <span className="font-semibold text-foreground">{preview.shares}</span> whole share{preview.shares !== 1 ? 's' : ''} ≈ <span className="font-semibold text-foreground">{fmtMoney(preview.estCents)}</span>{preview.leftoverCents != null ? <> · {fmtMoney(preview.leftoverCents)} left over</> : null}</>
            : <>Estimated {side === 'buy' ? 'cost' : 'proceeds'}: <span className="font-semibold text-foreground">{fmtMoney(preview.estCents)}</span></>}
          {side === 'buy' && <> · cash {fmtMoney(cashCents)}</>}
        </div>
      )}

      <button onClick={submit} disabled={submitting || !symbol}
        className={`w-full rounded-full px-4 py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 ${side === 'buy' ? 'pt-bg-gain' : 'pt-bg-loss'}`}>
        {submitting ? 'Placing…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol ?? ''}`.trim()}
      </button>

      {message && <p className={`mt-3 text-sm ${message.ok ? 'pt-gain' : 'pt-loss'}`}>{message.text}</p>}
    </div>
  );
}

function Segmented({ value, onChange, options, activeClass, small }: {
  value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; activeClass: string; small?: boolean;
}) {
  return (
    <div className={`inline-flex w-full rounded-full border border-border bg-card p-1 ${small ? 'text-xs' : 'text-sm'}`}>
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`flex-1 rounded-full px-2 ${small ? 'py-1' : 'py-2'} font-semibold transition-colors ${value === o.v ? activeClass : 'text-muted-foreground hover:text-foreground'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}
