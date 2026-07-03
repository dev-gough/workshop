# Implementation Plan — Audit Phases 3 (Consolidate) + 4 (Features)

Source: `docs/audit-2026-07-03.md`. Phases 1-2 shipped 2026-07-03 (commits `3045060..53f0f65`).
This file is self-contained: everything needed to dispatch and orchestrate is here.

## Orchestration protocol (read first, post-compact self)

- Implementing agents: **Opus 4.8** via the Agent tool. The session model (`claude-fable-5`)
  CANNOT be inherited by subagents — **always pass `model: "opus"` explicitly** or the spawn
  fails with a thinking-mode API error.
- Agent prompts: paste the relevant work-order section + the repo context line:
  "Repo /home/server/devys-workshop — Next.js 15 App Router, React 19, TS strict, Tailwind 4,
  Postgres 16, money in BIGINT cents. Match surrounding code style."
- Agent constraints (include verbatim in every prompt): do NOT git commit; do NOT restart
  services; do NOT run builds/dev servers; do NOT run migrations or scripts against the live
  DB; may run `npx tsc --noEmit`; report changes as file:line; report (don't fix) unrelated
  findings.
- Work orders within a wave are file-disjoint → dispatch each wave's agents in ONE parallel
  batch. Waves are sequential (later waves import modules earlier waves create).
- After each wave: review diffs → `npm run build` → run `npm run db:migrate` if the wave
  added migrations → `sudo systemctl restart workshop` → smoke-check → commit per work order
  (imperative style, e.g. "Soulseek: single SSE connection for transfers"; end commit body
  with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).
- Conventions: header offset is 57px (`calc(100vh - 57px)`); migrations live in
  `scripts/migrations/NNN-name.sql` (check current max; duplicates like 010 exist — use the
  next free number); systemd units are `*.{service,timer}.tmpl` in `scripts/systemd/` with
  `$SERVER_USER`/`$WORKSHOP_DIR` envsubst vars.
- Line numbers below are from the audit and may have drifted a few lines after Phase 1-2
  edits — treat as anchors, not gospel.

---

# PHASE 3 — Consolidation & remaining quality

## Wave 1 — shared modules (2 agents, parallel)

### H — Media-side shared modules
**Files:** new `src/lib/format.ts`, new `src/components/ui/ProgressBar.tsx`,
new `src/components/ui/ConnectionBadge.tsx`, `src/lib/slskd.ts`, `scripts/ingest-downloads.ts`
1. `src/lib/format.ts`: `fmtBytes`, `fmtSpeed`, `fmtTime`, `fmtEta`, `fmtDuration` — take the
   union of the near-identical copies in `src/app/projects/jellyfin/page.tsx:~106-148` and
   `src/app/projects/soulseek/page.tsx:~126-154` (server services page `:~62` and
   `src/app/projects/server/history/_lib/align.ts:59` have `formatBytes` too — reconcile
   signatures so all four call sites can adopt in Wave 2). Do NOT migrate the pages yet
   (Wave 2 owns them) — just create the module.
2. `ProgressBar.tsx` + `ConnectionBadge.tsx`: extract the byte-identical components from
   jellyfin page `:~187-209` / soulseek page `:~198-215` into `src/components/ui/` (props:
   ProgressBar `{ value }`-style as-is; ConnectionBadge — unify the `ok`/`connected` prop
   naming). Again: create only; pages migrate in Wave 2.
3. `src/lib/slskd.ts`: export a `flattenTransfers()` helper (the nested group→dir→files
   flatten currently copy-pasted in 4 places — the canonical copy lives in
   `src/app/api/soulseek/transfers/stream/route.ts:~29-44`). Migrate the two API routes that
   are safe to touch now: `src/app/api/soulseek/downloads/route.ts:~34-44` and
   `src/app/api/soulseek/uploads/route.ts:~28-37` (the stream route too). 
4. `scripts/ingest-downloads.ts`: delete the inline `slskdGet` (~:41-47, has an
   AbortSignal.timeout added in Phase 2 — the lib version has one too now) and import from
   `src/lib/slskd.ts` (call `resetConfigCache()` before polls as it already does; verify the
   lib client reads config per-call — it does via `getConfig()`). Replace both transfer
   flatten copies (~:83-93, ~:147-157) with the new `flattenTransfers`. Also fix the fragile
   state check at ~:98: `!== 'Completed, Succeeded'` → `state.includes('Completed') &&
   state.includes('Succeeded')`, matching the stream route's robust pattern.

### I — Challenges consolidation + unified service list
**Files:** new `src/lib/challenges-sync.ts`, `src/app/api/challenges/sync/route.ts`,
`scripts/sync-challenges.ts`, `scripts/poll-challenges.ts`, new `src/lib/server-services.ts`,
`src/app/api/server/services/route.ts`, `src/app/api/server/logs/route.ts`,
`src/app/api/server/logs/stream/route.ts`
1. Extract the duplicated challenge upsert/sync logic (challenge_configs + challenge_progress
   + sync_metadata upserts, `deriveCategory`, leaderboard-floor updates) from
   `scripts/sync-challenges.ts:~64-91` and `src/app/api/challenges/sync/route.ts:~65-141`
   into `src/lib/challenges-sync.ts` (a `syncChallenges(pool, riotCfg)`-shaped function or a
   couple of composable helpers — read both carefully; the route also has a 10-min cooldown
   which stays route-side). `scripts/poll-challenges.ts:~182-190` duplicates the
   challenge_progress upsert — point it at the shared helper too. NOTE: the sync route was
   fixed in Phase 2 to read `getConfig().riot` — preserve that. Remove the dead
   `challengePercentiles` variable in `sync-challenges.ts:~79`.
2. `src/lib/server-services.ts`: single exported service list. Today it's quadruplicated:
   `TRACKED_SERVICES` in `api/server/services/route.ts:~15-30` (richer objects) and
   `ALLOWED_SERVICES` in both `logs/route.ts:~6-22` and `logs/stream/route.ts:~6-22`
   (identical name arrays). Derive the allowed-names list from the tracked list. (The
   frontend `PINNED_LABELS` copy in process-explorer is Wave 2/M's job — via the pins API,
   not this module.)

**Wave 1 smoke checks:** `curl -X POST localhost:3000/api/challenges/sync` → 200 (or
cooldown JSON); soulseek downloads/uploads tabs still list transfers; `journalctl -u
soulseek-ingest -n 5` clean after restart.

## Wave 2 — page migrations + quality (5 agents, parallel)

### J — Jellyfin page adoption
**Files:** `src/app/projects/jellyfin/page.tsx`
Replace local `fmtBytes`/`fmtSpeed`/`fmtTime`/`fmtEta`/`fmtDuration` (~:106-148) with
`src/lib/format.ts`; replace local `ProgressBar` (~:187-197) and `ConnectionBadge` (~:200-209)
with the shared components. Zero visual change intended.

### K — Soulseek page adoption + single SSE + cover-art fix
**Files:** `src/app/projects/soulseek/page.tsx`, `src/app/api/soulseek/ingest/route.ts`
1. Adopt `format.ts` + shared `ProgressBar`/`ConnectionBadge` (same as J).
2. **Single SSE connection:** the Downloads tab (~:643) and Uploads tab (~:896) each open
   their own `EventSource` to `/api/soulseek/transfers/stream` — when both are mounted that's
   2 connections × 2s polls. Lift the EventSource to the page level (one connection, opened
   while either tab is active), pass `liveDownloads`/`liveUploads` down as props.
3. **Cover-art ordering bug:** `moveCoverArt` in the ingest route (~:220, was :209-228
   pre-Phase-2) searches `targetDir` for images — but at call time only audio files have been
   moved, so loose cover images sitting in the download folder are never picked up.
   Restructure: locate art in the SOURCE download directory (same dir as the audio files
   being ingested) and copy/move it to `targetDir` alongside the audio. Respect the
   path-traversal guard helper (`resolveWithinBase`) added in Phase 1.

### L — BarFoo + music streaming
**Files:** `src/app/projects/barfoo/page.tsx`, `src/app/api/music/stream/route.ts`
1. **Streaming rewrite:** the stream route does `fs.readFile` (whole file into heap) even for
   Range requests, then slices. Rewrite with `fs.createReadStream({ start, end })` converted
   to a web `ReadableStream` (Node 18+: `Readable.toWeb()`), correct 206/Content-Range/
   Accept-Ranges headers, 200 streaming path for non-Range. Preserve the existing path
   resolution + traversal guard and the `Disc N/` fallback logic exactly.
2. BarFoo page: replace the biased shuffle `allSongs.sort(() => Math.random() - 0.5)`
   (~:1008) with the Fisher-Yates idiom already used in `AudioProvider.tsx:~382-385`; delete
   the pointless aliases `cleanSongName`/`displaySongName`/`sortedIndices` (~:604-606) and
   use the imports directly.

### M — Server dashboard polish
**Files:** `src/app/projects/server/services/page.tsx`,
`src/app/projects/server/history/_components/*` (navigator-strip, process-explorer,
uplot-chart), `src/app/projects/server/history/_lib/align.ts`, `src/lib/config.ts` +
`config.example.json` (only if adding a config field)
1. Adopt `src/lib/format.ts` in services page (~:62) and `align.ts:59`.
2. **Hardcoded LAN IP:** `192.168.2.15` ×3 in services page (~:243, ~:350, ~:354) — these
   build links to other services (jellyfin/transmission/etc.). Replace with
   `window.location.hostname`-based URLs if the ports are on the same host, else a config
   value — inspect what the links point at and pick the cleaner option.
3. **process-explorer pinned state** (~:146-152): replace the hardcoded `PINNED_LABELS` set
   with a fetch of `/api/server/pins` (endpoint exists), so manual pins show correctly.
4. **navigator-strip stale clock** (~:28): `const stripTo = useMemo(() => Date.now(), [])`
   freezes the right edge at mount — tie it to the window's `toMs` or refresh per minute.
5. **uPlot theme recolor:** stroke/fill colors are read from CSS vars at construct time, so a
   theme toggle leaves stale canvas colors on the history charts (equity chart works around
   it with a `key`). In `uplot-chart.tsx` (~:147-153) make the theme MutationObserver trigger
   a rebuild (e.g. bump a `themeVersion` state consumed by the chart-build effect) instead of
   `redraw(true, true)`.

### N — Splitwiser + misc dedup / dead code
**Files:** new `src/app/projects/splitwiser/_lib/fmt.ts`,
`src/app/projects/splitwiser/page.tsx`, `src/app/projects/splitwiser/groups/[id]/page.tsx`,
`src/components/HousePlanner.tsx`
1. Extract `fmtMoney` (duplicated in splitwiser page:~45 and groups/[id] page:~44) and
   `todayISO` (groups/[id]:~50) into `_lib/fmt.ts`; adopt in both pages (check settings page
   too). Leave `src/app/page.tsx`'s `fmtMoneyCents` alone (different shape, home page).
2. `HousePlanner.tsx:~98-105`: `snapIncrement` returns 1 in every branch — delete the
   function, inline the constant at its call sites.

**Wave 2 smoke checks:** stream an album track with a Range request
(`curl -H 'Range: bytes=0-1023' -o /dev/null -w '%{http_code}' 'localhost:3000/api/music/stream?...'`
→ 206); soulseek page loads with one `/transfers/stream` connection (check
`ss -tn | grep :3000` count or server logs); jellyfin/server pages visually unchanged.

---

# PHASE 4 — Features (Wave 3: up to 8 agents, parallel; all file-disjoint)

Dispatch after Wave 2 commits. Each is one agent. P8 depends on Wave 2's L (barfoo page,
music API) having landed — safe in Wave 3.

### P1 — Game of Life: exhaustive-orientation census (the TODO-file idea)
**Files:** `src/app/projects/gol/page.tsx`, `src/components/GameOfLife.tsx`,
`src/components/GSMOL.tsx`, new worker file(s) (e.g. `src/workers/gol-census.worker.ts` —
check how Next 15 handles workers: `new Worker(new URL('...', import.meta.url))` works with
webpack/turbopack)
1. **Census feature:** for each grid size from 1×1 up to (at least) 4×4 exhaustively — and
   5×5 if runtime allows (2^25 = 33.5M states; chunked + resumable) — simulate every starting
   configuration on a BOUNDED grid and classify: dies (empty), still life, oscillates
   (period N), via state-hash cycle detection (hash each generation's packed bitboard; a
   repeat = cycle; a repeat of state 0 vs later determines period). Bounded-grid semantics:
   cells outside are dead. All bounded configs must die/fix/cycle, so classification always
   terminates (cap generations ~1000 as a safety bound; a 4×4 grid has ≤65536 states so its
   trajectory must cycle within 65536 steps — use per-size caps).
   - Run entirely in a Web Worker; use `Uint16Array`/`Uint32Array` bitboards (a W×H≤25 grid
     packs into one uint32); post progress every ~100k states.
   - Persist per-size results to `localStorage` (resume across visits).
   - UI: a new "Census" section/tab on the GoL page: per-size outcome breakdown (dies /
     still / oscillates by period), a heatmap-style visualization of % looping per grid
     dimension (the TODO's ask), and a gallery of the longest-period oscillators found
     (render each with the existing pattern-preview machinery, or a small canvas).
   - Deterministic small sizes (1×1..3×3) should complete instantly and render immediately.
2. **Drag-state fix:** clear `interactionRef.mode` on a window-level `mouseup` (audit: drag
   released off-canvas keeps drawing on re-enter).
3. **GSMOL refactor:** `src/components/GSMOL.tsx` runs its decorative sim through React state
   (`setGrid` clone + reconcile per tick). Convert the grid to a ref and drive the canvas
   directly from the interval; keep visuals identical (it's embedded on the home page).

### P2 — BrainFuck GA: live SSE + perf polish
**Files:** `src/lib/brainfuck.ts`, new `src/app/api/brainfuck/runs/stream/route.ts` (or
similar), `src/app/api/brainfuck/runs/[id]/route.ts`, `src/app/projects/brainfuck/page.tsx`,
`src/lib/brainfuck-interpreter.ts`
1. **SSE stream:** `src/lib/brainfuck.ts` already receives line-delimited JSON events from
   the Python child. Add an in-process event emitter fan-out and an SSE route streaming
   events for the active run(s) (pattern reference: `src/app/api/soulseek/transfers/stream/
   route.ts` and `api/server/logs/stream` — wire `request.signal` abort cleanup). Page:
   replace the 1s `setInterval(refresh, 1000)` polling with the SSE stream + a slow (10s)
   polling fallback if the stream errors.
2. **Bounded progress fetch:** `runs/[id]/route.ts:~24-27` selects the ENTIRE progress trail
   every poll. Cap at ~500 points: keep the newest ~250 rows plus an evenly-downsampled
   spread of the older rows (SQL `row_number() % N` trick or two queries).
3. **Event union:** add `restart` and `migration` to the `Event` union in `brainfuck.ts`
   (~:179) — runner.py emits them and they're silently dropped. Persist/surface them as
   lightweight activity entries in the run panel (small UI touch, keep subtle).
4. **Ring buffer:** `brainfuck-interpreter.ts:~217-220` trims undo history with
   `splice(0, cap/4)` (O(n) shift) — replace with a circular buffer or head-index + periodic
   compaction without full shifts. Behavior (max entries, undo semantics) unchanged.

### P3 — Image Evolver: engine in a Worker
**Files:** `src/components/ImageEvolver.tsx`, new worker file
Move `ImageEvolverEngine` into a Web Worker using `OffscreenCanvas` for fitness readbacks
(`getImageData` currently stalls the main thread; it's the speed cap). Protocol: main thread
sends target ImageData + params (+ live param updates incl. the Phase-1 `setPopSize`); worker
posts back `{generation, fitness, polyCount, bestPolygons}` at a throttled rate (~10/s) and
renders happen main-side from the polygon array (reuse the persistent canvas from Phase 1).
Feature-detect `OffscreenCanvas`; keep the current main-thread path as fallback. Bonus if
trivial: persist best candidate polygons to `localStorage` per preset so refresh doesn't lose
progress.

### P4 — Paper Trading: stop orders, TIF, realized P&L
**Files:** `src/lib/trading.ts`, new migration `scripts/migrations/NNN-pt-stop-tif.sql`,
`src/app/api/paper-trading/**` (orders routes), `src/app/projects/paper-trading/_components/`
(trade ticket), `src/app/projects/paper-trading/orders/page.tsx`, history page
1. **Migration:** add `trigger_price_cents BIGINT NULL`, `tif TEXT NOT NULL DEFAULT 'gtc'`
   (`'day'|'gtc'`), extend order `type` to allow `'stop'` and `'stop_limit'`. Read
   `scripts/migrations/012-paper-trading.sql` first and follow its conventions (constraints,
   comments). Do NOT run it — orchestrator applies via `npm run db:migrate`.
2. **Engine (`trading.ts`):** stop = becomes a market order once quote crosses trigger
   (buy-stop: price ≥ trigger; sell-stop: price ≤ trigger); stop-limit = becomes a resting
   limit once triggered (track triggered state — simplest: on trigger, update type→'limit'
   in the fill sweep). `tif='day'` orders auto-expire: in `processOpenOrders`, mark
   `status='expired'` (add to allowed statuses if constrained) for day orders whose
   created_at predates today's session open (reuse `todaysMarketOpen()` from Phase 2).
   Respect the Phase-2 patterns: atomic transactions, stale-quote guard.
3. **UI:** trade ticket gains an order-type segment (market/limit/stop/stop-limit — trigger
   and limit inputs appear as relevant) and a TIF toggle (Day/GTC), styled to the existing
   Wealthsimple language (segmented controls). Orders page shows trigger/TIF columns.
4. **Realized P&L:** the schema tracks positions with cost basis; compute realized P&L per
   sell from trade history (average-cost method — proceeds minus avg-cost-at-sale × qty;
   inspect `pt_trades`/fill code to see what's recorded at fill time and add a
   `realized_pnl_cents` column to trades in the same migration if it makes computation
   clean). Surface: a summary stat on the history page + per-trade P&L column.

### P5 — Ecosystem: perf + trait drift
**Files:** `src/components/EcosystemSim.tsx`
1. Put food in the spatial hash (or a second grid) — kill the O(prey×food) linear scan
   (~:250-256).
2. Single-pass per-tick stats: collapse the 4-6 `agents.filter` traversals (population cap
   ~:294-298, history push ~:302-309) into one loop.
3. Wrap the render-body avg-trait reduce (~:532-537) in `useMemo` keyed on tick.
4. **Feature — trait drift:** record avg speed/vision/size per species over time and plot
   them (second strip under the existing population chart, or toggleable overlay — match the
   existing canvas-chart style). This is the emergent-evolution payoff that's currently
   invisible.

### P6 — Neuroevolution: perf + track transfer
**Files:** `src/components/Neuroevolution.tsx`
1. Fold the collision wall-scan (~:245-252) into the sensor raycast pass (frontal sensor
   distance < car radius ⇒ crash) — halves per-car wall work.
2. Spatial-bin the walls (coarse grid keyed by cell → segment indices) so `castRay` tests
   ~20 nearby segments instead of ~480 (~:131-137).
3. Throttle `setAliveCount` (~:630) to every ~10th step via a ref.
4. **Feature — elite transfer:** "New Track" currently discards all genomes; carry the top
   N elites onto the regenerated track (fresh fitness, same weights) to show transfer
   learning. Small UI note showing "carried N elites".

### P7 — Polar Clock: split the monolith (optional — skip if wave is heavy)
**Files:** `src/app/projects/polar-clock/page.tsx` → `src/app/projects/polar-clock/_components/*`
Pure mechanical refactor of the 2,200-line file: each background animation component
(GOLBackground, Julia/Mandelbrot WebGL, Koch, Starfield, ParticleFlow, Matrix, Voronoi,
Ripples, Lissajous, Apollonian, …) moves to its own file; palettes/types to a shared module.
ZERO behavior change — diff should be pure moves + imports.

### P8 — Album art out of the DB
**Files:** `src/lib/musicScanner.ts`, new `src/app/api/music/cover/` route, `src/app/api/music/
route.ts` (+ stats route if it returns thumbnails), `src/components/AudioProvider.tsx`,
`src/components/FloatingPlayer.tsx`, `src/app/projects/barfoo/page.tsx`, new migration if
schema changes; check `src/app/page.tsx` activity feed + soulseek page for thumbnail usage
Currently `albums.thumbnail` stores base64 data-URIs (~8-20KB each) and `/api/music` ships
ALL of them inline (~MBs on cold load). Move to files: scanner writes
`<musicDir>/.covers/<albumId>.jpg` (or a cache dir under the workshop; pick what fits
`musicScanner.ts`'s existing structure) and a `GET /api/music/cover/[id]` route serves them
with long-lived cache headers (`Cache-Control: public, max-age=604800`) + 404 fallback.
`/api/music` returns a `coverUrl` instead of the blob. Update every consumer (grep
`thumbnail`). Migration: add a nullable `cover_path`/keep-and-ignore the old column (don't
destructively drop in the same change — leave `thumbnail` in place, stop reading it, note a
future cleanup migration). Provide a one-shot backfill path: easiest is regenerating via
`npm run scan-music` (scanner already extracts art) — confirm and note it in the report.
**Depends on Wave 2 L** (barfoo/stream edits) having landed — it has, by Wave 3.

**Wave 3 smoke checks:** `npm run db:migrate` clean; place a stop order + a day limit order
via UI/curl and confirm shapes; GoL census tab runs 1×1..3×3 instantly; BF page shows live
events without 1s polling (watch network tab / server logs); `/api/music` response no longer
contains `data:image` blobs; covers load with 200 + cache headers.

---

## Post-completion checklist
- All waves committed per work order; working tree clean.
- `npm run build` clean; `sudo systemctl restart workshop`; site up (`systemctl is-active workshop`).
- Remind Devon: metrics-prune timer from Phase 2 still needs `install-systemd.sh` if not yet
  enabled; `npm run scan-music` re-run needed after P8 for cover backfill.
- Update `docs/audit-2026-07-03.md` roadmap section marking phases 3-4 done, and the memory
  file `project_audit_roadmap.md` (phases 3-4 → shipped; note anything deferred, e.g. P7).
