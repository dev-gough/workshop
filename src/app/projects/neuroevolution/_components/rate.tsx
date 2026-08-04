'use client';

// The rate dial. Dragging a 600-wide range across a hundred-odd pixels can
// only land on every fifth value, so fine adjustment lives on the wheel and
// arrow keys: one tick per second per notch.

import { useEffect, useRef } from 'react';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const RATE_MIN = 1;
export const RATE_MAX = 600;

interface Props {
  rate: number;
  onChange: (v: number) => void;
  compact?: boolean;
}

export default function RateControl({ rate, onChange, compact }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Read through refs so the listener attaches once instead of on every tick.
  const rateRef = useRef(rate);
  const onChangeRef = useRef(onChange);
  rateRef.current = rate;
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Horizontal wheel (or a shift-remapped one) isn't a rate change.
      if (e.deltaY === 0) return;
      // Non-passive: the wheel adjusts the rate here rather than scrolling past it.
      e.preventDefault();
      const next = rateRef.current + (e.deltaY < 0 ? 1 : -1);
      onChangeRef.current(Math.max(RATE_MIN, Math.min(RATE_MAX, next)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={wrapRef}
          className={`flex cursor-ns-resize items-center gap-2 ${compact ? '' : 'min-w-[150px]'}`}
        >
          <span className="drs-etch shrink-0 text-[9px]">Rate</span>
          <Slider
            className="drs-dial w-24"
            value={[rate]}
            onValueChange={v => onChange(v[0])}
            min={RATE_MIN}
            max={RATE_MAX}
            step={1}
            aria-label="Ticks per second"
          />
          <span className="drs-readout w-[46px] shrink-0 text-[10px] text-muted-foreground">
            {rate} t/s
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-60">
        Session speed. Scroll here — or use the arrow keys — to nudge it one tick per second at
        a time.
      </TooltipContent>
    </Tooltip>
  );
}
