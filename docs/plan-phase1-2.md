# Implementation Plan — Audit Phases 1 + 2

Source: `docs/audit-2026-07-03.md`. Seven work orders (A–G), all file-disjoint so they can be
implemented in parallel. Implementing agents: Opus 4.8. Orchestrator reviews all diffs, runs one
build, restarts `workshop`, and commits per area. Agents do **not** commit or restart services.

Auth decision (Devon, 2026-07-03): privileged endpoints gated by the existing `X-Setup-Token`
pattern, with a client-side "admin unlock" (token kept in `localStorage`, prompted on 401).

---

## A — Fix challenges sync (restores dead feature)
**Files:** `src/app/api/challenges/sync/route.ts`
- Replace the raw `fs.readFile(config.json)` + flat destructure (`riotApiKey`, `riotGameName`,
  `riotTagLine`, `riotRegion` — lines ~38-41) with `getConfig().riot` from `@/lib/config`
  (nested: `apiKey`, `gameName`, `tagLine`, `region`).
- Return the same "not configured" 500 when fields are missing. No behavior change otherwise.

## B — Soulseek + BarFoo fixes
**Files:** `src/app/api/soulseek/ingest/route.ts`, `src/app/api/soulseek/status/route.ts`,
`src/app/projects/soulseek/page.tsx` (status fetch only), `src/app/projects/barfoo/page.tsx` (one line)
- **Traversal guard** (ingest DELETE, ~line 171): `path.resolve(DOWNLOADS_DIR, filePath)` must
  `startsWith(path.resolve(DOWNLOADS_DIR) + path.sep)` before any `fs.unlink`; skip otherwise.
  Apply the same guard anywhere else in the file that joins request-supplied paths.
- **Status badge**: determine the real slskd `/api/v0/application` response shape by curling
  `localhost:5030` with the API key from `config.json`. Make the route return a normalized
  `{ connected: boolean, state, version }` and update the page's `d.server?.isConnected` read.
- **BarFoo**: `calc(100vh - 56px)` → `57px` at page.tsx:713 (project convention).

## C — Splitwiser security
**Files:** `src/lib/splitwiser-auth.ts`, `src/app/api/splitwiser/{me,signup,login/[token],payments,expenses}/…`,
new `src/app/api/splitwiser/me/login-url/route.ts`, `src/app/projects/splitwiser/settings/page.tsx`
- Add `toPublicUser(row)` that strips `login_token`; use it in every route that returns a user
  (`/me`, signup, `login/[token]`, users list, etc. — grep for `RETURNING *` + user responses).
- New authed endpoint `GET /api/splitwiser/me/login-url` returning the login URL for the QR;
  settings page switches to it. Grep the frontend for `login_token` usages first and preserve flows.
- `payments/[id]` DELETE: add `userIsInGroup` check (mirror `expenses/[id]/route.ts:33`).
- Cap `total_cents` / `amount_cents` at 100_000_000 ($1M) in expenses + payments POST.

## D — Sim fixes
**Files:** `src/components/GameOfLife.tsx`, `src/components/ImageEvolver.tsx`
- `parseLif`: replace `Math.min(...map)` / `Math.max(...map)` with a reduce loop (stack-safe).
- ImageEvolver: persistent offscreen canvas (ref or engine field) instead of
  `document.createElement('canvas')` per redraw (~:417); `URL.revokeObjectURL` after image load
  (~:347); sync `popSize` to the running engine like `mutationRate` already is (~:369).

## E — Infra hardening: timeouts, pool, metrics
**Files:** `src/lib/{riot,slskd,transmission,db}.ts`, `scripts/ingest-downloads.ts`,
delete `src/app/api/server/metrics/route.ts` + `src/app/api/server/metrics/multi/route.ts`,
new `scripts/prune-metrics.ts` + systemd unit/timer
- `AbortSignal.timeout()` on every outbound fetch: riot (10s), slskd (8s), transmission (8s),
  ingest-downloads (8s). Keep error handling shape identical.
- Fix `riot.ts` rate limiter: recapture `now = Date.now()` each `while` iteration (~:44).
- `db.ts` pool: `{ max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }`.
- Delete the two legacy metrics routes (verified: no frontend callers; v2 replaced them).
  Leave the `system_metrics` table alone for now.
- `scripts/prune-metrics.ts`: delete rows older than 90 days from the `metric_*` tables
  (check migrations for exact table names); follow the conventions of existing collector
  scripts + `scripts/systemd/` units; daily timer.

## F — Paper-trading hardening
**Files:** `src/lib/trading.ts`, `src/app/api/paper-trading/accounts/route.ts`,
`src/app/projects/paper-trading/orders/page.tsx`
- `placeOrder`: move the order INSERT inside the fill transaction (atomic insert+fill; on
  market-closed/limit-resting paths the insert still commits as `open`).
- `processOpenOrders`: skip filling when the cached quote's `updated_at` predates today's
  market open (guard against filling at yesterday's close on the first tick).
- Cap `seedDollars` (accounts POST) at $10M; reject non-finite values.
- Orders page cancel: check `res.ok`, surface an inline error instead of silently reloading.

## G — Auth gating (setup-token unlock)
**Files:** new `src/lib/admin-auth.ts` (server) + small client helper; gate
`POST /api/server/services`, `POST /api/server/rcon`, `POST /api/setup/probe/[service]`;
rewrite `src/app/api/settings/route.ts`; update `src/app/projects/server/services/page.tsx`
+ `src/app/profile/page.tsx`
- Server: `requireSetupToken(req)` matching the pattern in `api/config/route.ts:89-98`
  (403 when no token configured, 401 on mismatch). Apply to the three POST endpoints above.
  GETs stay open.
- `/api/settings` rewrite: GET returns non-secret current values via `getConfig()`
  (`riot.gameName/tagLine/region`, `services.slskd.autoIngest`) keeping the response shape the
  profile page expects; PATCH is token-gated and writes through the same nested-merge +
  `resetConfigCache()` mechanism `/api/config` PATCH uses (read that route and reuse/share its
  write helper). This fixes the currently-broken flat-schema writes.
- Client: shared helper (e.g. `src/lib/admin-client.ts`) — token in
  `localStorage['workshop_admin_token']`, sent as `X-Setup-Token`; on 401, prompt for the token,
  store, retry once. Wire into services page control POSTs, RCON panel, and profile save.

---

**Orchestrator follow-up:** review diffs → `npm run build` → fix stragglers →
`sudo systemctl restart workshop` → commit per area (A–G ≈ 7 commits, message style per git log).
