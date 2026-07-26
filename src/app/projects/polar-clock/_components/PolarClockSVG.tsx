'use client';

import { useId, useRef, useState } from 'react';
import { PALETTES, type RingConfig } from './shared';

// ── The orrery ───────────────────────────────────────────────────
// One dial, one ring per unit of time, read from the outside in. The
// chrome around the rings is instrument plate: a graduated bezel, a
// leading pip on every arc, and a lamplit readout at the hub. Ring
// colours come from the user's palette; everything else comes from the
// room (see .pc-theme), which is dark-always — hence the literals below
// rather than a theme branch.

const READOUT = 'var(--font-readout), ui-monospace, SFMono-Regular, monospace';

/** Short engraving for each ring, cut into the band at nine o'clock. */
const SHORT: Record<string, string> = {
  Week: 'WK', 'Year Day': 'DOY', Month: 'MON', Day: 'DAY',
  Hour: 'HR', Min: 'MIN', Sec: 'SEC',
};

export function PolarClockSVG({
  timezone, label, time, palette, smooth, rings, size, showCity = true, showDate = true,
}: {
  timezone: string; label: string; time: Date;
  palette: string; smooth: boolean; rings: RingConfig; size: number;
  showCity?: boolean; showDate?: boolean;
}) {
  const colors = PALETTES[palette]?.colors ?? PALETTES.default.colors;
  const uid = useId().replace(/:/g, '');

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    day: 'numeric', month: 'numeric', year: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(time);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0');

  const seconds = get('second') + (smooth ? time.getMilliseconds() / 1000 : 0);
  const minutes = get('minute') + (smooth ? seconds / 60 : 0);
  const hours = get('hour') + (smooth ? minutes / 60 : 0);
  const day = get('day');
  const month = get('month');
  const year = get('year');
  const daysInMonth = new Date(year, month, 0).getDate();

  const tzOffset = new Date(time.toLocaleString('en-US', { timeZone: timezone })).getTime();
  const localTime = new Date(tzOffset);
  const dayOfYear = Math.floor((localTime.getTime() - new Date(localTime.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  const daysInYear = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  const jan1 = new Date(year, 0, 1);
  const weekOfYear = Math.ceil(((localTime.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);

  // The room's own palette, written out rather than read through CSS vars —
  // these end up on SVG stroke/fill attributes, not in a stylesheet.
  const trackColor = 'rgba(120,150,210,0.13)';
  const trackEdge = 'rgba(140,170,230,0.10)';
  const inkColor = '#e9eefc';
  const dimColor = '#8e9cbd';
  const bezelColor = 'rgba(85,97,138,0.55)';
  const lampColor = '#f2b76a';
  const voidColor = '#05070e';

  const activeRings: { label: string; value: string; percentage: number; color: string }[] = [];
  let ci = 0;
  if (rings.weekOfYear) activeRings.push({ label: 'Week', value: `W${weekOfYear} / 52`, percentage: (weekOfYear / 52) * 100, color: colors[ci++ % colors.length] });
  if (rings.dayOfYear) activeRings.push({ label: 'Year Day', value: `${dayOfYear} / ${daysInYear}`, percentage: (dayOfYear / daysInYear) * 100, color: colors[ci++ % colors.length] });
  if (rings.months) activeRings.push({ label: 'Month', value: `${month} / 12`, percentage: (month / 12) * 100, color: colors[ci++ % colors.length] });
  if (rings.days) activeRings.push({ label: 'Day', value: `${day} / ${daysInMonth}`, percentage: (day / daysInMonth) * 100, color: colors[ci++ % colors.length] });
  if (rings.hours) activeRings.push({ label: 'Hour', value: `${Math.floor(hours)} / 24`, percentage: (hours / 24) * 100, color: colors[ci++ % colors.length] });
  if (rings.minutes) activeRings.push({ label: 'Min', value: `${Math.floor(minutes)} / 60`, percentage: (minutes / 60) * 100, color: colors[ci++ % colors.length] });
  if (rings.seconds) activeRings.push({ label: 'Sec', value: `${Math.floor(seconds)} / 60`, percentage: (seconds / 60) * 100, color: colors[ci++ % colors.length] });

  const cx = size / 2, cy = size / 2;
  const ringCount = activeRings.length || 1;
  const ringThickness = Math.min((size / 2 - 30) / (ringCount + 1.5), size / 17);
  const maxR = size / 2 - ringThickness / 2 - 14;
  const ringGap = Math.max(2, size / 120);
  const bezelR = maxR + ringThickness / 2 + 8;
  const innerR = maxR - (ringCount - 1) * (ringThickness + ringGap) - ringThickness / 2;

  const digitalTime = time.toLocaleTimeString('en-US', { timeZone: timezone, hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const digitalDate = time.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' });

  const [hovered, setHovered] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Font sizes scale with the dial.
  const cityFontSize = Math.max(11, size / 26);
  const timeFontSize = Math.max(20, size / 12);
  const dateFontSize = Math.max(10, size / 30);
  const bandFontSize = Math.max(7, Math.min(ringThickness * 0.44, size / 62));

  // Graduated bezel: a major mark every five minutes, a minor at each one.
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0;
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const len = major ? 7 : 3.5;
    return {
      x1: cx + Math.cos(a) * bezelR, y1: cy + Math.sin(a) * bezelR,
      x2: cx + Math.cos(a) * (bezelR + len), y2: cy + Math.sin(a) * (bezelR + len),
      major,
    };
  });

  return (
    <div ref={containerRef} className="relative">
      <svg
        width={size} height={size}
        viewBox={`0 0 ${size} ${size}`}
        onMouseMove={(e) => {
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          }
        }}
        onMouseLeave={() => { setHovered(null); setMousePos(null); }}
      >
        <defs>
          {/* A pool of shade at the hub, so the readout stays legible no
              matter how loud the projector is behind it. */}
          <radialGradient id={`${uid}-hub`}>
            <stop offset="0%" stopColor={voidColor} stopOpacity="0.85" />
            <stop offset="62%" stopColor={voidColor} stopOpacity="0.6" />
            <stop offset="100%" stopColor={voidColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Graduated bezel */}
        <circle cx={cx} cy={cy} r={bezelR} fill="none" stroke={bezelColor} strokeWidth={1} opacity={0.5} />
        {ticks.map((t, i) => (
          <line
            key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={t.major ? 'rgba(207,224,255,0.42)' : bezelColor}
            strokeWidth={t.major ? 1.4 : 0.8}
          />
        ))}

        {/* Hub shade, under the rings so their inner edges sit on it */}
        <circle cx={cx} cy={cy} r={Math.max(innerR, size * 0.12)} fill={`url(#${uid}-hub)`} />

        {activeRings.map((ring, i) => {
          const r = maxR - i * (ringThickness + ringGap);
          const circumference = 2 * Math.PI * r;
          const dashLen = circumference * (ring.percentage / 100);
          const isHot = hovered === ring.label;
          // Leading edge: exactly how far this unit has got, right now.
          const headA = (ring.percentage / 100) * Math.PI * 2 - Math.PI / 2;
          const hx = cx + Math.cos(headA) * r;
          const hy = cy + Math.sin(headA) * r;
          return (
            <g
              key={ring.label}
              onMouseEnter={() => setHovered(ring.label)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="transparent" strokeWidth={ringThickness + 8} />
              {/* Recessed track */}
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={ringThickness} />
              <circle cx={cx} cy={cy} r={r + ringThickness / 2} fill="none" stroke={trackEdge} strokeWidth={0.75} />
              {/* Filled arc */}
              <circle
                cx={cx} cy={cy} r={r}
                fill="none" stroke={ring.color}
                strokeWidth={ringThickness}
                strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`}
                opacity={isHot ? 1 : 0.88}
                style={{ transition: smooth ? 'opacity 0.15s' : 'stroke-dasharray 0.3s ease, opacity 0.15s' }}
              />
              {/* Leading pip */}
              <circle
                cx={hx} cy={hy} r={Math.max(1.6, ringThickness * 0.13)}
                fill="#ffffff" opacity={isHot ? 0.95 : 0.7}
              />
              {/* Engraved band label at twelve o'clock — where every arc
                  starts, and the one radius the horizontal hub readout can
                  never reach. */}
              {ringThickness >= 15 && (
                <text
                  x={cx} y={cy - r} textAnchor="middle" dominantBaseline="central"
                  fontSize={bandFontSize} letterSpacing="0.16em" fontWeight={600}
                  fill={isHot ? inkColor : 'rgba(233,238,252,0.6)'}
                  stroke={voidColor} strokeWidth={2.5} paintOrder="stroke"
                  style={{ fontFamily: READOUT, pointerEvents: 'none' }}
                >
                  {SHORT[ring.label] ?? ring.label}
                </text>
              )}
            </g>
          );
        })}

        {/* The hub text is stroked in the dome's own colour before it's
            filled, so it stays readable even when the projector is throwing
            something as loud as the Newton basins behind it. */}
        {showCity && (
          <text x={cx} y={cy - timeFontSize * 0.92} textAnchor="middle" dominantBaseline="middle"
            fontSize={cityFontSize} fill={dimColor} letterSpacing="0.28em" fontWeight="600"
            stroke={voidColor} strokeWidth={cityFontSize * 0.22} strokeOpacity={0.6} paintOrder="stroke">
            {label.toUpperCase()}
          </text>
        )}
        <text x={cx} y={cy + (showCity ? 2 : -timeFontSize * 0.2)} textAnchor="middle" dominantBaseline="middle"
          fontSize={timeFontSize} fontWeight="600" fill={inkColor}
          stroke={voidColor} strokeWidth={timeFontSize * 0.13} strokeOpacity={0.6} paintOrder="stroke"
          style={{ fontFamily: READOUT, fontVariantNumeric: 'tabular-nums' }}>
          {digitalTime}
        </text>
        {showDate && (
          <>
            <line
              x1={cx - timeFontSize * 1.45} y1={cy + timeFontSize * 0.5}
              x2={cx + timeFontSize * 1.45} y2={cy + timeFontSize * 0.5}
              stroke={lampColor} strokeWidth={0.75} opacity={0.35}
            />
            <text x={cx} y={cy + timeFontSize * 0.92 - (showCity ? 0 : timeFontSize * 0.2)} textAnchor="middle" dominantBaseline="middle"
              fontSize={dateFontSize} fill={dimColor} letterSpacing="0.06em"
              stroke={voidColor} strokeWidth={dateFontSize * 0.24} strokeOpacity={0.6} paintOrder="stroke">
              {digitalDate}
            </text>
          </>
        )}
      </svg>

      {/* Ring readout, following the cursor */}
      {hovered && mousePos && (
        <div
          style={{ left: mousePos.x + 14, top: mousePos.y - 10, position: 'absolute' }}
          className="pc-glass pointer-events-none z-10 flex items-center gap-2 whitespace-nowrap px-3 py-1.5"
        >
          <span className="pc-etch">{hovered}</span>
          <span className="pc-readout text-sm text-foreground">
            {activeRings.find(r => r.label === hovered)?.value}
          </span>
        </div>
      )}
    </div>
  );
}
