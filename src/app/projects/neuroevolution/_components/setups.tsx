'use client';

// Set-ups: one-press experiment cards. Each is a full parameter sheet that
// regrids the session so the dials tell the truth about what's running.

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { defaultParams, type DriveParams } from '../_lib/engine';

export interface Setup {
  id: string;
  name: string;
  blurb: string;
  build: () => DriveParams;
}

export const SETUPS: Setup[] = [
  {
    id: 'baseline',
    name: 'Baseline',
    blurb: 'The stock session: seven rangefinders, a modest brain, steady selection pressure.',
    build: defaultParams,
  },
  {
    id: 'ice',
    name: 'Ice week',
    blurb: 'Barely any steering authority and a car that coasts. Watch evolution learn to brake early instead of turning late.',
    build: () => {
      const p = defaultParams();
      p.car.grip = 0.035;
      p.car.drag = 0.006;
      p.car.topSpeed = 5;
      return p;
    },
  },
  {
    id: 'karting',
    name: 'Karting',
    blurb: 'A tight, narrow kart track and a slow, twitchy car. Corners come fast — reflexes beat top speed.',
    build: () => {
      const p = defaultParams();
      p.circuit = { seed: 11, corners: 12, radius: 140, wobble: 0.55, width: 24 };
      p.car.topSpeed = 3;
      p.car.grip = 0.12;
      return p;
    },
  },
  {
    id: 'blindfold',
    name: 'Blindfold',
    blurb: 'Three short, noisy rangefinders. The information bottleneck is the whole problem — brains must drive on almost nothing.',
    build: () => {
      const p = defaultParams();
      p.sensors = { count: 3, spread: 100, range: 90, noise: 0.08 };
      return p;
    },
  },
  {
    id: 'anarchy',
    name: 'No selection',
    blurb: 'Tournament of one, zero elites, heavy mutation: the control experiment. Fitness can only drift — see what its absence looks like.',
    build: () => {
      const p = defaultParams();
      p.evolution.tourneyK = 1;
      p.evolution.eliteFrac = 0;
      p.evolution.mutRate = 0.35;
      p.evolution.immigrants = 0.1;
      return p;
    },
  },
  {
    id: 'touring',
    name: 'Touring season',
    blurb: 'A fresh circuit every five heats. Memorising one track stops working — only general cornering survives.',
    build: () => {
      const p = defaultParams();
      p.evolution.rotateEvery = 5;
      p.session.tickBudget = 1400;
      return p;
    },
  },
  {
    id: 'endurance',
    name: 'Endurance',
    blurb: 'A long, sweeping circuit and heats six times the length. Patience for the slow burn — full laps or nothing.',
    build: () => {
      const p = defaultParams();
      p.circuit = { seed: 23, corners: 11, radius: 240, wobble: 0.35, width: 38 };
      p.session = { tickBudget: 5000, patience: 300 };
      return p;
    },
  },
];

interface Props {
  active: string | null;
  onRun: (s: Setup) => void;
}

export default function Setups({ active, onRun }: Props) {
  return (
    <div className="px-3 pb-2">
      <p className="drs-etch pb-1.5">Set-ups</p>
      <div className="flex flex-wrap gap-1">
        {SETUPS.map(s => (
          <Tooltip key={s.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onRun(s)}
                data-on={active === s.id}
                className="drs-chip h-[22px] px-2 text-[9px] font-medium"
              >
                {s.name}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{s.blurb}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
