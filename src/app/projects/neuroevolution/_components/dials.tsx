'use client';

// Set-up sheet hardware. The rack carries thirty-odd parameters, so each
// control has to survive being stacked: one stencilled label, one value, one
// hairline dial, no chrome beyond that.

import { ChevronRight } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Marks a control whose change only lands on the next regrid. */
export function StagedMark() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="drs-staged cursor-help select-none text-[9px] leading-none">↺</span>
      </TooltipTrigger>
      <TooltipContent>Seeds the session — takes effect on the next regrid</TooltipContent>
    </Tooltip>
  );
}

interface DialProps {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  staged?: boolean;
}

export function Dial({ label, hint, value, onChange, min, max, step, unit, digits = 0, staged }: DialProps) {
  return (
    <div className="py-1.5">
      <div className="flex items-baseline gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help truncate text-[10px] font-medium tracking-wide">{label}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{hint}</TooltipContent>
        </Tooltip>
        {staged && <StagedMark />}
        <span className="drs-readout ml-auto shrink-0 text-[10px] text-foreground">
          {value.toFixed(digits)}
          {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
        </span>
      </div>
      <Slider
        className="drs-dial mt-1.5"
        value={[value]}
        onValueChange={v => onChange(v[0])}
        min={min}
        max={max}
        step={step}
        aria-label={label}
      />
    </div>
  );
}

interface SwitchProps {
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
  onText?: string;
  offText?: string;
  staged?: boolean;
}

export function Switch({ label, hint, on, onChange, onText = 'on', offText = 'off', staged }: SwitchProps) {
  return (
    <div className="flex items-center gap-1.5 py-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help truncate text-[10px] font-medium tracking-wide">{label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{hint}</TooltipContent>
      </Tooltip>
      {staged && <StagedMark />}
      <button
        type="button"
        onClick={() => onChange(!on)}
        data-on={on}
        className="drs-chip ml-auto h-[18px] shrink-0 px-2 text-[9px] font-semibold uppercase tracking-[0.14em]"
      >
        {on ? onText : offText}
      </button>
    </div>
  );
}

interface DrawerProps {
  title: string;
  note: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Drawer({ title, note, defaultOpen, children }: DrawerProps) {
  return (
    <details className="drs-drawer border-b border-border/70 last:border-b-0" open={defaultOpen}>
      <summary className="flex items-center gap-1.5 py-2.5 hover:text-foreground">
        <ChevronRight className="drs-caret h-3 w-3 text-muted-foreground" />
        <span className="drs-etch text-foreground">{title}</span>
        <span className="ml-auto truncate text-[9px] text-muted-foreground">{note}</span>
      </summary>
      <div className="pb-3 pl-[18px] pr-0.5">{children}</div>
    </details>
  );
}
