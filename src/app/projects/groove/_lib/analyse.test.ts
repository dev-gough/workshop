import assert from 'node:assert/strict';
import test from 'node:test';
import { pickOnsets } from './analyse';
import type { Onset } from '@/lib/groove';

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/** The original window-scanning implementation, retained as a parity oracle. */
function pickOnsetsBrute(flux: Float32Array[], frameRate: number): Onset[] {
  const out: Onset[] = [];
  const windowFrames = Math.max(4, Math.round(frameRate * 0.35));

  for (let band = 0; band < 3; band++) {
    const f = flux[band];
    if (f.length === 0) continue;
    const ceiling = percentile(Float32Array.from(f).sort(), 0.97) || 1;

    for (let i = 0; i < f.length; i++) {
      const lo = Math.max(0, i - windowFrames);
      const hi = Math.min(f.length - 1, i + windowFrames);
      let local = 0;
      for (let j = lo; j <= hi; j++) local += f[j];
      local /= hi - lo + 1;

      if (
        f[i] > local * 1.55
        && f[i] > ceiling * 0.12
        && f[i] >= f[Math.max(0, i - 1)]
        && f[i] >= f[Math.min(f.length - 1, i + 1)]
        && f[i] >= f[Math.max(0, i - 2)]
        && f[i] >= f[Math.min(f.length - 1, i + 2)]
      ) {
        out.push({
          t: Math.round((i / frameRate) * 1000) / 1000,
          band: band as 0 | 1 | 2,
          strength: Math.round(Math.min(1, f[i] / ceiling) * 1000) / 1000,
        });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

test('prefix-sum onset picker preserves window-scan results', () => {
  let seed = 0x16c0ffee;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const flux = Array.from({ length: 3 }, (_, band) => {
    const values = new Float32Array(4096);
    for (let i = 0; i < values.length; i++) {
      values[i] = random() * 0.18 + (i % (43 + band * 11) === 0 ? 1 + random() : 0);
    }
    return values;
  });

  assert.deepEqual(pickOnsets(flux, 22050 / 512), pickOnsetsBrute(flux, 22050 / 512));
});

test('onset picker handles empty bands', () => {
  assert.deepEqual(
    pickOnsets([new Float32Array(), new Float32Array(), new Float32Array()], 60),
    [],
  );
});
