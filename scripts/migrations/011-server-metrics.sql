-- Typed time-series tables for the /server dashboard. Replaces the single
-- untyped system_metrics(kind, label, data jsonb) collector path with narrow,
-- indexable columns so date_bin + LAG aggregation runs fast at any window.
--
-- Cumulative counters (jiffies, byte/page counters) are stored RAW; rates are
-- computed in SQL with LAG() at query time so bucketing works at any granularity.
-- BRIN on ts for range scans, BTREE on (label, ts DESC) where a label dimension exists.

-- ── system aggregates ──

CREATE TABLE IF NOT EXISTS metric_system_cpu (
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_j      BIGINT NOT NULL,
  nice_j      BIGINT NOT NULL,
  system_j    BIGINT NOT NULL,
  idle_j      BIGINT NOT NULL,
  iowait_j    BIGINT NOT NULL,
  irq_j       BIGINT NOT NULL,
  softirq_j   BIGINT NOT NULL,
  steal_j     BIGINT NOT NULL,
  total_j     BIGINT NOT NULL,
  load1       REAL   NOT NULL,
  load5       REAL   NOT NULL,
  load15      REAL   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_system_cpu_ts_brin ON metric_system_cpu USING BRIN (ts);

CREATE TABLE IF NOT EXISTS metric_system_cpu_core (
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  core        SMALLINT NOT NULL,
  user_j      BIGINT NOT NULL,
  system_j    BIGINT NOT NULL,
  idle_j      BIGINT NOT NULL,
  iowait_j    BIGINT NOT NULL,
  total_j     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_system_cpu_core_ts_brin ON metric_system_cpu_core USING BRIN (ts);
CREATE INDEX IF NOT EXISTS idx_metric_system_cpu_core_core_ts ON metric_system_cpu_core (core, ts DESC);

CREATE TABLE IF NOT EXISTS metric_system_mem (
  ts                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mem_total          BIGINT NOT NULL,
  mem_used           BIGINT NOT NULL,
  mem_available      BIGINT NOT NULL,
  cached             BIGINT NOT NULL,
  buffers            BIGINT NOT NULL,
  swap_total         BIGINT NOT NULL,
  swap_used          BIGINT NOT NULL,
  -- vmstat cumulative pages (rates computed at query time)
  swap_in_pages      BIGINT NOT NULL,
  swap_out_pages     BIGINT NOT NULL,
  page_faults_minor  BIGINT NOT NULL,
  page_faults_major  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_system_mem_ts_brin ON metric_system_mem USING BRIN (ts);

CREATE TABLE IF NOT EXISTS metric_system_misc (
  ts                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ctx_switches       BIGINT NOT NULL,   -- cumulative
  procs_running      INT    NOT NULL,
  procs_blocked      INT    NOT NULL,
  fd_open            INT    NOT NULL,
  tcp_established    INT    NOT NULL,
  tcp_time_wait      INT    NOT NULL,
  cpu_temp_c         REAL
);
CREATE INDEX IF NOT EXISTS idx_metric_system_misc_ts_brin ON metric_system_misc USING BRIN (ts);

-- ── per-process ──
-- label = stable identifier (systemd unit name for pinned services, or kernel comm
-- for dynamic top-N captures). pid/comm stored for context but not keyed on.
-- Same-comm dedup happens at write time in the collector.

CREATE TABLE IF NOT EXISTS metric_process (
  ts             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  label          TEXT    NOT NULL,
  pid            INT     NOT NULL,
  comm           TEXT    NOT NULL,
  pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  rss_bytes      BIGINT  NOT NULL,
  cpu_ns         BIGINT  NOT NULL,    -- cumulative
  cpu_percent    REAL    NOT NULL,    -- computed by collector from delta
  io_read_bytes  BIGINT  NOT NULL,    -- cumulative
  io_write_bytes BIGINT  NOT NULL,    -- cumulative
  threads        INT     NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_process_ts_brin ON metric_process USING BRIN (ts);
CREATE INDEX IF NOT EXISTS idx_metric_process_label_ts ON metric_process (label, ts DESC);

-- User-pinned processes beyond the hardcoded TRACKED_SERVICES set. The
-- collector reads this each tick and forces these labels into the pinned set.
CREATE TABLE IF NOT EXISTS metric_pin_config (
  label         TEXT PRIMARY KEY,
  comm          TEXT NOT NULL,
  cmdline_hint  TEXT,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── network ──

CREATE TABLE IF NOT EXISTS metric_net (
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  iface       TEXT   NOT NULL,
  rx_bytes    BIGINT NOT NULL,
  tx_bytes    BIGINT NOT NULL,
  rx_packets  BIGINT NOT NULL,
  tx_packets  BIGINT NOT NULL,
  rx_errs     BIGINT NOT NULL,
  rx_drop     BIGINT NOT NULL,
  tx_errs     BIGINT NOT NULL,
  tx_drop     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_net_ts_brin ON metric_net USING BRIN (ts);
CREATE INDEX IF NOT EXISTS idx_metric_net_iface_ts ON metric_net (iface, ts DESC);

-- ── disk ──

CREATE TABLE IF NOT EXISTS metric_disk (
  ts                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device            TEXT   NOT NULL,
  reads_completed   BIGINT NOT NULL,
  sectors_read      BIGINT NOT NULL,
  ms_reading        BIGINT NOT NULL,
  writes_completed  BIGINT NOT NULL,
  sectors_written   BIGINT NOT NULL,
  ms_writing        BIGINT NOT NULL,
  ios_in_progress   INT    NOT NULL,
  ms_io             BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metric_disk_ts_brin ON metric_disk USING BRIN (ts);
CREATE INDEX IF NOT EXISTS idx_metric_disk_device_ts ON metric_disk (device, ts DESC);
