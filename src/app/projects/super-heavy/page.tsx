'use client';

import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useHeaderConfig } from '@/components/header-config';
import { BoosterStage } from './_components/booster-stage';

export default function SuperHeavyPage() {
  useHeaderConfig({ scopeClass: 'sh-theme' });

  return (
    <PageTransition>
      <div className="sh-theme min-h-[calc(100vh-57px)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <FadeIn>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
              Flight dynamics
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Super Heavy — 2 Grid Fins + S-Turns
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              “We might be able to reduce to 2 grid fins and use S-turns for the third axis of control.”{' '}
              <a
                href="https://x.com/elonmusk/status/2103540479266836485"
                className="text-foreground underline decoration-border underline-offset-2 hover:decoration-primary"
              >
                Elon Musk
              </a>
              , 25 Sep 2026, to @Erdayastronaut.
            </p>
          </FadeIn>

          <FadeIn delay={0.05}>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <article className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Two fins</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  Mounted opposite, on ±X. Deflected together they push along one body axis — call it Z — the job one pair of a four-fin set already does.
                </p>
              </article>
              <article className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#e2a04a]">The missing axis</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  Nothing is left to push along X. Roll the booster and that same Z force swings onto whatever horizontal direction the turn needs.
                </p>
              </article>
              <article className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">S-turn</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  The track bends one way, then the other. Each lobe is a bank: fins deflect, the vehicle rolls, and the cyan arrow stays pointed into the curve.
                </p>
              </article>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-6">
              <BoosterStage />
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Drag to orbit the pad. The maneuver plays on its own: amber is the S, frost is the only force the two fins can make, and the white stripe shows the roll that aims it.
              </p>
            </div>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}
