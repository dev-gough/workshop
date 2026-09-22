import {
  defaultParams,
  type DriveParams,
  type Point,
  type Session,
} from './engine';

export interface ReplayCard {
  version: 1;
  params: DriveParams;
  customCircuit?: {
    centerline: Point[];
    width: number;
  };
}

function sameShape(value: unknown, template: unknown): boolean {
  if (typeof template === 'number') {
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
  }
  if (typeof template === 'boolean') return typeof value === 'boolean';
  if (!value || typeof value !== 'object' || Array.isArray(value) || !template || typeof template !== 'object') {
    return false;
  }
  return Object.entries(template).every(([key, child]) =>
    sameShape((value as Record<string, unknown>)[key], child),
  );
}

function validParams(value: unknown): value is DriveParams {
  if (!sameShape(value, defaultParams())) return false;
  const p = value as DriveParams;
  return (
    Number.isInteger(p.sensors.count) && p.sensors.count >= 1 && p.sensors.count <= 64
    && Number.isInteger(p.brain.hidden) && p.brain.hidden >= 1 && p.brain.hidden <= 128
    && Number.isInteger(p.evolution.popSize) && p.evolution.popSize >= 1 && p.evolution.popSize <= 1000
    && Number.isInteger(p.circuit.corners) && p.circuit.corners >= 3 && p.circuit.corners <= 64
    && p.circuit.radius > 0 && p.circuit.width > 0
    && p.car.topSpeed > 0 && p.sensors.range > 0
    && p.session.tickBudget > 0 && p.session.patience >= 0
  );
}

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return typeof p.x === 'number' && Number.isFinite(p.x) && Math.abs(p.x) <= 1_000_000
    && typeof p.y === 'number' && Number.isFinite(p.y) && Math.abs(p.y) <= 1_000_000;
}

function toBase64Url(text: string): string {
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
}

export function replayCard(session: Session): ReplayCard {
  const card: ReplayCard = {
    version: 1,
    params: structuredClone(session.params),
  };
  if (session.customTrack) {
    card.customCircuit = {
      centerline: session.track.centerline.map(({ x, y }) => ({ x, y })),
      width: session.track.width,
    };
  }
  return card;
}

export function encodeReplay(card: ReplayCard): string {
  return toBase64Url(JSON.stringify(card));
}

/** Accept a bare replay code or a full shared URL. */
export function decodeReplay(input: string): ReplayCard | null {
  try {
    const trimmed = input.trim();
    let code = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
      code = new URL(trimmed).searchParams.get('replay') ?? '';
    }
    if (!code || code.length > 500_000) return null;
    const raw = JSON.parse(fromBase64Url(code)) as Record<string, unknown>;
    if (raw.version !== 1 || !validParams(raw.params)) return null;

    const card: ReplayCard = {
      version: 1,
      params: structuredClone(raw.params),
    };
    if (raw.customCircuit !== undefined) {
      const custom = raw.customCircuit as Record<string, unknown>;
      if (
        !custom || typeof custom !== 'object'
        || !Array.isArray(custom.centerline)
        || custom.centerline.length < 3
        || custom.centerline.length > 5000
        || !custom.centerline.every(validPoint)
        || typeof custom.width !== 'number'
        || !Number.isFinite(custom.width)
        || custom.width <= 0
        || custom.width > 1000
      ) return null;
      card.customCircuit = {
        centerline: custom.centerline.map(p => ({ x: p.x, y: p.y })),
        width: custom.width,
      };
    }
    return card;
  } catch {
    return null;
  }
}
