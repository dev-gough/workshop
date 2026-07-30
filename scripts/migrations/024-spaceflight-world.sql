-- Mission Control (RM 03), phase 2: the whole world's launch history.
--
-- Mirror of GCAT — J. McDowell's General Catalog of Artificial Space Objects
-- (planet4589.org, CC-BY) — filtered to orbital ('O') and deep-space ('D')
-- launch attempts. GCAT's launch list carries OrbPay: payload tonnes to
-- orbit per launch, auto-derived from his object catalog. Two properties we
-- rely on: failures record the *intended* payload mass (so launched-vs-
-- delivered works), and crewed vehicles that reach orbit count as payload
-- (the Shuttle orbiter's ~95 t is why the Shuttle family tops the table —
-- stated in the room's methodology, not hidden).
--
-- The table is a truncate-and-reload mirror (one bulk download weekly, being
-- polite to both planet4589 and LL2) — no hand edits here. SpaceX rows also
-- live in spaceflight_launches via LL2; the world API splices those in and
-- excludes GCAT's Falcon/Starship families to avoid double counting.

CREATE TABLE IF NOT EXISTS gcat_launches (
  launch_tag  text PRIMARY KEY,       -- GCAT pseudo-COSPAR tag
  year        integer NOT NULL,
  launch_date timestamptz,            -- null when GCAT has only a partial date
  lv_type     text NOT NULL,
  lv_variant  text,
  family      text NOT NULL,          -- GCAT LV_Family (R-7, SRB, DF5, …)
  mission     text,
  agency      text,
  site        text,
  category    text NOT NULL,          -- O | D
  outcome     text NOT NULL,          -- S / F / U, optionally with GCAT's pct
  success     boolean NOT NULL,
  payload_t   real NOT NULL DEFAULT 0 -- GCAT OrbPay, tonnes
);

CREATE INDEX IF NOT EXISTS gcat_launches_family_idx
  ON gcat_launches (family, year);
