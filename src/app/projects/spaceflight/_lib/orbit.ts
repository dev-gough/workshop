// Deterministic two-body mission mechanics for the Orbit Desk. Distances are
// geocentric kilometres; velocities are km/s. These are ideal impulsive
// Hohmann transfers, intentionally excluding atmosphere, inclination and
// finite-burn losses.

export const EARTH_RADIUS_KM = 6371;
export const EARTH_MU_KM3_S2 = 398600.4418;
export const PARKING_ALTITUDE_KM = 200;

export interface OrbitTarget {
  key: string;
  label: string;
  altitudeKm: number;
  note: string;
}

export const ORBIT_TARGETS: readonly OrbitTarget[] = [
  { key: 'iss', label: 'ISS', altitudeKm: 408, note: 'Low orbit rendezvous' },
  { key: 'sso', label: 'Sun-sync', altitudeKm: 700, note: 'Typical imaging orbit' },
  { key: 'gps', label: 'GPS', altitudeKm: 20_200, note: 'Medium Earth orbit' },
  { key: 'geo', label: 'GEO', altitudeKm: 35_786, note: 'One sidereal-day orbit' },
] as const;

export interface TransferSolution {
  parkingRadiusKm: number;
  targetRadiusKm: number;
  semiMajorKm: number;
  eccentricity: number;
  coastSeconds: number;
  targetPeriodSeconds: number;
  targetSpeedKmS: number;
  departureDeltaVKmS: number;
  arrivalDeltaVKmS: number;
  totalDeltaVKmS: number;
}

export function solveHohmann(
  targetAltitudeKm: number,
  parkingAltitudeKm = PARKING_ALTITUDE_KM
): TransferSolution {
  if (targetAltitudeKm <= parkingAltitudeKm) {
    throw new RangeError('Target orbit must be above the parking orbit');
  }
  const r1 = EARTH_RADIUS_KM + parkingAltitudeKm;
  const r2 = EARTH_RADIUS_KM + targetAltitudeKm;
  const a = (r1 + r2) / 2;
  const v1 = Math.sqrt(EARTH_MU_KM3_S2 / r1);
  const v2 = Math.sqrt(EARTH_MU_KM3_S2 / r2);
  const departureDeltaVKmS = v1 * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
  const arrivalDeltaVKmS = v2 * (1 - Math.sqrt((2 * r1) / (r1 + r2)));

  return {
    parkingRadiusKm: r1,
    targetRadiusKm: r2,
    semiMajorKm: a,
    eccentricity: (r2 - r1) / (r2 + r1),
    coastSeconds: Math.PI * Math.sqrt(a ** 3 / EARTH_MU_KM3_S2),
    targetPeriodSeconds: 2 * Math.PI * Math.sqrt(r2 ** 3 / EARTH_MU_KM3_S2),
    targetSpeedKmS: v2,
    departureDeltaVKmS,
    arrivalDeltaVKmS,
    totalDeltaVKmS: departureDeltaVKmS + arrivalDeltaVKmS,
  };
}

export interface Point {
  x: number;
  y: number;
}

function pointLineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return (
    Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) /
    Math.hypot(dx, dy)
  );
}

/**
 * Tessellate a parametric curve until every sampled midpoint is within the
 * requested screen-space chord error. Unlike a fixed 360-point orbit, the
 * renderer spends vertices only where curvature is visible.
 */
export function adaptiveCurve(
  pointAt: (t: number) => Point,
  from: number,
  to: number,
  maxErrorPx = 0.45,
  maxDepth = 12
): Point[] {
  const first = pointAt(from);
  const last = pointAt(to);
  const points: Point[] = [first];

  const split = (t0: number, p0: Point, t1: number, p1: Point, depth: number) => {
    const tm = (t0 + t1) / 2;
    const pm = pointAt(tm);
    if (depth < maxDepth && pointLineDistance(pm, p0, p1) > maxErrorPx) {
      split(t0, p0, tm, pm, depth + 1);
      split(tm, pm, t1, p1, depth + 1);
    } else {
      points.push(p1);
    }
  };

  split(from, first, to, last, 0);
  return points;
}

export function transferArcPoints(
  solution: TransferSolution,
  earthX: number,
  earthY: number,
  kmPerPx: number,
  maxErrorPx = 0.45
): Point[] {
  const a = solution.semiMajorKm / kmPerPx;
  const c = (solution.semiMajorKm * solution.eccentricity) / kmPerPx;
  const b = a * Math.sqrt(1 - solution.eccentricity ** 2);
  return adaptiveCurve(
    (theta) => ({
      x: earthX + c + a * Math.cos(theta),
      y: earthY - b * Math.sin(theta),
    }),
    Math.PI,
    0,
    maxErrorPx
  );
}

export function pointsPath(points: readonly Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join('');
}
