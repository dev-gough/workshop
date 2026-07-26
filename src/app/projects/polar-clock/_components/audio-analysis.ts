// ── Listening room ──────────────────────────────────────────────
// Shared plumbing for the Sound shelf. Every audio background wants the
// same three things off the analyser — a band split, a perceptually
// spaced spectrum, and a kick — so they're derived once here instead of
// six slightly-different times.

export interface Bands {
  /** 0..1, smoothed. */
  bass: number;
  mid: number;
  treble: number;
  /** Mean of the whole spectrum, 0..1. */
  energy: number;
  /** True on the frame a transient in the low end crosses the running mean. */
  kick: boolean;
  /** False when nothing is playing — visuals fall back to ambient motion. */
  live: boolean;
}

const SILENT: Bands = { bass: 0, mid: 0, treble: 0, energy: 0, kick: false, live: false };

/**
 * Build a stateful reader. Call the returned function once per frame; it
 * owns the smoothing and kick history, so each background gets its own
 * instance rather than sharing (and fighting over) one.
 */
export function makeBandReader(getFrequencyData: () => Uint8Array | null) {
  let bass = 0, mid = 0, treble = 0, energy = 0;
  let bassAvg = 0;
  let kickCooldown = 0;

  return (attack = 0.35, release = 0.12): Bands => {
    const data = getFrequencyData();
    if (!data || data.length === 0) return SILENT;

    const len = data.length;
    // Bins are linear in Hz, so the bottom eighth carries the whole low end.
    const bassEnd = Math.max(1, Math.floor(len * 0.06));
    const midEnd = Math.max(bassEnd + 1, Math.floor(len * 0.34));

    let b = 0, m = 0, t = 0, all = 0;
    for (let i = 0; i < len; i++) {
      const v = data[i] / 255;
      all += v;
      if (i < bassEnd) b += v;
      else if (i < midEnd) m += v;
      else t += v;
    }
    b /= bassEnd;
    m /= midEnd - bassEnd;
    t /= len - midEnd;
    all /= len;

    // Asymmetric smoothing: snap up on a hit, ease back down.
    const ease = (cur: number, next: number) =>
      cur + (next - cur) * (next > cur ? attack : release);
    bass = ease(bass, b);
    mid = ease(mid, m);
    treble = ease(treble, t);
    energy = ease(energy, all);

    // A kick is the low end jumping well clear of its own running mean.
    bassAvg += (b - bassAvg) * 0.04;
    let kick = false;
    if (kickCooldown > 0) kickCooldown--;
    else if (b > bassAvg * 1.45 && b > 0.16) { kick = true; kickCooldown = 8; }

    return { bass, mid, treble, energy, kick, live: all > 0.002 };
  };
}

/**
 * Resample a linear FFT into `n` perceptually spaced buckets — a linear
 * spectrum wastes three quarters of its width on treble nobody can see
 * moving. Each bucket is the max of the bins it covers so narrow peaks
 * survive the downsample.
 */
export function sampleSpectrum(data: Uint8Array | null, n: number, out?: Float32Array): Float32Array {
  const dest = out && out.length === n ? out : new Float32Array(n);
  if (!data || data.length === 0) { dest.fill(0); return dest; }
  const len = data.length;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const end = Math.min(len, Math.max(prev + 1, Math.floor(Math.pow((i + 1) / n, 1.9) * len)));
    let peak = 0;
    for (let j = prev; j < end; j++) if (data[j] > peak) peak = data[j];
    dest[i] = peak / 255;
    prev = end;
  }
  return dest;
}
