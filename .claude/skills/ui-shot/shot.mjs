#!/usr/bin/env node
// UI screenshot helper for devys-workshop — used by the /ui-shot skill.
//
// Writes PNGs to a fixed directory (/tmp/workshop-ui-shots) and prints the
// saved paths, one per line, so they can be opened with the Read tool.
// Cleanup is `--clean`, implemented with fs.unlink on *.png files directly
// inside that fixed directory — no `rm`, no shell, no path arguments.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS_DIR = '/tmp/workshop-ui-shots';
const DEFAULT_BASE = 'http://localhost:3000';

function usage(code = 0) {
  console.log(`usage: node shot.mjs <path-or-url> [flags]
       node shot.mjs --clean

  <path-or-url>      "/" or "/projects/soulseek" (resolved against --base) or a full URL

  --base <url>       origin to resolve paths against (default ${DEFAULT_BASE})
  --out <name>       output basename (default derived from path, "-dark" appended in dark mode)
  --dark             dark mode (theme cookie + prefers-color-scheme)
  --full             full-page screenshot instead of viewport
  --el <selector>    screenshot just this element
  --width/--height   viewport size (default 1280x800)
  --mobile           390x844 viewport preset
  --scale <n>        deviceScaleFactor (default 1; 2 for crisp close-ups)

  Actions (run in the order given, after page load):
  --hover <selector> hover an element
  --click <selector> click an element
  --wait <ms>        pause between/after actions

  Transition capture:
  --frames <n>       take n sequential shots (name-f01.png ...)
  --every <ms>       delay between frames (default 250)

  --settle <ms>      post-load settle time before actions (default 900)
  --admin            seed localStorage admin token from config.json (value is never printed)
  --clean            delete all .png files in ${SHOTS_DIR} (fs-based, guarded)`);
  process.exit(code);
}

// ── guarded cleanup: fixed dir, top-level *.png files only, via fs.unlink ──
function cleanShots() {
  if (!fs.existsSync(SHOTS_DIR)) {
    console.log(`nothing to clean (${SHOTS_DIR} does not exist)`);
    return;
  }
  let n = 0;
  for (const entry of fs.readdirSync(SHOTS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.png')) {
      fs.unlinkSync(path.join(SHOTS_DIR, entry.name));
      n++;
    }
  }
  console.log(`removed ${n} png(s) from ${SHOTS_DIR}`);
}

// ── arg parsing (sequential, so actions keep their order) ──
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help')) usage(argv.length === 0 ? 1 : 0);

let url = null, base = DEFAULT_BASE, out = null, dark = false, full = false,
    el = null, width = 1280, height = 800, scale = 1, frames = 1, every = 250,
    settle = 900, admin = false, clean = false;
const actions = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  switch (a) {
    case '--clean':  clean = true; break;
    case '--dark':   dark = true; break;
    case '--full':   full = true; break;
    case '--admin':  admin = true; break;
    case '--mobile': width = 390; height = 844; break;
    case '--base':   base = argv[++i]; break;
    case '--out':    out = argv[++i]; break;
    case '--el':     el = argv[++i]; break;
    case '--width':  width = Number(argv[++i]); break;
    case '--height': height = Number(argv[++i]); break;
    case '--scale':  scale = Number(argv[++i]); break;
    case '--frames': frames = Number(argv[++i]); break;
    case '--every':  every = Number(argv[++i]); break;
    case '--settle': settle = Number(argv[++i]); break;
    case '--hover':  actions.push({ type: 'hover', sel: argv[++i] }); break;
    case '--click':  actions.push({ type: 'click', sel: argv[++i] }); break;
    case '--wait':   actions.push({ type: 'wait', ms: Number(argv[++i]) }); break;
    default:
      if (a.startsWith('-')) { console.error(`unknown flag: ${a}`); usage(1); }
      url = a;
  }
}

if (clean) { cleanShots(); process.exit(0); }
if (!url) usage(1);

const target = url.startsWith('http') ? url : new URL(url, base).href;
const origin = new URL(target).origin;
const name = out ?? (
  (new URL(target).pathname.replace(/^\/|\/$/g, '').replace(/[/?&=]+/g, '-') || 'home')
  + (dark ? '-dark' : '')
);

fs.mkdirSync(SHOTS_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: scale,
  colorScheme: dark ? 'dark' : 'light',
});
// The site persists theme in a cookie (see ThemeScript.tsx) — set it so SSR
// and the inline theme script agree with colorScheme.
await context.addCookies([{ name: 'theme', value: dark ? 'dark' : 'light', url: origin }]);

if (admin) {
  // config.json sits at the repo root, three levels up from this script.
  const cfgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../config.json');
  const token = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).setupToken;
  if (!token) { console.error('--admin: no setupToken in config.json'); process.exit(1); }
  await context.addInitScript(t => localStorage.setItem('workshop_admin_token', t), token);
}

const page = await context.newPage();
try {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 15_000 });
} catch {
  // networkidle can time out on pages with polling/websockets — shoot anyway
}
await page.evaluate(() => document.fonts?.ready).catch(() => {});
await page.waitForTimeout(settle);

for (const act of actions) {
  if (act.type === 'wait') await page.waitForTimeout(act.ms);
  else if (act.type === 'hover') await page.hover(act.sel);
  else if (act.type === 'click') await page.click(act.sel);
}

const saved = [];
async function shoot(file) {
  const subject = el ? page.locator(el).first() : page;
  await subject.screenshot({
    path: file,
    animations: 'allow', // keep transitions/keyframes running mid-shot
    ...(el ? {} : { fullPage: full }),
  });
  saved.push(file);
}

if (frames > 1) {
  for (let f = 1; f <= frames; f++) {
    await shoot(path.join(SHOTS_DIR, `${name}-f${String(f).padStart(2, '0')}.png`));
    await page.waitForTimeout(every);
  }
} else {
  await shoot(path.join(SHOTS_DIR, `${name}.png`));
}

await browser.close();
console.log(saved.join('\n'));
