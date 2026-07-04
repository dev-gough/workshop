---
name: workshop-ui
description: The workshop's design system ("a hallway of rooms"). Use when styling, theming, restyling, or visually overhauling any page or component in devys-workshop, when creating a new project page, or when adding a tile to the homepage. Ensures consistent tokens, typography, motion, and theming patterns across the site's many uniquely-themed projects.
---

# Workshop UI — "A Hallway of Rooms"

The site is a **hallway** (neutral shell) off which every project is a **room**
with its own committed, immersive theme. The hallway stays quiet — plaster,
ink, brass — and the rooms are allowed to be loud. Consistency comes from
*shared architecture*, not shared colors: every room remaps the same tokens,
speaks the same typographic patterns, and hangs the same brass hardware.

Reference implementations: homepage (`src/app/page.tsx` + `src/app/_home/`),
paper-trading (`ws-theme`), server (`cc-scope`), challenges (`lol-theme`).

## 1. Token architecture (the one hard rule)

Base tokens live in `@theme` in `src/app/globals.css`: `--color-background`,
`-foreground`, `-card`, `-card-foreground`, `-border`, `-muted`,
`-muted-foreground`, `-primary`, `-accent`, `-destructive`, `--radius`,
`--color-chart-1..5`, `--color-brand-maroon` (#8c334d).

**A page theme is a scope class that remaps those shared tokens locally.**
Components then use normal utilities (`bg-card`, `border-border`,
`text-muted-foreground`) and inherit the room's palette for free — including
shadcn pieces, uPlot, and lucide icons. Never hardcode a page's colors into
components when a token exists.

Existing scopes (all in `globals.css`):

| Scope        | Room                | Modes            | Voice |
|--------------|---------------------|------------------|-------|
| `hall-theme` | homepage / shell    | light + dark     | plaster walls, brass hardware, gallery calm |
| `ws-theme`   | paper-trading       | light + dark     | warm paper + ink, geometric sans (Jost), chunky serif |
| `cc-scope`   | server dashboards   | dark always      | phosphor instruments: cyan/amber/rose, scanlines, LEDs |
| `lol-theme`  | challenges          | light + dark     | hextech navy + gold |

New room scope template:

```css
/* ─── <Room> scope — applied to /projects/<x> shell ─── */
.xx-theme {
  /* 1. Palette vars, prefixed */
  --xx-bg: ...;  --xx-ink: ...;  --xx-accent: ...;
  /* 2. Remap the SHARED tokens from them */
  --color-background: var(--xx-bg);
  --color-foreground: var(--xx-ink);
  --color-card: ...;  --color-border: ...;
  --color-muted-foreground: ...;  --color-primary: var(--xx-accent);
  /* 3. Font + base paint on the scope itself */
  font-family: var(--font-...), system-ui, sans-serif;
  color: var(--xx-ink);
  background-color: var(--xx-bg);
}
.dark .xx-theme { /* dark palette, same var names */ }
```

Support `.dark` unless the room is *deliberately* single-mode (instruments,
cinema, terminals may be dark-always like `cc-scope`; receipts stay white).
That is an intentional design decision — state it in a comment.

## 2. The hallway (`hall-theme`) and its hardware

Hall palette vars (usable inside any hall-scoped element): `--hall-wall`,
`--hall-wall-2`, `--hall-card`, `--hall-ink`, `--hall-ink-soft`,
`--hall-line`, `--hall-brass` (brand maroon; #c86a86 in dark).

Brass is the **cross-room unifier** — door plaques, pins, the header plate,
active-nav underline. Outside a hall scope, always write it with a fallback:
`var(--hall-brass, var(--color-brand-maroon))`.

Signature hardware (defined in `globals.css` / `src/app/_home/`):

- `Door` component (`src/app/_home/door.tsx`) — link wrapper with 3D
  door-tilt hover (`rotateY: -3.5`, `transformPerspective: 900`) + plaque.
- `.hall-plaque` — brass room-number plate (`RM 01 · Name`).
- `.hall-door` — hover: border warms to brass, shadow lifts.
- `.hdr-plate` — the brass "D" logo plate (header + mobile drawer).
- `.hall-tear` (receipt zigzag), `.hall-sprockets` (film strip),
  `.hall-blink` (terminal caret), `hall-drift` / `hall-dash` keyframes.

## 3. Typography

Fonts are loaded once in `src/app/layout.tsx`:

| Var | Font | Use |
|-----|------|-----|
| `--font-geist-sans` | Geist | default UI (body) |
| `--font-geist-mono` | Geist Mono | general mono |
| `--font-readout` | JetBrains Mono | instrument numerics (`.cc-readout`) |
| `--font-ws-serif` → `.ws-serif` | Fraunces (roman) | **the workshop's serif voice**: masthead, header wordmark, money in ws-theme |
| `--font-display` | Fraunces (italic) | editorial accents, sparingly |
| `--font-ws-sans` | Jost | ws-theme UI |

Recurring patterns — reuse them verbatim:

- **Section/eyebrow label**: `text-[10px] font-semibold uppercase tracking-[0.2em]`
  in the room's accent or muted color. (Plaques use 9px/0.14em.)
- **Readout numbers**: mono, `tabular-nums`, color = the metric's accent.
- **Body detail lines**: `text-[11px] text-muted-foreground`, truncated.
- Headings: serif for identity moments (`.ws-serif`), sans for everything else.

## 4. Layout constants

- Header is `h-14` + 1px border → full-height pages use
  `min-h-[calc(100vh-57px)]` — **57, not 56**.
- Page container: `mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8`.
- Tile grids: `gap-3`; homepage rows are `auto-rows-[176px]`.
- Radii: `rounded-lg` for tiles/cards, `rounded-sm`/`rounded-md` for small
  plates and notes. `cc-scope` uses 3px squared corners — instruments aren't round.
- Money is BIGINT cents end-to-end; format at the edge.
- Shared formatters: `fmtBytes/fmtSpeed/fmtEta/fmtDuration/fmtTime` from
  `@/lib/format`. Don't reimplement.

## 5. Motion vocabulary

- Route-level: wrap pages in `PageTransition`; stagger sections with
  `FadeIn delay={0.05 * i}`.
- Hover: small physical lift — `whileHover={{ y: -2..-3 }}` (or the Door
  tilt), spring `stiffness 260–400, damping 22–30`. No wobble, no bounce.
- Value changes: width/offset transitions ~700ms ease-out (see `GaugeRing`,
  cc bars). Lists animate in with `delay: i * 0.03`.
- Ambient animation is welcome *inside* a room's diorama (LED pulse, caret
  blink, critter drift) but should be subtle enough to ignore.

## 6. Header integration

Every immersive page tells the global bar to match:

```tsx
import { useHeaderConfig } from '@/components/header-config';
useHeaderConfig({ scopeClass: 'xx-theme' });
```

The header's structure (brass plate, serif wordmark, small-caps nav with
brass underline) is fixed; only its palette follows the scope.

## 7. Overhauling a page — checklist

1. **Name the room's identity in one sentence** (a material metaphor:
   "phosphor instrument wall", "warm paper ledger", "till receipt"). If you
   can't, the design isn't ready.
2. Add the scope class in `globals.css` (light + dark, or deliberate
   single-mode) following the template above.
3. Apply the scope on the page shell root; call `useHeaderConfig`.
4. Restyle content using shared tokens + the typographic patterns (§3);
   pull formatters from `@/lib/format`.
5. Keep data honest: placeholder text for missing data, never fake numbers;
   a genuine zero is `0`, not `—`.
6. Update the project's homepage tile (`src/app/_home/rooms-*.tsx`) if the
   room's identity changed — the tile is a *miniature of the room*, in the
   room's own theme, with 1–3 live stats.
7. Verify BOTH modes (unless single-mode by design), mobile width, and the
   header recolor. Then: `npm run build` → `sudo systemctl restart workshop`
   → commit.

## 8. New project? New door.

Adding a project = adding a room: give it the next `RM NN` number, a `Door`
tile in the homepage grid (live diorama, not a static icon), and optionally
a note source for the corridor noticeboard (`src/app/_home/noticeboard.tsx`).

## Don'ts

- Don't restyle by scattering hex codes through TSX — put palette in the
  scope, remap tokens, use utilities.
- Don't mix room voices (no scanlines on the receipt, no serif in the
  terminal). One material metaphor per room.
- Don't touch header height, the 57px offset, or `hall-brass` hue.
- Don't add new Google fonts without checking an existing one fits (§3).
- Don't use `Math.random()`/`Date.now()` in render for decorative art —
  seed it (see `TRIANGLES` in `rooms-art.tsx`) so SSR/CSR match.
