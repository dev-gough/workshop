---
name: ui-shot
description: Screenshot workshop pages with Playwright to visually verify UI work — page/element shots in light or dark mode, hover/click interactions, and multi-frame transition captures. Use whenever styling or restyling a page (pairs with /workshop-ui), before/after visual changes, or to debug layout issues you can't reproduce from code alone.
---

# UI Shot — see what you shipped

Headless-Chromium screenshots of the running workshop, saved to
`/tmp/workshop-ui-shots/` and printed as paths you open with the **Read**
tool (it renders PNGs inline). Helper: `.claude/skills/ui-shot/shot.mjs`
(Playwright is a devDependency; Chromium lives in `~/.cache/ms-playwright`).

```bash
node .claude/skills/ui-shot/shot.mjs <path-or-url> [flags]
```

## Recipes

```bash
# Page, light + dark (ALWAYS check both — see /workshop-ui checklist)
node .claude/skills/ui-shot/shot.mjs /projects/soulseek
node .claude/skills/ui-shot/shot.mjs /projects/soulseek --dark

# Full-page (long pages), mobile width, crisp close-up of one element
node .claude/skills/ui-shot/shot.mjs / --full
node .claude/skills/ui-shot/shot.mjs / --mobile
node .claude/skills/ui-shot/shot.mjs / --el '.hall-plaque' --scale 2

# Hover / click before shooting (actions run in the order given)
node .claude/skills/ui-shot/shot.mjs / --hover '.hall-door' --out door-hover
node .claude/skills/ui-shot/shot.mjs /projects/paper-trading --click 'text=History' --wait 500

# Transitions: act, then burst-capture frames mid-animation
node .claude/skills/ui-shot/shot.mjs / --hover '.hall-door' --el '.hall-door' \
  --frames 4 --every 120 --out door-tilt

# Admin-gated UI (token read from config.json, never printed)
node .claude/skills/ui-shot/shot.mjs /projects/soulseek --admin

# Cookie-gated UI (e.g. BarFoo's who's-listening overlay; repeatable)
node .claude/skills/ui-shot/shot.mjs /projects/barfoo --cookie 'barfoo_user=devon'

# Village viewer: address the 3D camera by URL, and give it time to mesh
node .claude/skills/ui-shot/shot.mjs '/projects/village?cam=-64,90,-18&look=185,28' --settle 26000
```

The village viewer takes `?cam=x,y,z&look=yaw,pitch` (Minecraft angles: yaw 0
faces +Z, pitch positive looks down) precisely so it can be screenshot without
driving a camera by hand — do **not** try to fly it with `--click` and key
presses. Headless Chromium delivers no pointer-lock movement deltas, so it
cannot be made to look up or down at all, and software rendering is slow enough
that the page's per-frame delta clamp eats most of the movement. It also never
reaches `networkidle` (the citizen event stream is open forever), so `goto`
always burns its full timeout before the `--settle` even starts. Budget ~50s.
`window.villageViewer` exposes `view()`, `goTo()`, `markers()` and `stats()` if
you need assertions rather than pixels.

Selectors are Playwright locators: CSS (`.hall-door`), `text=History`,
`role=button[name="Save"]` all work. `--el`/`--hover`/`--click` use the
*first* match.

## The rebuild gotcha (most common mistake)

Port 3000 serves the **production build** — editing a `.tsx` file changes
nothing on screen until `npm run build && sudo systemctl restart workshop`.
For rapid visual iteration, run a dev server beside prod instead:

```bash
PORT=3001 npm run dev   # run_in_background
node .claude/skills/ui-shot/shot.mjs / --base http://localhost:3001
```

Dev-mode pixels can differ slightly (no minified CSS ordering quirks are
known, but fonts/turbopack overlays exist) — do the final check against the
real build.

## Timing knobs

- Pages load with `networkidle` (15s cap, falls through on chatty pages)
  plus a `--settle 900` ms pause — bump `--settle` if live data hasn't
  painted, or add `--wait <ms>` after actions.
- Springs on hover run ~300–400ms; `--frames 3 --every 150` brackets them.
  Ambient keyframes (LED pulse, caret blink) are left running
  (`animations: 'allow'`), so single shots may catch a blink mid-cycle —
  shoot 2–3 frames if something looks "off" before concluding it's a bug.

## Cleanup — no `rm`, ever

```bash
node .claude/skills/ui-shot/shot.mjs --clean
```

Deletes only top-level `*.png` files inside the hard-coded
`/tmp/workshop-ui-shots` via `fs.unlink` — the directory is a constant in
the script, never a shell argument. **Do not** clean up with `rm` commands
containing paths; if the script is somehow unusable, leave the files
(it's `/tmp`, the OS reclaims it).

## Don'ts

- Don't screenshot before rebuilding/restarting (or point `--base` at a dev
  server) — you'll be reviewing stale UI.
- Don't judge color/contrast from one mode; shoot `--dark` too.
- Don't `rm` anything in `/tmp/workshop-ui-shots` — use `--clean`.
- Don't print or echo the admin token; `--admin` handles it internally.
