-- Paper trading platform (Phase 1).
--
-- A personal sandbox for testing investing strategies with fake money: multiple
-- independent accounts, market + limit orders on individual stocks, market-hours
-- awareness, live P&L, an equity curve, and a filterable transaction log.
--
-- Money is stored as integer cents in BIGINT (same convention as splitwiser) to
-- avoid float drift. Share counts are whole numbers (BIGINT) — fractional shares
-- are out of scope for Phase 1. Quote prices are cents-per-share.

-- One account = one virtual brokerage account, seeded with a custom cash balance.
CREATE TABLE IF NOT EXISTS pt_accounts (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT        NOT NULL,
  seed_cents BIGINT      NOT NULL,            -- original seed, kept for reference / future reset
  cash_cents BIGINT      NOT NULL,            -- current buying power
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Current holdings. avg cost per share = cost_basis_cents / qty.
CREATE TABLE IF NOT EXISTS pt_positions (
  account_id       BIGINT NOT NULL REFERENCES pt_accounts(id) ON DELETE CASCADE,
  symbol           TEXT   NOT NULL,
  qty              BIGINT NOT NULL,
  cost_basis_cents BIGINT NOT NULL,           -- total cost of the shares currently held
  PRIMARY KEY (account_id, symbol)
);

-- Orders. Market orders fill immediately when the market is open, otherwise they
-- queue (status='open') and fill at the next open. Limit orders stay open until
-- the price crosses. Filled/cancelled/rejected are terminal.
CREATE TABLE IF NOT EXISTS pt_orders (
  id                BIGSERIAL PRIMARY KEY,
  account_id        BIGINT      NOT NULL REFERENCES pt_accounts(id) ON DELETE CASCADE,
  symbol            TEXT        NOT NULL,
  side              TEXT        NOT NULL CHECK (side IN ('buy','sell')),
  type              TEXT        NOT NULL CHECK (type IN ('market','limit')),
  qty               BIGINT      NOT NULL CHECK (qty > 0),
  limit_price_cents BIGINT,                   -- NULL for market orders
  status            TEXT        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open','filled','cancelled','rejected')),
  reject_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  filled_at         TIMESTAMPTZ,
  fill_price_cents  BIGINT
);

-- Partial index over just the open orders — the fill engine scans these every tick.
CREATE INDEX IF NOT EXISTS idx_pt_orders_open ON pt_orders (symbol)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_pt_orders_account ON pt_orders (account_id, created_at DESC);

-- Immutable execution ledger. Powers the transaction log. realized_pnl_cents is
-- set on sells (proceeds minus the proportional cost basis of the shares sold).
CREATE TABLE IF NOT EXISTS pt_trades (
  id                 BIGSERIAL PRIMARY KEY,
  account_id         BIGINT      NOT NULL REFERENCES pt_accounts(id) ON DELETE CASCADE,
  order_id           BIGINT      REFERENCES pt_orders(id) ON DELETE SET NULL,
  symbol             TEXT        NOT NULL,
  side               TEXT        NOT NULL CHECK (side IN ('buy','sell')),
  qty                BIGINT      NOT NULL,
  price_cents        BIGINT      NOT NULL,
  total_cents        BIGINT      NOT NULL,    -- qty * price_cents
  realized_pnl_cents BIGINT,                  -- sells only
  executed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pt_trades_account_ts ON pt_trades (account_id, executed_at DESC);

-- Latest-known quote per symbol. Acts as a cache: the collector refreshes it on a
-- timer, and on-demand fetches upsert into it. The fill engine reads price_cents.
CREATE TABLE IF NOT EXISTS pt_quotes (
  symbol           TEXT        PRIMARY KEY,
  price_cents      BIGINT      NOT NULL,
  prev_close_cents BIGINT,
  name             TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mark-to-market equity points per account, written by the collector. Feeds the
-- equity curve chart. BRIN index because it's append-only and time-ordered.
CREATE TABLE IF NOT EXISTS pt_snapshots (
  account_id        BIGINT      NOT NULL REFERENCES pt_accounts(id) ON DELETE CASCADE,
  ts                TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_value_cents BIGINT      NOT NULL,     -- cash + market value of holdings
  cash_cents        BIGINT      NOT NULL,
  PRIMARY KEY (account_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_pt_snapshots_ts ON pt_snapshots USING BRIN (ts);
