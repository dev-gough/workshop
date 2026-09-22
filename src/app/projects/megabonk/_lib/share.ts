import { CHARACTER_BY_ID, defaultBuild, ITEMS, type Build } from './model';

type SharedBuild = Omit<Build, 'items'> & {
  items: Record<string, { on: boolean; value: number; stacks: number }>;
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
        value: finite(candidate.value, items[definition.id].value),
        stacks: Math.max(1, Math.min(definition.maxStacks ?? 1, Math.round(finite(candidate.stacks, 1)))),
      };
    }

    return {
      ...base,
      items,
      characterId: typeof parsed.characterId === 'string' && CHARACTER_BY_ID.has(parsed.characterId)
        ? parsed.characterId
        : base.characterId,
      critChance: finite(parsed.critChance, base.critChance),
      critDamage: finite(parsed.critDamage, base.critDamage),
      critOn: bool(parsed.critOn, base.critOn),
      attackSpeed: finite(parsed.attackSpeed, base.attackSpeed),
      attackSpeedOn: bool(parsed.attackSpeedOn, base.attackSpeedOn),
      tomeDamage: finite(parsed.tomeDamage, base.tomeDamage),
      tomeOn: bool(parsed.tomeOn, base.tomeOn),
      megacrit: finite(parsed.megacrit, base.megacrit),
      megacritOn: bool(parsed.megacritOn, base.megacritOn),
      corrupted: finite(parsed.corrupted, base.corrupted),
      corruptedOn: bool(parsed.corruptedOn, base.corruptedOn),
      poison: finite(parsed.poison, base.poison),
      poisonOn: bool(parsed.poisonOn, base.poisonOn),
      bigBonkChance: finite(parsed.bigBonkChance, base.bigBonkChance),
      bigBonkMult: finite(parsed.bigBonkMult, base.bigBonkMult),
      bigBonkOn: bool(parsed.bigBonkOn, base.bigBonkOn),
      includeAttackSpeed: bool(parsed.includeAttackSpeed, base.includeAttackSpeed),
      targetElite: bool(parsed.targetElite, base.targetElite),
    };
  } catch {
    return null;
  }
}
