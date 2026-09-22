'use client';

import {
  type Build, type BracketId, CHARACTERS, CHARACTER_BY_ID, BRACKETS, ITEMS_BY_BRACKET,
} from '../_lib/model';

type Setter = (patch: Partial<Build>) => void;

// ── Primitives ────────────────────────────────────────────────────────────

function SectionLabel({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
      style={{ color: color ?? 'var(--color-muted-foreground)' }}>
      {children}
    </p>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-border'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function Slider({ value, min, max, step = 1, onChange, unit = '', accent }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; accent?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="mb-slider h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border"
        style={{ accentColor: accent ?? 'var(--color-primary)' }}
      />
      <span className="mb-readout w-16 shrink-0 text-right text-sm font-semibold">
        {value}{unit}
      </span>
    </div>
  );
}

// ── Character picker ──────────────────────────────────────────────────────

export function CharacterPicker({ build, set }: { build: Build; set: Setter }) {
  return (
    <div className="mb-plate px-4 py-3.5">
      <SectionLabel color="var(--color-primary)">Character</SectionLabel>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:grid-cols-4 xl:grid-cols-8">
        {CHARACTERS.map(c => {
          const on = build.characterId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => set({ characterId: c.id })}
              title={`${c.name} — ${c.passive}`}
              className={`mb-chip flex flex-col items-center gap-1 rounded-lg border px-1 py-2 ${
                on ? 'border-primary bg-primary/10' : 'border-border bg-muted/40 hover:border-primary/50'
              }`}
            >
              <span className="text-xl leading-none">{c.emoji}</span>
              <span className={`truncate text-[9px] font-semibold ${on ? 'text-primary' : 'text-muted-foreground'}`}>
                {c.name}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {CHARACTER_BY_ID.get(build.characterId)?.passive}
      </p>
    </div>
  );
}

// ── Item chips, grouped by bracket ────────────────────────────────────────

const ITEM_GROUPS: { bracket: BracketId; title: string }[] = [
  { bracket: 'main', title: 'Damage % items' },
  { bracket: 'flat', title: 'Base damage items' },
  { bracket: 'speedboi', title: 'Speed Boi' },
];

export function ItemRoster({ build, set }: { build: Build; set: Setter }) {
  const patchItem = (id: string, patch: Partial<Build['items'][string]>) =>
    set({ items: { ...build.items, [id]: { ...build.items[id], ...patch } } });

  return (
    <div className="mb-plate px-4 py-3.5">
      <SectionLabel color="var(--color-primary)">Items</SectionLabel>
      <div className="space-y-3.5">
        {ITEM_GROUPS.map(g => (
          <div key={g.bracket}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: BRACKETS[g.bracket].color }} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {g.title}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
              {(ITEMS_BY_BRACKET.get(g.bracket) ?? []).map(def => {
                const st = build.items[def.id];
                const color = BRACKETS[def.bracket].color;
                return (
                  <div
                    key={def.id}
                    className={`mb-chip rounded-lg border ${
                      st.on ? 'bg-muted/50' : 'border-border bg-muted/25 hover:border-primary/40'
                    }`}
                    style={st.on ? { borderColor: color } : undefined}
                  >
                    <button
                      onClick={() => patchItem(def.id, { on: !st.on })}
                      title={def.note}
                      className="flex w-full flex-col items-center gap-0.5 px-1 pt-2"
                    >
                      <span className="text-xl leading-none">{def.emoji}</span>
                      <span className={`w-full truncate text-center text-[8.5px] font-semibold leading-tight ${
                        st.on ? 'text-foreground' : 'text-muted-foreground'
                      }`}>
                        {def.name}
                      </span>
                    </button>
                    {st.on && def.stackable ? (
                      <div className="flex items-center justify-center gap-1.5 pb-1.5 pt-0.5">
                        <Stepper
                          value={st.stacks}
                          min={1}
                          max={def.maxStacks ?? 5}
                          onChange={v => patchItem(def.id, { stacks: v })}
                        />
                      </div>
                    ) : (
                      <div className="h-1.5" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid h-4 w-4 place-items-center rounded bg-border text-xs leading-none text-foreground hover:bg-primary hover:text-primary-foreground"
      >−</button>
      <span className="mb-readout w-4 text-center text-[11px] font-bold">×{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-4 w-4 place-items-center rounded bg-border text-xs leading-none text-foreground hover:bg-primary hover:text-primary-foreground"
      >+</button>
    </div>
  );
}

// ── Stat sliders + situational multipliers ────────────────────────────────

export function StatControls({ build, set }: { build: Build; set: Setter }) {
  return (
    <div className="mb-plate px-4 py-3.5">
      <SectionLabel color="var(--color-primary)">Stats &amp; situational</SectionLabel>

      <div className="space-y-3">
        <StatRow
          on={build.critOn} onToggle={v => set({ critOn: v })}
          emoji="🎯" name="Crit" color={BRACKETS.crit.color}
        >
          <LabeledSlider label="Chance" value={build.critChance} min={0} max={300} unit="%"
            accent={BRACKETS.crit.color} onChange={v => set({ critChance: v })} />
          <LabeledSlider label="Crit dmg" value={build.critDamage} min={1.5} max={6} step={0.1} unit="×"
            accent={BRACKETS.crit.color} onChange={v => set({ critDamage: v })} />
        </StatRow>

        <StatRow
          on={build.attackSpeedOn} onToggle={v => set({ attackSpeedOn: v })}
          emoji="⚡" name="Attack Speed" color={BRACKETS.attackspeed.color}
        >
          <LabeledSlider label="Bonus" value={build.attackSpeed} min={0} max={800} step={5} unit="%"
            accent={BRACKETS.attackspeed.color} onChange={v => set({ attackSpeed: v })} />
        </StatRow>

        <StatRow
          on={build.tomeOn} onToggle={v => set({ tomeOn: v })}
          emoji="📕" name="Damage Tome" color={BRACKETS.tome.color}
        >
          <LabeledSlider label="Tome dmg" value={build.tomeDamage} min={0} max={200} step={2} unit="%"
            accent={BRACKETS.tome.color} onChange={v => set({ tomeDamage: v })} />
        </StatRow>

        <div className="my-1 border-t border-border/70" />

        <div className="rounded-lg border border-border bg-muted/20 p-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-base leading-none">💥</span>
            <span className="flex-1 text-xs font-semibold text-foreground">Elite damage</span>
            <span className="text-[10px] text-muted-foreground">when the target is an elite</span>
          </div>
          <LabeledSlider label="Bonus" value={build.eliteDamage} min={0} max={300} step={5} unit="%"
            accent={BRACKETS.elite.color} onChange={v => set({ eliteDamage: v })} />
        </div>

        <StatRow
          on={build.megacritOn} onToggle={v => set({ megacritOn: v })}
          emoji="🍴" name="Megacrit (Giant Fork)" color={BRACKETS.megacrit.color}
        >
          <LabeledSlider label="Bonus" value={build.megacrit} min={0} max={400} step={5} unit="%"
            accent={BRACKETS.megacrit.color} onChange={v => set({ megacrit: v })} />
        </StatRow>

        <StatRow
          on={build.corruptedOn} onToggle={v => set({ corruptedOn: v })}
          emoji="⚔️" name="Corrupted Sword" color={BRACKETS.corrupted.color}
        >
          <LabeledSlider label="Bonus" value={build.corrupted} min={0} max={300} step={5} unit="%"
            accent={BRACKETS.corrupted.color} onChange={v => set({ corrupted: v })} />
        </StatRow>

        <StatRow
          on={build.poisonOn} onToggle={v => set({ poisonOn: v })}
          emoji="☠️" name="Poison damage" color={BRACKETS.poison.color}
        >
          <LabeledSlider label="Bonus" value={build.poison} min={0} max={300} step={5} unit="%"
            accent={BRACKETS.poison.color} onChange={v => set({ poison: v })} />
        </StatRow>

        <StatRow
          on={build.bigBonkOn} onToggle={v => set({ bigBonkOn: v })}
          emoji="🔨" name="Bonker" color={BRACKETS.bigbonk.color}
        >
          <LabeledSlider label="Proc %" value={build.bigBonkChance} min={0} max={20} step={0.5} unit="%"
            accent={BRACKETS.bigbonk.color} onChange={v => set({ bigBonkChance: v })} />
          <LabeledSlider label="On proc" value={build.bigBonkMult} min={5} max={80} step={5} unit="×"
            accent={BRACKETS.bigbonk.color} onChange={v => set({ bigBonkMult: v })} />
        </StatRow>
      </div>
    </div>
  );
}

function StatRow({ on, onToggle, emoji, name, color, children }: {
  on: boolean; onToggle: (v: boolean) => void; emoji: string; name: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-2.5 transition-colors ${on ? 'bg-muted/40' : 'border-border bg-muted/20'}`}
      style={on ? { borderColor: color } : undefined}>
      <div className="flex items-center gap-2">
        <span className="text-base leading-none">{emoji}</span>
        <span className={`flex-1 text-xs font-semibold ${on ? 'text-foreground' : 'text-muted-foreground'}`}>{name}</span>
        <Switch on={on} onChange={onToggle} label={name} />
      </div>
      {on && <div className="mt-2 space-y-1.5">{children}</div>}
    </div>
  );
}

function LabeledSlider({ label, value, min, max, step, unit, accent, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; accent: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-medium text-muted-foreground">{label}</span>
      <Slider value={value} min={min} max={max} step={step} unit={unit} accent={accent} onChange={onChange} />
    </div>
  );
}
