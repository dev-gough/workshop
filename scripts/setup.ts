/**
 * Workshop bootstrap. One command takes a fresh clone to a runnable state.
 *
 *   npm run setup
 *
 * Flow:
 *   1. Version checks (Node, Python, psql)
 *   2. Init git submodules if missing
 *   3. Prompt for Postgres superuser creds (used only here, not stored)
 *   4. Create the workshop DB and the three scoped roles with random passwords
 *      (only for roles that don't already exist — existing roles are left alone)
 *   5. Apply migrations via the runner
 *   6. Provision the BrainFuck Python venv via scripts/setup-python.sh
 *   7. If config.json is missing, copy from config.example.json and inject
 *      generated passwords + a setup token
 *   8. Print a status table of which projects are ready
 *
 * Re-running is safe: every step is idempotent.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import crypto from 'node:crypto';
import { Client } from 'pg';

const REPO_ROOT = path.resolve(__dirname, '..');
process.chdir(REPO_ROOT);

const ROLES = ['workshop', 'soulseek_ingest', 'challenge_poller'] as const;
type Role = typeof ROLES[number];

const COLORS = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};

function header(s: string) { console.log(`\n${COLORS.bold}${COLORS.cyan}${s}${COLORS.reset}`); }
function ok(s: string)     { console.log(`  ${COLORS.green}✓${COLORS.reset} ${s}`); }
function warn(s: string)   { console.log(`  ${COLORS.yellow}⚠${COLORS.reset} ${s}`); }
function fail(s: string)   { console.log(`  ${COLORS.red}✗${COLORS.reset} ${s}`); }
function info(s: string)   { console.log(`  ${COLORS.dim}${s}${COLORS.reset}`); }

function tryRun(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function generatePassword(): string { return crypto.randomBytes(16).toString('hex'); }

async function checkVersions() {
  header('Version checks');
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 20) { fail(`node ${process.versions.node} (need ≥ 20)`); process.exit(1); }
  ok(`node ${process.versions.node}`);

  const py = tryRun('python3', ['--version']);
  if (!py) { fail('python3 not found — install Python 3.10+'); process.exit(1); }
  const m = py.match(/Python (\d+)\.(\d+)/);
  if (!m || parseInt(m[1]) < 3 || (parseInt(m[1]) === 3 && parseInt(m[2]) < 10)) {
    fail(`${py} (need ≥ 3.10)`); process.exit(1);
  }
  ok(py);

  const psql = tryRun('psql', ['--version']);
  if (!psql) { fail('psql not found — install postgresql-client'); process.exit(1); }
  ok(psql);
}

function initSubmodules() {
  header('Git submodules');
  const status = tryRun('git', ['submodule', 'status']);
  if (status === null) { warn('not a git checkout — skipping submodule init'); return; }
  if (!status || status.trim() === '') { info('no submodules declared'); return; }
  // Lines starting with '-' mean uninitialized
  if (status.split('\n').some((l) => l.startsWith('-'))) {
    info('initializing submodules…');
    execSync('git submodule update --init --recursive', { stdio: 'inherit' });
  }
  ok('submodules ready');
}

async function promptPostgres(rl: readline.Interface): Promise<{
  host: string; port: number; superuser: string; superpass: string;
}> {
  header('Postgres connection');
  info('Setup needs a superuser to create the database and roles. ' +
       'These credentials are not stored — they\'re used only for this run.');
  const host = (await rl.question('  Host [localhost]: ')).trim() || 'localhost';
  const portStr = (await rl.question('  Port [5432]: ')).trim() || '5432';
  const superuser = (await rl.question('  Superuser [postgres]: ')).trim() || 'postgres';
  const superpass = await rl.question('  Password (leave blank for peer auth / .pgpass): ');
  return { host, port: parseInt(portStr, 10), superuser, superpass };
}

async function setupDatabase(
  pgConn: { host: string; port: number; superuser: string; superpass: string },
): Promise<{ database: string; roles: Record<Role, { user: string; password: string }>; created: Role[] }> {
  header('Database & roles');
  const database = 'workshop';

  // Connect to the maintenance DB to check/create the workshop DB
  const maint = new Client({
    host: pgConn.host, port: pgConn.port,
    user: pgConn.superuser, password: pgConn.superpass || undefined,
    database: 'postgres',
  });
  await maint.connect();

  const dbExists = await maint.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists`, [database],
  );
  if (!dbExists.rows[0].exists) {
    await maint.query(`CREATE DATABASE "${database}"`);
    ok(`created database "${database}"`);
  } else {
    info(`database "${database}" already exists`);
  }

  // Roles
  const roles: Record<string, { user: string; password: string }> = {};
  const created: Role[] = [];
  for (const role of ROLES) {
    const exists = await maint.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`, [role],
    );
    if (exists.rows[0].exists) {
      info(`role "${role}" already exists (password preserved)`);
      // We don't have the password — caller will reuse from existing config.json if present
      roles[role] = { user: role, password: '__EXISTING__' };
    } else {
      const pw = generatePassword();
      await maint.query(`CREATE ROLE "${role}" WITH LOGIN PASSWORD '${pw.replace(/'/g, "''")}'`);
      roles[role] = { user: role, password: pw };
      created.push(role);
      ok(`created role "${role}" with random password`);
    }
  }
  await maint.end();

  // Connect to the workshop DB as superuser to grant role privileges
  const wkdb = new Client({
    host: pgConn.host, port: pgConn.port,
    user: pgConn.superuser, password: pgConn.superpass || undefined,
    database,
  });
  await wkdb.connect();
  // Grants are safe to re-issue
  for (const role of ROLES) {
    await wkdb.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
    await wkdb.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await wkdb.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
    await wkdb.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
    await wkdb.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`);
    await wkdb.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`);
  }
  // Only the workshop role runs migrations (npm run db:migrate); it needs
  // CREATE on schema public to add new tables.
  await wkdb.query(`GRANT CREATE ON SCHEMA public TO "workshop"`);
  await wkdb.end();
  ok('grants applied');

  return { database, roles: roles as Record<Role, { user: string; password: string }>, created };
}

async function runMigrations(
  pgConn: { host: string; port: number; superuser: string; superpass: string },
  database: string,
) {
  header('Migrations');
  const { applyMigrations } = await import('./migrations/_apply');
  const { applied, skipped } = await applyMigrations({
    connection: {
      host: pgConn.host, port: pgConn.port,
      user: pgConn.superuser, password: pgConn.superpass || undefined,
      database,
    },
  });
  info(`${applied.length} new, ${skipped.length} previously applied`);
}

function setupPython() {
  header('Python venv');
  const r = spawnSync('bash', ['scripts/setup-python.sh'], { stdio: 'inherit' });
  if (r.status !== 0) { fail('venv setup failed'); process.exit(1); }
}

function writeConfigIfMissing(roles: Record<Role, { user: string; password: string }>) {
  header('Config file');
  const configPath = path.join(REPO_ROOT, 'config.json');
  if (existsSync(configPath)) {
    info('config.json already exists — leaving in place');
    return;
  }
  const example = JSON.parse(readFileSync(path.join(REPO_ROOT, 'config.example.json'), 'utf-8'));

  // Drop _doc / _comment / _*_example keys before writing
  function strip(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(strip);
    if (obj && typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith('_')) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return obj;
  }
  const cfg = strip(example) as { postgres: { roles: Record<string, { password: string }> }; setupToken: string | null };

  // Inject passwords for the three roles. If a role already existed (we don't
  // know its password), leave the placeholder so the user knows to fill it in.
  for (const role of ROLES) {
    if (roles[role].password !== '__EXISTING__') {
      cfg.postgres.roles[role].password = roles[role].password;
    }
  }

  cfg.setupToken = generatePassword();

  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(configPath, 0o600);
  ok(`wrote ${configPath}`);
  info(`Setup token: ${cfg.setupToken}`);
  info('Use this token to authorize writes from the in-app /setup page.');
}

function statusTable() {
  header('Status');
  let cfg: Record<string, unknown> | null = null;
  try { cfg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'config.json'), 'utf-8')); } catch {}
  if (!cfg) { warn('config.json not readable'); return; }

  const services = (cfg.services ?? {}) as Record<string, unknown>;
  const items: { label: string; ready: boolean; hint: string }[] = [
    { label: 'Postgres',    ready: !!cfg.postgres,                 hint: 'always required' },
    { label: 'BrainFuck',   ready: !!(cfg.paths as { brainfuckRepo?: string })?.brainfuckRepo, hint: '/projects/brainfuck' },
    { label: 'Music dir',   ready: !!(cfg.paths as { musicDirectory?: string })?.musicDirectory, hint: '/projects/barfoo, /projects/soulseek' },
    { label: 'slskd',       ready: services.slskd != null,         hint: '/projects/soulseek' },
    { label: 'Transmission',ready: services.transmission != null,  hint: '/projects/jellyfin (torrent fetcher)' },
    { label: 'Jellyfin',    ready: services.jellyfin != null,      hint: '/projects/jellyfin (status)' },
    { label: 'Riot API',    ready: cfg.riot != null,               hint: '/projects/challenges' },
    { label: 'Minecraft',   ready: Array.isArray(cfg.minecraftServers) && cfg.minecraftServers.length > 0, hint: '/projects/server (RCON)' },
  ];
  for (const it of items) {
    if (it.ready) ok(`${it.label.padEnd(13)} ${COLORS.dim}${it.hint}${COLORS.reset}`);
    else          warn(`${it.label.padEnd(13)} ${COLORS.dim}configure at /setup — ${it.hint}${COLORS.reset}`);
  }
}

async function main() {
  console.log(`${COLORS.bold}Devy's Workshop — setup${COLORS.reset}`);
  await checkVersions();
  initSubmodules();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let pgConn: Awaited<ReturnType<typeof promptPostgres>>;
  try {
    pgConn = await promptPostgres(rl);
  } finally {
    rl.close();
  }

  const { database, roles } = await setupDatabase(pgConn);
  await runMigrations(pgConn, database);
  setupPython();
  writeConfigIfMissing(roles);
  statusTable();

  console.log(`\n${COLORS.bold}Done.${COLORS.reset} Run \`${COLORS.cyan}npm run dev${COLORS.reset}\` and open http://localhost:3000/setup`);
}

main().catch((e) => {
  console.error(`\n${COLORS.red}Setup failed:${COLORS.reset} ${e.message}`);
  process.exit(1);
});
