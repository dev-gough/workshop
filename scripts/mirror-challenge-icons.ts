/**
 * Mirror the LoL challenge tier tokens from CommunityDragon into `public/`.
 *
 *   npx tsx scripts/mirror-challenge-icons.ts [--force] [--concurrency N]
 *
 * ~3,476 PNGs / ~93 MB, written to public/lol/challenge-tokens/{id}/{tier}.png
 * and gitignored. Idempotent: existing files are skipped unless --force, so
 * re-running after a patch only pulls what's new.
 *
 * Two things worth knowing about the upstream:
 *  - Paths are case-sensitive and must be fully lowercase. The widely-cited
 *    `.../tokens/GOLD.png` form 404s; `.../tokens/gold.png` is correct.
 *  - The `game/assets/...` tree carries the same artwork as the
 *    `plugins/rcp-be-lol-game-data/...` tree at ~2/3 the bytes (93 MB vs 142 MB),
 *    so we pull from `game/`.
 *  - ~81 (challenge, tier) pairs are dead upstream and 404 on every mirror.
 *    Those are recorded and left absent; the UI falls back to a placeholder.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MANIFEST =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/challenges.json';
const TOKEN_URL = (id: string, tier: string) =>
  `https://raw.communitydragon.org/latest/game/assets/challenges/config/${id}/tokens/${tier}.png`;

// Category glyphs, crystals and chrome live in the frontend static-assets
// plugin, NOT the game asset tree — the six category challenges (ids 0-5) have
// an empty levelToIconPath and no tokens of their own.
const STATIC =
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default';

const OUT_ROOT = path.join(process.cwd(), 'public/lol/challenge-tokens');
const SHARED_ROOT = path.join(process.cwd(), 'public/lol/challenge-shared');

const TIER_SLUGS = [
  'none', 'iron', 'bronze', 'silver', 'gold',
  'platinum', 'diamond', 'master', 'grandmaster', 'challenger',
];

/**
 * Shared chrome. Filenames are inconsistent upstream and must not be
 * "tidied": the IMAGINATION category PNG ships under its old internal name
 * `innovation.png` (`imagination.png` 404s), while the matching SVG really is
 * `icon_category_imagination.svg`. Local names are normalised so callers only
 * ever deal with the canonical category slug.
 */
function sharedJobs(): Job[] {
  const jobs: Job[] = [];
  const add = (url: string, rel: string) =>
    jobs.push({ id: 'shared', tier: rel, url, dest: path.join(SHARED_ROOT, rel) });

  const catPng: Record<string, string> = {
    imagination: 'innovation', expertise: 'expertise', veterancy: 'veterancy',
    teamwork: 'teamwork', collection: 'collection', legacy: 'legacy',
  };
  for (const [slug, upstream] of Object.entries(catPng)) {
    add(`${STATIC}/challenges-shared/categories/${upstream}.png`, `categories/${slug}.png`);
    add(`${STATIC}/challenges-shared/icon_category_${slug}.svg`, `categories/${slug}.svg`);
  }

  for (const tier of TIER_SLUGS) {
    // The overall CRYSTAL gem — the only category art with per-tier variants.
    add(`${STATIC}/challenges-shared/crystal_${tier}.png`, `crystal/${tier}.png`);
    add(`${STATIC}/challenge-mini-crystal/${tier}.svg`, `crystal/mini-${tier}.svg`);
    // Fallback token art, used for nodes that have no per-challenge token.
    add(`${STATIC}/challenges-shared/icon_achievement_${tier}.png`, `token-fallback/${tier}.png`);
    add(`${STATIC}/challenges-shared/challenge-card-background-${tier}.png`, `card-bg/${tier}.png`);
  }

  for (const f of ['crystal-ring.png', 'crystal-radial-fill.png', 'crystal-container-bg.png', 'icon-capstone.svg']) {
    add(`${STATIC}/challenges-shared/${f}`, `chrome/${f}`);
  }
  return jobs;
}

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CONCURRENCY = (() => {
  const i = argv.indexOf('--concurrency');
  const n = i >= 0 ? parseInt(argv[i + 1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 16) : 6;
})();

interface Job { id: string; tier: string; dest: string; url: string }

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function buildJobs(): Promise<Job[]> {
  const res = await fetch(MANIFEST, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`manifest ${res.status} ${res.statusText}`);
  const doc = (await res.json()) as { challenges?: Record<string, { levelToIconPath?: Record<string, string> }> };
  const challenges = doc.challenges ?? {};

  const jobs: Job[] = [];
  for (const [id, entry] of Object.entries(challenges)) {
    for (const tier of Object.keys(entry.levelToIconPath ?? {})) {
      const lower = tier.toLowerCase();
      jobs.push({
        id,
        tier: lower,
        dest: path.join(OUT_ROOT, id, `${lower}.png`),
        url: TOKEN_URL(id, lower),
      });
    }
  }
  return jobs;
}

async function download(job: Job): Promise<'ok' | 'skip' | 'missing' | 'error'> {
  if (!FORCE && (await exists(job.dest))) return 'skip';
  try {
    const res = await fetch(job.url, { signal: AbortSignal.timeout(30000) });
    if (res.status === 404) return 'missing';
    if (!res.ok) return 'error';
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(job.dest), { recursive: true });
    // Write-then-rename so an interrupted run never leaves a truncated PNG that
    // a later idempotent run would happily skip over.
    const tmp = `${job.dest}.part`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, job.dest);
    return 'ok';
  } catch {
    return 'error';
  }
}

async function main() {
  console.log(`Mirroring challenge art -> ${OUT_ROOT} + ${SHARED_ROOT}`);
  const tokenJobs = await buildJobs();
  const shared = sharedJobs();
  const jobs = [...tokenJobs, ...shared];
  console.log(
    `  ${tokenJobs.length} (challenge, tier) tokens + ${shared.length} shared assets; ` +
    `concurrency ${CONCURRENCY}${FORCE ? ' (force)' : ''}`
  );

  const tally = { ok: 0, skip: 0, missing: 0, error: 0 };
  const missing: string[] = [];
  const failed: Job[] = [];
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const r = await download(job);
      tally[r]++;
      if (r === 'missing') missing.push(`${job.id}/${job.tier}`);
      if (r === 'error') failed.push(job);
      if (++done % 250 === 0) console.log(`  ${done}/${jobs.length} …`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // One retry pass for transient failures; genuine 404s are already classified.
  if (failed.length) {
    console.log(`  retrying ${failed.length} transient failure(s)…`);
    for (const job of failed) {
      const r = await download(job);
      tally[r]++; tally.error--;
      if (r === 'missing') missing.push(`${job.id}/${job.tier}`);
    }
  }

  await fs.mkdir(OUT_ROOT, { recursive: true });
  await fs.writeFile(
    path.join(OUT_ROOT, 'missing.json'),
    JSON.stringify({ count: missing.length, pairs: missing.sort() }, null, 2) + '\n'
  );

  console.log(
    `\nDone. downloaded=${tally.ok} skipped=${tally.skip} missing-upstream=${tally.missing} failed=${tally.error}`
  );
  if (tally.missing) console.log(`  ${tally.missing} dead upstream path(s) recorded in missing.json`);
  if (tally.error) {
    console.error(`  ${tally.error} file(s) still failing after retry — re-run to pick them up`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Mirror failed:', err);
  process.exit(1);
});
