import type { Build } from './model';

/** Local websocket the Megabonk bridge mod hosts. See mods/megabonk-bridge. */
export const LIVE_URL = 'ws://127.0.0.1:47315';

export type LiveStats = {
  damageMultiplier?: number;
  critChance?: number;
  critDamage?: number;
  attackSpeed?: number;
  eliteDamage?: number;
  poisonDamage?: number;
};

export type LiveSnapshot = {
  v: 1;
  t: number;
  inRun: boolean;
  stats?: LiveStats;
};

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
