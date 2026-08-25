'use client';

// Park silhouette — outline only, projected so the shape isn't stretched.

import { useId, useMemo } from 'react';
import type { ParkOutline } from '../_lib/model';

type Pt = [number, number];

function setup(ring: Pt[]) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of ring) {
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  const pad = 0.12;
  const spanX = (e - w) || 1;
  const spanY = (n - s) || 1;
  const mx = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const W = spanX * (1 + pad * 2) * mx;
  const H = spanY * (1 + pad * 2);
  const originX = (w - spanX * pad) * mx;
  const originY = n + spanY * pad;
  const project = ([lon, lat]: Pt): Pt => [lon * mx - originX, originY - lat];
  return { W, H, project };
}

export default function ParkOutlineSvg({ park }: { park: ParkOutline }) {
  const glowId = useId().replace(/:/g, '');
  const { W, H, project } = useMemo(() => setup(park.outline), [park.outline]);
  const d = park.outline
    .map((p, i) => {
      const [x, y] = project(p);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      aria-hidden
    >
      <defs>
        <filter id={glowId} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation={Math.max(W, H) * 0.006} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {d && <path className="pd-radar-outline" d={`${d} Z`} filter={`url(#${glowId})`} />}
    </svg>
  );
}
