-- The Groove (RM 16): songs turned into rideable tracks.
--
-- Two tables, and the reason they're separate matters. `groove_tracks` caches
-- the *analysis* of a song — the feature series pulled out of the audio — which
-- is expensive to compute and never changes for a given file. `groove_scores`
-- records runs, which are only meaningful against a particular generator.
--
-- Hence `generator_version` on the scores but NOT on the analysis: features are
-- raw measurements of the audio, while the track built from them is a matter of
-- opinion that we expect to revise. Bumping GENERATOR_VERSION in
-- src/lib/groove.ts starts a fresh leaderboard without touching the (still
-- perfectly good) analysis, and without silently invalidating old scores by
-- leaving them attached to a track that no longer exists.

CREATE TABLE IF NOT EXISTS groove_tracks (
  artist        text NOT NULL,
  album         text NOT NULL,
  song          text NOT NULL,
  -- Frames per second of the series below; the client resamples off this
  -- rather than assuming, so the analyser's hop size can change freely.
  frame_rate    real NOT NULL,
  duration      real NOT NULL,
  -- Parallel float arrays, one entry per frame, each already normalised to
  -- 0..1 against the song's own distribution (see analyse.ts) so a quiet
  -- record isn't a flat track.
  intensity     real[] NOT NULL,
  bass          real[] NOT NULL,
  mid           real[] NOT NULL,
  treble        real[] NOT NULL,
  -- [{ t, band, strength }] — detected onsets, the raw material for notes
  -- and ramps.
  onsets        jsonb NOT NULL,
  -- How much of a track this song has in it: 0 for an ambient drone, 1 for
  -- something relentless. Surfaced in the crate so you know what you're
  -- putting on.
  rideability   real NOT NULL DEFAULT 0,
  analysed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist, album, song)
);

CREATE TABLE IF NOT EXISTS groove_scores (
  id                bigserial PRIMARY KEY,
  artist            text NOT NULL,
  album             text NOT NULL,
  song              text NOT NULL,
  generator_version integer NOT NULL,
  player            text NOT NULL DEFAULT 'anon',
  score             bigint NOT NULL CHECK (score >= 0),
  -- Recomputed server-side from the cached features, never taken from the
  -- client: it's the denominator of every percentage on the leaderboard.
  max_score         bigint NOT NULL CHECK (max_score > 0),
  notes_hit         integer NOT NULL DEFAULT 0,
  notes_total       integer NOT NULL DEFAULT 0,
  ramps_hit         integer NOT NULL DEFAULT 0,
  ramps_total       integer NOT NULL DEFAULT 0,
  best_combo        integer NOT NULL DEFAULT 0,
  played_at         timestamptz NOT NULL DEFAULT now()
);

-- The leaderboard always reads "best run for this song on this generator",
-- so index the lookup rather than the insert.
CREATE INDEX IF NOT EXISTS groove_scores_best_idx
  ON groove_scores (artist, album, song, generator_version, score DESC);

CREATE INDEX IF NOT EXISTS groove_scores_album_idx
  ON groove_scores (artist, album, generator_version);
