-- fixed-v1 benchmark rows. Older rows leave these null: they were one-shot
-- timings, often of a few dozen generations, and solve rows were a race of
-- several processes. New rows carry the protocol, the machine, and the
-- in-process trial summary so a laptop run or a C / C++ / Rust port is not
-- averaged into a PyPy number from this box.

ALTER TABLE brainfuck_benchmarks
  ADD COLUMN IF NOT EXISTS trials integer,
  ADD COLUMN IF NOT EXISTS solved integer,
  ADD COLUMN IF NOT EXISTS solve_rate double precision,
  ADD COLUMN IF NOT EXISTS median_gens integer,
  ADD COLUMN IF NOT EXISTS p90_gens integer,
  ADD COLUMN IF NOT EXISTS seed integer,
  ADD COLUMN IF NOT EXISTS runtime text,
  ADD COLUMN IF NOT EXISTS host text,
  ADD COLUMN IF NOT EXISTS cpu text,
  ADD COLUMN IF NOT EXISTS repeats integer,
  ADD COLUMN IF NOT EXISTS found_at integer,
  ADD COLUMN IF NOT EXISTS protocol text,
  ADD COLUMN IF NOT EXISTS cache_hit_rate double precision,
  ADD COLUMN IF NOT EXISTS result_json jsonb;
