<div align="center">
  <img src="docs/readme/hero.svg" alt="Devy's Workshop" width="100%">
</div>

<p align="center">
  <a href="https://devydev.ca"><img src="https://img.shields.io/badge/live-devydev.ca-e879f9?style=flat-square&labelColor=0a0a0d" alt="devydev.ca"></a>
  <img src="https://img.shields.io/badge/projects-13-22d3ee?style=flat-square&labelColor=0a0a0d" alt="13 projects">
  <img src="https://img.shields.io/badge/Next.js-15-fafafa?style=flat-square&logo=nextdotjs&logoColor=fafafa&labelColor=0a0a0d" alt="Next.js 15">
  <img src="https://img.shields.io/badge/React-19-22d3ee?style=flat-square&logo=react&logoColor=22d3ee&labelColor=0a0a0d" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=3178c6&labelColor=0a0a0d" alt="TypeScript">
  <img src="https://img.shields.io/badge/Postgres-16-336791?style=flat-square&logo=postgresql&logoColor=336791&labelColor=0a0a0d" alt="Postgres">
  <img src="https://img.shields.io/badge/Tailwind-4-22d3ee?style=flat-square&logo=tailwindcss&logoColor=22d3ee&labelColor=0a0a0d" alt="Tailwind 4">
</p>

<p align="center">
  <em>A self-hosted playground for genetic algorithms, simulations, media pipelines, and assorted curios — all served from one Next.js app under one roof.</em>
</p>

---

## What is this?

`devys-workshop` is the monorepo behind [**devydev.ca**](https://devydev.ca) — a single Next.js 15 / React 19 application hosting **thirteen** small projects that each get their own page, their own database tables, and their own opinions about what makes a good interface. Some are evolutionary playgrounds (BrainFuck GA, image evolver, neuroevolution); some are personal infrastructure (Jellyfin ingestion, Soulseek bridge, server dashboard); some are tools I wanted that didn't exist quite the way I wanted them (polar clock, house planner, splitwiser).

Each project is allowed to look and feel like its own thing. The shared chrome is light on purpose.

```
17 page routes · 60 API routes · 31 components · 8 migrations · 27k LOC of TypeScript
```

---

## The Workbench

<table align="center">
<tr>
<td><a href="https://devydev.ca/projects/brainfuck"><img src="docs/readme/tiles/brainfuck.svg" alt="BrainFuck GA" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/gol"><img src="docs/readme/tiles/gol.svg" alt="Game of Life" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/ecosystem"><img src="docs/readme/tiles/ecosystem.svg" alt="Ecosystem" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/neuroevolution"><img src="docs/readme/tiles/neuroevolution.svg" alt="Neuroevolution" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/image-evolver"><img src="docs/readme/tiles/image-evolver.svg" alt="Image Evolver" width="160"/></a></td>
</tr>
<tr>
<td><a href="https://devydev.ca/projects/polar-clock"><img src="docs/readme/tiles/polar-clock.svg" alt="Polar Clock" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/house"><img src="docs/readme/tiles/house.svg" alt="House Planner" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/challenges"><img src="docs/readme/tiles/challenges.svg" alt="LoL Challenges" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/jellyfin"><img src="docs/readme/tiles/jellyfin.svg" alt="Jellyfin Ingest" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/soulseek"><img src="docs/readme/tiles/soulseek.svg" alt="Soulseek" width="160"/></a></td>
</tr>
<tr>
<td><a href="https://devydev.ca/projects/barfoo"><img src="docs/readme/tiles/barfoo.svg" alt="BarFoo Player" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/splitwiser"><img src="docs/readme/tiles/splitwiser.svg" alt="Splitwiser" width="160"/></a></td>
<td><a href="https://devydev.ca/projects/server"><img src="docs/readme/tiles/server.svg" alt="Server Status" width="160"/></a></td>
<td colspan="2" align="center"><sub>each tile links to the live project on<br/><a href="https://devydev.ca">devydev.ca</a></sub></td>
</tr>
</table>

---

## Under the Hood

```mermaid
flowchart LR
    classDef ui fill:#0a0a0d,stroke:#e879f9,color:#fafafa
    classDef srv fill:#0a0a0d,stroke:#22d3ee,color:#fafafa
    classDef data fill:#0a0a0d,stroke:#34d399,color:#fafafa
    classDef ext fill:#0a0a0d,stroke:#fbbf24,color:#fafafa

    Browser["Browser<br/>React 19 / Tailwind 4"]:::ui
    Next["Next.js 15<br/>App Router · 60 API routes"]:::srv
    PG[("Postgres 16<br/>workshop")]:::data
    PY["Python · BF GA<br/>subprocess"]:::srv
    Slskd["slskd<br/>Soulseek"]:::ext
    Jellyfin["Jellyfin"]:::ext
    Trans["Transmission"]:::ext
    Riot["Riot API"]:::ext

    Browser <-->|HTTPS| Next
    Next <-->|pg pool, scoped roles| PG
    Next -->|spawn / JSON lines| PY
    Next <-->|REST| Slskd
    Next <-->|REST| Jellyfin
    Next <-->|RPC| Trans
    Next <-->|REST| Riot
```

Each long-running side process talks to Postgres through its own scoped role (`workshop`, `soulseek_ingest`, `challenge_poller`) — no shared admin credential touches the runtime path.

---

## Projects

### Evolution & algorithms

<table>
<tr>
<td width="180" valign="top"><a href="https://devydev.ca/projects/brainfuck"><img src="docs/readme/tiles/brainfuck.svg" alt="" width="160"/></a></td>
<td valign="top">

#### `01` · BrainFuck Genetic Algorithm

Evolves BrainFuck source code that prints a target string. Tournament selection over a tape-themed hyperparameter form, a fitness cache, and a custom RLE interpreter that compiles `++++++++` into a single `(ADD, 8)` op before dispatching.

<img src="https://img.shields.io/badge/RLE_interpreter-e879f9?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/tournament_select-e879f9?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/preset_slots-e879f9?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/live_tape_animator-e879f9?style=flat-square&labelColor=0a0a0d"/>

<details>
<summary><b>Throughput journey →</b></summary>

| | gens/sec | per-interp | speedup |
|--|--|--|--|
| original (Java shell-out per eval) | 5.8 | ~170 ms | 1× |
| pure-Python interpreter | 569 | 1.8 ms | 98× |
| + tournament + RLE compile | **7,544** | **0.4 ms** | **1,300×** |

Seven-letter target now reaches fitness 1777/1792 in 200k gens / **4 minutes** — same workload took **15 minutes** for 133k gens before the throughput pass. Each commit on the BF reference repo is auto-tagged by the workshop's benchmark suite so regressions show up immediately.

</details>
</td>
</tr>
</table>

<table>
<tr>
<td valign="top">

#### `05` · Image Evolver

Genetic approximation of a target photograph using semi-transparent polygons. Mutates vertex positions and colors; selection is greedy on per-pixel SSE. Watch the abstract version of your face slowly resolve.

<img src="https://img.shields.io/badge/canvas_diff-22d3ee?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/preset_targets-22d3ee?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/fitness_chart-22d3ee?style=flat-square&labelColor=0a0a0d"/>

</td>
<td width="180" valign="top"><a href="https://devydev.ca/projects/image-evolver"><img src="docs/readme/tiles/image-evolver.svg" alt="" width="160"/></a></td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top"><a href="https://devydev.ca/projects/neuroevolution"><img src="docs/readme/tiles/neuroevolution.svg" alt="" width="160"/></a></td>
<td valign="top">

#### `04` · Neuroevolution

Tiny feed-forward networks learn to steer a car around procedurally generated racetracks. Each generation, the survivors crossover and mutate; the population graph next to the track shows the lineage of the best driver.

<img src="https://img.shields.io/badge/canvas_track-60a5fa?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/raycast_sensors-60a5fa?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/lineage_graph-60a5fa?style=flat-square&labelColor=0a0a0d"/>

</td>
</tr>
</table>

<table>
<tr>
<td valign="top">

#### `03` · Ecosystem

Predator–prey simulation where both species mutate their own behavioral parameters across generations. Population swings, extinction events, sometimes equilibria. Reset the seed and watch a different drama play out.

<img src="https://img.shields.io/badge/agent_swarm-34d399?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/co--evolution-34d399?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/population_graph-34d399?style=flat-square&labelColor=0a0a0d"/>

</td>
<td width="180" valign="top"><a href="https://devydev.ca/projects/ecosystem"><img src="docs/readme/tiles/ecosystem.svg" alt="" width="160"/></a></td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top"><a href="https://devydev.ca/projects/gol"><img src="docs/readme/tiles/gol.svg" alt="" width="160"/></a></td>
<td valign="top">

#### `02` · Game of Life

Conway's classic on an infinite canvas. Pan, zoom, draw cells by hand, or load classic patterns (glider, gosper gun, R-pentomino). Generation counter and step-by-step controls.

<img src="https://img.shields.io/badge/infinite_canvas-4ade80?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/pattern_library-4ade80?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/pan_zoom-4ade80?style=flat-square&labelColor=0a0a0d"/>

</td>
</tr>
</table>

---

### Visualization & tools

<table>
<tr>
<td valign="top">

#### `06` · Polar Clock

Time encoded as concentric rings — seconds, minutes, hours, days, months, day-of-year. Each ring fills as its unit progresses. Eight color palettes (Aurora, Cyberpunk, Sunset, …), timezone selector, exports to a Lively-compatible wallpaper.

<img src="https://img.shields.io/badge/8_palettes-a78bfa?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/wallpaper_export-a78bfa?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/gol_background-a78bfa?style=flat-square&labelColor=0a0a0d"/>

</td>
<td width="180" valign="top"><a href="https://devydev.ca/projects/polar-clock"><img src="docs/readme/tiles/polar-clock.svg" alt="" width="160"/></a></td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top"><a href="https://devydev.ca/projects/house"><img src="docs/readme/tiles/house.svg" alt="" width="160"/></a></td>
<td valign="top">

#### `07` · House Planner

Drag-and-drop interior layout tool. SVG furniture symbols on a snap-grid, rotate / lock / group, save layouts as JSON or PNG. Built when I was rearranging my actual living room and decided I needed a tool I could share a link to.

<img src="https://img.shields.io/badge/svg_furniture-d6d3d1?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/snap_grid-d6d3d1?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/json_export-d6d3d1?style=flat-square&labelColor=0a0a0d"/>

</td>
</tr>
</table>

---

### Media stack

<table>
<tr>
<td valign="top">

#### `09` · Jellyfin Ingest

Magnet/torrent → Transmission → renamed → Jellyfin library. Live transfer progress, seeding leaderboard, history log of finished jobs. The "drop a magnet, walk away" pipeline I always wanted.

<img src="https://img.shields.io/badge/transmission_rpc-818cf8?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/jellyfin_api-818cf8?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/auto_rename-818cf8?style=flat-square&labelColor=0a0a0d"/>

</td>
<td width="180" valign="top"><a href="https://devydev.ca/projects/jellyfin"><img src="docs/readme/tiles/jellyfin.svg" alt="" width="160"/></a></td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top"><a href="https://devydev.ca/projects/soulseek"><img src="docs/readme/tiles/soulseek.svg" alt="" width="160"/></a></td>
<td valign="top">

#### `10` · Soulseek

Browser frontend over a local `slskd` daemon for searching and pulling music off the Soulseek P2P network. Quality-tier badges (FLAC > V0 > 320 > everything else), expandable per-user trees, drag-to-queue, staged metadata review before files land in the library.

<img src="https://img.shields.io/badge/slskd_bridge-38bdf8?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/quality_filter-38bdf8?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/staged_ingest-38bdf8?style=flat-square&labelColor=0a0a0d"/>

</td>
</tr>
</table>

<table>
<tr>
<td valign="top">

#### `11` · BarFoo Player

Album-first music player that walks your local FLAC/MP3 library and serves it through a grid of cover art. Click an album, listen. The opposite of an algorithmic "for you" feed.

<img src="https://img.shields.io/badge/cover_grid-f59e0b?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/flac_/_mp3-f59e0b?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/local_first-f59e0b?style=flat-square&labelColor=0a0a0d"/>

</td>
<td width="180" valign="top"><a href="https://devydev.ca/projects/barfoo"><img src="docs/readme/tiles/barfoo.svg" alt="" width="160"/></a></td>
</tr>
</table>

---

### Trackers & utilities

<table>
<tr>
<td width="180" valign="top"><a href="https://devydev.ca/projects/challenges"><img src="docs/readme/tiles/challenges.svg" alt="" width="160"/></a></td>
<td valign="top">

#### `08` · LoL Challenges

League of Legends in-game achievement tracker — six categories, per-champion completion data, tier badges with the game's actual color codes. A background poller hits the Riot API on a cron and the UI animates whenever a tier-up arrives.

<img src="https://img.shields.io/badge/riot_api-fbbf24?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/cron_poller-fbbf24?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/tier_glow-fbbf24?style=flat-square&labelColor=0a0a0d"/>

</td>
</tr>
</table>

<table>
<tr>
<td valign="top">

#### `12` · Splitwiser

A Splitwise-shaped tool for groups (trips, roommates, dinners). Add expenses, auto-settle debts, see who owes whom in real time. QR-link logins for invitees who don't want yet another account.

<img src="https://img.shields.io/badge/group_balances-fb7185?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/qr_invites-fb7185?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/auto_settle-fb7185?style=flat-square&labelColor=0a0a0d"/>

</td>
<td width="180" valign="top"><a href="https://devydev.ca/projects/splitwiser"><img src="docs/readme/tiles/splitwiser.svg" alt="" width="160"/></a></td>
</tr>
</table>

<table>
<tr>
<td width="180" valign="top"><a href="https://devydev.ca/projects/server"><img src="docs/readme/tiles/server.svg" alt="" width="160"/></a></td>
<td valign="top">

#### `13` · Server Status

The dashboard that watches the box hosting all of the above. CPU/memory/disk gauges, per-process metrics, live-streaming systemd journal logs, RCON commands for the Minecraft server. The instrument panel for the workshop itself.

<img src="https://img.shields.io/badge/live_metrics-2dd4bf?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/journal_stream-2dd4bf?style=flat-square&labelColor=0a0a0d"/> <img src="https://img.shields.io/badge/minecraft_rcon-2dd4bf?style=flat-square&labelColor=0a0a0d"/>

</td>
</tr>
</table>

---

## Stack

<p>
  <img src="https://img.shields.io/badge/Next.js_15-fafafa?style=for-the-badge&logo=nextdotjs&logoColor=fafafa&labelColor=0a0a0d" alt="Next.js"/>
  <img src="https://img.shields.io/badge/React_19-22d3ee?style=for-the-badge&logo=react&logoColor=22d3ee&labelColor=0a0a0d" alt="React"/>
  <img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=3178c6&labelColor=0a0a0d" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Tailwind_4-22d3ee?style=for-the-badge&logo=tailwindcss&logoColor=22d3ee&labelColor=0a0a0d" alt="Tailwind"/>
  <img src="https://img.shields.io/badge/Motion-e879f9?style=for-the-badge&labelColor=0a0a0d" alt="Motion"/>
  <img src="https://img.shields.io/badge/Radix_UI-fafafa?style=for-the-badge&labelColor=0a0a0d" alt="Radix"/>
</p>
<p>
  <img src="https://img.shields.io/badge/Postgres_16-336791?style=for-the-badge&logo=postgresql&logoColor=336791&labelColor=0a0a0d" alt="Postgres"/>
  <img src="https://img.shields.io/badge/Python-fbbf24?style=for-the-badge&logo=python&logoColor=fbbf24&labelColor=0a0a0d" alt="Python"/>
  <img src="https://img.shields.io/badge/systemd-fafafa?style=for-the-badge&logo=systemd&logoColor=fafafa&labelColor=0a0a0d" alt="systemd"/>
  <img src="https://img.shields.io/badge/Transmission_RPC-d23535?style=for-the-badge&labelColor=0a0a0d" alt="Transmission"/>
  <img src="https://img.shields.io/badge/Jellyfin-00a4dc?style=for-the-badge&logo=jellyfin&logoColor=00a4dc&labelColor=0a0a0d" alt="Jellyfin"/>
  <img src="https://img.shields.io/badge/slskd-38bdf8?style=for-the-badge&labelColor=0a0a0d" alt="slskd"/>
</p>

---

## Local Development

```bash
# clone, install
git clone git@github.com:dev-gough/workshop.git devys-workshop
cd devys-workshop
npm install

# postgres — create the workshop db and per-service roles
sudo -u postgres psql -c "CREATE DATABASE workshop;"
sudo -u postgres psql -c "CREATE USER workshop WITH PASSWORD 'workshop';"
sudo -u postgres psql -c "GRANT ALL ON DATABASE workshop TO workshop;"

# apply migrations in order
for f in scripts/migrations/*.sql; do
  PGPASSWORD=workshop psql -h localhost -U workshop -d workshop -f "$f"
done

# run
npm run dev   # → http://localhost:3000
```

Per-project setup notes (Soulseek's `slskd` daemon, Jellyfin endpoints, Riot API key, Python venv for the BF GA, etc.) live in the `scripts/` and `docs/` subtrees.

---

<div align="center">

<sub>
built &amp; broken in equal measure by <a href="https://devydev.ca">Devy</a> · 
<a href="https://github.com/dev-gough/workshop">github</a> · 
<a href="https://devydev.ca">devydev.ca</a>
</sub>

</div>
