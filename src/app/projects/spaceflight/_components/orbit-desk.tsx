'use client';

import { useMemo, useState } from 'react';
import {
  EARTH_RADIUS_KM,
  ORBIT_TARGETS,
  PARKING_ALTITUDE_KM,
  pointsPath,
  solveHohmann,
  transferArcPoints,
} from '../_lib/orbit';

const fmtDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes} min`;
};

export function OrbitDesk() {
  const [targetKey, setTargetKey] = useState('geo');
  const target = ORBIT_TARGETS.find((item) => item.key === targetKey) ?? ORBIT_TARGETS[3];
  const solution = useMemo(() => solveHohmann(target.altitudeKm), [target.altitudeKm]);

  const geometry = useMemo(() => {
    const cx = 270;
    const cy = 174;
    const kmPerPx = solution.targetRadiusKm / 145;
    const arc = transferArcPoints(solution, cx, cy, kmPerPx);
    return {
      cx,
      cy,
      earthR: EARTH_RADIUS_KM / kmPerPx,
      parkingR: solution.parkingRadiusKm / kmPerPx,
      targetR: solution.targetRadiusKm / kmPerPx,
      arc,
      path: pointsPath(arc),
    };
  }, [solution]);

  const metrics = [
    ['Transfer coast', fmtDuration(solution.coastSeconds)],
    ['Total Δv', `${solution.totalDeltaVKmS.toFixed(2)} km/s`],
    ['Target speed', `${solution.targetSpeedKmS.toFixed(2)} km/s`],
    ['Target period', fmtDuration(solution.targetPeriodSeconds)],
  ];

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1fr)_250px]">
      <div className="relative min-h-[250px] overflow-hidden border border-border bg-background/35">
        <svg
          className="h-full min-h-[250px] w-full"
          viewBox="0 0 600 348"
          role="img"
          aria-label={`Ideal transfer from a ${PARKING_ALTITUDE_KM} kilometre parking orbit to ${target.label}`}
        >
          <defs>
            <radialGradient id="orbit-earth" cx="35%" cy="30%">
              <stop offset="0" stopColor="var(--sf-green)" stopOpacity=".34" />
              <stop offset=".72" stopColor="var(--sf-f9)" stopOpacity=".2" />
              <stop offset="1" stopColor="var(--sf-void)" />
            </radialGradient>
            <filter id="orbit-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g opacity=".45" stroke="var(--sf-line)">
            {[54, 108, 162, 216, 270, 324].map((y) => (
              <line key={y} x1="18" x2="582" y1={y} y2={y} />
            ))}
            {[54, 108, 162, 216, 270, 324, 378, 432, 486, 540].map((x) => (
              <line key={x} x1={x} x2={x} y1="18" y2="330" />
            ))}
          </g>

          <circle
            cx={geometry.cx}
            cy={geometry.cy}
            r={geometry.targetR}
            fill="none"
            stroke="var(--sf-faint)"
            strokeDasharray="4 5"
          />
          <circle
            cx={geometry.cx}
            cy={geometry.cy}
            r={geometry.parkingR}
            fill="none"
            stroke="var(--sf-dim)"
            strokeWidth="1.2"
          />
          <circle
            cx={geometry.cx}
            cy={geometry.cy}
            r={geometry.earthR}
            fill="url(#orbit-earth)"
            stroke="var(--sf-f9)"
            strokeWidth="1.2"
          />
          <path
            d={geometry.path}
            fill="none"
            stroke="var(--sf-amber)"
            strokeWidth="2.4"
            strokeLinecap="round"
            filter="url(#orbit-glow)"
          />

          <circle
            cx={geometry.arc[0].x}
            cy={geometry.arc[0].y}
            r="4"
            fill="var(--sf-green)"
          />
          <circle
            cx={geometry.arc[geometry.arc.length - 1].x}
            cy={geometry.arc[geometry.arc.length - 1].y}
            r="4"
            fill="var(--sf-amber)"
          />

          <g className="sf-readout" fontSize="10">
            <text x="18" y="30" fill="var(--sf-dim)">
              IDEAL TWO-BODY TRAJECTORY · NOT TO SCALE BETWEEN TARGETS
            </text>
            <text
              x={geometry.cx - geometry.parkingR - 7}
              y={geometry.cy + 17}
              textAnchor="end"
              fill="var(--sf-green)"
            >
              BURN 1
            </text>
            <text
              x={geometry.cx + geometry.targetR + 7}
              y={geometry.cy + 17}
              fill="var(--sf-amber)"
            >
              BURN 2
            </text>
            <text x={geometry.cx} y={geometry.cy + 4} textAnchor="middle" fill="var(--sf-dim)">
              EARTH
            </text>
          </g>
        </svg>

        <div className="absolute bottom-3 left-3 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-px w-5 bg-accent" /> transfer
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-px w-5 border-t border-dashed border-muted-foreground" /> target
          </span>
          <span className="sf-readout">{geometry.arc.length} render points</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="sf-etch">Mission target</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Orbit target">
            {ORBIT_TARGETS.map((item) => (
              <button
                key={item.key}
                role="radio"
                aria-checked={item.key === target.key}
                data-on={item.key === target.key}
                onClick={() => setTargetKey(item.key)}
                className="sf-chip px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.12em]"
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            {target.altitudeKm.toLocaleString('en-US')} km · {target.note}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border">
          {metrics.map(([label, value]) => (
            <div key={label} className="bg-card px-3 py-2.5">
              <p className="sf-etch !text-[8px]">{label}</p>
              <p className="sf-readout mt-1 text-[13px] text-foreground">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-auto border-l-2 border-accent pl-3">
          <p className="sf-etch">Flight plan</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Circularize at {PARKING_ALTITUDE_KM} km, burn{' '}
            <span className="sf-readout text-foreground">
              {(solution.departureDeltaVKmS * 1000).toFixed(0)} m/s
            </span>
            , coast half an ellipse, then add{' '}
            <span className="sf-readout text-foreground">
              {(solution.arrivalDeltaVKmS * 1000).toFixed(0)} m/s
            </span>{' '}
            prograde at apogee. Gravity and atmosphere losses are excluded.
          </p>
        </div>
      </div>
    </div>
  );
}
