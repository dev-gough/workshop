# The Outfitter — TODO / roadmap

Purpose shift (2026-08-08): from room to **hardcore trip tool** — maximum use,
minimal bullshit. Target: an installable app the Temagami crew can carry,
GPS-aware, fully offline in-park.

## Next up

- **Garmin inReach import.** Thomas's inReach logged the May trip (Opeongo
  water taxi → Proulx → Crow River → Crow Bay). Garmin MapShare exposes a
  per-device KML feed (the raw inReach API needs a professional account — the
  MapShare share-URL feed is the pragmatic path; a one-time KML/GPX file
  export works too). Import tracks (points + timestamps) into a
  `paddle_tracks` table → overlay real tracks on the chart, replay them, and
  **calibrate the cost model** (paddle/walk km/h, load-unload penalty)
  against real timings per leg.
- Portage elevation profiles from the cached DEM (like Jeff's printed climb
  graphs), shown when hovering a carry / in the trip ledger.
- Waypoint drag-to-adjust; insert-between; day ends that snap to campsites.
- Campsite curation UI (paddle_campsites table already survives re-ingest).

## Field kit (in-park use — short ideas, expand as built)

- **GPS**: geolocation watch → position puck + heading cone on the chart;
  "distance to next carry / campsite" glance line in the readout; off-route
  nudge when >200 m from the active trip line.
- **Offline**: service worker + "take this trip offline" button — pre-cache
  chart/imagery/DEM tiles along the route buffer (size the download, show progress),
  network JSON, trip data. Cache versioning keyed on park built_at.
- **Timing**: one-tap leg log ("underway"/"landed") stamps actual times per
  leg onto the trip → actual-vs-estimate view; feeds the same calibration as
  inReach tracks. Big thumb-sized button when a trip is active in the field.
- **Photos**: camera capture geotagged to the trip (photo pins on the chart
  at capture spot, thumbnail strip per day); server keeps originals per trip.
- **Battery discipline**: field mode should drop terrain, hillshade, and the
  RAF-heavy bits; dark chart at night.

## The app (Temagami crew)

- **PWA**: manifest + service worker; installable from the site. Pre-cache a
  trip's corridor for offline: chart + imagery + DEM tiles along the route buffer,
  network JSON, the trip itself. Everything is already self-hosted, so
  offline is a caching problem, not an architecture problem.
- **GPS**: browser geolocation → position puck on the chart, "distance to
  next carry" glance, off-route nudge. inReach breadcrumbs for the crew who
  have one.
- Trip share links (`/projects/paddle?trip=<slug>`) — shipped 2026-08-08.
- Aerial imagery layer — shipped 2026-08-08. Ontario's OIWMS orthos (20–40 cm
  acquisitions, OGL–Ontario so self-hosting/offline bundling is legal) as a
  self-hosted XYZ pyramid, z4–15 over the park bbox:
  `npm run import-imagery-tiles -- --park <slug>` → "Aerials" toggle. Drapes
  over the terrain mesh; gives chart-less Temagami a photographic base.
- Chart licensing: Jeff's tiles are a personal-use purchase. Decide how the
  crew handles copies before sharing installs (per-person purchase is the
  clean answer; the tool must also work chart-less on the vector base).
- Temagami: buy + `npm run import-jeff-tiles` + `sync-paddle --park temagami`
  — alignment, arbitration, terrain all light up automatically.

## Architecture principles (decided 2026-08-08 — keep these true)

1. **Trips store geometry, never graph ids.** Waypoints persist as lon/lat
   and re-snap on load — segment indexes change on every re-ingest, so a
   saved trip must outlive the network build that existed when it was drawn.
2. **Re-ingest is always safe.** Hand-curated data (campsites, trips) lives
   in its own tables; everything derived (network, alignment) is rebuilt
   deterministically from OTN + the chart.
3. **The chart is ground truth** for what a route *is* (dots = carry, ribbon
   without dots = paddle, bare paper = track); OTN is ground truth for
   topology.
4. **Self-hosted end to end** — tiles, DEM, graph, router all live on this
   box / in this bundle. No third-party runtime dependency, which is what
   makes offline-first possible at all.
5. **Real trips are regression tests.** `npm run paddle-verify` routes known
   trips (starting with the May Crow River trip) and fails on connectivity or
   cost regressions. Add every future trip trace as a fixture.
