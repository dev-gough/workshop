-- Paper trading: stop / stop-limit orders and time-in-force (Day/GTC).
--
-- Extends the order engine with two new order types and a TIF policy:
--   - stop        → becomes a market order once the quote crosses the trigger
--                   (buy-stop: quote >= trigger, sell-stop: quote <= trigger).
--   - stop_limit  → on trigger it turns into a resting limit at limit_price_cents.
--   - tif='day'   → auto-expires (status='expired') if still open at the next
--                   session open; tif='gtc' rests indefinitely (the default).
--
-- Money stays integer cents in BIGINT, consistent with 012. realized_pnl_cents
-- already lives on pt_trades (added in 012), so nothing to add there.

-- Trigger price for stop / stop_limit orders (NULL for market/limit).
ALTER TABLE pt_orders ADD COLUMN IF NOT EXISTS trigger_price_cents BIGINT;

-- Time-in-force. 'gtc' (good-till-cancelled) is the default; 'day' expires at the
-- next session open if unfilled.
ALTER TABLE pt_orders ADD COLUMN IF NOT EXISTS tif TEXT NOT NULL DEFAULT 'gtc';

-- Widen the order type + status constraints. Drop-then-add is the portable way to
-- edit a CHECK; the names match Postgres's default <table>_<column>_check convention.
ALTER TABLE pt_orders DROP CONSTRAINT IF EXISTS pt_orders_type_check;
ALTER TABLE pt_orders ADD  CONSTRAINT pt_orders_type_check
  CHECK (type IN ('market','limit','stop','stop_limit'));

ALTER TABLE pt_orders DROP CONSTRAINT IF EXISTS pt_orders_status_check;
ALTER TABLE pt_orders ADD  CONSTRAINT pt_orders_status_check
  CHECK (status IN ('open','filled','cancelled','rejected','expired'));

ALTER TABLE pt_orders DROP CONSTRAINT IF EXISTS pt_orders_tif_check;
ALTER TABLE pt_orders ADD  CONSTRAINT pt_orders_tif_check
  CHECK (tif IN ('day','gtc'));
