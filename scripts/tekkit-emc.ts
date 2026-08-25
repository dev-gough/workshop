/**
 * Equivalent Exchange 2 (Tekkit Classic 3.1.2) EMC + fuel/matter.
 * Values match EE2Server V1.4.6.5 (EEMaps + EEAddonRP2).
 */
export type EmcKind = 'fuel' | 'matter';

export interface EmcInfo {
  emc: number;
  kind: EmcKind;
}

/** Fuel items the transmutation tablet locks to. Everything else with EMC is matter. */
const FUEL_IDS = new Set<number>([
  331,   // redstone
  289,   // gunpowder
  348,   // glowstone dust
  89,    // glowstone block
  377,   // blaze powder
  27283, // alchemical coal
  27284, // mobius fuel
  27315, // aeternalis fuel
  27285, // dark matter (EE2 treats DM/RM as fuel)
  27307, // red matter
]);

/** id -> emc, or id -> { [damage]: emc } when meta matters. */
const EMC: Record<number, number | Record<number, number>> = {
  1: 1, 2: 1, 3: 1, 4: 1, 5: 8, 6: 32, 12: 1, 13: 4,
  14: 2048, 15: 256, 16: 128, 17: 32, 18: 1, 20: 1,
  21: 864, 22: 7776, 24: 1, 35: 48, 37: 16, 38: 16,
  39: 32, 40: 32, 41: 18432, 42: 2304, 45: 64, 47: 336,
  48: 1, 49: 64, 50: 9, 54: 64, 56: 8192, 57: 73728,
  58: 32, 61: 8, 65: 14, 66: 96, 69: 5, 70: 2, 72: 2,
  76: 68, 77: 2, 79: 1, 80: 1, 81: 8, 82: 64, 87: 1,
  88: 49, 89: 1536, 91: 144, 98: 1, 103: 144, 106: 8,
  112: 4,
  256: 256, 257: 256, 258: 256, 259: 260, 260: 128,
  306: 1280, 307: 2048, 308: 1792, 309: 1024,
  262: 14, 264: 8192, 265: 256, 266: 2048,
  267: 256, 268: 8, 269: 8, 270: 8, 271: 8,
  272: 1, 273: 1, 274: 1, 275: 1,
  276: 8192, 277: 8192, 278: 8192, 279: 8192,
  280: 4, 281: 6, 282: 70, 287: 24, 288: 48, 289: 192,
  295: 16, 296: 24, 297: 72, 318: 4, 319: 64, 320: 64,
  325: 768, 326: 769, 327: 832, 329: 192, 330: 1536,
  331: 64, 332: 1, 334: 64, 336: 16, 337: 16, 338: 32,
  339: 32, 340: 96, 344: 32, 345: 1088, 347: 8256,
  348: 384, 352: 144, 353: 32, 360: 16, 361: 16, 362: 16,
  363: 64, 364: 64, 365: 64, 366: 64, 367: 24, 368: 1024,
  369: 1536, 370: 4096, 371: 227, 372: 24, 377: 768,
  378: 792, 381: 1792,
  263: { 0: 128, 1: 32 }, // coal / charcoal
  351: { // dyes
    0: 8, 1: 16, 2: 8, 3: 128, 4: 864, 5: 16, 6: 8, 7: 8,
    8: 8, 9: 16, 10: 8, 11: 16, 12: 16, 13: 16, 14: 16, 15: 48,
  },
  // RP world ores (block 140) — same EMC as the gem/ingot they drop
  140: { 0: 1024, 1: 1024, 2: 1024, 3: 512, 4: 256, 5: 85, 6: 128, 7: 4096 },
  // RP resource item (cfg 1001, NBT 1257)
  1001: { 0: 1024, 1: 1024, 2: 1024, 3: 512, 4: 256, 5: 85, 6: 128 },
  1257: { 0: 1024, 1: 1024, 2: 1024, 3: 512, 4: 256, 5: 85, 6: 128 },
  // EE2
  27270: 9984, 27283: 512, 27284: 2048, 27285: 139264,
  27286: 1, // covalence dust meta handled below
  27307: 466944, 27315: 8192, 27336: 260,
  126: 139264, 128: 64, // DM block, alch chest-ish (best-effort)
};

/** Covalence dust metas: 0 low=1, 1 medium=8, 2 high=208 */
function covalence(dmg: number): number {
  return dmg === 1 ? 8 : dmg === 2 ? 208 : 1;
}

function lookupRaw(id: number, dmg: number): number | undefined {
  const cfg = id >= 1000 ? id - 256 : id;
  for (const key of [id, cfg]) {
    const row = EMC[key];
    if (row == null) continue;
    if (typeof row === 'number') return row;
    if (row[dmg] != null) return row[dmg];
    if (row[0] != null && dmg === 0) return row[0];
  }
  if (id === 27286 || cfg === 27286) return covalence(dmg);
  return undefined;
}

function isFuel(id: number, dmg: number): boolean {
  const cfg = id >= 1000 ? id - 256 : id;
  if (FUEL_IDS.has(id) || FUEL_IDS.has(cfg)) return true;
  if ((id === 263 || cfg === 263) && (dmg === 0 || dmg === 1)) return true; // coal + charcoal
  // RP nikolite (resource meta 6, ore meta 6)
  if ((id === 1257 || id === 1001 || cfg === 1001) && dmg === 6) return true;
  if (id === 140 && dmg === 6) return true;
  return false;
}

export function emcInfo(id: number, dmg: number): EmcInfo | null {
  const emc = lookupRaw(id, dmg);
  if (emc == null || emc <= 0) return null;
  return { emc, kind: isFuel(id, dmg) ? 'fuel' : 'matter' };
}

export function fmtEmc(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function emcTag(id: number, dmg: number, count: number): string {
  const cfg = id >= 1000 ? id - 256 : id;
  const klein = [27301, 27302, 27303, 27304, 27305, 27335];
  if (klein.includes(id) || klein.includes(cfg)) {
    return 'Klein - dump tablet EMC in here to unlock fuel/matter';
  }
  const info = emcInfo(id, dmg);
  if (!info) return 'no EMC';
  const stack = info.emc * count;
  const each = count > 1 ? `${info.emc}ea ` : '';
  return `${info.kind} ${each}${fmtEmc(stack)}`;
}

export function summarizeEmc(items: { id: number; damage: number; count: number }[]): string {
  let fuel = 0;
  let matter = 0;
  let unknown = 0;
  for (const it of items) {
    const info = emcInfo(it.id, it.damage);
    if (!info) {
      unknown += 1;
      continue;
    }
    const n = info.emc * it.count;
    if (info.kind === 'fuel') fuel += n;
    else matter += n;
  }
  return `known EMC on person: ${fmtEmc(matter)} matter + ${fmtEmc(fuel)} fuel`
    + (unknown ? ` (${unknown} stacks have no EE2 value — do not burn those)` : '');
}
