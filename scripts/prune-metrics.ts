/**
 * Metrics retention pruner — runs daily via systemd timer.
 * Deletes rows older than RETENTION_DAYS from the typed time-series metric_*
 * tables. metric_pin_config is left alone (config, no ts column). Uses the same
 * 'workshop' role the collectors write with, which owns these tables.
 */

import { makePool } from '../src/lib/db';

const pool = makePool('workshop');

const RETENTION_DAYS = 90;

// Typed time-series tables (each has a ts column). metric_pin_config is excluded.
const TABLES = [
  'metric_system_cpu',
  'metric_system_cpu_core',
  'metric_system_mem',
  'metric_system_misc',
  'metric_process',
  'metric_net',
  'metric_disk',
];

async function main() {
  try {
    for (const table of TABLES) {
      const res = await pool.query(
        `DELETE FROM ${table} WHERE ts < now() - interval '${RETENTION_DAYS} days'`
      );
      console.log(`[prune] ${table}: deleted ${res.rowCount ?? 0} rows`);
    }
  } catch (err) {
    console.error('prune-metrics error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
