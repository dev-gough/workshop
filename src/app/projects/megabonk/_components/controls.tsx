'use client';

import {
  type Build, BRACKETS, ITEMS, STACK_UI_MAX, stacksOf,
} from '../_lib/model';

type Setter = (patch: Partial<Build>) => void;

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

const GROUPS: { title: string; color: string; kinds: string[] }[] = [
  { title: 'Power — these add', color: BRACKETS.power.color, kinds: ['power', 'scarf', 'beefy', 'goggles', 'redcard', 'idle', 'joe'] },
  { title: 'On the hit', color: BRACKETS.hitAdd.color, kinds: ['eagle', 'glasses', 'knuckles', 'phantom', 'fork', 'speedboi', 'bonker'] },
];

export function ItemRoster({ build, set }: { build: Build; set: Setter }) {
  const patchItem = (id: string, patch: Partial<Build['items'][string]>) =>
    set({ items: { ...build.items, [id]: { ...build.items[id], ...patch } } });

  return (
    <div className="mb-plate px-4 py-3.5">
      <SectionLabel color="var(--color-primary)">Items</SectionLabel>
      <div className="space-y-3.5">
        {GROUPS.map(g => (
          <div key={g.title}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: g.color }} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {g.title}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
              {ITEMS.filter(def => g.kinds.includes(def.kind)).map(def => {
                const st = build.items[def.id];
                return (
                  <div
                    key={def.id}
                    className={`mb-chip rounded-lg border ${
                      st.on ? 'bg-muted/50' : 'border-border bg-muted/25 hover:border-primary/40'
                    }`}
                    style={st.on ? { borderColor: g.color } : undefined}
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
                          max={STACK_UI_MAX}
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
      <Conditions build={build} set={set} />
    </div>
  );
}

function Conditions({ build, set }: { build: Build; set: Setter }) {
  const rows: { key: string; label: string; control: React.ReactNode }[] = [];
  if (stacksOf(build, 'scarf') > 0) {
    rows.push({ key: 'air', label: 'You are airborne', control: <Switch on={build.airborne} onChange={v => set({ airborne: v })} label="You are airborne" /> });
  }
  if (stacksOf(build, 'beefy-ring') > 0) {
    rows.push({ key: 'hp', label: 'Max HP', control: <NumberField value={build.maxHp} min={0} max={99999} onChange={v => set({ maxHp: v })} /> });
  }
  if (stacksOf(build, 'gamer-goggles') > 0) {
    rows.push({ key: 'hpp', label: 'Your HP %', control: <Slider value={build.hpPercent} min={1} max={100} unit="%" onChange={v => set({ hpPercent: v })} /> });
  }
  if (stacksOf(build, 'red-card') > 0) {
    rows.push({ key: 'chests', label: 'Chests opened', control: <NumberField value={build.chests} min={0} max={9999} onChange={v => set({ chests: v })} /> });
  }
  if (stacksOf(build, 'idle-juice') > 0) {
    rows.push({ key: 'idle', label: 'Seconds still', control: <NumberField value={build.idleSeconds} min={0} max={999} step={0.1} onChange={v => set({ idleSeconds: v })} /> });
  }
  if (stacksOf(build, 'joes-dagger') > 0) {
    rows.push({ key: 'joe', label: 'Executes', control: <NumberField value={build.joeExecutes} min={0} max={999999} onChange={v => set({ joeExecutes: v })} /> });
  }
  if (stacksOf(build, 'eagle-claw') > 0) {
    rows.push({ key: 'eair', label: 'Enemy is airborne', control: <Switch on={build.enemyAirborne} onChange={v => set({ enemyAirborne: v })} label="Enemy is airborne" /> });
  }
  if (stacksOf(build, 'tactical-glasses') > 0) {
    rows.push({ key: 'ehigh', label: 'Enemy at 90% HP or more', control: <Switch on={build.enemyHighHp} onChange={v => set({ enemyHighHp: v })} label="Enemy at 90% HP or more" /> });
  }
  if (stacksOf(build, 'brass-knuckles') > 0) {
    rows.push({ key: 'melee', label: 'Enemy is in melee range', control: <Switch on={build.inMelee} onChange={v => set({ inMelee: v })} label="Enemy is in melee range" /> });
  }
  if (stacksOf(build, 'phantom-shroud') > 0) {
    const cap = stacksOf(build, 'phantom-shroud') * 4;
    rows.push({ key: 'evade', label: 'This hit is after an evade', control: <Switch on={build.evadeHit} onChange={v => set({ evadeHit: v })} label="This hit is after an evade" /> });
    rows.push({ key: 'pstacks', label: `Phantom stacks (max ${cap})`, control: <NumberField value={build.phantomStacks} min={0} max={cap} onChange={v => set({ phantomStacks: v })} /> });
  }
  if (stacksOf(build, 'speed-boi') > 0) {
    rows.push({ key: 'slow', label: 'Time slow is active', control: <Switch on={build.timeSlow} onChange={v => set({ timeSlow: v })} label="Time slow is active" /> });
  }
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">This hit</p>
      {rows.map(row => (
        <div key={row.key} className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">{row.label}</span>
          <div className="w-40 shrink-0">{row.control}</div>
        </div>
      ))}
    </div>
  );
}

function NumberField({ value, min, max, step = 1, onChange }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n)) return;
        onChange(Math.max(min, Math.min(max, n)));
      }}
      className="mb-readout w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-right text-sm font-semibold"
    />
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

export function StatControls({ build, set }: { build: Build; set: Setter }) {
  const fork = stacksOf(build, 'giant-fork');
  return (
    <div className="mb-plate px-4 py-3.5">
      <SectionLabel color="var(--color-primary)">Stats</SectionLabel>

      <div className="space-y-3">
        <StatRow
          on={build.critOn} onToggle={v => set({ critOn: v })}
          emoji="🎯" name="Crit" color={BRACKETS.crit.color}
        >
          <LabeledSlider label="Chance" value={build.critChance} min={0} max={400} unit="%"
            accent={BRACKETS.crit.color} onChange={v => set({ critChance: v })} />
          <LabeledSlider label="Crit dmg" value={build.critDamage} min={0} max={8} step={0.1} unit="×"
            accent={BRACKETS.crit.color} onChange={v => set({ critDamage: v })} />
        </StatRow>
        {fork > 0 && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            {build.forkCritSeparate
              ? `Giant Fork adds +${fork * 15}% crit chance on top of the crit slider, even if that slider is off.`
              : 'The live crit stat already includes Giant Fork, so its +15% per copy is not added again.'}
          </p>
        )}

        <StatRow
          on={build.attackSpeedOn} onToggle={v => set({ attackSpeedOn: v })}
          emoji="⚡" name="Attack speed" color={BRACKETS.attackspeed.color}
        >
          <LabeledSlider label="Bonus" value={build.attackSpeed} min={0} max={800} step={5} unit="%"
            accent={BRACKETS.attackspeed.color} onChange={v => set({ attackSpeed: v })} />
        </StatRow>

        <div className="rounded-lg border border-border bg-muted/20 p-2.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-base leading-none">💥</span>
            <span className="flex-1 text-xs font-semibold text-foreground">Elite damage</span>
            <span className="text-[10px] text-muted-foreground">elites only</span>
          </div>
          <LabeledSlider label="Bonus" value={build.eliteDamage} min={0} max={300} step={1} unit="%"
            accent={BRACKETS.elite.color} onChange={v => set({ eliteDamage: v })} />
        </div>

        {build.poisonOn && build.poison > 0 && (
          <p className="text-[10px] leading-snug text-muted-foreground">
            The game reports a poison damage stat of ×{(1 + build.poison / 100).toFixed(2)}. That multiplies poison, not this weapon hit, so it is left out of the total.
          </p>
        )}
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
