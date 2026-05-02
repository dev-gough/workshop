-- SplitWiser: personal Splitwise replacement.
-- Money is stored as integer cents in BIGINT columns. Never floats.
-- login_token is nullable: NULL = ghost user (no login), set = real user.

CREATE TABLE IF NOT EXISTS splitwiser_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#22d3ee',
  login_token TEXT UNIQUE,
  created_by INTEGER REFERENCES splitwiser_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sw_users_token ON splitwiser_users(login_token) WHERE login_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS splitwiser_groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  invite_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER NOT NULL REFERENCES splitwiser_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS splitwiser_group_members (
  group_id INTEGER NOT NULL REFERENCES splitwiser_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES splitwiser_users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS splitwiser_expenses (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES splitwiser_groups(id) ON DELETE CASCADE,
  paid_by INTEGER NOT NULL REFERENCES splitwiser_users(id),
  description TEXT NOT NULL,
  total_cents BIGINT NOT NULL CHECK (total_cents > 0),
  currency TEXT NOT NULL DEFAULT 'CAD',
  occurred_on DATE NOT NULL,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES splitwiser_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sw_expenses_group ON splitwiser_expenses(group_id, occurred_on DESC);

CREATE TABLE IF NOT EXISTS splitwiser_expense_shares (
  expense_id INTEGER NOT NULL REFERENCES splitwiser_expenses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES splitwiser_users(id),
  share_cents BIGINT NOT NULL,
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE IF NOT EXISTS splitwiser_payments (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES splitwiser_groups(id) ON DELETE CASCADE,
  from_user INTEGER NOT NULL REFERENCES splitwiser_users(id),
  to_user INTEGER NOT NULL REFERENCES splitwiser_users(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'CAD',
  occurred_on DATE NOT NULL,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES splitwiser_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT splitwiser_payments_distinct_parties CHECK (from_user <> to_user)
);
CREATE INDEX IF NOT EXISTS idx_sw_payments_group ON splitwiser_payments(group_id, occurred_on DESC);
