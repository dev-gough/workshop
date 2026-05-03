/**
 * Forward-only migration runner. Reads every `*.sql` in this directory in
 * filename order and applies the ones not yet recorded in `_migrations`.
 * Each migration runs inside a transaction.
 *
 * Used by `npm run db:migrate` (current workshop role) and by `npm run setup`
 * (which passes superuser creds the first time so CREATE/ALTER work for tables
 * the role doesn't yet own).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Pool, type PoolConfig } from 'pg';
import { pgClientConfig } from '../../src/lib/config';

export interface MigrationOptions {
  /** Optional override for connection. Defaults to the workshop role from config. */
  connection?: PoolConfig;
  /** Migrations directory. Defaults to this script's directory. */
  dir?: string;
  /** If true, log each applied filename. Defaults to true. */
  verbose?: boolean;
}

export async function applyMigrations(opts: MigrationOptions = {}): Promise<{ applied: string[]; skipped: string[] }> {
  const dir = opts.dir ?? path.join(process.cwd(), 'scripts/migrations');
  const conn = opts.connection ?? pgClientConfig('workshop');
  const verbose = opts.verbose ?? true;

  const pool = new Pool(conn);
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.sql') && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort();

    const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM _migrations');
    const known = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (known.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = await fs.readFile(path.join(dir, file), 'utf-8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        if (verbose) console.log(`  ✓ ${file}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }

  return { applied, skipped };
}

// Allow running directly: `npx tsx scripts/migrations/_apply.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  applyMigrations()
    .then(({ applied, skipped }) => {
      console.log(`\nApplied ${applied.length}, skipped ${skipped.length}.`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
