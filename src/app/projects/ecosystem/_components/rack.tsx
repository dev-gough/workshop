'use client';

// The rack: every rule the world runs on, as a dial you can turn.
//
// Most changes land on the running simulation immediately. The handful that
// seed the world rather than govern it — the RNG seed, world size, founder
// stock, starting counts — are marked with ↺ and take effect on restock.

import { useCallback } from 'react';
import {
  RESTOCK_KEYS,
  TRAITS,
  TRAIT_LABEL,
  TRAIT_LIMITS,
  TRAIT_STEP,
  TRAIT_UNIT,
  type EcoParams,
  type Species,
  type TraitKey,
} from '../_lib/engine';
import { Dial, Drawer, RangeDial, Switch } from './dials';

interface Props {
  params: EcoParams;
  onChange: (next: EcoParams) => void;
}

const TRAIT_HINT: Record<TraitKey, string> = {
  speed: 'World units travelled per tick. The most expensive trait to carry — metabolism raises it to a power.',
  vision: 'Radius an agent senses within. Grazers spot hunters and plants; hunters spot grazers.',
  size: 'Body radius. Decides the reach of a meal and, for grazers, how big a prize they make.',
  threshold: 'Energy at which an agent breeds. Low thresholds breed fast and cheap; high ones bank energy first.',
};

/** Traits are labelled in their species' colour so the two blocks never blur together. */
const SPECIES_META: Record<Species, { title: string; note: string; color: string }> = {
  prey: { title: 'Grazers', note: 'eat plants, flee hunters', color: 'var(--eco-prey)' },
  pred: { title: 'Hunters', note: 'eat grazers', color: 'var(--eco-pred)' },
};

export default function Rack({ params, onChange }: Props) {
  const patch = useCallback(
    (mutate: (draft: EcoParams) => void) => {
      const next = structuredClone(params);
      mutate(next);
      onChange(next);
    },
    [params, onChange],
  );

  const staged = (key: string) => RESTOCK_KEYS.has(key);
  const m = params.metabolism;

  const speciesDrawer = (species: Species) => {
    const sp = params[species];
    const meta = SPECIES_META[species];
    const isPred = species === 'pred';
    return (
      <Drawer key={species} title={meta.title} note={meta.note}>
        <p className="pb-1 pt-0.5 text-[9px] leading-relaxed text-muted-foreground">
          Founder stock is the genome the first generation is drawn around. Everything after
          generation one is the world&apos;s doing, not yours.
        </p>
        {TRAITS.map(k => (
          <Dial
            key={k}
            label={`Founder ${TRAIT_LABEL[k].toLowerCase()}`}
            hint={TRAIT_HINT[k]}
            value={sp.founder[k]}
            onChange={v => patch(d => { d[species].founder[k] = v; })}
            min={TRAIT_LIMITS[k][0]}
            max={TRAIT_LIMITS[k][1]}
            step={TRAIT_STEP[k]}
            unit={TRAIT_UNIT[k]}
            digits={k === 'speed' ? 2 : k === 'size' ? 1 : 0}
            staged={staged(`${species}.founder.${k}`)}
            accent={meta.color}
          />
        ))}
        <Dial
          label="Founder spread"
          hint="How widely founders scatter around that genome, as a fraction of each trait's legal range. Zero makes a clonal founding population."
          value={sp.spread}
          onChange={v => patch(d => { d[species].spread = v; })}
          min={0}
          max={0.5}
          step={0.01}
          digits={2}
          staged={staged(`${species}.spread`)}
        />
        <Dial
          label="Starting count"
          hint="How many of this species the world is stocked with."
          value={sp.initial}
          onChange={v => patch(d => { d[species].initial = v; })}
          min={0}
          max={species === 'prey' ? 400 : 150}
          step={1}
          staged={staged(`${species}.initial`)}
        />
        <Dial
          label="Starting energy"
          hint="Energy each founder begins with. Buys the first generation time to find a meal."
          value={sp.startEnergy}
          onChange={v => patch(d => { d[species].startEnergy = v; })}
          min={10}
          max={250}
          step={5}
          unit="e"
          staged={staged(`${species}.startEnergy`)}
        />
        {isPred && (
          <>
            <Dial
              label="Energy per kill"
              hint="Base energy a hunter gains from a catch, before the size bonus."
              value={sp.mealEnergy}
              onChange={v => patch(d => { d.pred.mealEnergy = v; })}
              min={0}
              max={150}
              step={5}
              unit="e"
            />
            <Dial
              label="Size bonus"
              hint="Extra energy per unit of the grazer's body size. Raise it and hunters start selecting for large prey — which selects grazers smaller."
              value={sp.sizeBonus}
              onChange={v => patch(d => { d.pred.sizeBonus = v; })}
              min={0}
              max={12}
              step={0.5}
              digits={1}
              unit="e/u"
            />
          </>
        )}
        <Dial
          label="Turn rate"
          hint="Radians an agent can turn per tick while steering. Low agility makes vision less useful than it looks."
          value={sp.turnRate}
          onChange={v => patch(d => { d[species].turnRate = v; })}
          min={0.02}
          max={0.8}
          step={0.01}
          digits={2}
          unit="rad/t"
        />
        <Dial
          label="Wander"
          hint="Random heading jitter per tick when nothing is in sight. High wander searches broadly; low wander commits to a direction."
          value={sp.wander}
          onChange={v => patch(d => { d[species].wander = v; })}
          min={0}
          max={1.5}
          step={0.05}
          digits={2}
        />
        <Dial
          label="Reach"
          hint={isPred ? 'Added to both bodies when testing a catch. A hunter with reach need not touch its prey.' : 'Added to body size when testing whether a plant is in reach.'}
          value={sp.reach}
          onChange={v => patch(d => { d[species].reach = v; })}
          min={0}
          max={20}
          step={0.5}
          digits={1}
          unit="u"
        />
        <Dial
          label="Parent keeps"
          hint="Fraction of its energy a parent retains when it breeds. The rest is surrendered."
          value={sp.breedRetain}
          onChange={v => patch(d => { d[species].breedRetain = v; })}
          min={0.1}
          max={0.9}
          step={0.05}
          digits={2}
        />
        <Dial
          label="Child receives"
          hint="Fraction of the surrendered energy that reaches the offspring. The remainder is the cost of breeding — set it to 1 and reproduction becomes free."
          value={sp.childShare}
          onChange={v => patch(d => { d[species].childShare = v; })}
          min={0.1}
          max={1}
          step={0.05}
          digits={2}
        />
        <Dial
          label="Lifespan"
          hint="Ticks before death by old age. Zero disables ageing, so the only way out is starvation or a hunter."
          value={sp.maxAge}
          onChange={v => patch(d => { d[species].maxAge = v; })}
          min={0}
          max={4000}
          step={50}
          unit="t"
        />
        <Dial
          label="Carrying capacity"
          hint="Population ceiling. Overshoot it and the lowest-energy members are culled — itself a form of selection."
          value={sp.cap}
          onChange={v => patch(d => { d[species].cap = v; })}
          min={20}
          max={800}
          step={10}
        />
      </Drawer>
    );
  };

  return (
    <div className="px-3 pb-8">
      <Drawer title="Plants" note="what grazers live on" defaultOpen>
        <Dial
          label="Growth rate"
          hint="New plants seeded per tick, up to the capacity below. The energy entering the world."
          value={params.plants.spawnRate}
          onChange={v => patch(d => { d.plants.spawnRate = v; })}
          min={0}
          max={25}
          step={0.25}
          digits={2}
          unit="/t"
        />
        <Dial
          label="Standing crop"
          hint="Most plants the world will hold at once."
          value={params.plants.capacity}
          onChange={v => patch(d => { d.plants.capacity = v; })}
          min={20}
          max={2000}
          step={20}
        />
        <Dial
          label="Energy per plant"
          hint="What a grazer gains from a meal. Together with growth rate this sets the whole world's energy budget."
          value={params.plants.energy}
          onChange={v => patch(d => { d.plants.energy = v; })}
          min={2}
          max={100}
          step={1}
          unit="e"
        />
        <Dial
          label="Patchiness"
          hint="How far plants clump into patches rather than scattering evenly. Patchy food rewards vision; even food rewards speed."
          value={params.plants.patchiness}
          onChange={v => patch(d => { d.plants.patchiness = v; })}
          min={0}
          max={1}
          step={0.05}
          digits={2}
        />
        <Dial
          label="Patch count"
          hint="How many clumps the patchy fraction is spread across."
          value={params.plants.patches}
          onChange={v => patch(d => { d.plants.patches = v; })}
          min={1}
          max={40}
          step={1}
        />
        <Dial
          label="Starting crop"
          hint="Plants already on the ground at restock."
          value={params.plants.initial}
          onChange={v => patch(d => { d.plants.initial = v; })}
          min={0}
          max={1500}
          step={20}
          staged={staged('plants.initial')}
        />
      </Drawer>

      <Drawer title="Metabolism" note="what every trait costs" defaultOpen>
        <p className="pb-1.5 pt-0.5 text-[9px] leading-relaxed text-muted-foreground">
          The whole model in one line. Nothing is free: every tick an agent pays for the body it
          carries, and it must out-earn that bill to breed.
        </p>
        <div className="eco-readout mb-2 rounded-sm border border-border/70 bg-muted/50 px-2 py-1.5 text-[9px] leading-relaxed text-foreground">
          cost = <span className="text-primary">{m.base.toFixed(3)}</span> ×{' '}
          speed<sup className="text-primary">{m.speedExp.toFixed(2)}</sup> × (1 +{' '}
          <span className="text-primary">{m.visionCost.toFixed(4)}</span>·vision) × (1 +{' '}
          <span className="text-primary">{m.sizeCost.toFixed(3)}</span>·size)
        </div>
        <Dial
          label="Base cost"
          hint="Flat multiplier on the whole bill. Raise it and only the most efficient bodies clear their upkeep."
          value={m.base}
          onChange={v => patch(d => { d.metabolism.base = v; })}
          min={0}
          max={0.4}
          step={0.005}
          digits={3}
          unit="e/t"
        />
        <Dial
          label="Speed exponent"
          hint="How sharply speed is punished. Above 1 fast bodies pay superlinearly, which is what stops speed running away."
          value={m.speedExp}
          onChange={v => patch(d => { d.metabolism.speedExp = v; })}
          min={0.5}
          max={3}
          step={0.05}
          digits={2}
        />
        <Dial
          label="Vision cost"
          hint="Price per unit of sensing radius. Set it to zero and vision becomes free, so it grows without limit."
          value={m.visionCost}
          onChange={v => patch(d => { d.metabolism.visionCost = v; })}
          min={0}
          max={0.02}
          step={0.0005}
          digits={4}
        />
        <Dial
          label="Size cost"
          hint="Price per unit of body size. Balanced against the hunters' size bonus, this is what sets grazer body size."
          value={m.sizeCost}
          onChange={v => patch(d => { d.metabolism.sizeCost = v; })}
          min={0}
          max={0.4}
          step={0.005}
          digits={3}
        />
      </Drawer>

      <Drawer title="Heredity" note="how offspring differ" defaultOpen>
        <Dial
          label="Mutation rate"
          hint="Chance each trait is altered at birth. At zero, offspring are exact copies and the population can only be sorted, never improved."
          value={params.heredity.rate}
          onChange={v => patch(d => { d.heredity.rate = v; })}
          min={0}
          max={1}
          step={0.01}
          digits={2}
        />
        <Dial
          label="Mutation size"
          hint="Multiplier on every mutation step. Small steps climb carefully; large ones jump, and mostly land worse."
          value={params.heredity.scale}
          onChange={v => patch(d => { d.heredity.scale = v; })}
          min={0}
          max={4}
          step={0.05}
          digits={2}
          unit="×"
        />
        <p className="pb-0.5 pt-2 text-[9px] leading-relaxed text-muted-foreground">
          Trait bounds — the walls evolution has to work between. Narrow one and you can watch the
          population pile up against it.
        </p>
        {TRAITS.map(k => (
          <RangeDial
            key={k}
            label={TRAIT_LABEL[k]}
            hint={TRAIT_HINT[k]}
            value={params.heredity.bounds[k]}
            onChange={v => patch(d => { d.heredity.bounds[k] = v; })}
            min={TRAIT_LIMITS[k][0]}
            max={TRAIT_LIMITS[k][1]}
            step={TRAIT_STEP[k]}
            digits={k === 'speed' ? 1 : 0}
            locked={params.heredity.locked[k]}
            onToggleLock={() => patch(d => { d.heredity.locked[k] = !d.heredity.locked[k]; })}
          />
        ))}
      </Drawer>

      {speciesDrawer('prey')}
      {speciesDrawer('pred')}

      <Drawer title="The world" note="ground and glass">
        <Dial
          label="Width"
          hint="World width in units. A bigger world dilutes encounters without changing any agent's abilities."
          value={params.world.w}
          onChange={v => patch(d => { d.world.w = v; })}
          min={300}
          max={2000}
          step={50}
          unit="u"
          staged={staged('world.w')}
        />
        <Dial
          label="Height"
          hint="World height in units."
          value={params.world.h}
          onChange={v => patch(d => { d.world.h = v; })}
          min={300}
          max={2000}
          step={50}
          unit="u"
          staged={staged('world.h')}
        />
        <Switch
          label="Edges"
          hint="A wrapped world has no edge — leave one side and you arrive at the other. Walled worlds trap agents in corners, which hunters learn to exploit."
          on={params.world.wrap}
          onChange={v => patch(d => { d.world.wrap = v; })}
          onText="wrapped"
          offText="walled"
        />
      </Drawer>

      <Drawer title="The run" note="seed and rescue">
        <Dial
          label="Seed"
          hint="Seeds every random draw in the run. Same seed and same parameters give the same world, every time — change one dial, keep the seed, and the difference you see is that dial's doing."
          value={params.seed}
          onChange={v => patch(d => { d.seed = v; })}
          min={1}
          max={9999}
          step={1}
          staged={staged('seed')}
        />
        <Switch
          label="Rescue extinctions"
          hint="Restock a species that dies out with fresh founders. Turn it off to let a run genuinely end — collapse is a result too."
          on={params.rules.rescue}
          onChange={v => patch(d => { d.rules.rescue = v; })}
        />
        {params.rules.rescue && (
          <>
            <Dial
              label="Grazer rescue"
              hint="Founders introduced when grazers die out."
              value={params.rules.rescuePrey}
              onChange={v => patch(d => { d.rules.rescuePrey = v; })}
              min={1}
              max={100}
              step={1}
            />
            <Dial
              label="Hunter rescue"
              hint="Founders introduced when hunters die out."
              value={params.rules.rescuePred}
              onChange={v => patch(d => { d.rules.rescuePred = v; })}
              min={1}
              max={50}
              step={1}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
