-- Capture the full GA hyperparameter set each run was started with so the
-- history is reproducible and we can compare the effect of knob tweaks.
-- pop_size and max_generations are duplicated inside config_json for
-- self-containment but the existing dedicated columns stay authoritative
-- for indexing/queries.

ALTER TABLE brainfuck_runs
  ADD COLUMN IF NOT EXISTS config_json JSONB;
