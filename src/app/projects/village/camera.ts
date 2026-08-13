/**
 * Addressable camera: `?cam=x,y,z&look=yaw,pitch`.
 *
 * A voxel scene is a bad thing to navigate blind. Without this, "look at the
 * builder's hut" means flying there by hand every time — fine once, miserable
 * as the way to reproduce a bug, and impossible from a script, because headless
 * Chromium delivers no pointer-lock movement deltas and so cannot be made to
 * look up or down at all.
 *
 * **Angles are in Minecraft's convention, not three.js's**: yaw 0 faces +Z
 * (south) and increases clockwise seen from above; pitch 0 is the horizon and
 * positive looks *down*. That is what the game's own F3 screen shows, and more
 * usefully it is exactly what the mod sends for each citizen — so a yaw and
 * pitch lifted straight out of an event frame can be pasted into this URL. The
 * phase 4 POV camera is the same conversion pointed at an entity instead of a
 * query string.
 */
import type * as ThreeTypes from 'three';

const DEG = Math.PI / 180;

export interface CameraView {
  x: number;
  y: number;
  z: number;
  /** Degrees, Minecraft convention: 0 is +Z, increasing clockwise from above. */
  yaw: number;
  /** Degrees, Minecraft convention: 0 is the horizon, positive looks down. */
  pitch: number;
}

/**
 * Read a camera view out of a query string.
 *
 * `look` is optional — a position with no angles is a common thing to want, and
 * defaults to due north (yaw 180) and level, which is the direction the viewer
 * has always opened facing.
 *
 * @param search a `location.search` value.
 * @return the view, or null if `cam` is absent or unparseable.
 */
export function parseCameraQuery(search: string): CameraView | null {
  const params = new URLSearchParams(search);
  const position = numbers(params.get('cam'), 3);
  if (!position) {
    return null;
  }
  const look = numbers(params.get('look'), 2) ?? [180, 0];
  return { x: position[0], y: position[1], z: position[2], yaw: look[0], pitch: look[1] };
}

function numbers(raw: string | null, count: number): number[] | null {
  if (!raw) {
    return null;
  }
  const parts = raw.split(',').map((p) => Number(p.trim()));
  return parts.length === count && parts.every(Number.isFinite) ? parts : null;
}

/**
 * Point a camera at a view.
 *
 * Safe to call while PointerLockControls is attached: the controls read the
 * camera's own quaternion at the start of every mouse move rather than keeping
 * their own copy of the orientation, so there is no second source of truth to
 * fall out of sync.
 */
export function applyCameraView(camera: ThreeTypes.Camera, view: CameraView): void {
  camera.position.set(view.x, view.y, view.z);
  const cosPitch = Math.cos(view.pitch * DEG);
  camera.lookAt(
    view.x - cosPitch * Math.sin(view.yaw * DEG),
    view.y - Math.sin(view.pitch * DEG),
    view.z + cosPitch * Math.cos(view.yaw * DEG),
  );
}

/**
 * The inverse: where a camera currently is and which way it is looking.
 *
 * @param camera the camera.
 * @param scratch a vector to reuse, so this is safe to call in a render loop.
 */
export function readCameraView(camera: ThreeTypes.Camera, scratch: ThreeTypes.Vector3): CameraView {
  const direction = camera.getWorldDirection(scratch);
  const pitch = -Math.asin(Math.max(-1, Math.min(1, direction.y))) / DEG;
  // atan2(-x, z) inverts the lookAt above; the modulo keeps yaw in [0, 360) so a
  // copied link never carries a negative angle that reads as a typo.
  const yaw = (Math.atan2(-direction.x, direction.z) / DEG + 360) % 360;
  return { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw, pitch };
}

/** One decimal everywhere: finer than anyone can aim, and keeps the link short. */
function round(value: number): string {
  return value.toFixed(1);
}

/** The query string for a view, without the leading `?`. */
export function cameraQuery(view: CameraView): string {
  return (
    `cam=${round(view.x)},${round(view.y)},${round(view.z)}` +
    `&look=${round(view.yaw)},${round(view.pitch)}`
  );
}

/**
 * A full, pasteable URL for a view.
 *
 * The whole URL rather than just the coordinates, because the useful thing to
 * hand someone — or to drop into a screenshot script — is a link that opens
 * here, not two triples they have to assemble themselves.
 */
export function cameraLink(view: CameraView): string {
  const url = new URL(window.location.href);
  url.search = cameraQuery(view);
  url.hash = '';
  return url.toString();
}
