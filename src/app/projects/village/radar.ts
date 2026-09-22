import type { CameraView } from './camera';
import type { VillageCitizenFrame } from '@/lib/village';

export interface RadarBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface RadarChunk {
  x: number;
  z: number;
}

export interface RadarPoint {
  x: number;
  y: number;
}

export interface RadarTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  project(x: number, z: number): RadarPoint;
  unproject(x: number, y: number): { x: number; z: number };
}

/**
 * A reversible, aspect-preserving world-to-radar transform. Keeping this pure
 * makes click navigation land at exactly the point represented by the pixels.
 */
export function createRadarTransform(
  bounds: RadarBounds,
  width: number,
  height: number,
  padding: number,
): RadarTransform {
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
  const worldDepth = Math.max(1, bounds.maxZ - bounds.minZ);
  const scale = Math.min(
    Math.max(1, width - padding * 2) / worldWidth,
    Math.max(1, height - padding * 2) / worldDepth,
  );
  const offsetX = (width - worldWidth * scale) / 2;
  const offsetY = (height - worldDepth * scale) / 2;

  return {
    scale,
    offsetX,
    offsetY,
    project: (x, z) => ({
      x: offsetX + (x - bounds.minX) * scale,
      y: offsetY + (z - bounds.minZ) * scale,
    }),
    unproject: (x, y) => ({
      x: bounds.minX + (x - offsetX) / scale,
      z: bounds.minZ + (y - offsetY) / scale,
    }),
  };
}

interface DrawRadarInput {
  bounds: RadarBounds;
  chunks: RadarChunk[];
  citizens: VillageCitizenFrame[];
  camera: CameraView;
  following: number | null;
}

/** Draw one live radar sample. Called at stream frequency, never at render frequency. */
export function drawSettlementRadar(
  context: CanvasRenderingContext2D,
  input: DrawRadarInput,
): void {
  const { width, height } = context.canvas;
  const transform = createRadarTransform(input.bounds, width, height, 18);

  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgba(10, 12, 16, 0.82)';
  context.fillRect(0, 0, width, height);

  context.fillStyle = 'rgba(52, 211, 153, 0.12)';
  context.strokeStyle = 'rgba(163, 163, 163, 0.20)';
  context.lineWidth = 1;
  for (const chunk of input.chunks) {
    const corner = transform.project(chunk.x * 16, chunk.z * 16);
    const size = 16 * transform.scale;
    context.fillRect(corner.x, corner.y, size, size);
    context.strokeRect(corner.x, corner.y, size, size);
  }

  for (const citizen of input.citizens) {
    const point = transform.project(citizen.x, citizen.z);
    context.beginPath();
    context.arc(point.x, point.y, citizen.id === input.following ? 5 : 3.5, 0, Math.PI * 2);
    context.fillStyle =
      citizen.id === input.following
        ? '#fbbf24'
        : (citizen.stuck ?? 0) > 0
          ? '#f87171'
          : citizen.asleep
            ? '#a78bfa'
            : '#6ee7b7';
    context.fill();
  }

  // Minecraft yaw 0 points +Z. Radar Z runs downward, matching a north-up map.
  const camera = transform.project(input.camera.x, input.camera.z);
  const yaw = (input.camera.yaw * Math.PI) / 180;
  const dx = -Math.sin(yaw);
  const dy = Math.cos(yaw);
  const sideX = -dy;
  const sideY = dx;
  context.beginPath();
  context.moveTo(camera.x + dx * 9, camera.y + dy * 9);
  context.lineTo(camera.x - dx * 5 + sideX * 5, camera.y - dy * 5 + sideY * 5);
  context.lineTo(camera.x - dx * 5 - sideX * 5, camera.y - dy * 5 - sideY * 5);
  context.closePath();
  context.fillStyle = '#ffffff';
  context.fill();
  context.strokeStyle = 'rgba(10, 12, 16, 0.9)';
  context.stroke();
}
