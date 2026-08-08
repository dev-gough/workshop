-- Trip summary stats, denormalized at save time so the trips list reads
-- like a logbook without routing every trip client-side:
-- { paddleM, portageM, trackM, carries, timeH, days }
ALTER TABLE paddle_trips ADD COLUMN IF NOT EXISTS stats jsonb;
