import type { Build } from './model';

/** Local websocket the Megabonk bridge mod hosts. See mods/megabonk-bridge. */
export const LIVE_URL = 'ws://127.0.0.1:47315';

export type LiveStat = { id: string; v: number };
export type LiveStack = { id: string; n?: number; level?: number; damage?: number; on?: boolean; power?: number; icon?: string };
export type LiveDealt = { source: string; damage: number; icon?: string };

export type LiveStats = {
  damageMultiplier?: number;
  critChance?: number;
  critDamage?: number;
  attackSpeed?: number;
  eliteDamage?: number;
  poisonDamage?: number;
};

export type LiveSnapshot = {
  v: 1 | 2;
  t: number;
  inRun: boolean;
  hp?: number;
  maxHp?: number;
  shield?: number;
  gold?: number;
  level?: number;
  stats?: LiveStats;
  /** Every non-zero GetStat value. Present on plugin 0.2+. */
  all?: LiveStat[];
  items?: LiveStack[];
  weapons?: LiveStack[];
  tomes?: LiveStack[];
  /** Damage dealt per second over the last 10 seconds. */
  dps?: number;
  /** Per-source damage in that same 10 second window. */
  dealt?: LiveDealt[];
  /** Per-source damage since the run started. */
  run?: LiveDealt[];
};

export type SourceShare = LiveDealt & { percent: number };

/** Every stat the snapshot actually carried. `all` wins; the six named fields cover an older plugin. */
export function statRows(snap: LiveSnapshot): LiveStat[] {
  if (snap.all && snap.all.length > 0) return snap.all;
  const stats = snap.stats;
  if (!stats) return [];
  const named: [string, number | undefined][] = [
    ['DamageMultiplier', stats.damageMultiplier],
    ['CritChance', stats.critChance],
    ['CritDamage', stats.critDamage],
    ['AttackSpeed', stats.attackSpeed],
    ['EliteDamageMultiplier', stats.eliteDamage],
    ['PoisonDamageMultiplier', stats.poisonDamage],
  ];
  return named.flatMap(([id, v]) => (typeof v === 'number' && Number.isFinite(v) ? [{ id, v }] : []));
}

/** Share of damage dealt in the mod's window. Sums to 100 across rows with damage. */
export function sourceShares(dealt: LiveDealt[] | undefined): SourceShare[] {
  if (!dealt || dealt.length === 0) return [];
  const rows = dealt.filter(row => Number.isFinite(row.damage) && row.damage > 0);
  const total = rows.reduce((sum, row) => sum + row.damage, 0);
  return rows
    .map(row => ({ ...row, percent: total > 0 ? (row.damage / total) * 100 : 0 }))
    .sort((a, b) => b.damage - a.damage);
}

const STAT_LABEL: Record<string, string> = {
  MaxHealth: 'Max HP',
  HealthRegen: 'HP regen',
  DamageMultiplier: 'Damage',
  AttackSpeed: 'Attack speed',
  CritChance: 'Crit chance',
  CritDamage: 'Crit damage',
  EliteDamageMultiplier: 'Elite damage',
  PoisonDamageMultiplier: 'Poison damage',
  MoveSpeedMultiplier: 'Move speed',
  GoldIncreaseMultiplier: 'Gold gain',
  XpIncreaseMultiplier: 'XP gain',
  Luck: 'Luck',
  Lifesteal: 'Lifesteal',
  Evasion: 'Evasion',
  Armor: 'Armor',
  Projectiles: 'Projectiles',
  ExtraJumps: 'Extra jumps',
  KnockbackMultiplier: 'Knockback',
  PickupRange: 'Pickup range',
  SizeMultiplier: 'Size',
  DurationMultiplier: 'Duration',
  ProjectileSpeedMultiplier: 'Projectile speed',
  ProjectileBounces: 'Bounces',
  Shield: 'Shield',
  Thorns: 'Thorns',
  Overheal: 'Overheal',
  JumpHeight: 'Jump height',
};

/** Raw GetStat, with the few units the dump documents written out. */
export function formatStat(id: string, value: number): { label: string; text: string } {
  const label = STAT_LABEL[id] ?? id.replace(/([A-Z])/g, ' $1').trim();
  if (id === 'CritChance' || id === 'AttackSpeed' || id === 'Evasion' || id === 'Lifesteal' || id === 'Armor') {
    return { label, text: `${trimNum(value * 100)}%` };
  }
  if (id === 'CritDamage') return { label, text: `×${trimNum(value * 2)}` };
  if (id.endsWith('Multiplier') || id === 'DamageMultiplier') return { label, text: `×${trimNum(value)}` };
  return { label, text: trimNum(value) };
}

function trimNum(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Copy the game's raw stats onto the sliders.
 * Crit chance and attack speed are fractions (0.4 = 40%).
 * Crit damage is stored raw and shown in-game as raw × 2.
 * Elite and poison damage are multipliers (1 = no bonus).
 */
export function applyLiveSnapshot(build: Build, snap: LiveSnapshot): Build {
  if (!snap.inRun || !snap.stats) return build;
  const stats = snap.stats;
  const next: Build = { ...build };

  if (typeof stats.critChance === 'number' && Number.isFinite(stats.critChance)) {
    next.critOn = stats.critChance > 0;
    next.critChance = round1(stats.critChance * 100);
    // The game's crit stat already includes Giant Fork.
    next.forkCritSeparate = false;
  }
  if (typeof stats.critDamage === 'number' && stats.critDamage > 0) {
    next.critDamage = round1(stats.critDamage * 2);
  }
  if (typeof stats.attackSpeed === 'number' && Number.isFinite(stats.attackSpeed)) {
    next.attackSpeedOn = stats.attackSpeed > 0;
    next.attackSpeed = round1(stats.attackSpeed * 100);
  }
  if (typeof stats.eliteDamage === 'number' && Number.isFinite(stats.eliteDamage)) {
    next.eliteDamage = Math.max(0, round1((stats.eliteDamage - 1) * 100));
  }
  if (typeof stats.poisonDamage === 'number' && Number.isFinite(stats.poisonDamage)) {
    next.poisonOn = stats.poisonDamage > 1;
    next.poison = Math.max(0, round1((stats.poisonDamage - 1) * 100));
  }
  return next;
}
