/**
 * Headless course verification for RM 16.
 *
 * Rides every analysed song with a crude autopilot and reports whether the
 * course can actually be completed, how close to par, and where it crashes.
 * Physics constants are hard to tune by playing — you can't tell a bad course
 * from bad handling by feel — so this separates the two: if the autopilot
 * can't get round, the course is at fault, and if it gets round far off par,
 * the handling is.
 *
 *   npx tsx scripts/groove-sim.ts            # every analysed song
 *   npx tsx scripts/groove-sim.ts --limit 5
 *   npx tsx scripts/groove-sim.ts --verbose  # per-crash detail
 */

import { makePool } from '../src/lib/db';
import { generateCourse, heightAt, slopeAt, type TrackFeatures } from '../src/lib/groove';
import { spawnBike, stepBike, PHYSICS_DT, type BikeState } from '../src/lib/groove-physics';

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf('--limit') + 1]) || 0;
const verbose = args.includes('--verbose');

/**
 * A rider with no foresight: pin the throttle, and lean against whatever the
 * ground is doing. Deliberately unskilled — it's a floor, not a benchmark. If
 * THIS can get round, a person can get round faster.
 */
function autopilot(course: ReturnType<typeof generateCourse>, b: BikeState) {
  const airborne = !b.rearGrounded && !b.frontGrounded;
  let lean = 0;
  if (airborne) {
    // Try to land wheels-down and matched to the slope ahead.
    const target = Math.atan(slopeAt(course, b.x + b.vx * 0.25));
    const err = b.angle - target;
    lean = Math.max(-1, Math.min(1, err * 2.4 + b.omega * 0.35));
  } else {
    // On the ground, hold the bike ALONG the slope, not level with the
    // horizon. Holding it level on a climb lifts the rear wheel off its own
    // drive, which is a very slow way to discover you can't climb anything.
    const target = Math.atan(slopeAt(course, b.x));
    lean = Math.max(-1, Math.min(1, (b.angle - target) * 2.6 + b.omega * 0.6));
  }
  return { throttle: true, brake: false, lean };
}

interface Result {
  song: string;
  finished: boolean;
  seconds: number;
  par: number;
  crashes: number;
  reached: number;
  length: number;
  worstX: number;
  air: number;
  flips: number;
}

function ride(course: ReturnType<typeof generateCourse>, song: string): Result {
  const checkpoints = [0, ...course.checkpoints];
  let cp = 0;
  let bike = spawnBike(course, 0);
  let t = 0;
  let crashes = 0;
  let furthest = 0;
  let worstX = 0;
  let stuckFor = 0;
  const MAX_SECONDS = course.duration * 3 + 60;

  while (t < MAX_SECONDS) {
    stepBike(course, bike, autopilot(course, bike));
    t += PHYSICS_DT;

    if (bike.x > furthest) { furthest = bike.x; stuckFor = 0; }
    else stuckFor += PHYSICS_DT;

    while (cp + 1 < checkpoints.length && bike.x > checkpoints[cp + 1]) cp++;

    if (bike.x >= course.length) break;

    // A crash, or simply not getting anywhere for six seconds, both mean
    // "put it back at the last marker and try again".
    if (bike.crashed || stuckFor > 6) {
      crashes++;
      if (crashes > 400) break;
      worstX = Math.max(worstX, bike.x);
      if (verbose && crashes < 12) {
        console.log(`    crash ${crashes} at x=${Math.round(bike.x)} (${(bike.x / course.length * 100).toFixed(0)}%) angle=${bike.angle.toFixed(2)}`);
      }
      bike = spawnBike(course, checkpoints[cp]);
      furthest = checkpoints[cp];
      stuckFor = 0;
      t += 1.5;   // the restart penalty
    }
  }

  return {
    air: bike.totalAir,
    flips: bike.flips,
    song,
    finished: bike.x >= course.length,
    seconds: t,
    par: course.duration,
    crashes,
    reached: Math.min(bike.x, course.length),
    length: course.length,
    worstX,
  };
}

async function main() {
  const pool = makePool('workshop');
  const { rows } = await pool.query<{
    artist: string; album: string; song: string;
    frame_rate: number; duration: number;
    intensity: number[]; bass: number[]; mid: number[]; treble: number[];
    onsets: TrackFeatures['onsets']; rideability: number;
  }>(
    `SELECT artist, album, song, frame_rate, duration, intensity, bass, mid, treble, onsets, rideability
       FROM groove_tracks ORDER BY artist, album, song ${limit ? `LIMIT ${limit}` : ''}`
  );

  if (rows.length === 0) {
    console.log('No analysed songs yet — ride one in the browser first so there is something to check.');
    await pool.end();
    return;
  }

  const results: Result[] = [];
  for (const r of rows) {
    const features: TrackFeatures = {
      frameRate: r.frame_rate, duration: r.duration,
      intensity: r.intensity, bass: r.bass, mid: r.mid, treble: r.treble,
      onsets: r.onsets, rideability: r.rideability,
    };
    const course = generateCourse(features);

    // Course shape, before anyone rides it.
    let steepest = 0;
    for (let x = 0; x < course.length; x += course.step) {
      steepest = Math.max(steepest, Math.abs(slopeAt(course, x)));
    }
    const lo = Math.min(...course.heights), hi = Math.max(...course.heights);

    console.log(`\n${r.artist} — ${r.song}`);
    console.log(`  ${(course.length / 1000).toFixed(1)}k units · par ${r.duration.toFixed(0)}s · ` +
      `${course.kickers.length} jumps · ${course.rocks.length} rocks · ` +
      `relief ${Math.round(hi - lo)} · steepest ${(Math.atan(steepest) * 180 / Math.PI).toFixed(0)}°`);

    const res = ride(course, r.song);
    results.push(res);
    const pctDone = (res.reached / res.length) * 100;
    console.log(
      `  autopilot: ${res.finished ? 'FINISHED' : `stalled at ${pctDone.toFixed(0)}%`} ` +
      `in ${res.seconds.toFixed(0)}s (par ${res.par.toFixed(0)}s, ratio ${(res.par / res.seconds).toFixed(2)}) ` +
      `· ${res.crashes} crashes · ${res.air.toFixed(1)}s air · ${res.flips} flips`
    );
    void heightAt;
  }

  const finished = results.filter(r => r.finished);
  console.log(`\n── ${finished.length}/${results.length} completable by autopilot ──`);
  if (finished.length) {
    const ratios = finished.map(r => r.par / r.seconds).sort((a, b) => a - b);
    const crashes = finished.map(r => r.crashes).sort((a, b) => a - b);
    console.log(`   par ratio  median ${ratios[ratios.length >> 1].toFixed(2)} ` +
      `(${ratios[0].toFixed(2)}–${ratios[ratios.length - 1].toFixed(2)})`);
    console.log(`   crashes    median ${crashes[crashes.length >> 1]} ` +
      `(${crashes[0]}–${crashes[crashes.length - 1]})`);
    console.log('   A skilled rider should land comfortably above the autopilot;');
    console.log('   a median well under ~0.75 means the course or the bike is too slow.');
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
