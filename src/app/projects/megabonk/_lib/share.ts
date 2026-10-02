import { defaultBuild, ITEMS, STACK_UI_MAX, type Build } from './model';

type SharedBuild = Omit<Build, 'items'> & {
  items: Record<string, { on: boolean; stacks: number }>;
};

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

/**
 * URL-safe base64 keeps a build self-contained: shared links need no account,
 * database row, or server cleanup. The payload is version-tolerant because
 * decoding overlays known fields on today's defaults.
 */
export function encodeBuild(build: Build): string {
  const bytes = new TextEncoder().encode(JSON.stringify(build));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeBuild(encoded: string): Build | null {
  try {
    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharedBuild>;
    if (!parsed || typeof parsed !== 'object') return null;

    const base = defaultBuild();
    const items = { ...base.items };
    for (const definition of ITEMS) {
      const candidate = parsed.items?.[definition.id];
      if (!candidate || typeof candidate !== 'object') continue;
      items[definition.id] = {
        on: typeof candidate.on === 'boolean' ? candidate.on : items[definition.id].on,
        stacks: Math.max(1, Math.min(definition.stackable ? STACK_UI_MAX : 1, Math.round(finite(candidate.stacks, 1)))),
      };
    }

    return {
      ...base,
      items,
      hpPercent: finite(parsed.hpPercent, base.hpPercent),
      maxHp: finite(parsed.maxHp, base.maxHp),
      chests: finite(parsed.chests, base.chests),
      idleSeconds: finite(parsed.idleSeconds, base.idleSeconds),
      joeExecutes: finite(parsed.joeExecutes, base.joeExecutes),
      phantomStacks: finite(parsed.phantomStacks, base.phantomStacks),
      airborne: bool(parsed.airborne, base.airborne),
      enemyAirborne: bool(parsed.enemyAirborne, base.enemyAirborne),
      enemyHighHp: bool(parsed.enemyHighHp, base.enemyHighHp),
      inMelee: bool(parsed.inMelee, base.inMelee),
      evadeHit: bool(parsed.evadeHit, base.evadeHit),
      timeSlow: bool(parsed.timeSlow, base.timeSlow),
      critChance: finite(parsed.critChance, base.critChance),
      critDamage: finite(parsed.critDamage, base.critDamage),
      critOn: bool(parsed.critOn, base.critOn),
      forkCritSeparate: bool(parsed.forkCritSeparate, base.forkCritSeparate),
      attackSpeed: finite(parsed.attackSpeed, base.attackSpeed),
      attackSpeedOn: bool(parsed.attackSpeedOn, base.attackSpeedOn),
      includeAttackSpeed: bool(parsed.includeAttackSpeed, base.includeAttackSpeed),
      targetElite: bool(parsed.targetElite, base.targetElite),
      eliteDamage: finite(parsed.eliteDamage, base.eliteDamage),
      poison: finite(parsed.poison, base.poison),
      poisonOn: bool(parsed.poisonOn, base.poisonOn),
    };
  } catch {
    return null;
  }
}
