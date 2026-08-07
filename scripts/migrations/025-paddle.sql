-- Paddle Planner (RM 18): multi-park canoe-trip planner.
--
-- Everything is keyed by park slug so new parks (Algonquin is next) are a
-- registry entry + re-ingest, not a schema change. The network is built by
-- scripts/sync-paddle.ts from Ontario open data (OGL-Ontario):
--   * OTN Trail Segment      -> the park's canoe-route polylines
--   * OHN Waterbody          -> lake polygons (basemap + water test)
--   * OHN Watercourse        -> stream lines (narrow rivers aren't polygons)
-- The build classifies 25 m samples along the route as water/land, splits the
-- lines into paddle/portage segments, then snaps endpoints into graph nodes.
-- Routing happens client-side over this graph, so tables store plain JSON
-- geometry (no PostGIS dependency) with lengths precomputed at build time.

CREATE TABLE IF NOT EXISTS paddle_parks (
  slug      text PRIMARY KEY,          -- 'temagami'
  name      text NOT NULL,
  bbox      jsonb NOT NULL,            -- [w, s, e, n] in lon/lat
  built_at  timestamptz,               -- last successful network build
  stats     jsonb                      -- { paddleKm, portageKm, portages, nodes, segments, lakes }
);

CREATE TABLE IF NOT EXISTS paddle_nodes (
  park  text NOT NULL REFERENCES paddle_parks(slug) ON DELETE CASCADE,
  id    integer NOT NULL,              -- dense per-park index, assigned at build
  lon   double precision NOT NULL,
  lat   double precision NOT NULL,
  PRIMARY KEY (park, id)
);

CREATE TABLE IF NOT EXISTS paddle_segments (
  park      text NOT NULL REFERENCES paddle_parks(slug) ON DELETE CASCADE,
  id        integer NOT NULL,
  kind      text NOT NULL,             -- 'paddle' | 'portage'
  node_a    integer NOT NULL,          -- graph endpoints (paddle_nodes.id)
  node_b    integer NOT NULL,
  length_m  real NOT NULL,
  coords    jsonb NOT NULL,            -- [[lon,lat], ...] full polyline
  PRIMARY KEY (park, id)
);

-- Lakes double as the room's self-hosted basemap; on_network marks the ones
-- the route actually touches so the UI can fade the rest.
CREATE TABLE IF NOT EXISTS paddle_lakes (
  park        text NOT NULL REFERENCES paddle_parks(slug) ON DELETE CASCADE,
  ogf_id      bigint NOT NULL,         -- OHN feature id
  name        text,
  area_m2     double precision NOT NULL,
  on_network  boolean NOT NULL DEFAULT false,
  rings       jsonb NOT NULL,          -- esri-style rings incl. island holes
  PRIMARY KEY (park, ogf_id)
);
CREATE INDEX IF NOT EXISTS paddle_lakes_area ON paddle_lakes (park, area_m2 DESC);

-- OTN access points near the network (put-ins / trailheads).
CREATE TABLE IF NOT EXISTS paddle_access_points (
  park    text NOT NULL REFERENCES paddle_parks(slug) ON DELETE CASCADE,
  ogf_id  bigint NOT NULL,
  name    text,
  lon     double precision NOT NULL,
  lat     double precision NOT NULL,
  PRIMARY KEY (park, ogf_id)
);

-- Campsites have no open dataset (the one gap in Ontario's data), so this
-- table is hand-curated through the room's UI and survives re-ingests.
CREATE TABLE IF NOT EXISTS paddle_campsites (
  id          serial PRIMARY KEY,
  park        text NOT NULL REFERENCES paddle_parks(slug) ON DELETE CASCADE,
  name        text,
  lon         double precision NOT NULL,
  lat         double precision NOT NULL,
  notes       text,
  source      text NOT NULL DEFAULT 'manual',
  status      text NOT NULL DEFAULT 'active',   -- 'active' | 'unverified' | 'closed'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paddle_campsites_park ON paddle_campsites (park);
