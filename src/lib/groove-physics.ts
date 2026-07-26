/**
 * The bike.
 *
 * A two-wheel raycast vehicle: a rigid chassis with a sprung contact point at
 * each end. Each wheel that's touching the ground pushes back along the local
 * normal and drags along the local tangent, and because those forces are
 * applied at the contact patch rather than the axle, wheelies, endos and
 * nose-dives all fall out of the same three lines of maths instead of needing
 * to be special-cased.
 *
 * Pure and fixed-step on purpose. Same course + same inputs + same dt ⇒ same
 * ride, every time, on any machine — which is what lets scripts/groove-sim.ts
 * tune the handling headlessly, and what a ghost replay would need later.
 */

import { heightAt, slopeAt, type Course } from './groove';

// ── The machine ──────────────────────────────────────────────────
export const WHEELBASE = 48;
export const WHEEL_R = 14;
/** Rider's head, in chassis-local coords. Touch the ground with it and you're off. */
const HEAD_H = 44;

// ── Handling ─────────────────────────────────────────────────────
const GRAVITY = 2200;
const SPRING_K = 300;        // ground stiffness, force per unit of squash
const SPRING_D = 26;         // and its damping, or the bike pogos
const MOMENT = 9000;         // resistance to pitching
const DRIVE = 2300;
const TRACTION = 1.6;        // drive is capped at this × the load on the wheel
const ROLL = 0.12;           // rolling resistance — small, as a tyre's is
const BRAKE = 5.5;
const DRAG = 0.0018;         // air resistance, and what actually caps top speed
const AIR_PITCH = 9.5;       // rad/s² of lean authority with both wheels off
/**
 * The rider can still shift weight with the wheels down, just not as much.
 * Without this the throttle's own wheelie torque loops you over on the start
 * line and there is nothing you can do about it.
 */
const GROUND_PITCH = 0.7;
const GROUND_PITCH_DAMP = 5.5;
const MAX_OMEGA = 12;

/** Fixed physics step. The renderer accumulates real time and calls in units of this. */
export const PHYSICS_DT = 1 / 240;

export interface BikeState {
  x: number; y: number;
  vx: number; vy: number;
  /** Chassis pitch in radians; positive is nose-up. */
  angle: number;
  omega: number;
  rearGrounded: boolean;
  frontGrounded: boolean;
  crashed: boolean;
  /** Seconds in the current jump, and across the whole run. */
  air: number;
  totalAir: number;
  /** Radians turned since leaving the ground, and completed flips banked. */
  spin: number;
  flips: number;
}

export interface BikeInput {
  throttle: boolean;
  brake: boolean;
  /** -1 lean back (wheelie), +1 lean forward. */
  lean: number;
}

export function spawnBike(course: Course, x: number): BikeState {
  return {
    x,
    y: heightAt(course, x) + WHEEL_R + 6,
    vx: 0, vy: 0,
    angle: Math.atan(slopeAt(course, x)),
    omega: 0,
    rearGrounded: true, frontGrounded: true,
    crashed: false,
    air: 0, totalAir: 0,
    spin: 0, flips: 0,
  };
}

/** One fixed step. Mutates `b`. */
export function stepBike(course: Course, b: BikeState, input: BikeInput, dt: number = PHYSICS_DT): void {
  if (b.crashed) return;

  const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
  let fx = 0;
  let fy = -GRAVITY;
  let torque = 0;

  b.rearGrounded = false;
  b.frontGrounded = false;

  for (let w = 0; w < 2; w++) {
    const isRear = w === 0;
    const lx = isRear ? -WHEELBASE / 2 : WHEELBASE / 2;
    // Wheel centre in world space.
    const wx = b.x + lx * cos;
    const wy = b.y + lx * sin;

    const g = heightAt(course, wx);
    const squash = g + WHEEL_R - wy;
    if (squash <= 0) continue;

    if (isRear) b.rearGrounded = true; else b.frontGrounded = true;

    const slope = slopeAt(course, wx);
    const inv = 1 / Math.hypot(1, slope);
    const nx = -slope * inv, ny = inv;          // ground normal, pointing up
    const tx = inv, ty = slope * inv;           // tangent, pointing forward

    // Forces act at the contact patch, not the axle. That single detail is
    // what makes the throttle lift the front wheel.
    const rx = wx - b.x - nx * WHEEL_R;
    const ry = wy - b.y - ny * WHEEL_R;

    // Velocity of that point on the chassis: v + ω × r.
    const pvx = b.vx - b.omega * ry;
    const pvy = b.vy + b.omega * rx;

    const vn = pvx * nx + pvy * ny;
    const load = Math.max(0, SPRING_K * squash - SPRING_D * vn);

    let ftan = 0;
    const vt = pvx * tx + pvy * ty;
    ftan -= vt * ROLL;
    if (input.brake) ftan -= vt * BRAKE;
    if (isRear && input.throttle) {
      // No traction, no drive — you can't accelerate off a light rear wheel.
      ftan += Math.min(DRIVE, load * TRACTION);
    }

    const fxw = load * nx + ftan * tx;
    const fyw = load * ny + ftan * ty;
    fx += fxw;
    fy += fyw;
    torque += rx * fyw - ry * fxw;
  }

  const airborne = !b.rearGrounded && !b.frontGrounded;

  // Weight shift, in the air and out of it.
  b.omega -= input.lean * AIR_PITCH * (airborne ? 1 : GROUND_PITCH) * dt;

  if (airborne) {
    b.air += dt;
    b.totalAir += dt;
  } else {
    b.omega -= b.omega * Math.min(1, GROUND_PITCH_DAMP * dt);
    if (b.air > 0.28) {
      // Landed. Bank whatever went all the way round.
      b.flips += Math.floor(Math.abs(b.spin) / (Math.PI * 2));
    }
    b.air = 0;
    b.spin = 0;
  }

  // Air resistance, and the only thing actually setting a top speed.
  const speed = Math.hypot(b.vx, b.vy);
  fx -= DRAG * b.vx * speed;
  fy -= DRAG * b.vy * speed;

  b.vx += fx * dt;
  b.vy += fy * dt;
  b.omega += (torque / MOMENT) * dt;
  b.omega = Math.max(-MAX_OMEGA, Math.min(MAX_OMEGA, b.omega));

  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const dTheta = b.omega * dt;
  b.angle += dTheta;
  if (airborne) b.spin += dTheta;

  // Never let the course push you backwards off the start line.
  if (b.x < 0) { b.x = 0; b.vx = Math.max(0, b.vx); }

  // ── Off ──
  const headX = b.x - HEAD_H * Math.sin(b.angle);
  const headY = b.y + HEAD_H * Math.cos(b.angle);
  if (headY < heightAt(course, headX)) b.crashed = true;
}

/** Where the wheels are, for drawing. */
export function wheelPositions(b: BikeState): { rx: number; ry: number; fx: number; fy: number } {
  const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
  return {
    rx: b.x - (WHEELBASE / 2) * cos, ry: b.y - (WHEELBASE / 2) * sin,
    fx: b.x + (WHEELBASE / 2) * cos, fy: b.y + (WHEELBASE / 2) * sin,
  };
}
