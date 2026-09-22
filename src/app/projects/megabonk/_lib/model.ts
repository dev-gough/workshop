// ─────────────────────────────────────────────────────────────────────────
// Megabonk damage model.
//
// Megabonk stacks damage in independent "brackets": bonuses INSIDE a bracket
// add together, and then the brackets MULTIPLY with each other. That is why a
// spread of modest +20% items can outrun one giant number — each bracket is a
// fresh multiplier. This file encodes that model and a fair way to attribute a
// share of the final multiplier back to each contributing thing.
//
// Item constants and the crit curve come from lukeod/megabonk_research
// (IL2CPP constructors + IDA, validated 2026-01-28). A few character passives
// and the per-kill Demonic Soul coefficient were not in that dump — those
// stay editable and are marked unverified. Conditional items (airborne,
// evade, time-slow) are modeled as if the condition is currently true.
// ─────────────────────────────────────────────────────────────────────────

export type BracketId =
  | 'flat'
  | 'main'
  | 'speedboi'
  | 'elite'
  | 'corrupted'
  | 'megacrit'
  | 'poison'
  | 'crit'
  | 'tome'
  | 'attackspeed'
  | 'bigbonk';

export type Bracket = {
  id: BracketId;
  name: string;
  blurb: string;
  color: string; // categorical hue, tuned to read on both light & dark stone
  /** additive brackets sum their members then form (1 + sum). others are single multipliers. */
  additive: boolean;
  /** applies only under a scenario the player must be in (vs elite, airborne, poison…) */
  conditional?: boolean;
};

export const BRACKETS: Record<BracketId, Bracket> = {
  main: {
    id: 'main',
    name: 'Damage %',
    blurb: 'The big pool. Most +Damage% items, tome damage and shrines add here.',
    color: '#f2a71c',
    additive: true,
  },
  flat: {
    id: 'flat',
    name: 'Base Damage %',
    blurb: 'Flat base-damage upgrades and several character passives.',
    color: '#e8743b',
    additive: true,
  },
  crit: {
    id: 'crit',
    name: 'Crit',
    blurb: 'Expected multiplier from crit chance × crit damage, including overcrit past 100%.',
    color: '#e8433f',
    additive: false,
  },
  tome: {
    id: 'tome',
    name: 'Damage Tome',
    blurb: 'Tome damage multiplies the whole character-damage term on its own.',
    color: '#37b24d',
    additive: false,
  },
  attackspeed: {
    id: 'attackspeed',
    name: 'Attack Speed',
    blurb: 'More hits per second. Multiplies sustained DPS, not per-hit damage.',
    color: '#3b82f6',
    additive: false,
  },
  speedboi: {
    id: 'speedboi',
    name: 'Speed Boi',
    blurb: 'Sits alone in its own bracket, so it always multiplies clean.',
    color: '#22b8cf',
    additive: true,
  },
  elite: {
    id: 'elite',
    name: 'Elite Damage',
    blurb: 'A separate bracket that only applies to Elites and Bosses.',
    color: '#a855f7',
    additive: true,
    conditional: true,
  },
  megacrit: {
    id: 'megacrit',
    name: 'Giant Fork Megacrit',
    blurb: 'Megacrits get their own bracket — they multiply on top of everything.',
    color: '#ec4899',
    additive: false,
    conditional: true,
  },
  corrupted: {
    id: 'corrupted',
    name: 'Corrupted Sword',
    blurb: 'Its own bracket, and only the sword hit benefits.',
    color: '#7c6cf0',
    additive: false,
    conditional: true,
  },
  bigbonk: {
    id: 'bigbonk',
    name: 'Big Bonk',
    blurb: 'A rare huge proc; shown as its average multiplier over many hits.',
    color: '#f76707',
    additive: false,
    conditional: true,
  },
  poison: {
    id: 'poison',
    name: 'Amog Poison',
    blurb: 'Its own bracket, applying only to poison damage.',
    color: '#82c91e',
    additive: false,
    conditional: true,
  },
};

// ── Characters — a passive that lands in one bracket ──────────────────────

export type Character = {
  id: string;
  name: string;
  emoji: string;
  passive: string;
  bracket?: BracketId;
  value?: number; // percent
};

export const CHARACTERS: Character[] = [
  { id: 'vanilla', name: 'Vanilla', emoji: '🙂', passive: 'No damage passive — a clean baseline.' },
  { id: 'megachad', name: 'Megachad', emoji: '💪', passive: '+25% base damage.', bracket: 'flat', value: 25 },
  { id: 'monke', name: 'Monke', emoji: '🐒', passive: '+15% base damage.', bracket: 'flat', value: 15 },
  { id: 'ogre', name: 'Ogre', emoji: '👹', passive: '+10% Damage %, scaling with level.', bracket: 'main', value: 10 },
  { id: 'robinette', name: 'Robinette', emoji: '🏹', passive: '+30% Damage %.', bracket: 'main', value: 30 },
  { id: 'athena', name: 'Athena', emoji: '🦉', passive: '+25% Damage %.', bracket: 'main', value: 25 },
  { id: 'dicehead', name: 'Dicehead', emoji: '🎲', passive: '+20% Damage %, more vs elites.', bracket: 'main', value: 20 },
  { id: 'amog', name: 'Amog', emoji: '🛸', passive: '+50% Poison damage.', bracket: 'poison', value: 50 },
];

/** Stable lookup used on every slider update; avoids rescanning the roster. */
export const CHARACTER_BY_ID = new Map(CHARACTERS.map(character => [character.id, character]));

// ── Items — the icons the player toggles on ───────────────────────────────

export type ItemDef = {
  id: string;
  name: string;
  emoji: string;
  bracket: BracketId;
  /** default percent contribution (for additive brackets) */
  value: number;
  stackable?: boolean;
  maxStacks?: number;
  note: string;
};

export const ITEMS: ItemDef[] = [
  // EStat 12 (DamageMultiplier), stored as a fraction. 0.2 = +20%.
  { id: 'beer', name: 'Beer', emoji: '🍺', bracket: 'main', value: 20, stackable: true, maxStacks: 5, note: '+20% damage per stack, −5% max HP per stack.' },
  { id: 'beefy-ring', name: 'Beefy Ring', emoji: '💍', bracket: 'main', value: 20, stackable: true, maxStacks: 5, note: '+0.2% damage per current HP per stack (+10 max HP). 20 assumes 100 HP.' },
  { id: 'gamer-goggles', name: 'Gamer Goggles', emoji: '🥽', bracket: 'main', value: 50, stackable: true, maxStacks: 5, note: 'Only under half HP, up to +100% per stack at 1 HP. 50 is the bonus at 25% HP.' },
  { id: 'red-card', name: 'Red Credit Card', emoji: '💳', bracket: 'main', value: 2.5, stackable: true, maxStacks: 40, note: '+2.5% per chest per copy. Count stacks as chests × copies (10 chests on 1 copy = ×10).' },
  { id: 'phantom-shroud', name: 'Phantom Shroud', emoji: '👻', bracket: 'main', value: 100, note: 'The hit after an evade deals ×2. Extra copies add ×0.5 each; this chip is the one-copy case.' },
  { id: 'demonic-soul', name: 'Demonic Soul', emoji: '😈', bracket: 'main', value: 100, note: 'Kills add damage. The per-kill coefficient was not in the constructor dump, so this chip is the +100% cap people report.' },
  { id: 'joes-dagger', name: "Joe's Dagger", emoji: '🗡️', bracket: 'main', value: 1, stackable: true, maxStacks: 40, note: '+1% per execution, per copy. Each stack is one proc. 1% execute chance, 0.3s between rolls.' },
  { id: 'scarf', name: 'Scarf', emoji: '🧣', bracket: 'main', value: 50, stackable: true, maxStacks: 5, note: '+50% damage per stack while you are airborne. Zero on the ground.' },
  { id: 'eagle-claw', name: 'Eagle Claw', emoji: '🦅', bracket: 'main', value: 66, stackable: true, maxStacks: 5, note: '+66% per stack vs airborne enemies, added on the hit itself.' },
  { id: 'tactical-glasses', name: 'Tactical Glasses', emoji: '🕶️', bracket: 'main', value: 20, stackable: true, maxStacks: 5, note: '+20% per stack vs enemies at 90% HP or higher, added on the hit.' },

  // Flat / base component of the attack modifier (EStatModifyType.Flat).
  { id: 'gym-sauce', name: 'Gym Sauce', emoji: '🧴', bracket: 'flat', value: 10, stackable: true, maxStacks: 5, note: '+10% damage per stack on the damage stat. No health penalty.' },
  { id: 'brass-knuckles', name: 'Brass Knuckles', emoji: '🥊', bracket: 'flat', value: 25, stackable: true, maxStacks: 5, note: '+0.25 on the attack\'s base component per stack, only while the enemy is in melee range.' },
  { id: 'idle-juice', name: 'Idle Juice', emoji: '🧃', bracket: 'flat', value: 100, stackable: true, maxStacks: 5, note: 'Standing still fills +4% damage per second, capped at +100% per stack.' },

  // Multiplies the hit directly (dc.damage *= 2) during its time-slow.
  { id: 'speed-boi', name: 'Speed Boi', emoji: '👟', bracket: 'speedboi', value: 100, note: '×2 damage during the time-slow. Triggers below 50% HP, then a 10s cooldown. The ×2 does not grow with stacks.' },
];

/** Pre-group once rather than allocating four filtered arrays per render. */
export const ITEMS_BY_BRACKET = new Map<BracketId, ItemDef[]>();
for (const item of ITEMS) {
  const group = ITEMS_BY_BRACKET.get(item.bracket);
  if (group) group.push(item);
  else ITEMS_BY_BRACKET.set(item.bracket, [item]);
}

// ── The build the player is assembling ────────────────────────────────────

export type SourceState = { on: boolean; value: number; stacks: number };

export type Build = {
  characterId: string;
  items: Record<string, SourceState>;
  critChance: number; // percent, can exceed 100 (overcrit)
  critDamage: number; // multiplier applied per crit level, e.g. 2 = ×2
  critOn: boolean;
  attackSpeed: number; // percent bonus, e.g. 80 = +80%
  attackSpeedOn: boolean;
  tomeDamage: number; // percent, e.g. 16 → ×1.16
  tomeOn: boolean;
  megacrit: number; // percent bonus on top when megacrit lands
  megacritOn: boolean;
  corrupted: number; // percent
  corruptedOn: boolean;
  poison: number; // percent
  poisonOn: boolean;
  bigBonkChance: number; // percent proc
  bigBonkMult: number; // e.g. 20 = ×20 on proc
  bigBonkOn: boolean;
  includeAttackSpeed: boolean; // DPS view vs per-hit view
  targetElite: boolean;
  /** Bonus above ×1 from EStat EliteDamageMultiplier, e.g. 15 = ×1.15. Applied only when targetElite. */
  eliteDamage: number;
};

export function defaultBuild(): Build {
  const items: Record<string, SourceState> = {};
  for (const it of ITEMS) items[it.id] = { on: false, value: it.value, stacks: 1 };
  // A friendly starting loadout so the page shows something alive.
  items['beer'] = { on: true, value: 20, stacks: 2 };
  items['gym-sauce'] = { on: true, value: 10, stacks: 1 };
  return {
    characterId: 'robinette',
    items,
    critChance: 40,
    critDamage: 2,
    critOn: true,
    attackSpeed: 60,
    attackSpeedOn: true,
    tomeDamage: 16,
    tomeOn: true,
    megacrit: 42,
    megacritOn: false,
    corrupted: 0,
    corruptedOn: false,
    poison: 0,
    poisonOn: false,
    bigBonkChance: 2,
    bigBonkMult: 20,
    bigBonkOn: false,
    includeAttackSpeed: true,
    targetElite: true,
    eliteDamage: 0,
  };
}

// ── Crit expected multiplier ──────────────────────────────────────────────
// DamageUtility.GetCritDamageMultiplier, verified in IDA:
//   0 crits → ×1 (not a crit)
//   1 crit  → ×2
//   n ≥ 2   → (n × 0.5)² + (n + 1)    so 2 → ×4, 3 → ×6.25, 4 → ×9
// The in-game crit-damage stat is displayed as raw × 2 (default raw 1 → ×2).
// The curve above is that default. Other displayed values scale the crit
// multiplier in proportion, and a non-crit stays ×1.

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

// ── The core: fold the build into brackets, then attribute a share ────────

export type Leaf = {
  id: string;
  label: string;
  emoji: string;
  bracket: BracketId;
  detail: string;
  /** this leaf's own multiplier contribution (e.g. 1.2 = it added +20% of final) */
  factor: number;
  /** natural-log weight — the fair split of the total multiplier */
  ln: number;
  /** share of the total damage multiplier, 0–100, sums to 100 across leaves */
  percent: number;
  /** DPS lost if this single thing were removed, 0–100 */
  marginal: number;
};

export type BracketRollup = {
  id: BracketId;
  factor: number; // combined multiplier of the whole bracket
  active: boolean;
  members: number;
};

export type Analysis = {
  leaves: Leaf[];
  brackets: BracketRollup[];
  total: number; // total damage multiplier over a naked baseline
  totalLn: number;
  perHit: number; // total without attack speed
  mode: 'dps' | 'perhit';
};

export function analyze(build: Build): Analysis {
  const char = CHARACTER_BY_ID.get(build.characterId);

  // Accumulate additive brackets as { sum, members:[{leaf-seed}] }.
  type Additive = { sum: number; parts: { id: string; label: string; emoji: string; detail: string; amount: number }[] };
  const additive: Partial<Record<BracketId, Additive>> = {};
  const pushAdd = (b: BracketId, part: { id: string; label: string; emoji: string; detail: string; amount: number }) => {
    if (part.amount <= 0) return;
    (additive[b] ??= { sum: 0, parts: [] }).sum += part.amount;
    additive[b]!.parts.push(part);
  };

  // Character passive.
  if (char?.bracket && char.value) {
    if (BRACKETS[char.bracket].additive) {
      pushAdd(char.bracket, {
        id: `char:${char.id}`, label: char.name, emoji: char.emoji,
        detail: char.passive, amount: char.value / 100,
      });
    }
  }

  // Items.
  for (const def of ITEMS) {
    const st = build.items[def.id];
    if (!st?.on) continue;
    if (def.bracket === 'elite' && !build.targetElite) continue;
    const stacks = def.stackable ? Math.max(1, st.stacks) : 1;
    const amount = (st.value / 100) * stacks;
    pushAdd(def.bracket, {
      id: def.id, label: def.name, emoji: def.emoji,
      detail: stacks > 1 ? `${def.note} ×${stacks}` : def.note,
      amount,
    });
  }

  const leaves: Leaf[] = [];
  const brackets: BracketRollup[] = [];
  let totalLn = 0;
  let atkLn = 0; // attack-speed ln, tracked so we can report per-hit vs dps

  // Fold additive brackets → one factor each, split among members.
  for (const bid of Object.keys(additive) as BracketId[]) {
    const acc = additive[bid]!;
    const factor = 1 + acc.sum;
    const lnF = Math.log(factor);
    totalLn += lnF;
    brackets.push({ id: bid, factor, active: true, members: acc.parts.length });
    for (const p of acc.parts) {
      const shareOfBracket = acc.sum > 0 ? p.amount / acc.sum : 0;
      const ln = lnF * shareOfBracket;
      leaves.push({
        id: p.id, label: p.label, emoji: p.emoji, bracket: bid, detail: p.detail,
        factor: 1 + p.amount, ln, percent: 0,
        // removing this member shrinks the bracket from (1+sum) to (1+sum−amount)
        marginal: acc.sum >= 0 ? (p.amount / factor) * 100 : 0,
      });
    }
  }

  // Single-multiplier axes.
  const addSingle = (
    on: boolean, bid: BracketId, factor: number,
    label: string, emoji: string, detail: string, isAttackSpeed = false,
  ) => {
    if (!on || factor <= 1) return;
    const lnF = Math.log(factor);
    totalLn += lnF;
    if (isAttackSpeed) atkLn = lnF;
    brackets.push({ id: bid, factor, active: true, members: 1 });
    leaves.push({
      id: bid, label, emoji, bracket: bid, detail,
      factor, ln: lnF, percent: 0, marginal: ((factor - 1) / factor) * 100,
    });
  };

  const cf = critFactor(build.critChance, build.critDamage);
  addSingle(build.critOn, 'crit', cf, 'Crit', '🎯',
    `${build.critChance}% chance · ×${build.critDamage} crit damage → ×${cf.toFixed(2)} average. 100% is ×2, 200% is ×4, 300% is ×6.25, at the default ×2.`);
  addSingle(build.tomeOn, 'tome', 1 + build.tomeDamage / 100, 'Damage Tome', '📕',
    `+${build.tomeDamage}% tome damage (own multiplier).`);
  addSingle(build.megacritOn, 'megacrit', 1 + build.megacrit / 100, 'Megacrit', '🍴',
    `Giant Fork: +15% crit chance per stack, and 14% of those crits deal ×4 (+0.15× per extra stack). +${build.megacrit}% is the average you are applying to every hit.`);
  addSingle(build.corruptedOn, 'corrupted', 1 + build.corrupted / 100, 'Corrupted Sword', '⚔️',
    `+${build.corrupted}% in the sword's own bracket.`);
  addSingle(build.poisonOn, 'poison', 1 + build.poison / 100, 'Poison damage', '☠️',
    `EStat PoisonDamageMultiplier. +${build.poison}% on poison damage only.`);
  if (build.bigBonkOn) {
    const avg = 1 + (build.bigBonkChance / 100) * build.bigBonkMult;
    addSingle(true, 'bigbonk', avg, 'Bonker', '🔨',
      `One stack is 2% for an extra ×20 hit. Each extra stack adds 1.5% chance and ×10. ${build.bigBonkChance}% × ${build.bigBonkMult} → ×${avg.toFixed(2)} average.`);
  }
  addSingle(build.targetElite, 'elite', 1 + build.eliteDamage / 100, 'Elite damage', '💥',
    `EStat EliteDamageMultiplier. +${build.eliteDamage}% above ×1, only while the target is an elite.`);
  addSingle(build.attackSpeedOn && build.includeAttackSpeed, 'attackspeed',
    1 + build.attackSpeed / 100, 'Attack Speed', '⚡',
    `+${build.attackSpeed}% attack speed (DPS only).`, true);

  const total = Math.exp(totalLn);
  const perHit = Math.exp(totalLn - atkLn);

  for (const lf of leaves) lf.percent = totalLn > 0 ? (lf.ln / totalLn) * 100 : 0;
  leaves.sort((a, b) => b.percent - a.percent);

  return {
    leaves, brackets, total, totalLn, perHit,
    mode: build.includeAttackSpeed ? 'dps' : 'perhit',
  };
}

// A compact number for the big impact readout: 3.2×, 14×, 1,240×.
export function fmtMult(x: number): string {
  if (x >= 1000) return `${Math.round(x).toLocaleString()}×`;
  if (x >= 100) return `${x.toFixed(0)}×`;
  if (x >= 10) return `${x.toFixed(1)}×`;
  return `${x.toFixed(2)}×`;
}
