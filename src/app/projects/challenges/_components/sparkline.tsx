'use client';

import { TIERS, tierVar, type ChallengeNode } from './types';

export type HistoryMap = Record<string, [number, number][]>;

const W = 308;
const H = 96;
// Room for threshold labels. Sized for the widest realistic one — "GRAN 39.2M"
// at 8px — since a 7-figure gold challenge would otherwise clip its suffix.
const PAD_R = 58;
const PAD_B = 12; // room for the date axis

/**
 * Value over time for one challenge: the shape of the climb, and where a tier
 * boundary was crossed if one falls inside the window.
 *
 * Renders nothing below two points. A single delta is a dot, not a trend, and
 * drawing a flat line through it would imply a history that isn't there.
 */
export function ChallengeSparkline({
  node, points,
}: { node: ChallengeNode; points: [number, number][] | undefined }) {
  if (!points || points.length < 2) return null;

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const t0 = xs[0];
  const t1 = xs[xs.length - 1];
  if (t1 <= t0) return null;

  // Scale to the observed values, NOT to the next threshold. Forcing a distant
  // target into the domain flattens the series against the axis — a challenge
  // sitting at 52 with the next tier at 260 became a dead horizontal line. The
  // progress bar immediately above this chart already states the distance
  // ("52 / 260"); the chart's only unique job is the shape of the climb.
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.02);
  const domLo = lo - pad;
  const span = (hi + pad) - domLo || 1;

  const x = (t: number) => ((t - t0) / (t1 - t0)) * (W - PAD_R);
  const y = (v: number) => (H - PAD_B) - ((v - domLo) / span) * (H - PAD_B - 8);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  const area = `${line} L${x(t1).toFixed(1)},${H - PAD_B} L${x(t0).toFixed(1)},${H - PAD_B} Z`;
  const color = tierVar(node.level);

  // Only thresholds that actually land inside the drawn range are useful; the
  // rest would be labels pointing off-canvas.
  const marks = TIERS
    .filter((t) => {
      const v = node.thresholds[t];
      // A tier line only earns its place if it falls inside the drawn window —
      // which happens exactly when the trail crossed it, the useful case.
      return v !== undefined && v >= domLo && v <= domLo + span;
    })
    .map((t) => ({ tier: t, value: node.thresholds[t] }));

  const fmt = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 10_000 ? `${Math.round(v / 1000)}k`
        : String(Math.round(v));
  const day = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const gradId = `spark-${node.challengeId}`;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Progress
        </p>
        <p className="text-[10px] text-[var(--lol-text-muted)]">
          {points.length} games tracked
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label={`Progress from ${fmt(ys[0])} to ${fmt(ys[ys.length - 1])}`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {marks.map((m) => (
          <g key={m.tier}>
            <line
              x1="0" x2={W - PAD_R} y1={y(m.value)} y2={y(m.value)}
              stroke={tierVar(m.tier)} strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
            />
            <text
              x={W - PAD_R + 5} y={y(m.value) + 3}
              fontSize="8" fill={tierVar(m.tier)} opacity="0.9"
            >
              {m.tier.slice(0, 4)} {fmt(m.value)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5"
              strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(t1)} cy={y(ys[ys.length - 1])} r="2.5" fill={color} />
      </svg>

      <div className="flex justify-between text-[9px] text-[var(--lol-text-muted)]">
        <span>{day(t0)}</span>
        <span>{day(t1)}</span>
      </div>
    </div>
  );
}
