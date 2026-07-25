-- LoL Challenges: retro-declare the existing tables and add the columns the
-- client-faithful UI needs.
--
-- These six tables predate the migration runner and existed only in the live
-- DB, so a fresh clone had no way to create them. The CREATE TABLE IF NOT
-- EXISTS blocks below are written to match production exactly; on this machine
-- they are all no-ops, on a new checkout they are the schema.

CREATE TABLE IF NOT EXISTS challenge_configs (
  challenge_id      bigint PRIMARY KEY,
  name              text,
  description       text,
  short_description text,
  category          text,
  state             text,
  thresholds        jsonb,
  tags              jsonb,
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_challenge_configs_category ON challenge_configs (category);

CREATE TABLE IF NOT EXISTS challenge_progress (
  challenge_id     bigint PRIMARY KEY REFERENCES challenge_configs (challenge_id),
  level            text,
  value            double precision,
  percentile       double precision,
  achieved_time    bigint,
  position         integer,
  players_in_level bigint,
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_challenge_progress_level ON challenge_progress (level);

CREATE TABLE IF NOT EXISTS challenge_snapshot (
  id         integer PRIMARY KEY DEFAULT 1,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenge_games (
  id            serial PRIMARY KEY,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  match_id      text UNIQUE,
  champion      text,
  win           boolean,
  game_mode     text,
  kills         integer,
  deaths        integer,
  assists       integer,
  game_duration integer,
  game_creation bigint,
  deltas        jsonb NOT NULL DEFAULT '[]',
  tier_ups      integer DEFAULT 0,
  points_gained integer DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_challenge_games_detected ON challenge_games (detected_at DESC);

CREATE TABLE IF NOT EXISTS challenge_champion_progress (
  challenge_id  bigint NOT NULL REFERENCES challenge_configs (challenge_id),
  champion_id   integer NOT NULL,
  champion_name text NOT NULL,
  completed     boolean NOT NULL DEFAULT true,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, champion_id)
);
CREATE INDEX IF NOT EXISTS idx_ccp_challenge ON challenge_champion_progress (challenge_id);

CREATE TABLE IF NOT EXISTS sync_metadata (
  key            text PRIMARY KEY,
  last_synced_at timestamptz,
  details        jsonb
);

-- ── New columns ────────────────────────────────────────────────────────────

-- The full 9-point rarity curve from /challenges/v1/challenges/percentiles,
-- shaped { TIER: fraction-of-players-at-or-above }. This endpoint was already
-- being called on every sync and its result discarded; challenge_progress.
-- percentile is a single point off this same curve.
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS percentiles jsonb;

-- Capstone/group hierarchy. Riot's own config endpoint exposes no parent link
-- and no category, so these come from the CommunityDragon manifest and the
-- existing `category` column is an ID-prefix guess we can now retire.
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS parent_id   bigint;
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS is_capstone boolean NOT NULL DEFAULT false;
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS is_category boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_challenge_configs_parent ON challenge_configs (parent_id);

-- Delisted challenges: still returned by the Riot API and still holding player
-- progress, but they no longer contribute points to their parent. Identified by
-- absence from Data Dragon's challenges.json. Two exist today (301104, 402406);
-- excluding them is what makes the point rollup reconcile exactly.
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS is_scoring boolean NOT NULL DEFAULT true;

-- Present in the Riot config response but previously dropped on the floor.
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS leaderboard   boolean;
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS end_timestamp bigint;

-- From the CommunityDragon manifest: `source` and `queue_ids` replace the
-- description-regex game-mode guessing the old page did in the browser;
-- `rewards` backs the "NEXT LEVEL REWARDS" block in the detail card.
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS source    text;
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS queue_ids jsonb;
ALTER TABLE challenge_configs ADD COLUMN IF NOT EXISTS rewards   jsonb;

-- ── Grants ─────────────────────────────────────────────────────────────────
-- Migrations run as `workshop`, and ALTER DEFAULT PRIVILEGES is scoped to the
-- creating role, so tables born here inherit no grants for the service roles.
-- That is how sync_metadata ended up unwritable by the poller. Every migration
-- that creates a table a service role touches must grant explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_configs            TO challenge_poller;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_progress           TO challenge_poller;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_snapshot           TO challenge_poller;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_games              TO challenge_poller;
GRANT SELECT, INSERT, UPDATE, DELETE ON challenge_champion_progress  TO challenge_poller;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_metadata                TO challenge_poller;
GRANT USAGE, SELECT ON SEQUENCE challenge_games_id_seq               TO challenge_poller;
