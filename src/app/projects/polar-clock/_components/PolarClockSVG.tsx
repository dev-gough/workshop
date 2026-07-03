'use client';

import { useRef, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { PALETTES, type RingConfig } from './shared';

// ── Polar Clock SVG ─────────────────────────────────────────────
export function PolarClockSVG({
  timezone, label, time, palette, smooth, rings, size, showCity = true, showDate = true,
}: {
  timezone: string; label: string; time: Date;
  palette: string; smooth: boolean; rings: RingConfig; size: number;
  showCity?: boolean; showDate?: boolean;
}) {
  const { theme } = useTheme();
  const colors = PALETTES[palette]?.colors ?? PALETTES.default.colors;

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

  const bgRingColor = theme === 'dark' ? 'rgba(40,50,70,0.6)' : 'rgba(200,210,220,0.6)';
  const textColor = theme === 'dark' ? 'hsl(210,20%,92%)' : 'hsl(224,30%,15%)';
  const mutedColor = theme === 'dark' ? 'hsl(210,10%,60%)' : 'hsl(220,10%,45%)';

  const activeRings: { label: string; value: string; percentage: number; color: string }[] = [];
  let ci = 0;
  if (rings.weekOfYear) activeRings.push({ label: 'Week', value: `W${weekOfYear}`, percentage: (weekOfYear / 52) * 100, color: colors[ci++ % colors.length] });
  if (rings.dayOfYear) activeRings.push({ label: 'Year Day', value: `${dayOfYear}/${daysInYear}`, percentage: (dayOfYear / daysInYear) * 100, color: colors[ci++ % colors.length] });
  if (rings.months) activeRings.push({ label: 'Month', value: `${month}/12`, percentage: (month / 12) * 100, color: colors[ci++ % colors.length] });
  if (rings.days) activeRings.push({ label: 'Day', value: `${day}/${daysInMonth}`, percentage: (day / daysInMonth) * 100, color: colors[ci++ % colors.length] });
  if (rings.hours) activeRings.push({ label: 'Hour', value: `${Math.floor(hours)}`, percentage: (hours / 24) * 100, color: colors[ci++ % colors.length] });
  if (rings.minutes) activeRings.push({ label: 'Min', value: `${Math.floor(minutes)}`, percentage: (minutes / 60) * 100, color: colors[ci++ % colors.length] });
  if (rings.seconds) activeRings.push({ label: 'Sec', value: `${Math.floor(seconds)}`, percentage: (seconds / 60) * 100, color: colors[ci++ % colors.length] });

  const cx = size / 2, cy = size / 2;
  const ringCount = activeRings.length || 1;
  const ringThickness = Math.min((size / 2 - 30) / (ringCount + 1.5), size / 14);
  const maxR = size / 2 - ringThickness / 2 - 6;
  const ringGap = Math.max(2, size / 120);

  const digitalTime = time.toLocaleTimeString('en-US', { timeZone: timezone, hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const digitalDate = time.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' });

  const [hovered, setHovered] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Font sizes scale with clock
  const cityFontSize = Math.max(14, size / 18);
  const timeFontSize = Math.max(20, size / 12);
  const dateFontSize = Math.max(10, size / 28);
  const legendFontSize = Math.max(9, size / 40);

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
        {activeRings.map((ring, i) => {
          const r = maxR - i * (ringThickness + ringGap);
          const circumference = 2 * Math.PI * r;
          const dashLen = circumference * (ring.percentage / 100);
          return (
            <g
              key={ring.label}
              onMouseEnter={() => setHovered(ring.label)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="transparent" strokeWidth={ringThickness + 8} />
              <circle cx={cx} cy={cy} r={r} fill="none" stroke={bgRingColor} strokeWidth={ringThickness} strokeLinecap="round" />
              <circle
                cx={cx} cy={cy} r={r}
                fill="none" stroke={ring.color}
                strokeWidth={ringThickness}
                strokeDasharray={`${dashLen} ${circumference - dashLen}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${cx} ${cy})`}
                opacity={hovered === ring.label ? 1 : 0.85}
                style={{ transition: smooth ? 'opacity 0.15s' : 'stroke-dasharray 0.3s ease, opacity 0.15s' }}
              />
            </g>
          );
        })}
        {/* Center: City, Time, Date */}
        {showCity && (
          <text x={cx} y={cy - timeFontSize * 0.9} textAnchor="middle" dominantBaseline="middle"
            fontSize={cityFontSize} fill={mutedColor} fontFamily="'Inter', system-ui, sans-serif" letterSpacing="0.12em" fontWeight="300">
            {label.toUpperCase()}
          </text>
        )}
        <text x={cx} y={cy + (showCity ? 2 : -timeFontSize * 0.2)} textAnchor="middle" dominantBaseline="middle"
          fontSize={timeFontSize} fontWeight="700" fill={textColor} fontFamily="'JetBrains Mono', 'SF Mono', monospace">
          {digitalTime}
        </text>
        {showDate && (
          <text x={cx} y={cy + timeFontSize * 0.85 - (showCity ? 0 : timeFontSize * 0.2)} textAnchor="middle" dominantBaseline="middle"
            fontSize={dateFontSize} fill={mutedColor}>
            {digitalDate}
          </text>
        )}
      </svg>
      {/* Tooltip */}
      {hovered && mousePos && (
        <div
          style={{ left: mousePos.x + 12, top: mousePos.y - 12, position: 'absolute' }}
          className="bg-popover/95 backdrop-blur text-popover-foreground border shadow-md px-3 py-1.5 rounded text-sm z-10 pointer-events-none whitespace-nowrap"
        >
          <span className="font-semibold">{hovered}:</span>{' '}
          {activeRings.find(r => r.label === hovered)?.value}
        </div>
      )}
    </div>
  );
}
