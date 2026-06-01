'use client';

import { useId } from 'react';

export type GaugeStatus = 'ok' | 'warn' | 'crit' | 'idle';

interface RadialGaugeProps {
  value: number | null;
  min?: number;
  max: number;
  /** Fractions of [min..max] at which the indicator flips to warn / crit. */
  thresholds?: [number, number];
  /** Big number formatter. */
  format?: (v: number) => string;
  /** Optional unit suffix rendered alongside the big number. */
  unit?: string;
  /** Optional small caption under the digital panel. */
  sub?: string;
  /** Tick labels at the dial extremes. */
  minLabel?: string;
  maxLabel?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function RadialGauge({
  value,
  min = 0,
  max,
  thresholds = [0.7, 0.9],
  format,
  unit,
  sub,
  minLabel,
  maxLabel,
}: RadialGaugeProps) {
  const rawId = useId();
  const id = rawId.replace(/[:]/g, '');

  const hasValue = value != null && Number.isFinite(value);
  const span = max - min || 1;
  const pct = hasValue ? clamp((value! - min) / span, 0, 1) : 0;

  // SVG geometry — center (100,100), 180° arc opening downward.
  const cx = 100;
  const cy = 100;
  const Rb = 86;   // bezel ring
  const Rt = 80;   // tick anchor
  const Rv = 66;   // value-arc radius
  const trackW = 8;
  const valW = 12;

  const polar = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const arcD = (r: number, fromDeg: number, toDeg: number) => {
    const [x1, y1] = polar(r, fromDeg);
    const [x2, y2] = polar(r, toDeg);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };

  const fullLen = Math.PI * Rv;
  const dashOffset = fullLen * (1 - pct);

  const status: GaugeStatus = !hasValue ? 'idle' : pct < thresholds[0] ? 'ok' : pct < thresholds[1] ? 'warn' : 'crit';
  const zoneColor =
    status === 'ok'   ? 'var(--cc-cyan)'  :
    status === 'warn' ? 'var(--cc-amber)' :
    status === 'crit' ? 'var(--cc-rose)'  :
                        'var(--cc-muted)';

  // Needle: -90° = left (pct 0); 0° = up (pct 0.5); +90° = right (pct 1).
  const needleAngle = pct * 180 - 90;

  // 21 ticks (every 5%).
  const ticks: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  for (let i = 0; i <= 20; i++) {
    const ang = 180 + (180 * i) / 20;
    const major = i % 5 === 0;
    const len = major ? 10 : 5;
    const [x1, y1] = polar(Rt, ang);
    const [x2, y2] = polar(Rt - len, ang);
    ticks.push({ x1, y1, x2, y2, major });
  }
  const valueTickAng = 180 + 180 * pct;

  return (
    <div className="relative w-full select-none">
      <svg viewBox="0 0 200 104" className="w-full h-auto block overflow-visible">
        <defs>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="var(--cc-cyan)"  />
            <stop offset={`${thresholds[0] * 100}%`} stopColor="var(--cc-cyan)" />
            <stop offset={`${(thresholds[0] + (thresholds[1] - thresholds[0]) / 2) * 100}%`} stopColor="var(--cc-amber)" />
            <stop offset="100%" stopColor="var(--cc-rose)" />
          </linearGradient>
          <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`hardglow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Bezel ring */}
        <path d={arcD(Rb, 180, 360)} stroke="var(--cc-bezel)" strokeWidth={1.5} fill="none" />
        <path d={arcD(Rb - 4, 180, 360)} stroke="hsl(220 30% 13%)" strokeWidth={0.75} fill="none" opacity={0.7} />

        {/* Tick marks */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={t.major ? 'var(--cc-dim)' : 'var(--cc-muted)'}
            strokeWidth={t.major ? 1 : 0.6}
            strokeLinecap="round"
            opacity={t.major ? 0.85 : 0.45}
          />
        ))}

        {/* Background track */}
        <path
          d={arcD(Rv, 180, 360)}
          stroke="hsl(220 25% 11%)"
          strokeWidth={trackW}
          fill="none"
          strokeLinecap="round"
        />

        {/* Value arc — gradient stroke, animated via dashoffset */}
        {hasValue && (
          <path
            className="cc-gauge-arc"
            d={arcD(Rv, 180, 360)}
            stroke={`url(#grad-${id})`}
            strokeWidth={valW}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${fullLen} ${fullLen}`}
            strokeDashoffset={dashOffset}
            filter={`url(#glow-${id})`}
          />
        )}

        {/* Bright leading tick at current value */}
        {hasValue && (() => {
          const [x1, y1] = polar(Rt + 2, valueTickAng);
          const [x2, y2] = polar(Rt - 12, valueTickAng);
          return (
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={zoneColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              filter={`url(#hardglow-${id})`}
              style={{ transition: 'all 700ms cubic-bezier(.2,.9,.2,1)' }}
            />
          );
        })()}

        {/* Needle */}
        {hasValue && (
          <g className="cc-gauge-needle" transform={`rotate(${needleAngle} ${cx} ${cy})`}>
            <line
              x1={cx} y1={cy + 4}
              x2={cx} y2={cy - (Rv - 6)}
              stroke={zoneColor}
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.28"
              filter={`url(#glow-${id})`}
            />
            <line
              x1={cx} y1={cy + 4}
              x2={cx} y2={cy - (Rv - 6)}
              stroke={zoneColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              filter={`url(#hardglow-${id})`}
            />
            <circle cx={cx} cy={cy - (Rv - 6)} r="2.5" fill={zoneColor} filter={`url(#hardglow-${id})`} />
          </g>
        )}

        {/* Center hub */}
        <circle cx={cx} cy={cy} r="7" fill="var(--cc-card-2)" stroke="var(--cc-bezel)" strokeWidth="1.2" />
        <circle cx={cx} cy={cy} r="2" fill={zoneColor} />
      </svg>

      {/* Digital readout strip — replaces orphan min/max + sub texts */}
      <div className="mt-1 px-2">
        <div
          className="relative rounded-[2px] px-3 py-1.5 flex items-center justify-between gap-3"
          style={{
            background: 'linear-gradient(180deg, hsl(220 30% 6%) 0%, hsl(220 32% 4%) 100%)',
            border: '1px solid var(--cc-border)',
            boxShadow:
              'inset 0 1px 0 hsl(220 30% 18% / 0.6), inset 0 -1px 0 hsl(0 0% 0% / 0.5), 0 0 0 1px hsl(0 0% 0% / 0.3)',
          }}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--cc-muted)] tabular-nums w-10">
            {minLabel ?? ''}
          </span>
          <div
            className="cc-readout text-[26px] leading-none text-center flex-1"
            style={{ color: zoneColor }}
          >
            {hasValue ? (format ? format(value!) : value!.toFixed(2)) : '—'}
            {unit && <span className="text-[13px] ml-1 opacity-70">{unit}</span>}
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[color:var(--cc-muted)] tabular-nums w-10 text-right">
            {maxLabel ?? ''}
          </span>
        </div>
        {sub && (
          <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.28em] text-[color:var(--cc-muted)] tabular-nums text-center">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
