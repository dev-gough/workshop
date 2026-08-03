'use client';

// Field trials. Each one is a claim about the model that the room can settle
// in about a thousand ticks — a parameter change plus the result you should
// expect if the algorithm works the way the rack says it does.

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { defaultParams, type EcoParams } from '../_lib/engine';

export interface Trial {
  id: string;
  label: string;
  claim: string;
  build: () => EcoParams;
}

export const TRIALS: Trial[] = [
  {
    id: 'baseline',
    label: 'Baseline',
    claim: 'The tuned world. Grazers and hunters settle into a cycle, and traits drift slowly.',
    build: defaultParams,
  },
  {
    id: 'clones',
    label: 'Clones',
    claim:
      'Mutation off. Selection can only sort the founders it was given — the distribution narrows to a spike and then stops moving. Variation is what selection spends.',
    build: () => {
      const p = defaultParams();
      p.heredity.rate = 0;
      p.prey.spread = 0.35;
      p.pred.spread = 0.35;
      return p;
    },
  },
  {
    id: 'free-vision',
    label: 'Free eyes',
    claim:
      'Vision costs nothing. With no bill to pay, sensing range climbs to the ceiling and stays there — a trait is only bounded by what it costs.',
    build: () => {
      const p = defaultParams();
      p.metabolism.visionCost = 0;
      return p;
    },
  },
  {
    id: 'famine',
    label: 'Lean years',
    claim:
      'Roughly one plant per tick. Starvation replaces predation as the main cause of death, and expensive bodies go first — watch mean speed fall.',
    build: () => {
      const p = defaultParams();
      p.plants.spawnRate = 1.5;
      p.plants.capacity = 230;
      return p;
    },
  },
  {
    id: 'patchy',
    label: 'Patchy food',
    claim:
      'Plants clump into five patches. Finding a patch matters more than covering ground, so vision earns its keep and climbs.',
    build: () => {
      const p = defaultParams();
      p.plants.patchiness = 0.95;
      p.plants.patches = 5;
      return p;
    },
  },
  {
    id: 'no-hunters',
    label: 'No hunters',
    claim:
      'Predation removed entirely. Nothing rewards speed any more, so grazers get slower and cheaper until the plant supply is all that limits them.',
    build: () => {
      const p = defaultParams();
      p.pred.initial = 0;
      p.rules.rescue = false;
      return p;
    },
  },
  {
    id: 'big-game',
    label: 'Big game',
    claim:
      'Hunters gain far more from large prey. The two species pull size in opposite directions — an arms race you can watch in the core sample.',
    build: () => {
      const p = defaultParams();
      p.pred.sizeBonus = 10;
      p.pred.mealEnergy = 10;
      return p;
    },
  },
];

export default function Trials({ active, onRun }: { active: string | null; onRun: (t: Trial) => void }) {
  return (
    <div className="px-3 pb-3">
      <p className="eco-etch mb-1.5">Field trials</p>
      <div className="flex flex-wrap gap-1">
        {TRIALS.map(t => (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onRun(t)}
                data-on={active === t.id}
                className="eco-chip h-[20px] px-1.5 text-[9px] font-medium"
              >
                {t.label}
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 leading-relaxed">{t.claim}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
