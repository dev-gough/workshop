// Payload-mass estimation for RM 17 (Mission Control).
//
// Launch Library 2 gives us the flight record but not payload masses, and
// SpaceX stopped publishing them for most flights around the start of the
// Starlink era — which is precisely where most of the tonnage is. So masses
// here are a layered rules engine, most-specific first:
//
//   1. `lookup`   — curated table of notable payloads with published masses
//   2. `starlink` — batch count parsed from the mission description × a
//                   per-satellite mass for that hardware generation
//   3. `dragon`   — capsule missions get the (well-documented) Dragon masses
//   4. `coarse`   — orbit-class typical mass, the honest "we don't know"
//   5. `none`     — no rule matched; counts as 0 t and is flagged in the UI
//
// Numbers are community-researched estimates where SpaceX is silent (same
// posture as the Megabonk damage model: editable, sourced in comments, and
// never presented as gospel). Re-running the sync re-applies these rules to
// every launch, so corrections here fix history.

export type MassSource = 'lookup' | 'starlink' | 'dragon' | 'coarse' | 'none';

export interface MassEstimate {
  kg: number | null;
  source: MassSource;
  note: string;
}

export interface LaunchFacts {
  missionName: string;
  description: string;
  vehicle: string; // Falcon 1 | Falcon 9 | Falcon Heavy | Starship
  net: Date;
  orbitAbbrev: string | null;
}

/** Group an LL2 launcher config into the marketing name the room charts by. */
export function groupVehicle(configName: string): string {
  if (configName.startsWith('Falcon 9')) return 'Falcon 9';
  if (configName.startsWith('Falcon Heavy')) return 'Falcon Heavy';
  if (configName.startsWith('Falcon 1')) return 'Falcon 1';
  if (configName.startsWith('Starship')) return 'Starship';
  return configName;
}

// ── 1. Curated lookup ───────────────────────────────────────────────────────
// Published (or well-reported) masses for payloads big or famous enough to
// matter individually. Matched against the LL2 mission name. `vehicle` guards
// ambiguous names — Falcon 1's third flight and Starship's third test are
// both just "Flight 3" in LL2.
const LOOKUP: Array<{ match: RegExp; kg: number; note: string; vehicle?: string }> = [
  // Falcon 1 — the whole manifest, tiny masses, worth being exact about.
  { match: /FalconSAT-2/i, kg: 19.5, note: 'FalconSAT-2 (flight failed)' },
  { match: /DemoSat/i, kg: 0, note: 'no payload (demo flight, failed)' },
  { match: /^Flight 3$|Trailblazer|Jumpstart/i, kg: 83, vehicle: 'Falcon 1', note: 'Trailblazer + cubesats (flight failed)' },
  { match: /RatSat/i, kg: 165, note: 'RatSat mass simulator' },
  { match: /RazakSAT/i, kg: 180, note: 'RazakSAT' },
  // Falcon 9 / Heavy notables with published masses.
  { match: /Tesla Roadster|Falcon Heavy Demo/i, kg: 1305, note: 'Roadster + adapter' },
  { match: /Arabsat[- ]?6A/i, kg: 6465, note: 'published mass' },
  { match: /STP-2/i, kg: 3700, note: '24-payload DoD rideshare' },
  { match: /Telstar 19V/i, kg: 7076, note: 'heaviest commercial comsat of its day' },
  { match: /Telstar 18V/i, kg: 7060, note: 'published mass' },
  { match: /Intelsat 35e/i, kg: 6761, note: 'published mass' },
  { match: /Inmarsat-5/i, kg: 6070, note: 'published mass' },
  { match: /EchoStar 23/i, kg: 5600, note: 'published mass' },
  { match: /SES-9/i, kg: 5271, note: 'published mass' },
  { match: /SES-8/i, kg: 3138, note: 'published mass' },
  { match: /JCSAT-14/i, kg: 4696, note: 'published mass' },
  { match: /Bangabandhu/i, kg: 3600, note: 'published mass' },
  { match: /GPS III/i, kg: 4311, note: 'GPS III satellite' },
  { match: /Iridium(-| )NEXT/i, kg: 9600, note: '10 × 860 kg + dispenser' },
  { match: /TESS/i, kg: 362, note: 'published mass' },
  { match: /DART/i, kg: 610, note: 'published mass' },
  { match: /Psyche/i, kg: 2608, note: 'published mass' },
  { match: /Euclid/i, kg: 2160, note: 'published mass' },
  { match: /Jason-3/i, kg: 553, note: 'published mass' },
  { match: /DSCOVR/i, kg: 570, note: 'published mass' },
  { match: /IXPE/i, kg: 330, note: 'published mass' },
  { match: /Europa Clipper/i, kg: 6065, note: 'published mass' },
  { match: /Hakuto-R/i, kg: 1000, note: 'lander + rideshare, approximate' },
  { match: /Korea ?Pathfinder|KPLO|Danuri/i, kg: 678, note: 'published mass' },
  { match: /Nova-C|IM-[123]/i, kg: 1931, note: 'Intuitive Machines lander, fueled' },
  { match: /X-37B|OTV-/i, kg: 4990, note: 'X-37B, approximate' },
  { match: /JCSAT-18|KACIFIC-?1/i, kg: 6956, note: 'published mass' },
  { match: /Nusantara Satu/i, kg: 4700, note: 'PSN-6 + Beresheet + S5, approximate' },
  { match: /^Hera$/i, kg: 1210, note: 'Hera asteroid probe, approximate' },
];

// ── 2. Starlink generations ─────────────────────────────────────────────────
// Per-satellite masses: v0.9/v1.0 were published (227/260 kg); v1.5 (~306 kg)
// and V2 Mini (~790 kg) are consistent community figures; the lighter
// "optimized" V2 Mini (~575 kg) is inferred from Falcon 9 batch sizes jumping
// to 26–29; V3 (~1900 kg, Starship only) from SpaceX's stated V3 specs.
interface StarlinkGen {
  from: string; // first launch date of the generation (UTC)
  perSat: number;
  label: string;
  defaultCount: number; // used when the description doesn't state a batch size
}
const STARLINK_GENS: StarlinkGen[] = [
  { from: '2019-05-01', perSat: 227, label: 'v0.9', defaultCount: 60 },
  { from: '2019-11-01', perSat: 260, label: 'v1.0', defaultCount: 60 },
  { from: '2021-09-01', perSat: 306, label: 'v1.5', defaultCount: 53 },
  { from: '2023-02-01', perSat: 790, label: 'V2 Mini', defaultCount: 22 },
];
const STARLINK_V2_OPTIMIZED = { perSat: 575, label: 'V2 Mini (optimized)' };
const STARLINK_V3 = { perSat: 1900, label: 'V3', defaultCount: 20 };

function starlinkEstimate(f: LaunchFacts): MassEstimate | null {
  const mentions =
    /starlink/i.test(f.missionName) || /starlink satellites/i.test(f.description);
  if (!mentions) return null;

  // "A batch of 24 satellites…" / "carry 20 V3 Starlink satellites"
  const m =
    f.description.match(/batch of (\d+)/i) ??
    f.description.match(/(\d+)\s+V\d\s+Starlink/i) ??
    f.description.match(/(\d+)\s+Starlink/i);
  const parsed = m ? parseInt(m[1], 10) : null;

  let gen: { perSat: number; label: string };
  let count: number;
  if (f.vehicle === 'Starship') {
    gen = STARLINK_V3;
    count = parsed ?? STARLINK_V3.defaultCount;
  } else {
    let g = STARLINK_GENS[0];
    for (const cand of STARLINK_GENS) {
      if (f.net >= new Date(cand.from)) g = cand;
    }
    count = parsed ?? g.defaultCount;
    // Batches of 26+ only fit on Falcon 9 with the lighter optimized bus.
    gen = g.label === 'V2 Mini' && count >= 26 ? STARLINK_V2_OPTIMIZED : g;
  }

  return {
    kg: count * gen.perSat,
    source: 'starlink',
    note: `${count}${parsed ? '' : ' (assumed)'} × ${gen.perSat} kg ${gen.label}`,
  };
}

// ── 3. Dragon ───────────────────────────────────────────────────────────────
const CREW_DRAGON = /^Crew-\d|^Demo-2|^DM-2|Axiom|^Ax-\d|Inspiration4|Polaris Dawn|Fram2/i;
const CARGO_DRAGON = /^CRS-?\d|^SpX-?\d|^COTS|^Demo Flight|Dragon Qualification|^DM-1|^Demo-1|^Crew Dragon Demo-1/i;

function dragonEstimate(f: LaunchFacts): MassEstimate | null {
  if (CREW_DRAGON.test(f.missionName)) {
    return { kg: 12500, source: 'dragon', note: 'Crew Dragon, loaded' };
  }
  if (CARGO_DRAGON.test(f.missionName)) {
    // CRS-21 (Dec 2020) switched the cargo contract to Dragon 2.
    const dragon2 = f.net >= new Date('2020-11-01');
    return dragon2
      ? { kg: 12200, source: 'dragon', note: 'Cargo Dragon 2, loaded' }
      : { kg: 9000, source: 'dragon', note: 'Dragon 1 + cargo, approximate' };
  }
  return null;
}

// ── 4. Orbit-class fallback ─────────────────────────────────────────────────
// Typical Falcon-class payload masses by target orbit. Deliberately round
// numbers: these are order-of-magnitude stand-ins, always flagged as coarse.
const ORBIT_TYPICAL: Record<string, number> = {
  LEO: 8000, // dedicated LEO missions (constellations, stations)
  SSO: 4200, // sun-synchronous, incl. Transporter-class rideshares
  PO: 4500,
  GTO: 5300, // classic commercial comsat
  GEO: 3700, // direct-to-GEO (usually Falcon Heavy, expended)
  'Direct-GEO': 3700,
  MEO: 3900, // GPS / O3b class
  Sub: 0,
  Elliptical: 4000,
  HEO: 4000,
  LO: 1200, // lunar orbit
  Asteroid: 1200,
  'L1-point': 1500,
  'L2-point': 1500,
};

/** Best-effort payload mass for one launch. */
export function estimateMass(f: LaunchFacts): MassEstimate {
  for (const row of LOOKUP) {
    if (row.match.test(f.missionName) && (!row.vehicle || row.vehicle === f.vehicle)) {
      return { kg: row.kg, source: 'lookup', note: row.note };
    }
  }

  // Classified NRO flights: no orbit, no mass, ever. Kuiper-class guess.
  if (/^NROL-/i.test(f.missionName)) {
    return { kg: 5000, source: 'coarse', note: 'classified NRO payload (guess)' };
  }

  const starlink = starlinkEstimate(f);
  if (starlink) return starlink;

  const dragon = dragonEstimate(f);
  if (dragon) return dragon;

  // Starship test flights: nothing on board that counts as payload.
  if (f.vehicle === 'Starship') {
    return { kg: 0, source: 'lookup', note: 'test flight, no payload' };
  }

  if (f.orbitAbbrev && f.orbitAbbrev in ORBIT_TYPICAL) {
    return {
      kg: ORBIT_TYPICAL[f.orbitAbbrev],
      source: 'coarse',
      note: `typical ${f.orbitAbbrev} payload (mass unpublished)`,
    };
  }

  return { kg: null, source: 'none', note: 'no mass rule matched' };
}
