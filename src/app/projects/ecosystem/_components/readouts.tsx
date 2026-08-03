'use client';

// The two text instruments: the census board, and the specimen slide.
//
// These refresh a few times a second rather than every frame — numbers that
// change 60 times a second can't be read, and the tank is already showing the
// motion.

import { X } from 'lucide-react';
import {
  TRAITS,
  TRAIT_LABEL,
  TRAIT_UNIT,
  type Agent,
  type EcoParams,
  type Stats,
} from '../_lib/engine';

const STATE_LABEL: Record<Agent['state'], string> = {
  flee: 'fleeing',
  hunt: 'hunting',
  graze: 'grazing',
  wander: 'searching',
};

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="truncate text-[10px] text-muted-foreground">{label}</span>
      <span className="eco-readout ml-auto shrink-0 text-[11px]" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function Census({ stats }: { stats: Stats }) {
  const total = stats.deaths.starved + stats.deaths.eaten + stats.deaths.aged + stats.deaths.culled;
  const share = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '—');
  return (
    <div className="eco-case px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="eco-etch">Census</span>
        <span className="eco-readout text-[10px] text-muted-foreground">tick {stats.tick.toLocaleString()}</span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {([
          ['Grazers', stats.prey, 'var(--eco-prey)'],
          ['Hunters', stats.pred, 'var(--eco-pred)'],
          ['Plants', stats.plants, 'var(--eco-plant)'],
        ] as const).map(([label, value, color]) => (
          <div key={label}>
            <div className="eco-readout text-lg leading-none" style={{ color }}>
              {value}
            </div>
            <div className="eco-etch mt-1 text-[8px]">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 space-y-1 border-t border-border/70 pt-2">
        <Row label="Generations deep" value={stats.maxGen.toLocaleString()} />
        <Row
          label="Mean generation"
          value={`${stats.meanGen.prey.toFixed(1)} · ${stats.meanGen.pred.toFixed(1)}`}
        />
        <Row label="Born, all time" value={stats.births.toLocaleString()} />
      </div>

      <div className="mt-2 space-y-1 border-t border-border/70 pt-2">
        <div className="eco-etch mb-1 text-[8px]">Cause of death</div>
        <Row label="Eaten" value={`${stats.deaths.eaten.toLocaleString()}  ${share(stats.deaths.eaten)}`} color="var(--eco-pred)" />
        <Row label="Starved" value={`${stats.deaths.starved.toLocaleString()}  ${share(stats.deaths.starved)}`} color="var(--eco-lamp)" />
        {stats.deaths.aged > 0 && (
          <Row label="Old age" value={`${stats.deaths.aged.toLocaleString()}  ${share(stats.deaths.aged)}`} />
        )}
        {stats.deaths.culled > 0 && (
          <Row label="Over capacity" value={`${stats.deaths.culled.toLocaleString()}  ${share(stats.deaths.culled)}`} />
        )}
      </div>

      {(stats.extinct.prey || stats.extinct.pred) && (
        <p className="mt-2 border-t border-border/70 pt-2 text-[10px] leading-relaxed text-destructive">
          {stats.extinct.prey && stats.extinct.pred
            ? 'Both species are gone.'
            : stats.extinct.prey
              ? 'The grazers are gone. Hunters have nothing left to eat.'
              : 'The hunters are gone. Nothing is checking the grazers.'}
        </p>
      )}
    </div>
  );
}

interface InspectorProps {
  agent: Agent | null;
  stats: Stats;
  params: EcoParams;
  cost: number;
  onClear: () => void;
}

export function Inspector({ agent, stats, params, cost, onClear }: InspectorProps) {
  if (!agent) {
    return (
      <div className="eco-case px-3 py-2.5">
        <span className="eco-etch">Specimen</span>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Click anything in the tank to put it on the slide — its genome, its lineage, and the bill
          its body runs up every tick.
        </p>
      </div>
    );
  }

  const color = agent.species === 'prey' ? 'var(--eco-prey)' : 'var(--eco-pred)';
  const popMean = stats.traits[agent.species === 'prey' ? 'prey' : 'pred'];
  const m = params.metabolism;
  const g = agent.genome;

  // The bill, split into the three things a body pays for. Shares are of the
  // multiplicative excess over a hypothetical costless body.
  const speedPart = Math.pow(g.speed, m.speedExp);
  const visionPart = 1 + g.vision * m.visionCost;
  const sizePart = 1 + g.size * m.sizeCost;
  const parts: [string, number, string][] = [
    ['speed', Math.log(Math.max(speedPart, 1e-6)), 'var(--eco-lamp)'],
    ['vision', Math.log(visionPart), 'var(--eco-plant)'],
    ['size', Math.log(sizePart), 'var(--eco-dim)'],
  ];
  const partSum = parts.reduce((a, p) => a + Math.max(0, p[1]), 0) || 1;

  // How much food it has to find to stay solvent.
  const income = agent.species === 'prey'
    ? params.plants.energy
    : params.pred.mealEnergy + popMean.size * params.pred.sizeBonus;
  const ticksPerMeal = income / (cost || 1e-6);

  return (
    <div className="eco-case px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="eco-etch" style={{ color }}>
          {agent.species === 'prey' ? 'Grazer' : 'Hunter'} #{agent.id}
        </span>
        <span className="eco-readout ml-auto text-[10px] text-muted-foreground">
          {STATE_LABEL[agent.state]}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the slide"
          className="eco-chip flex h-[18px] w-[18px] items-center justify-center"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <Row label="Energy" value={`${agent.energy.toFixed(0)} / ${g.threshold.toFixed(0)}`} />
        <Row label="Age" value={`${agent.age.toLocaleString()} t`} />
        <Row label="Generation" value={agent.gen.toLocaleString()} />
        <Row label="Offspring" value={agent.kids.toLocaleString()} />
        <Row label="Meals" value={agent.meals.toLocaleString()} />
        <Row label="Parent" value={agent.parent === 0 ? 'founder' : `#${agent.parent}`} />
      </div>

      {/* Genome against the species mean — the only comparison that says whether
          this individual is ahead of its population or behind it. */}
      <div className="mt-2.5 space-y-1.5 border-t border-border/70 pt-2">
        <div className="eco-etch text-[8px]">Genome vs species mean</div>
        {TRAITS.map(k => {
          const [lo, hi] = params.heredity.bounds[k];
          const span = hi - lo || 1;
          const pct = ((g[k] - lo) / span) * 100;
          const meanPct = ((popMean[k] - lo) / span) * 100;
          return (
            <div key={k}>
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] text-muted-foreground">{TRAIT_LABEL[k]}</span>
                <span className="eco-readout ml-auto text-[10px]">
                  {g[k].toFixed(k === 'speed' ? 2 : 1)}
                  <span className="ml-0.5 text-muted-foreground">{TRAIT_UNIT[k]}</span>
                </span>
              </div>
              <div className="relative mt-0.5 h-[5px] rounded-sm bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{ width: `${Math.max(1, Math.min(100, pct))}%`, background: color }}
                />
                <div
                  className="absolute inset-y-[-2px] w-px bg-foreground/70"
                  style={{ left: `${Math.max(0, Math.min(100, meanPct))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2.5 border-t border-border/70 pt-2">
        <div className="flex items-baseline gap-2">
          <span className="eco-etch text-[8px]">Metabolic bill</span>
          <span className="eco-readout ml-auto text-[10px] text-primary">{cost.toFixed(3)} e/t</span>
        </div>
        <div className="mt-1.5 flex h-[6px] overflow-hidden rounded-sm bg-muted">
          {parts.map(([label, value, c]) => (
            <div
              key={label}
              title={label}
              style={{ width: `${(Math.max(0, value) / partSum) * 100}%`, background: c }}
            />
          ))}
        </div>
        <div className="mt-1 flex gap-2.5">
          {parts.map(([label, value, c]) => (
            <span key={label} className="flex items-center gap-1 text-[9px] text-muted-foreground">
              <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: c }} />
              {label} {Math.round((Math.max(0, value) / partSum) * 100)}%
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          One meal buys it{' '}
          <span className="eco-readout text-foreground">{ticksPerMeal.toFixed(0)}</span> ticks. It
          needs{' '}
          <span className="eco-readout text-foreground">
            {(g.threshold / Math.max(income, 1e-6)).toFixed(1)}
          </span>{' '}
          to breed from empty.
        </p>
      </div>
    </div>
  );
}
