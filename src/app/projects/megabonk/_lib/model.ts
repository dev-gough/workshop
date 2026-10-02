// ─────────────────────────────────────────────────────────────────────────
// Megabonk hit model.
//
// Sources:
//   lukeod/megabonk_research item constructors + DamageUtility.GetCritDamageMultiplier,
//   validated 2026-01-28.
//   v1.0.12 patch notes for Joe's Dagger growth cap (the constructor still
//   stores a 999,999 ceiling; the cap is the patch). No patch from v1.0.64
//   through v1.0.69 changed these item constants.
//
// A hit is a product of real stages. EStat 12 (Power) items add into one
// stat. PreAttack additives add into a second component. Those stages
// multiply. This file does not invent character passives, tome multipliers,
// or a Demonic Soul per-kill number — those are not in the dump.
// ─────────────────────────────────────────────────────────────────────────

export type StageId =
  | 'power'
  | 'hitAdd'
  | 'hitBase'
  | 'hitMult'
  | 'speedboi'
  | 'bonker'
  | 'crit'
  | 'elite'
  | 'attackspeed';

export type Bracket = {
  id: StageId;
  name: string;
  blurb: string;
  color: string;
  additive: boolean;
  conditional?: boolean;
};

export const BRACKETS: Record<StageId, Bracket> = {
  power: {
    id: 'power',
    name: 'Power',
    blurb: 'EStat 12. These items add into one stat, then the hit is multiplied by (1 + that sum).',
    color: '#f2a71c',
    additive: true,
  },
  hitAdd: {
    id: 'hitAdd',
    name: 'Hit additive',
    blurb: 'PreAttack AddAdditive. Adds together, then multiplies Power as (1 + sum).',
    color: '#e8743b',
    additive: true,
  },
  hitBase: {
    id: 'hitBase',
    name: 'Hit base',
    blurb: 'Added onto the hit\'s base component. Counted as (1 + sum).',
    color: '#37b24d',
    additive: true,
  },
  hitMult: {
    id: 'hitMult',
    name: 'Hit multiplier',
    blurb: 'PreAttack AddMultiplier. Each one multiplies the hit.',
    color: '#ec4899',
    additive: false,
  },
  speedboi: {
    id: 'speedboi',
    name: 'Speed Boi',
    blurb: 'During the time slow, the hit\'s damage is multiplied by 2. Copies do not raise that 2.',
    color: '#22b8cf',
    additive: false,
    conditional: true,
  },
  bonker: {
    id: 'bonker',
    name: 'Bonker',
    blurb: 'Expected extra hit on the enemy you struck. Not a buff on every attack.',
    color: '#f76707',
    additive: false,
    conditional: true,
  },
  crit: {
    id: 'crit',
    name: 'Crit',
    blurb: 'Expected multiplier from GetCritDamageMultiplier, including overcrit past 100%.',
    color: '#e8433f',
    additive: false,
  },
  elite: {
    id: 'elite',
    name: 'Elite damage',
    blurb: 'Elite damage multiplier. The v1.0.64 notes say it applies to that elite, not to every enemy.',
    color: '#a855f7',
    additive: false,
    conditional: true,
  },
  attackspeed: {
    id: 'attackspeed',
    name: 'Attack speed',
    blurb: 'More hits per second. Multiplies sustained DPS, not the damage of one hit.',
    color: '#3b82f6',
    additive: false,
  },
};

export type ItemKind =
  | 'power'
  | 'scarf'
  | 'beefy'
  | 'goggles'
  | 'redcard'
  | 'idle'
  | 'joe'
  | 'eagle'
  | 'glasses'
  | 'knuckles'
  | 'phantom'
  | 'fork'
  | 'speedboi'
  | 'bonker';

export type ItemDef = {
  id: string;
  name: string;
  emoji: string;
  kind: ItemKind;
  stackable?: boolean;
  note: string;
};

/** Stepper limit for the page. The dump does not publish a stack cap for these items. */
export const STACK_UI_MAX = 40;

export const ITEMS: ItemDef[] = [
  { id: 'beer', name: 'Beer', emoji: '🍺', kind: 'power', stackable: true, note: '+20% Power per copy. Also −5% max HP per copy, which this hit total does not apply.' },
  { id: 'gym-sauce', name: 'Gym Sauce', emoji: '🧴', kind: 'power', stackable: true, note: '+10% Power per copy. Same stat as Beer, so they add.' },
  { id: 'scarf', name: 'Scarf', emoji: '🧣', kind: 'scarf', stackable: true, note: '+50% Power per copy while you are airborne. Zero on the ground. v1.0.17 raised this from 33% to 50%; the dump has 0.50.' },
  { id: 'beefy-ring', name: 'Beefy Ring', emoji: '💍', kind: 'beefy', stackable: true, note: 'Power += Max HP × 0.002 × copies. Also +10 max HP per copy, which is not included until you type the resulting Max HP.' },
  { id: 'gamer-goggles', name: 'Gamer Goggles', emoji: '🥽', kind: 'goggles', stackable: true, note: 'Power bonus only under half HP: (0.5 − hp%) × 2 × copies. Zero at half HP or above. At 1 HP it approaches +100% per copy.' },
  { id: 'red-card', name: 'Red Credit Card', emoji: '💳', kind: 'redcard', stackable: true, note: '+2.5% Power per chest opened, per copy.' },
  { id: 'idle-juice', name: 'Idle Juice', emoji: '🧃', kind: 'idle', stackable: true, note: 'After 0.6s standing still, +4% Power per second. The rate does not grow with copies. Cap is +100% per copy. Moving resets it.' },
  { id: 'joes-dagger', name: "Joe's Dagger", emoji: '🗡️', kind: 'joe', stackable: true, note: 'Each execute adds +1% Power per copy. v1.0.12 caps that growth at +200% per copy per minute. Execute chance is 1%, with 0.3s between rolls.' },
  { id: 'eagle-claw', name: 'Eagle Claw', emoji: '🦅', kind: 'eagle', stackable: true, note: '+66% on the hit\'s additive component per copy, only while the enemy is airborne. Also an 8% per copy knockup proc, which is not damage.' },
  { id: 'tactical-glasses', name: 'Tactical Glasses', emoji: '🕶️', kind: 'glasses', stackable: true, note: '+20% on the hit\'s additive component per copy, only while the enemy is at 90% HP or higher.' },
  { id: 'brass-knuckles', name: 'Brass Knuckles', emoji: '🥊', kind: 'knuckles', stackable: true, note: 'Adds 0.25 per copy to the hit\'s base component while the enemy is in range (8 + 2 per copy). Counted as ×(1 + 0.25 × copies).' },
  { id: 'phantom-shroud', name: 'Phantom Shroud', emoji: '👻', kind: 'phantom', stackable: true, note: 'The hit after an evade is multiplied by 2.0 + 0.5 × (copies − 1). Phantom stacks, up to 4 per copy, separately add +50% Power and +25% attack speed each while the buff holds.' },
  { id: 'giant-fork', name: 'Giant Fork', emoji: '🍴', kind: 'fork', stackable: true, note: '+15% crit chance per copy. When a hit crits, a further 14% per copy of those crits are megacrits: ×4, plus ×0.15 per copy after the first.' },
  { id: 'speed-boi', name: 'Speed Boi', emoji: '👟', kind: 'speedboi', stackable: true, note: '×2 damage during the time slow. Copies do not raise the ×2. Duration is copies × 2s + 8s, clamped to 1–15s. Triggers under half HP, then a 10s cooldown.' },
  { id: 'bonker', name: 'Bonker', emoji: '🔨', kind: 'bonker', stackable: true, note: 'On hit: 2% + 1.5% per extra copy to deal an extra hit for ×20 + ×10 per extra copy. Nearby enemies take a separate 1× splash, which is not in this number.' },
];

export const ITEM_BY_ID = new Map(ITEMS.map(item => [item.id, item]));

export type SourceState = { on: boolean; stacks: number };

export type Build = {
  items: Record<string, SourceState>;
  /** Player HP percent, 0–100. Gamer Goggles reads this. */
  hpPercent: number;
  /** Max HP stat. Beefy Ring reads this. */
  maxHp: number;
  chests: number;
  /** Seconds spent standing still. Idle Juice reads this. */
  idleSeconds: number;
  /** Executes landed. Joe's Dagger reads this. Not copies. */
  joeExecutes: number;
  /** Phantom stacks currently up. Separate from how many shrouds you hold. */
  phantomStacks: number;
  airborne: boolean;
  enemyAirborne: boolean;
  enemyHighHp: boolean;
  inMelee: boolean;
  /** This hit is the attack after an evade. */
  evadeHit: boolean;
  timeSlow: boolean;
  critChance: number;
  critDamage: number;
  critOn: boolean;
  /**
   * When true, Giant Fork's +15% crit per copy is added on top of the slider.
   * The live game stat already includes the fork, so a live snapshot turns this off.
   */
  forkCritSeparate: boolean;
  attackSpeed: number;
  attackSpeedOn: boolean;
  includeAttackSpeed: boolean;
  targetElite: boolean;
  /** Bonus above ×1, so 15 means ×1.15. */
  eliteDamage: number;
  /** Live poison-damage stat, percent above ×1. Not part of a weapon hit. */
  poison: number;
  poisonOn: boolean;
};

export function defaultBuild(): Build {
  const items: Record<string, SourceState> = {};
  for (const it of ITEMS) items[it.id] = { on: false, stacks: 1 };
  return {
    items,
    hpPercent: 100,
    maxHp: 0,
    chests: 0,
    idleSeconds: 0,
    joeExecutes: 0,
    phantomStacks: 0,
    airborne: false,
    enemyAirborne: false,
    enemyHighHp: false,
    inMelee: false,
    evadeHit: false,
    timeSlow: false,
    critChance: 0,
    critDamage: 2,
    critOn: false,
    forkCritSeparate: true,
    attackSpeed: 0,
    attackSpeedOn: false,
    includeAttackSpeed: true,
    targetElite: false,
    eliteDamage: 0,
    poison: 0,
    poisonOn: false,
  };
}

export function stacksOf(build: Build, id: string): number {
  const st = build.items[id];
  if (!st?.on) return 0;
  return Math.max(1, st.stacks);
}

// DamageUtility.GetCritDamageMultiplier, verified in IDA:
//   0 crits → ×1
//   1 crit  → ×2
//   n ≥ 2   → (n × 0.5)² + (n + 1)
// Displayed crit damage defaults to ×2 (raw 1). Other displayed values scale
// the crit portion in proportion. A non-crit stays ×1.

function critLevelMultiplier(level: number, displayedCrit: number): number {
  if (level <= 0) return 1;
  const verified = level === 1 ? 2 : (level * 0.5) ** 2 + (level + 1);
  return verified * (Math.max(0, displayedCrit) / 2);
}

export function critFactor(chancePct: number, dmgMult: number): number {
  const c = Math.max(0, chancePct) / 100;
  const whole = Math.floor(c);
  const frac = c - whole;
  const low = critLevelMultiplier(whole, dmgMult);
  const high = critLevelMultiplier(whole + 1, dmgMult);
  return (1 - frac) * low + frac * high;
}

/** Chance the hit is a crit at all (one or more crit levels). */
export function critProcChance(chancePct: number): number {
  const c = Math.max(0, chancePct) / 100;
  if (c >= 1) return 1;
  return c;
}

export type Leaf = {
  id: string;
  label: string;
  emoji: string;
  bracket: StageId;
  detail: string;
  factor: number;
  ln: number;
  percent: number;
  marginal: number;
};

export type BracketRollup = {
  id: StageId;
  factor: number;
  active: boolean;
  members: number;
};

export type Analysis = {
  leaves: Leaf[];
  brackets: BracketRollup[];
  total: number;
  totalLn: number;
  perHit: number;
  mode: 'dps' | 'perhit';
  /** Full crit chance used, including Giant Fork when it is added separately. */
  critChance: number;
};

type Part = { id: string; label: string; emoji: string; detail: string; amount: number };

function itemOn(build: Build, id: string): boolean {
  return stacksOf(build, id) > 0;
}

export function analyze(build: Build): Analysis {
  const power: Part[] = [];
  const hitAdd: Part[] = [];
  const hitBase: Part[] = [];

  const push = (bucket: Part[], part: Part) => {
    if (part.amount > 0) bucket.push(part);
  };

  const beer = stacksOf(build, 'beer');
  push(power, { id: 'beer', label: 'Beer', emoji: '🍺', detail: `+20% Power × ${beer} copies.`, amount: beer * 0.2 });

  const gym = stacksOf(build, 'gym-sauce');
  push(power, { id: 'gym-sauce', label: 'Gym Sauce', emoji: '🧴', detail: `+10% Power × ${gym} copies. Adds with Beer.`, amount: gym * 0.1 });

  const scarf = stacksOf(build, 'scarf');
  if (scarf > 0 && build.airborne) {
    push(power, { id: 'scarf', label: 'Scarf', emoji: '🧣', detail: `+50% Power × ${scarf} copies, because you are airborne.`, amount: scarf * 0.5 });
  }

  const beefy = stacksOf(build, 'beefy-ring');
  if (beefy > 0 && build.maxHp > 0) {
    const amount = build.maxHp * 0.002 * beefy;
    push(power, {
      id: 'beefy-ring', label: 'Beefy Ring', emoji: '💍',
      detail: `${build.maxHp} max HP × 0.002 × ${beefy} copies = +${(amount * 100).toFixed(1)}% Power.`,
      amount,
    });
  }

  const goggles = stacksOf(build, 'gamer-goggles');
  const hp = Math.max(0, build.hpPercent) / 100;
  if (goggles > 0 && hp < 0.5) {
    const amount = (0.5 - hp) * 2 * goggles;
    push(power, {
      id: 'gamer-goggles', label: 'Gamer Goggles', emoji: '🥽',
      detail: `HP is ${build.hpPercent}%. (0.5 − hp) × 2 × ${goggles} copies = +${(amount * 100).toFixed(1)}% Power.`,
      amount,
    });
  }

  const card = stacksOf(build, 'red-card');
  if (card > 0 && build.chests > 0) {
    const amount = 0.025 * card * build.chests;
    push(power, {
      id: 'red-card', label: 'Red Credit Card', emoji: '💳',
      detail: `${build.chests} chests × 2.5% × ${card} copies = +${(amount * 100).toFixed(1)}% Power.`,
      amount,
    });
  }

  const idle = stacksOf(build, 'idle-juice');
  if (idle > 0) {
    const active = Math.max(0, build.idleSeconds - 0.6);
    const amount = Math.min(idle * 1, active * 0.04);
    push(power, {
      id: 'idle-juice', label: 'Idle Juice', emoji: '🧃',
      detail: `${build.idleSeconds.toFixed(1)}s still. After 0.6s, +4%/s, cap +${idle * 100}%. Now +${(amount * 100).toFixed(1)}% Power.`,
      amount,
    });
  }

  const joe = stacksOf(build, 'joes-dagger');
  if (joe > 0 && build.joeExecutes > 0) {
    const amount = build.joeExecutes * 0.01 * joe;
    push(power, {
      id: 'joes-dagger', label: "Joe's Dagger", emoji: '🗡️',
      detail: `${build.joeExecutes} executes × 1% × ${joe} copies = +${(amount * 100).toFixed(1)}% Power. Growth is capped at +200% per copy per minute.`,
      amount,
    });
  }

  const phantomCopies = stacksOf(build, 'phantom-shroud');
  const phantomStacks = phantomCopies > 0 ? Math.max(0, Math.min(build.phantomStacks, phantomCopies * 4)) : 0;
  if (phantomStacks > 0) {
    push(power, {
      id: 'phantom-stacks', label: 'Phantom stacks', emoji: '👻',
      detail: `${phantomStacks} phantom stacks × +50% Power. Cap is ${phantomCopies * 4}.`,
      amount: phantomStacks * 0.5,
    });
  }

  const eagle = stacksOf(build, 'eagle-claw');
  if (eagle > 0 && build.enemyAirborne) {
    push(hitAdd, {
      id: 'eagle-claw', label: 'Eagle Claw', emoji: '🦅',
      detail: `Enemy is airborne. +66% × ${eagle} copies on the hit's additive component.`,
      amount: eagle * 0.66,
    });
  }

  const glasses = stacksOf(build, 'tactical-glasses');
  if (glasses > 0 && build.enemyHighHp) {
    push(hitAdd, {
      id: 'tactical-glasses', label: 'Tactical Glasses', emoji: '🕶️',
      detail: `Enemy is at 90% HP or higher. +20% × ${glasses} copies on the hit's additive component.`,
      amount: glasses * 0.2,
    });
  }

  const knuckles = stacksOf(build, 'brass-knuckles');
  if (knuckles > 0 && build.inMelee) {
    push(hitBase, {
      id: 'brass-knuckles', label: 'Brass Knuckles', emoji: '🥊',
      detail: `Enemy is in melee range. +0.25 × ${knuckles} copies on the hit's base component.`,
      amount: knuckles * 0.25,
    });
  }

  const leaves: Leaf[] = [];
  const brackets: BracketRollup[] = [];
  let totalLn = 0;
  let atkLn = 0;

  const addPool = (id: StageId, parts: Part[]) => {
    if (parts.length === 0) return;
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    const factor = 1 + sum;
    const lnF = Math.log(factor);
    totalLn += lnF;
    brackets.push({ id, factor, active: true, members: parts.length });
    for (const p of parts) {
      const share = sum > 0 ? p.amount / sum : 0;
      leaves.push({
        id: p.id, label: p.label, emoji: p.emoji, bracket: id, detail: p.detail,
        factor: 1 + p.amount, ln: lnF * share, percent: 0,
        marginal: (p.amount / factor) * 100,
      });
    }
  };

  addPool('power', power);
  addPool('hitAdd', hitAdd);
  addPool('hitBase', hitBase);

  const addFactor = (
    id: StageId, factor: number, label: string, emoji: string, detail: string, leafId: string = id, isAttackSpeed = false,
  ) => {
    if (factor <= 1) return;
    const lnF = Math.log(factor);
    totalLn += lnF;
    if (isAttackSpeed) atkLn = lnF;
    brackets.push({ id, factor, active: true, members: 1 });
    leaves.push({
      id: leafId, label, emoji, bracket: id, detail,
      factor, ln: lnF, percent: 0, marginal: ((factor - 1) / factor) * 100,
    });
  };

  if (phantomCopies > 0 && build.evadeHit) {
    const mult = 2 + (phantomCopies - 1) * 0.5;
    addFactor('hitMult', mult, 'Phantom Shroud', '👻',
      `This is the hit after an evade. ×${mult.toFixed(2)} = 2 + 0.5 × (${phantomCopies} − 1).`,
      'phantom-shroud');
  }

  const fork = stacksOf(build, 'giant-fork');
  let critChance = build.critOn ? Math.max(0, build.critChance) : 0;
  if (fork > 0 && build.forkCritSeparate) critChance += fork * 15;
  if (critChance > 0) {
    const cf = critFactor(critChance, build.critDamage);
    const forkNote = fork > 0 && build.forkCritSeparate ? ` Includes +${fork * 15}% from Giant Fork.` : '';
    addFactor('crit', cf, 'Crit', '🎯',
      `${critChance}% crit chance · ×${build.critDamage} crit damage → ×${cf.toFixed(2)} expected. At ×2 crit damage, 100% is ×2, 200% is ×4, 300% is ×6.25.${forkNote}`);
  }

  if (fork > 0) {
    const pMega = Math.min(1, fork * 0.14);
    const megaMult = fork <= 1 ? 4 : 4 + (fork - 1) * 0.15;
    const pCrit = critProcChance(critChance);
    const expected = 1 + pCrit * pMega * (megaMult - 1);
    addFactor('hitMult', expected, 'Megacrit', '🍴',
      `${fork} copies: ${(pMega * 100).toFixed(0)}% of crits deal ×${megaMult.toFixed(2)}. With a ${(pCrit * 100).toFixed(0)}% chance to crit at all, that is ×${expected.toFixed(2)} expected on every hit.`,
      'giant-fork');
  }

  if (itemOn(build, 'speed-boi') && build.timeSlow) {
    const copies = stacksOf(build, 'speed-boi');
    const duration = Math.min(15, Math.max(1, copies * 2 + 8));
    addFactor('speedboi', 2, 'Speed Boi', '👟',
      `Time slow is active, so this hit is ×2. ${copies} copies last ${duration}s. The ×2 does not grow with copies.`);
  }

  const bonker = stacksOf(build, 'bonker');
  if (bonker > 0) {
    const chance = 0.02 + (bonker - 1) * 0.015;
    const mult = 20 + (bonker - 1) * 10;
    const expected = 1 + chance * mult;
    addFactor('bonker', expected, 'Bonker', '🔨',
      `${(chance * 100).toFixed(1)}% chance of an extra ×${mult} hit on the enemy you struck → ×${expected.toFixed(2)} expected. Splash on other enemies is a separate 1× hit and is not included.`,
      'bonker');
  }

  if (build.targetElite && build.eliteDamage > 0) {
    addFactor('elite', 1 + build.eliteDamage / 100, 'Elite damage', '💥',
      `+${build.eliteDamage}% elite damage on this elite. Not applied to other enemies.`);
  }

  let atkBonus = build.attackSpeedOn ? Math.max(0, build.attackSpeed) : 0;
  atkBonus += phantomStacks * 25;
  if (build.includeAttackSpeed && atkBonus > 0) {
    const parts: string[] = [];
    if (build.attackSpeedOn && build.attackSpeed > 0) parts.push(`+${build.attackSpeed}% from the attack speed stat`);
    if (phantomStacks > 0) parts.push(`+${phantomStacks * 25}% from ${phantomStacks} phantom stacks`);
    addFactor('attackspeed', 1 + atkBonus / 100, 'Attack speed', '⚡',
      `${parts.join(', ')}. DPS only, not one hit.`, 'attackspeed', true);
  }

  const total = Math.exp(totalLn);
  const perHit = Math.exp(totalLn - atkLn);
  for (const lf of leaves) lf.percent = totalLn > 0 ? (lf.ln / totalLn) * 100 : 0;
  leaves.sort((a, b) => b.percent - a.percent);

  return {
    leaves, brackets, total, totalLn, perHit,
    mode: build.includeAttackSpeed ? 'dps' : 'perhit',
    critChance,
  };
}

export function fmtMult(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x >= 1000) return `${Math.round(x).toLocaleString()}×`;
  if (x >= 100) return `${x.toFixed(0)}×`;
  if (x >= 10) return `${x.toFixed(1)}×`;
  return `${x.toFixed(2)}×`;
}
