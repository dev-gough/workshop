/**
 * Tekkit Classic coach — oneshot via tekkit-coach.timer.
 *
 * save-all → read player.dat + nearby chests → cheap CLI agent → RCON say.
 *
 * Compatible CLIs (TEKKIT_COACH_CLI):
 *   cursor-agent  (default)  model TEKKIT_COACH_MODEL or composer-2.5-fast
 *   grok                     model TEKKIT_COACH_MODEL or grok-4.5
 *
 * Flags: --dry-run (print snapshot, no agent/RCON)  --no-say (agent only)
 */
import { execFile, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import { getConfig } from '../src/lib/config';
import { sendRconCommand } from '../src/lib/rcon';
import { emcTag, summarizeEmc } from './tekkit-emc';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SERVICE = 'minecraft-tekkit';
const WORLD = '/home/server/tekkit/world';
const WORLD_PLAYERS = path.join(WORLD, 'players');
const STATE_PATH = '/home/server/tekkit/coach-state.json';
const HISTORY_PATH = '/home/server/tekkit/coach-history.jsonl';
const SYSTEM_PROMPT_PATH = path.join(HERE, 'tekkit-coach-system.md');
const WORK_DIR = '/tmp/tekkit-coach-work';
const RECENT_KEEP = 8;
const HISTORY_KEEP = 6;
const AGENT_TIMEOUT_MS = 90_000;
/** `say` prepends "[Server] "; vanilla 1.2.5 then truncates the whole line at 100. */
const LINE_WIDTH = 84;

const HINT_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['silent', 'hint'],
  properties: {
    silent: { type: 'boolean' },
    hint: { type: 'string' },
  },
});

const ITEM_NAMES: Record<number, string> = {
  1: 'Stone', 2: 'Grass', 3: 'Dirt', 4: 'Cobble', 5: 'Planks', 6: 'Sapling',
  14: 'Gold Ore', 15: 'Iron Ore', 16: 'Coal Ore', 17: 'Wood', 18: 'Leaves',
  20: 'Glass', 21: 'Lapis Ore', 35: 'Wool', 49: 'Obsidian', 50: 'Torch',
  54: 'Chest', 56: 'Diamond Ore', 58: 'Crafting Table', 61: 'Furnace',
  73: 'Redstone Ore', 81: 'Cactus', 87: 'Netherrack', 88: 'Soul Sand',
  89: 'Glowstone', 13: 'Gravel', 140: 'RP Ore', 246: 'IC2 Generator', 248: 'Tin Ore (IC2)',
  249: 'Copper Ore (IC2)', 250: 'IC2 Machine', 256: 'Iron Shovel',
  257: 'Iron Pick', 258: 'Iron Axe', 259: 'Flint and Steel', 260: 'Apple',
  262: 'Arrow', 263: 'Coal', 264: 'Diamond', 265: 'Iron Ingot', 266: 'Gold Ingot',
  267: 'Iron Sword', 268: 'Wood Sword', 269: 'Wood Shovel', 270: 'Wood Pick',
  271: 'Wood Axe', 272: 'Stone Sword', 273: 'Stone Shovel', 274: 'Stone Pick',
  275: 'Stone Axe', 276: 'Diamond Sword', 277: 'Diamond Shovel', 278: 'Diamond Pick',
  279: 'Diamond Axe', 280: 'Stick', 297: 'Bread', 318: 'Flint', 319: 'Raw Pork',
  320: 'Cooked Pork', 325: 'Bucket', 326: 'Water Bucket', 327: 'Lava Bucket',
  329: 'Saddle', 331: 'Redstone', 344: 'Egg', 345: 'Compass', 347: 'Clock',
  348: 'Glowstone Dust', 351: 'Dye', 352: 'Bone', 361: 'Pumpkin Seeds',
  362: 'Melon Seeds', 364: 'Steak', 366: 'Cooked Chicken', 368: 'Ender Pearl',
  287: 'String', 289: 'Gunpowder', 296: 'Wheat',
  // RedPower 2 (config ids; NBT is +256)
  1001: 'RP Resource', 1022: 'Ruby Shovel', 1023: 'Emerald Shovel',
  1024: 'Sapphire Shovel', 1025: 'Ruby Pickaxe', 1026: 'Emerald Pickaxe',
  1027: 'Sapphire Pickaxe', 1028: 'Ruby Axe', 1029: 'Emerald Axe',
  1030: 'Sapphire Axe', 1013: 'Iron Sickle', 1014: 'Diamond Sickle',
  1019: 'Ruby Sword', 1020: 'Emerald Sword', 1021: 'Sapphire Sword',
  3800: 'Wood Gear', 3801: 'Stone Gear', 3802: 'Iron Gear', 3803: 'Gold Gear',
  3804: 'Diamond Gear',
  306: 'Iron Helmet', 307: 'Iron Chestplate', 308: 'Iron Leggings', 309: 'Iron Boots',
  27270: "Philosopher's Stone", 27283: 'Alchemical Coal', 27284: 'Mobius Fuel',
  27285: 'Dark Matter', 27286: 'Covalence Dust', 27287: 'DM Pickaxe',
  27301: 'Klein Star Ein', 27302: 'Klein Star Zwei', 27303: 'Klein Star Drei',
  27304: 'Klein Star Vier', 27305: 'Klein Star Sphere', 27307: 'Red Matter',
  27308: 'RM Pickaxe', 27315: 'Aeternalis Fuel', 27329: 'Divining Rod',
  27306: 'Alchemy Bag', 27335: 'Klein Star Omega',
  27336: 'Transmutation Tablet',
  29928: 'IC2 Cable', 29935: 'Electronic Circuit', 29934: 'Advanced Circuit',
  29944: 'Bronze Pickaxe', 29956: 'Treetap', 29960: 'Rubber', 29961: 'Sticky Resin',
  29978: 'Diamond Drill', 29979: 'Mining Drill', 29986: 'RE-Battery',
  29990: 'Bronze Ingot', 29991: 'Tin Ingot', 29992: 'Copper Ingot',
  29993: 'Refined Iron', 29997: 'Copper Dust', 29996: 'Tin Dust', 29999: 'Iron Dust',
};

const RP_RESOURCE_META = [
  'Ruby', 'Green Sapphire', 'Sapphire', 'Silver', 'Tin', 'Copper', 'Nikolite', 'Brass',
];
const RP_ORE_META = [
  'Ruby Ore', 'Green Sapphire Ore', 'Sapphire Ore', 'Silver Ore',
  'Tin Ore', 'Copper Ore', 'Nikolite Ore', 'Tungstate Ore',
];

interface Item {
  id: number;
  count: number;
  damage: number;
  slot: number;
}

interface Facts {
  name: string;
  x: number;
  y: number;
  z: number;
  dim: number;
  health: number;
  food: number;
  xp: number;
  items: Item[];
}

interface HintResult {
  silent: boolean;
  hint: string;
}

interface State {
  players: Record<string, { recent: string[] }>;
}

interface NearbyInv {
  id: string;
  x: number;
  y: number;
  z: number;
  dist: number;
  items: { slot: number; count: number; name: string; id: number; dmg: number }[];
}

class Nbt {
  constructor(private buf: Buffer, private o = 0) {}
  private u8() { return this.buf[this.o++]; }
  private i8() { const v = this.buf.readInt8(this.o); this.o += 1; return v; }
  private i16() { const v = this.buf.readInt16BE(this.o); this.o += 2; return v; }
  private i32() { const v = this.buf.readInt32BE(this.o); this.o += 4; return v; }
  private i64() { const v = this.buf.readBigInt64BE(this.o); this.o += 8; return v; }
  private f32() { const v = this.buf.readFloatBE(this.o); this.o += 4; return v; }
  private f64() { const v = this.buf.readDoubleBE(this.o); this.o += 8; return v; }
  private str() {
    const n = this.i16();
    const s = this.buf.subarray(this.o, this.o + n).toString('utf8');
    this.o += n;
    return s;
  }
  private payload(t: number): unknown {
    if (t === 1) return this.i8();
    if (t === 2) return this.i16();
    if (t === 3) return this.i32();
    if (t === 4) return this.i64();
    if (t === 5) return this.f32();
    if (t === 6) return this.f64();
    if (t === 7) {
      const n = this.i32();
      const d = this.buf.subarray(this.o, this.o + n);
      this.o += n;
      return d;
    }
    if (t === 8) return this.str();
    if (t === 9) {
      const lt = this.u8();
      const n = this.i32();
      return Array.from({ length: n }, () => this.payload(lt));
    }
    if (t === 10) return this.compound();
    if (t === 11) {
      const n = this.i32();
      return Array.from({ length: n }, () => this.i32());
    }
    throw new Error(`nbt tag ${t} at ${this.o}`);
  }
  compound(): Record<string, unknown> {
    const d: Record<string, unknown> = {};
    for (;;) {
      const t = this.u8();
      if (t === 0) break;
      d[this.str()] = this.payload(t);
    }
    return d;
  }
  root(): Record<string, unknown> {
    const t = this.u8();
    this.str();
    const v = this.payload(t);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};
  }
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return fallback;
}

function itemLabel(id: number, dmg: number): string {
  if (id === 140) return RP_ORE_META[dmg] ?? `RP Ore:${dmg}`;
  if (id === 1001 || id === 1257) return RP_RESOURCE_META[dmg] ? `RP ${RP_RESOURCE_META[dmg]}` : `RP Resource:${dmg}`;
  if (id === 263) return dmg === 1 ? 'Charcoal' : 'Coal';
  if (id === 351) return ['Ink Sac', 'Rose Red', 'Cactus Green', 'Cocoa Beans', 'Lapis', 'Purple Dye', 'Cyan Dye', 'Light Gray Dye', 'Gray Dye', 'Pink Dye', 'Lime Dye', 'Dandelion Yellow', 'Light Blue Dye', 'Magenta Dye', 'Orange Dye', 'Bone Meal'][dmg] ?? `Dye:${dmg}`;
  const cfg = id >= 1000 ? id - 256 : id;
  const named = ITEM_NAMES[id] ?? ITEM_NAMES[cfg];
  if (named) return named;
  if ((id >= 27269 && id < 27620) || (cfg >= 27269 && cfg < 27620)) return `EE item ${id}`;
  if ((id >= 29848 && id <= 30300) || (cfg >= 29848 && cfg <= 30300)) return `IC2 item ${id}`;
  return `id ${id}`;
}

function parsePlayer(file: string): Facts | null {
  if (!existsSync(file)) return null;
  const data = new Nbt(gunzipSync(readFileSync(file))).root();
  const pos = Array.isArray(data.Pos) ? data.Pos as number[] : [0, 0, 0];
  const rawInv = Array.isArray(data.Inventory) ? data.Inventory as Record<string, unknown>[] : [];
  const items: Item[] = rawInv.map((it) => ({
    id: num(it.id),
    count: num(it.Count, 1),
    damage: num(it.Damage),
    slot: num(it.Slot),
  }));
  return {
    name: path.basename(file, '.dat'),
    x: num(pos[0]), y: num(pos[1]), z: num(pos[2]),
    dim: num(data.Dimension),
    health: num(data.Health, 20),
    food: num(data.foodLevel, 20),
    xp: num(data.XpLevel),
    items,
  };
}

function ascii(s: string): string {
  return s.replace(/[—–]/g, '-').replace(/[^\x20-\x7e]/g, '');
}

function wrapChat(s: string, width = LINE_WIDTH): string[] {
  const words = ascii(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= width) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    if (w.length > width) {
      for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width));
      cur = '';
    } else {
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State;
  } catch {
    return { players: {} };
  }
}

function saveState(state: State) {
  const tmp = STATE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, STATE_PATH);
}

function parseList(raw: string): string[] {
  const line = raw.replace(/\u00a7./g, '').trim();
  const m = line.match(/Connected players:\s*(.*)$/i);
  if (!m) return [];
  const body = m[1].trim();
  if (!body || /^none$/i.test(body)) return [];
  return body.split(',').map((s) => s.trim()).filter(Boolean);
}

function whichBin(name: string): string | null {
  const extra = path.join(homedir(), '.local', 'bin', name);
  if (existsSync(extra)) return extra;
  return null;
}

function resolveCli(): { kind: 'grok' | 'cursor-agent'; bin: string; model: string } {
  const forced = (process.env.TEKKIT_COACH_CLI || 'cursor-agent').trim().toLowerCase();
  const kind: 'grok' | 'cursor-agent' = forced.includes('grok') && !forced.includes('cursor')
    ? 'grok'
    : 'cursor-agent';
  const bin = kind === 'grok'
    ? (whichBin('grok') ?? 'grok')
    : (whichBin('cursor-agent') ?? 'cursor-agent');
  const model = process.env.TEKKIT_COACH_MODEL?.trim()
    || (kind === 'grok' ? 'grok-4.5' : 'composer-2.5-fast');
  return { kind, bin, model };
}

function formatInv(items: Item[]): string[] {
  return [...items]
    .sort((a, b) => a.slot - b.slot)
    .map((i) => {
      const where = i.slot < 9 ? 'hotbar' : i.slot < 36 ? 'inv' : 'armor';
      const dmg = i.damage ? ` dmg=${i.damage}` : '';
      return `${where} s${i.slot}: ${i.count}x ${itemLabel(i.id, i.damage)} (id ${i.id}${dmg}) [${emcTag(i.id, i.damage, i.count)}]`;
    });
}

function tailHistory(name: string, n: number): unknown[] {
  if (!existsSync(HISTORY_PATH)) return [];
  const lines = readFileSync(HISTORY_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const mine = lines.map((l) => {
    try { return JSON.parse(l) as { name?: string; inv?: [number, number, number, number][] } & Record<string, unknown>; }
    catch { return null; }
  }).filter((r): r is NonNullable<typeof r> => !!r && r.name === name);
  return mine.slice(-n).map((r) => ({
    t: r.t, x: r.x, y: r.y, z: r.z, dim: r.dim, health: r.health, food: r.food, xp: r.xp,
    inv: Array.isArray(r.inv)
      ? r.inv.map(([id, count, damage, slot]) => `${count}x ${itemLabel(id, damage)} (id ${id} dmg=${damage} s${slot})`)
      : [],
  }));
}

async function nearbyInventories(player: string, radius = 48): Promise<NearbyInv[]> {
  const script = path.join(HERE, 'tekkit-world.py');
  if (!existsSync(script)) return [];
  try {
    const { stdout } = await execFileAsync('python3', [
      script, '--json', '--player', player, '--radius', String(radius),
    ], { timeout: 20_000, maxBuffer: 2_000_000 });
    const data = JSON.parse(stdout) as { nearby?: NearbyInv[] };
    return Array.isArray(data.nearby) ? data.nearby.slice(0, 12) : [];
  } catch (e) {
    console.log(`nearby inventories skipped: ${(e as Error).message}`);
    return [];
  }
}

function buildUserPrompt(f: Facts, recent: string[], history: unknown[], nearby: NearbyInv[]): string {
  const dim = f.dim === -1 ? 'nether' : f.dim === 1 ? 'end' : 'overworld';
  const invLines = formatInv(f.items);
  const chests = nearby.map((c) => {
    const stuff = c.items.length
      ? c.items.map((it) => `${it.count}x ${itemLabel(it.id, it.dmg)} [${emcTag(it.id, it.dmg, it.count)}]`).join(', ')
      : 'empty';
    return `- ${c.id} at ${c.x},${c.y},${c.z} (${Math.round(c.dist)}m): ${stuff}`;
  });
  return [
    `Player ${f.name}  pos=${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)}  dim=${dim} (${f.dim})`,
    `health=${f.health}/20  food=${f.food}/20  xpLevel=${f.xp}`,
    `Base last seen around 247,58,127 (overworld).`,
    '',
    'Inventory now:',
    ...(invLines.length ? invLines : ['(empty)']),
    summarizeEmc(f.items),
    '',
    'Nearby tile inventories (this save, closest first):',
    ...(chests.length ? chests : ['(none)']),
    '',
    `recentTips (already said, do not repeat): ${recent.length ? JSON.stringify(recent) : '[]'}`,
    '',
    'Recent snapshots (oldest to newest):',
    JSON.stringify(history, null, 2),
    '',
    'Return the JSON hint object now.',
  ].join('\n');
}

function extractJson(raw: string): HintResult {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as Partial<HintResult>;
      const hint = ascii(String(parsed.hint ?? '')).trim();
      const silent = Boolean(parsed.silent) || hint.length === 0;
      return { silent, hint };
    } catch {
      // fall through
    }
  }
  const line = ascii(trimmed)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('```') && !l.startsWith('{') && l.toLowerCase() !== 'skip');
  if (!line) return { silent: true, hint: '' };
  return { silent: false, hint: line };
}

function runCli(kind: 'grok' | 'cursor-agent', bin: string, model: string, system: string, user: string): Promise<string> {
  mkdirSync(WORK_DIR, { recursive: true });
  const userFile = path.join(WORK_DIR, 'user.txt');
  const sysFile = path.join(WORK_DIR, 'system.md');
  writeFileSync(userFile, user);
  writeFileSync(sysFile, system);

  const args = kind === 'grok'
    ? [
        '--cwd', WORK_DIR,
        '--no-plan',
        '--no-subagents',
        '--disable-web-search',
        '--max-turns', '1',
        '--permission-mode', 'plan',
        '--reasoning-effort', 'low',
        '--model', model,
        '--system-prompt-override', system,
        '--prompt-file', userFile,
        '--json-schema', HINT_SCHEMA,
        '--output-format', 'json',
      ]
    : [
        '-p',
        '--mode', 'ask',
        '--trust',
        '--sandbox', 'disabled',
        '--workspace', WORK_DIR,
        '--model', model,
        '--output-format', 'text',
        `${system}\n\n---\n\n${user}`,
      ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: WORK_DIR,
      env: { ...process.env, HOME: homedir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${kind} timed out after ${AGENT_TIMEOUT_MS}ms`));
    }, AGENT_TIMEOUT_MS);
    child.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { err += c.toString(); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${kind} exit ${code}: ${(err || out).trim().slice(0, 800)}`));
        return;
      }
      resolve(out.trim() || err.trim());
    });
  });
}

function grokHintFromOutput(raw: string): HintResult {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const inner = parsed.result ?? parsed.hint ?? parsed;
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && ('hint' in (inner as object) || 'silent' in (inner as object))) {
      return extractJson(JSON.stringify(inner));
    }
    if (typeof parsed.result === 'string') return extractJson(parsed.result);
    if (typeof parsed.text === 'string') return extractJson(parsed.text);
  } catch {
    // fall through to brace-scan
  }
  return extractJson(raw);
}

async function askCoach(system: string, user: string): Promise<HintResult> {
  const { kind, bin, model } = resolveCli();
  console.log(`agent ${kind} model=${model} bin=${bin}`);
  const raw = await runCli(kind, bin, model, system, user);
  return kind === 'grok' ? grokHintFromOutput(raw) : extractJson(raw);
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const noSay = process.argv.includes('--no-say') || dry;
  const mc = getConfig().minecraftServers.find((s) => s.name === SERVICE);
  if (!mc) {
    console.error(`${SERVICE} is not in config.json minecraftServers`);
    process.exitCode = 1;
    return;
  }

  const rcon = async (cmd: string) => {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await sendRconCommand(mc.host, mc.port, mc.password, cmd);
        await new Promise((r) => setTimeout(r, 150));
        return out;
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    throw last;
  };

  let names: string[];
  if (dry && process.env.TEKKIT_COACH_PLAYER) {
    names = [process.env.TEKKIT_COACH_PLAYER];
  } else {
    let listRaw: string;
    try {
      listRaw = await rcon('list');
    } catch (e) {
      console.log(`rcon list failed (server down?): ${(e as Error).message}`);
      return;
    }
    names = parseList(listRaw);
  }
  if (names.length === 0) {
    if (dry) {
      names = [process.env.TEKKIT_COACH_PLAYER || 'Devy_10'];
      console.log(`nobody online; dry-run using ${names[0]}.dat`);
    } else {
      console.log('nobody online');
      return;
    }
  }

  if (!dry) {
    await rcon('save-all');
    await new Promise((r) => setTimeout(r, 800));
  }

  const system = readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
  const state = loadState();
  for (const name of names) {
    const facts = parsePlayer(path.join(WORLD_PLAYERS, `${name}.dat`));
    if (!facts) {
      console.log(`${name}: no player.dat`);
      continue;
    }
    facts.name = name;
    const slot = state.players[name] ?? { recent: [] };
    if (!dry) {
      appendFileSync(HISTORY_PATH, JSON.stringify({
        t: new Date().toISOString(),
        name,
        x: +facts.x.toFixed(2), y: +facts.y.toFixed(2), z: +facts.z.toFixed(2),
        dim: facts.dim, health: facts.health, food: facts.food, xp: facts.xp,
        inv: facts.items.map((i) => [i.id, i.count, i.damage, i.slot]),
      }) + '\n');
    }
    const nearby = await nearbyInventories(name);
    const history = tailHistory(name, HISTORY_KEEP);
    const user = buildUserPrompt(facts, slot.recent, history, nearby);

    if (dry) {
      console.log('--- system ---\n' + system.slice(0, 400) + '...\n');
      console.log('--- user ---\n' + user);
      continue;
    }

    let result: HintResult;
    try {
      result = await askCoach(system, user);
    } catch (e) {
      console.error(`${name}: agent failed: ${(e as Error).message}`);
      continue;
    }
    if (result.silent) {
      console.log(`${name}: silent`);
      continue;
    }

    const lines = wrapChat(result.hint);
    if (noSay) {
      for (const line of lines) console.log(`  (no-say) ${line}`);
      console.log(`${name} y=${facts.y.toFixed(0)} food=${facts.food} -> ${lines.length} line${lines.length === 1 ? '' : 's'} (not sent)`);
      continue;
    }
    for (const line of lines) {
      const said = await rcon(`say ${line}`);
      console.log(`  say: ${said.trim() || line}`);
    }
    slot.recent = [...slot.recent, result.hint].slice(-RECENT_KEEP);
    state.players[name] = slot;
    console.log(`${name} y=${facts.y.toFixed(0)} food=${facts.food} -> ${lines.length} line${lines.length === 1 ? '' : 's'}`);
  }
  if (!dry) saveState(state);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
