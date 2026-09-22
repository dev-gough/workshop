import { performance } from 'node:perf_hooks';
import { pointsPath, solveHohmann, transferArcPoints, type Point } from './orbit';

const solution = solveHohmann(35_786);
const kmPerPx = solution.targetRadiusKm / 145;
const iterations = 10_000;

const fixedArc = (segments = 360): Point[] => {
  const a = solution.semiMajorKm / kmPerPx;
  const c = (solution.semiMajorKm * solution.eccentricity) / kmPerPx;
  const b = a * Math.sqrt(1 - solution.eccentricity ** 2);
  return Array.from({ length: segments + 1 }, (_, index) => {
    const theta = Math.PI - (index / segments) * Math.PI;
    return { x: 270 + c + a * Math.cos(theta), y: 174 - b * Math.sin(theta) };
  });
};

const measure = (make: () => Point[]) => {
  const start = performance.now();
  let bytes = 0;
  let vertices = 0;
  for (let i = 0; i < iterations; i++) {
    const points = make();
    vertices += points.length;
    bytes += pointsPath(points).length;
  }
  return { ms: performance.now() - start, bytes, vertices };
};

// Warm both paths before measuring to reduce JIT noise.
for (let i = 0; i < 500; i++) {
  fixedArc();
  transferArcPoints(solution, 270, 174, kmPerPx);
}

const fixed = measure(fixedArc);
const adaptive = measure(() => transferArcPoints(solution, 270, 174, kmPerPx));

console.log(
  JSON.stringify(
    {
      iterations,
      fixed: {
        ms: Number(fixed.ms.toFixed(1)),
        verticesPerPath: fixed.vertices / iterations,
        bytesPerPath: fixed.bytes / iterations,
      },
      adaptive: {
        ms: Number(adaptive.ms.toFixed(1)),
        verticesPerPath: adaptive.vertices / iterations,
        bytesPerPath: adaptive.bytes / iterations,
      },
      reduction: {
        verticesPct: Number((100 * (1 - adaptive.vertices / fixed.vertices)).toFixed(1)),
        pathBytesPct: Number((100 * (1 - adaptive.bytes / fixed.bytes)).toFixed(1)),
      },
    },
    null,
    2
  )
);
