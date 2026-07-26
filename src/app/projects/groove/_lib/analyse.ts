'use client';

import type { Onset, TrackFeatures } from '@/lib/groove';

/**
 * Pulling the shape of a song out of the audio.
 *
 * This has to happen up front, before a single metre of road is drawn — the
 * live analyser the visualizers use only knows the present, and a track needs
 * to know its own future. So the file is fetched, decoded, and swept once;
 * everything after that is geometry.
 *
 * Results are cached server-side (see /api/groove/track) keyed on the song,
 * NOT on the generator version: these are measurements of the audio, and they
 * stay true however often we change our minds about what makes a good track.
 */

const TARGET_RATE = 22050;   // plenty for onsets; halves the work vs 44.1k
const FFT_SIZE = 1024;
const HOP = 512;
const MAX_SECONDS = 12 * 60;

// ── FFT ──────────────────────────────────────────────────────────

/** In-place iterative radix-2 Cooley–Tukey. `re`/`im` must be a power of two. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k], aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe; im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe; im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ── Statistics ───────────────────────────────────────────────────

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Stretch a series onto 0..1 against its OWN 5th/95th percentiles rather than
 * absolute levels. A delicate acoustic record and a brickwalled master should
 * both produce a track with hills in it; normalising against dBFS would give
 * the first one a flat road and the second one a wall.
 */
function normalise(values: Float32Array): number[] {
  const sorted = Float32Array.from(values).sort();
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  const span = hi - lo;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = span > 1e-9 ? Math.min(1, Math.max(0, (values[i] - lo) / span)) : 0.5;
    out[i] = Math.round(out[i] * 1000) / 1000;  // keep the cached JSON small
  }
  return out;
}

// ── Analysis ─────────────────────────────────────────────────────

export interface AnalyseProgress {
  stage: 'fetching' | 'decoding' | 'analysing';
  /** 0..1 within the current stage, or -1 when indeterminate. */
  progress: number;
}

export async function analyseSong(
  streamUrl: string,
  onProgress?: (p: AnalyseProgress) => void,
): Promise<TrackFeatures> {
  onProgress?.({ stage: 'fetching', progress: -1 });
  const res = await fetch(streamUrl);
  if (!res.ok) throw new Error(`Could not fetch audio (${res.status})`);
  const bytes = await res.arrayBuffer();

  onProgress?.({ stage: 'decoding', progress: -1 });
  // decodeAudioData resamples to the context's rate, so decoding *into* a
  // 22.05k offline context does the downsampling for us.
  const AC: typeof OfflineAudioContext =
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new AC(1, 1, TARGET_RATE);
  const buffer = await ctx.decodeAudioData(bytes);

  // Downmix: a track is about the whole song, not one side of the stereo field.
  const frames = Math.min(buffer.length, MAX_SECONDS * TARGET_RATE);
  const mono = new Float32Array(frames);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }

  const duration = frames / TARGET_RATE;
  const frameRate = TARGET_RATE / HOP;
  const frameCount = Math.max(1, Math.floor((frames - FFT_SIZE) / HOP));

  // Band edges in bins. Bin width is TARGET_RATE / FFT_SIZE ≈ 21.5 Hz.
  const binHz = TARGET_RATE / FFT_SIZE;
  const bassEnd = Math.max(2, Math.round(200 / binHz));
  const midEnd = Math.max(bassEnd + 1, Math.round(2000 / binHz));
  const nyquistBin = FFT_SIZE / 2;

  const hann = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));

  const bassSeries = new Float32Array(frameCount);
  const midSeries = new Float32Array(frameCount);
  const trebleSeries = new Float32Array(frameCount);
  const loudSeries = new Float32Array(frameCount);
  const flux: Float32Array[] = [new Float32Array(frameCount), new Float32Array(frameCount), new Float32Array(frameCount)];

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const mag = new Float32Array(nyquistBin);
  const prevMag = new Float32Array(nyquistBin);

  onProgress?.({ stage: 'analysing', progress: 0 });
  for (let f = 0; f < frameCount; f++) {
    const off = f * HOP;
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = mono[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);

    let bass = 0, mid = 0, treble = 0, loud = 0;
    let fluxLo = 0, fluxMid = 0, fluxHi = 0;
    for (let k = 1; k < nyquistBin; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      loud += m;
      // Spectral flux — only rises count. A note starting is energy
      // appearing; energy fading away is not an onset.
      const d = m - prevMag[k];
      const rise = d > 0 ? d : 0;
      if (k < bassEnd) { bass += m; fluxLo += rise; }
      else if (k < midEnd) { mid += m; fluxMid += rise; }
      else { treble += m; fluxHi += rise; }
    }
    prevMag.set(mag);

    bassSeries[f] = bass / bassEnd;
    midSeries[f] = mid / (midEnd - bassEnd);
    trebleSeries[f] = treble / (nyquistBin - midEnd);
    loudSeries[f] = loud / nyquistBin;
    flux[0][f] = fluxLo; flux[1][f] = fluxMid; flux[2][f] = fluxHi;

    // Yield periodically: a four-minute song is a couple of seconds of solid
    // maths, and freezing the tab through it would be worse than the wait.
    if ((f & 255) === 0) {
      onProgress?.({ stage: 'analysing', progress: f / frameCount });
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const onsets = pickOnsets(flux, frameRate);

  // Rideability: how much of this record actually has something to ride.
  // Events per second against a comfortable target, tempered by how much of
  // the song sits above its own noise floor.
  const eventsPerSec = onsets.length / Math.max(1, duration);
  const loudNorm = normalise(loudSeries);
  const alive = loudNorm.filter(v => v > 0.35).length / Math.max(1, loudNorm.length);
  const rideability = Math.round(
    Math.min(1, Math.min(1, eventsPerSec / 3.2) * 0.65 + alive * 0.35) * 1000
  ) / 1000;

  return {
    frameRate,
    duration,
    intensity: loudNorm,
    bass: normalise(bassSeries),
    mid: normalise(midSeries),
    treble: normalise(trebleSeries),
    onsets,
    rideability,
  };
}

/**
 * Peak-pick each band's flux against a LOCAL mean rather than a fixed level.
 * A fixed threshold finds nothing in a quiet passage and everything in a loud
 * one, which is exactly backwards: a snare in a breakdown is more of an event
 * than the same snare buried in a wall of guitars.
 */
function pickOnsets(flux: Float32Array[], frameRate: number): Onset[] {
  const out: Onset[] = [];
  const windowFrames = Math.max(4, Math.round(frameRate * 0.35));

  for (let band = 0; band < 3; band++) {
    const f = flux[band];
    const n = f.length;
    if (n === 0) continue;

    const sorted = Float32Array.from(f).sort();
    const ceiling = percentile(sorted, 0.97) || 1;

    for (let i = 0; i < n; i++) {
      // Mean of the window either side of this frame.
      const lo = Math.max(0, i - windowFrames);
      const hi = Math.min(n - 1, i + windowFrames);
      let local = 0;
      for (let j = lo; j <= hi; j++) local += f[j];
      local /= hi - lo + 1;

      const isPeak =
        f[i] > local * 1.55 &&
        f[i] > ceiling * 0.12 &&
        f[i] >= f[Math.max(0, i - 1)] &&
        f[i] >= f[Math.min(n - 1, i + 1)] &&
        f[i] >= f[Math.max(0, i - 2)] &&
        f[i] >= f[Math.min(n - 1, i + 2)];

      if (isPeak) {
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
