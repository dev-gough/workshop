'use client';

// The set-up sheet: every rule the session runs on, as a dial you can turn.
//
// Most changes land on the running cars immediately. The handful that seed
// the session — the circuit's shape, the sensor count, the brain's size, the
// RNG seed — are marked with ↺ and take effect on regrid.

import { useCallback } from 'react';
import { brainShape, type DriveParams } from '../_lib/engine';
import { Dial, Drawer, Switch } from './dials';

interface Props {
  params: DriveParams;
  onChange: (next: DriveParams) => void;
}

export default function Rack({ params, onChange }: Props) {
  const patch = useCallback(
    (mutate: (draft: DriveParams) => void) => {
      const next = structuredClone(params);
      mutate(next);
      onChange(next);
    },
    [params, onChange],
  );

  const shape = brainShape(params);

  return (
    <div className="px-3">
      <Drawer title="The circuit" note="all land on regrid" defaultOpen>
        <p className="pb-1 pt-0.5 text-[9px] leading-relaxed text-muted-foreground">
          The track is drawn from a seed, so a circuit you liked can be dialled
          straight back in.
        </p>
        <Dial
          label="Circuit seed"
          hint="Which circuit gets drawn. Same seed, same corners — every time."
          value={params.circuit.seed}
          onChange={v => patch(d => { d.circuit.seed = v; })}
          min={1} max={200} step={1} staged
        />
        <Dial
          label="Corners"
          hint="Control points on the loop. More corners, more decisions per lap."
          value={params.circuit.corners}
          onChange={v => patch(d => { d.circuit.corners = v; })}
          min={5} max={14} step={1} staged
        />
        <Dial
          label="Size"
          hint="Mean radius of the loop, in track units."
          value={params.circuit.radius}
          onChange={v => patch(d => { d.circuit.radius = v; })}
          min={110} max={260} step={5} unit="u" staged
        />
        <Dial
          label="Wobble"
          hint="How far corners stray from a clean oval. High wobble makes hairpins — and occasionally a monster."
          value={params.circuit.wobble}
          onChange={v => patch(d => { d.circuit.wobble = v; })}
          min={0} max={0.8} step={0.05} digits={2} staged
        />
        <Dial
          label="Track width"
          hint="Half-width of the ribbon. Narrow tracks punish sloppy lines."
          value={params.circuit.width}
          onChange={v => patch(d => { d.circuit.width = v; })}
          min={18} max={55} step={1} unit="u" staged
        />
      </Drawer>

      <Drawer title="The car" note="live physics">
        <Dial
          label="Top speed"
          hint="Hard ceiling on speed, units per tick. The brain still has to decide whether to use it."
          value={params.car.topSpeed}
          onChange={v => patch(d => { d.car.topSpeed = v; })}
          min={1} max={8} step={0.25} digits={2} unit="u/t"
        />
        <Dial
          label="Acceleration"
          hint="Throttle authority: how much speed one tick at full throttle adds."
          value={params.car.accel}
          onChange={v => patch(d => { d.car.accel = v; })}
          min={0.02} max={0.5} step={0.01} digits={2}
        />
        <Dial
          label="Steering lock"
          hint="Radians per tick at full steering deflection. This is grip — drop it and the car understeers into every barrier."
          value={params.car.grip}
          onChange={v => patch(d => { d.car.grip = v; })}
          min={0.02} max={0.2} step={0.005} digits={3} unit="r/t"
        />
        <Dial
          label="Drag"
          hint="Fraction of speed shed each tick. Low drag means the car coasts — lifting off stops nothing."
          value={params.car.drag}
          onChange={v => patch(d => { d.car.drag = v; })}
          min={0} max={0.1} step={0.005} digits={3}
        />
      </Drawer>

      <Drawer title="The senses" note="what a car can know">
        <p className="pb-1 pt-0.5 text-[9px] leading-relaxed text-muted-foreground">
          Rangefinders are the car&apos;s entire world — no map, no memory, no
          coordinates. Everything it does is a function of these readings.
        </p>
        <Dial
          label="Rangefinders"
          hint="Rays across the fan. Each one is an input neuron, so this resizes the genome."
          value={params.sensors.count}
          onChange={v => patch(d => { d.sensors.count = v; })}
          min={1} max={13} step={1} staged
        />
        <Dial
          label="Fan spread"
          hint="Angle the fan covers. Narrow fans see far ahead and nothing beside; wide fans trade focus for peripheral vision."
          value={params.sensors.spread}
          onChange={v => patch(d => { d.sensors.spread = v; })}
          min={30} max={300} step={5} unit="°"
        />
        <Dial
          label="Reach"
          hint="How far a rangefinder can see, in track units. Short reach means corners arrive as surprises."
          value={params.sensors.range}
          onChange={v => patch(d => { d.sensors.range = v; })}
          min={60} max={320} step={10} unit="u"
        />
        <Dial
          label="Noise"
          hint="Gaussian error added to every reading. Real sensors lie a little — brains that survive it are more robust."
          value={params.sensors.noise}
          onChange={v => patch(d => { d.sensors.noise = v; })}
          min={0} max={0.3} step={0.01} digits={2} unit="σ"
        />
      </Drawer>

      <Drawer title="The brain" note={`${shape.size} weights`}>
        <p className="pb-1 pt-0.5 text-[9px] leading-relaxed text-muted-foreground">
          rays + speed → {shape.hidden} hidden → steer + throttle. The genome is
          nothing but these {shape.size} numbers.
        </p>
        <Dial
          label="Hidden neurons"
          hint="Width of the middle layer. Bigger brains can represent more — and take longer to evolve."
          value={params.brain.hidden}
          onChange={v => patch(d => { d.brain.hidden = v; })}
          min={2} max={24} step={1} staged
        />
        <Dial
          label="Founding spread"
          hint="Stddev of the founding weights. Wild founders explore more and crash more."
          value={params.brain.initSpread}
          onChange={v => patch(d => { d.brain.initSpread = v; })}
          min={0.2} max={3} step={0.1} digits={1} staged
        />
      </Drawer>

      <Drawer title="Selection" note="how heats breed">
        <Dial
          label="Grid size"
          hint="Cars per heat. Applies when the next heat forms. Bigger grids explore more per generation."
          value={params.evolution.popSize}
          onChange={v => patch(d => { d.evolution.popSize = v; })}
          min={10} max={200} step={5}
        />
        <Dial
          label="Elite share"
          hint="Top fraction copied into the next heat untouched. Insurance against forgetting — and a brake on exploration."
          value={params.evolution.eliteFrac}
          onChange={v => patch(d => { d.evolution.eliteFrac = v; })}
          min={0} max={0.4} step={0.01} digits={2}
        />
        <Dial
          label="Tournament size"
          hint="Each parent is the best of K random cars. K=1 picks parents at random — selection switched off. This dial IS the selection pressure."
          value={params.evolution.tourneyK}
          onChange={v => patch(d => { d.evolution.tourneyK = v; })}
          min={1} max={8} step={1}
        />
        <Switch
          label="Crossover"
          hint="On: each child mixes two parents' weights uniformly. Off: children are mutated clones of one parent."
          on={params.evolution.crossover}
          onChange={v => patch(d => { d.evolution.crossover = v; })}
          onText="mix" offText="clone"
        />
        <Dial
          label="Mutation rate"
          hint="Chance each weight in a child gets perturbed. The exploration dial."
          value={params.evolution.mutRate}
          onChange={v => patch(d => { d.evolution.mutRate = v; })}
          min={0} max={0.6} step={0.01} digits={2}
        />
        <Dial
          label="Mutation size"
          hint="Stddev of each perturbation. Small steps refine a line; big steps invent new ones."
          value={params.evolution.mutStrength}
          onChange={v => patch(d => { d.evolution.mutStrength = v; })}
          min={0} max={1.5} step={0.05} digits={2}
        />
        <Dial
          label="Immigrants"
          hint="Fraction of each heat drawn completely fresh. New blood keeps a converged grid from going stale."
          value={params.evolution.immigrants}
          onChange={v => patch(d => { d.evolution.immigrants = v; })}
          min={0} max={0.3} step={0.01} digits={2}
        />
        <Dial
          label="New circuit every"
          hint="Swap in a fresh circuit every N heats, carrying the grid across. Zero = never. Punishes memorising, rewards driving."
          value={params.evolution.rotateEvery}
          onChange={v => patch(d => { d.evolution.rotateEvery = v; })}
          min={0} max={50} step={1} unit="heats"
        />
      </Drawer>

      <Drawer title="The session" note="clocks and seeds">
        <Dial
          label="Heat length"
          hint="Ticks before the chequered flag ends a heat regardless of who's still running."
          value={params.session.tickBudget}
          onChange={v => patch(d => { d.session.tickBudget = v; })}
          min={200} max={6000} step={100} unit="t"
        />
        <Dial
          label="Patience"
          hint="Ticks a car may go without gaining ground before it's flagged off as stalled."
          value={params.session.patience}
          onChange={v => patch(d => { d.session.patience = v; })}
          min={30} max={400} step={10} unit="t"
        />
        <Dial
          label="Session seed"
          hint="Seeds the founding genomes and every random draw after them. Same seed, same dials, same season."
          value={params.seed}
          onChange={v => patch(d => { d.seed = v; })}
          min={1} max={99} step={1} staged
        />
      </Drawer>
    </div>
  );
}
