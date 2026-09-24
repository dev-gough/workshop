/**
 * Centralized typed config loader for the workshop.
 *
 * `config.json` lives at the repo root, is gitignored, and is the single source
 * of truth for everything that varies between machines: Postgres credentials,
 * service URLs/keys, file paths, RCON passwords. The schema is documented in
 * `config.example.json` (which IS committed). Run `npm run setup` to bootstrap
 * a config.json from the example with generated DB passwords.
 *
 * Loading is synchronous — config is read once at module init, cached for the
 * process lifetime. This means `db.ts` can build its connection pool at import
 * time without async ceremony. Use `resetConfigCache()` from the in-app `/setup`
 * page after writing changes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export interface PostgresRole {
  user: string;
  password: string;
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  roles: {
    workshop: PostgresRole;
    soulseek_ingest: PostgresRole;
    challenge_poller: PostgresRole;
  };
}

export interface PathsConfig {
  /** Absolute or repo-relative path to the music library. `null` = unconfigured. */
  musicDirectory: string | null;
  /** Path to the BrainFuck Python repo (genetic algorithm + runner). Relative paths resolve from the repo root. */
  brainfuckRepo: string;
  /** Path to the Python interpreter for the BrainFuck venv. Defaults to `<brainfuckRepo>/.venv/bin/python`. */
  pythonBin: string;
  /**
   * Root of the paddle park data — tile pyramids and cached ArcGIS layer JSON,
   * laid out as `<root>/<slug>/{dem,imagery,jeff,*.json}`. Defaults to
   * `../paddle-cache`, i.e. deliberately OUTSIDE the repo.
   *
   * This must stay out of the project tree. Next's output file tracer globs
   * `**` under the tracing root at build time; with ~1.9M tiles in the tree it
   * exhausted the build worker's heap at any ceiling, and
   * `outputFileTracingExcludes` prunes the tracer's result rather than its walk,
   * so it could not prevent the enumeration. Renaming the directory in place did
   * not help either — only moving it out of the root did. Tiles are runtime data,
   * read when a request asks for them; nothing here is ever a build input.
   */
  paddleCache: string;
}

export interface JellyfinConfig {
  baseUrl: string;
  apiKey: string | null;
}

export interface TransmissionConfig {
  rpcUrl: string;
  username: string;
  password: string;
}

export interface SlskdConfig {
  baseUrl: string;
  apiKey: string;
  autoIngest: boolean;
}

export interface FinnhubConfig {
  /** API key for finnhub.io. Used as the fallback quote source for paper trading. */
  apiKey: string;
}

export interface RiotConfig {
  apiKey: string;
  gameName: string;
  tagLine: string;
  region: string;
}

export interface MinecraftServer {
  name: string;
  host: string;
  port: number;
  password: string;
}

export interface Config {
  postgres: PostgresConfig;
  paths: PathsConfig;
  services: {
    jellyfin: JellyfinConfig | null;
    transmission: TransmissionConfig | null;
    slskd: SlskdConfig | null;
    finnhub: FinnhubConfig | null;
  };
  riot: RiotConfig | null;
  minecraftServers: MinecraftServer[];
  /** Single shared token gating /api/config writes from the in-app /setup page. */
  setupToken: string | null;
  /** Laptop Ollama. Null hides generation until a base URL is set. */
  ollama: { baseUrl: string } | null;
}

class ConfigError extends Error {
  constructor(msg: string) {
    super(`config.json: ${msg}`);
    this.name = 'ConfigError';
  }
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(obj: unknown, key: string, ctx: string): string {
  const v = isObject(obj) ? obj[key] : undefined;
  if (typeof v !== 'string' || v.length === 0) {
    throw new ConfigError(`${ctx}.${key} must be a non-empty string`);
  }
  return v;
}

function asOptionalString(obj: unknown, key: string): string | null {
  const v = isObject(obj) ? obj[key] : undefined;
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new ConfigError(`${key} must be a string or null`);
  return v;
}

function asNumber(obj: unknown, key: string, ctx: string): number {
  const v = isObject(obj) ? obj[key] : undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ConfigError(`${ctx}.${key} must be a number`);
  }
  return v;
}

function asBoolean(obj: unknown, key: string, ctx: string, fallback?: boolean): boolean {
  const v = isObject(obj) ? obj[key] : undefined;
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'boolean') throw new ConfigError(`${ctx}.${key} must be a boolean`);
  return v;
}

function validateRole(obj: unknown, ctx: string): PostgresRole {
  if (!isObject(obj)) throw new ConfigError(`${ctx} must be an object`);
  return { user: asString(obj, 'user', ctx), password: asString(obj, 'password', ctx) };
}

function validate(raw: unknown): Config {
  if (!isObject(raw)) throw new ConfigError('root must be an object');

  const pg = raw.postgres;
  if (!isObject(pg)) throw new ConfigError('missing required "postgres" section');
  if (!isObject(pg.roles)) throw new ConfigError('missing required "postgres.roles" section');
  const roles = pg.roles as Json;
  const postgres: PostgresConfig = {
    host: asString(pg, 'host', 'postgres'),
    port: asNumber(pg, 'port', 'postgres'),
    database: asString(pg, 'database', 'postgres'),
    roles: {
      workshop: validateRole(roles.workshop, 'postgres.roles.workshop'),
      soulseek_ingest: validateRole(roles.soulseek_ingest, 'postgres.roles.soulseek_ingest'),
      challenge_poller: validateRole(roles.challenge_poller, 'postgres.roles.challenge_poller'),
    },
  };

  const p = isObject(raw.paths) ? raw.paths : {};
  const brainfuckRepo =
    typeof p.brainfuckRepo === 'string' && p.brainfuckRepo.length > 0
      ? p.brainfuckRepo
      : 'vendor/brainfuck-genetic';
  const pythonBin =
    typeof p.pythonBin === 'string' && p.pythonBin.length > 0
      ? p.pythonBin
      : `${brainfuckRepo}/.venv/bin/python`;
  const paths: PathsConfig = {
    musicDirectory: asOptionalString(p, 'musicDirectory'),
    brainfuckRepo,
    pythonBin,
    paddleCache:
      typeof p.paddleCache === 'string' && p.paddleCache.length > 0
        ? p.paddleCache
        : '../paddle-cache',
  };

  const s = isObject(raw.services) ? raw.services : {};
  const services: Config['services'] = {
    jellyfin: s.jellyfin == null ? null : {
      baseUrl: asString(s.jellyfin, 'baseUrl', 'services.jellyfin'),
      apiKey: asOptionalString(s.jellyfin, 'apiKey'),
    },
    transmission: s.transmission == null ? null : {
      rpcUrl: asString(s.transmission, 'rpcUrl', 'services.transmission'),
      username: asString(s.transmission, 'username', 'services.transmission'),
      password: asString(s.transmission, 'password', 'services.transmission'),
    },
    slskd: s.slskd == null ? null : {
      baseUrl: asString(s.slskd, 'baseUrl', 'services.slskd'),
      apiKey: asString(s.slskd, 'apiKey', 'services.slskd'),
      autoIngest: asBoolean(s.slskd, 'autoIngest', 'services.slskd', false),
    },
    finnhub: s.finnhub == null ? null : {
      apiKey: asString(s.finnhub, 'apiKey', 'services.finnhub'),
    },
  };

  const r = raw.riot;
  const riot: RiotConfig | null = r == null ? null : {
    apiKey: asString(r, 'apiKey', 'riot'),
    gameName: asString(r, 'gameName', 'riot'),
    tagLine: asString(r, 'tagLine', 'riot'),
    region: asString(r, 'region', 'riot'),
  };

  let minecraftServers: MinecraftServer[] = [];
  if (Array.isArray(raw.minecraftServers)) {
    minecraftServers = raw.minecraftServers.map((srv, i) => {
      const ctx = `minecraftServers[${i}]`;
      return {
        name: asString(srv, 'name', ctx),
        host: asString(srv, 'host', ctx),
        port: asNumber(srv, 'port', ctx),
        password: asString(srv, 'password', ctx),
      };
    });
  }

  return {
    postgres,
    paths,
    services,
    riot,
    minecraftServers,
    setupToken: asOptionalString(raw, 'setupToken'),
    ollama: validateOllama(raw.ollama),
  };
}

function validateOllama(raw: unknown): { baseUrl: string } | null {
  if (raw == null) return null;
  if (!isObject(raw)) throw new ConfigError('ollama must be an object or null');
  const baseUrl = asString(raw, 'baseUrl', 'ollama').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigError('ollama.baseUrl must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('ollama.baseUrl must be an http(s) URL');
  }
  return { baseUrl };
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const configPath = path.join(process.cwd(), 'config.json');
  if (!existsSync(configPath)) {
    throw new ConfigError(
      `not found at ${configPath}. ` +
      `Copy config.example.json to config.json and edit, ` +
      `or run \`npm run setup\` to bootstrap.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    throw new ConfigError(`invalid JSON: ${(e as Error).message}`);
  }
  cached = validate(raw);
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

/**
 * Merge `mutate` into the raw config.json, write atomically, reset the cache,
 * and re-validate by reloading. Shared by every route that persists config
 * changes (/api/config PATCH, /api/settings PATCH) so there is a single writer.
 *
 * `mutate` receives the parsed raw object (which preserves keys we don't model,
 * like `_doc`/`_comment`) and edits it in place.
 *
 * Resolves `{ ok: true }` on success, or a `{ ok: false, error, ... }` shape the
 * caller can turn into a NextResponse. A 422-style `written: true` flag is set
 * when the file was written but the reloaded config failed validation.
 */
export async function writeConfigPatch(
  mutate: (raw: Record<string, unknown>) => void,
): Promise<{ ok: true } | { ok: false; error: string; written?: boolean; status: number }> {
  const configPath = path.join(process.cwd(), 'config.json');
  const raw = JSON.parse(await fsp.readFile(configPath, 'utf-8')) as Record<string, unknown>;
  mutate(raw);

  // Atomic write
  const tmp = configPath + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  await fsp.rename(tmp, configPath);

  // Reset cache so the next getConfig() picks up the new values, and re-validate
  // immediately. If validation fails, surface the error (the file is already
  // written, but the in-memory cache will be invalid).
  resetConfigCache();
  try {
    getConfig();
  } catch (e) {
    return { ok: false, error: `validation failed after write: ${(e as Error).message}`, written: true, status: 422 };
  }
  return { ok: true };
}

/** Build a `pg`-compatible connection config for one of the three roles. */
export function pgClientConfig(role: keyof Config['postgres']['roles']) {
  const c = getConfig();
  const r = c.postgres.roles[role];
  return {
    user: r.user,
    password: r.password,
    host: c.postgres.host,
    port: c.postgres.port,
    database: c.postgres.database,
  };
}

/** Resolve `paths.brainfuckRepo` to an absolute path (relative paths use cwd). */
export function brainfuckRepoPath(): string {
  const c = getConfig();
  return path.isAbsolute(c.paths.brainfuckRepo)
    ? c.paths.brainfuckRepo
    : path.resolve(process.cwd(), c.paths.brainfuckRepo);
}

/** Resolve `paths.pythonBin` to an absolute path (relative paths use cwd). */
export function pythonBinPath(): string {
  const c = getConfig();
  return path.isAbsolute(c.paths.pythonBin)
    ? c.paths.pythonBin
    : path.resolve(process.cwd(), c.paths.pythonBin);
}

/**
 * Resolve `paths.paddleCache` to an absolute path (relative paths use cwd).
 * Call this per-use rather than caching it in a module-level const: reading it
 * lazily keeps `getConfig()` off the import path, so a missing config.json
 * cannot break module loading during a build.
 */
export function paddleCachePath(): string {
  const c = getConfig();
  return path.isAbsolute(c.paths.paddleCache)
    ? c.paths.paddleCache
    : path.resolve(process.cwd(), c.paths.paddleCache);
}
