export const IMAGE_SIZE = 100;

export type EvolutionQuality = 'draft' | 'balanced' | 'fine';

export interface Polygon {
  vertices: [number, number][];
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Candidate {
  polygons: Polygon[];
  fitness: number;
}

export const QUALITY_OPTIONS: ReadonlyArray<{
  value: EvolutionQuality;
  label: string;
  size: number;
}> = [
  { value: 'draft', label: 'Draft', size: 32 },
  { value: 'balanced', label: 'Balanced', size: 64 },
  { value: 'fine', label: 'Fine', size: IMAGE_SIZE },
];

export function evaluationSize(quality: EvolutionQuality): number {
  return QUALITY_OPTIONS.find(option => option.value === quality)?.size ?? IMAGE_SIZE;
}

export function fitnessWorkRatio(quality: EvolutionQuality): number {
  const size = evaluationSize(quality);
  return (size * size) / (IMAGE_SIZE * IMAGE_SIZE);
}

export function resizeRgbaNearest(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  if (
    source.length !== sourceWidth * sourceHeight * 4 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new RangeError('Invalid RGBA dimensions');
  }

  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return new Uint8ClampedArray(source);
  }

  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / targetHeight));
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / targetWidth));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      output[targetOffset] = source[sourceOffset];
      output[targetOffset + 1] = source[sourceOffset + 1];
      output[targetOffset + 2] = source[sourceOffset + 2];
      output[targetOffset + 3] = source[sourceOffset + 3];
    }
  }
  return output;
}

export function normalizedRgbError(
  candidate: Uint8ClampedArray,
  target: Uint8ClampedArray,
): number {
  if (candidate.length !== target.length || candidate.length % 4 !== 0) {
    throw new RangeError('RGBA buffers must have matching lengths');
  }

  let difference = 0;
  for (let i = 0; i < candidate.length; i += 4) {
    const dr = candidate[i] - target[i];
    const dg = candidate[i + 1] - target[i + 1];
    const db = candidate[i + 2] - target[i + 2];
    difference += dr * dr + dg * dg + db * db;
  }
  return difference / ((candidate.length / 4) * 3 * 255 * 255);
}
