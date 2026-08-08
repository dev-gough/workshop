/**
 * Import a Maps by Jeff `.tpkx` tile package as a park's paper chart.
 *
 *   npm run import-jeff-tiles -- --park temagami --tpkx ~/temagami.tpkx
 *
 * Also accepts the storefront's outer zip (the >2GB "all formats" download) —
 * it finds the .tpkx inside. Extracts `tile/` + `root.json` into
 * `.cache/paddle/<park>/jeff/`, where the tile API serves bundles directly.
 * The parks API starts advertising the chart on the next request.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PARKS } from '../src/lib/paddle/parks';
import { chartTileDir } from '../src/lib/paddle/jefftiles';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const park = arg('--park');
const src = arg('--tpkx');
if (!park || !PARKS[park] || !src) {
  console.error('usage: npm run import-jeff-tiles -- --park <slug> --tpkx <file.tpkx|download.zip>');
  console.error(`parks: ${Object.keys(PARKS).join(', ')}`);
  process.exit(1);
}

let tpkx = path.resolve(src.replace(/^~(?=\/)/, os.homedir()));
if (!existsSync(tpkx)) {
  console.error(`not found: ${tpkx}`);
  process.exit(1);
}

const jeffDir = path.dirname(chartTileDir(park));
mkdirSync(jeffDir, { recursive: true });

// Outer storefront zip? Pull the .tpkx out of it first.
if (!tpkx.endsWith('.tpkx')) {
  const listing = execFileSync('unzip', ['-Z1', tpkx], { encoding: 'utf8' });
  const inner = listing.split('\n').find((l) => l.endsWith('.tpkx'));
  if (!inner) {
    console.error('no .tpkx found inside that zip');
    process.exit(1);
  }
  console.log(`extracting ${inner} …`);
  execFileSync('unzip', ['-o', '-j', tpkx, inner, '-d', jeffDir], { stdio: 'inherit' });
  tpkx = path.join(jeffDir, path.basename(inner));
}

console.log(`unpacking tile bundles into ${jeffDir} …`);
rmSync(chartTileDir(park), { recursive: true, force: true });
execFileSync('unzip', ['-o', tpkx, 'tile/*', 'root.json', '-d', jeffDir], { stdio: 'inherit' });
if (tpkx.startsWith(jeffDir)) rmSync(tpkx); // drop the intermediate copy

console.log(`done — ${park}'s chart is live (the parks API advertises it automatically).`);
