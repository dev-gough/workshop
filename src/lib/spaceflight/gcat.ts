// GCAT (planet4589.org, J. McDowell, CC-BY) → Postgres mirror for the
// world-history side of RM 03. Two bulk files, one weekly sync — the polite
// alternative to paginating 7,000+ launches out of a rate-limited API.
//
// After the mirror reloads, GCAT's per-launch payload masses are adopted
// into the SpaceX table (spaceflight_launches) wherever a launch matches by
// time: GCAT's numbers are better sourced than our description-parsing
// estimator, which then only bridges the gap until GCAT's next update.
// Starship is deliberately NOT overridden — GCAT counts a ship reaching
// space as ~120 t of payload, which contradicts the room's stated rule
// (test flights deliver only what they deploy).

import type { Pool } from 'pg';

const LAUNCH_URL = 'https://planet4589.org/space/gcat/tsv/launch/launch.tsv';
const LV_URL = 'https://planet4589.org/space/gcat/tsv/tables/lv.tsv';
const UA = 'devys-workshop/1.0 (personal dashboard; single weekly sync)';

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

async function fetchTsv(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`GCAT ${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  const lines = text.split('\n');
  const header = lines[0].replace(/^#/, '').split('\t').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('#')) continue;
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = (cells[c] ?? '').trim();
    rows.push(row);
  }
  return rows;
}

/** "2026 Jul 25 1551:21" | "1961 Oct" | "1957" → Date or null (partial). */
function parseGcatDate(s: string): Date | null {
  const m = s.match(/^(\d{4})(?:\s+(\w{3}))?(?:\s+(\d{1,2}))?(?:\s+(\d{2})(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mon, day, hh, mm, ss] = m;
  if (!mon || !(mon in MONTHS)) return null; // year-only: too coarse to place
  return new Date(Date.UTC(
    Number(y), MONTHS[mon], Number(day ?? 1),
    Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0)
  ));
}

export interface GcatSyncResult {
  ingested: number;
  spacexAdopted: number;
}

export async function syncGcat(pool: Pool): Promise<GcatSyncResult> {
  const [lvRows, launchRows] = await Promise.all([fetchTsv(LV_URL), fetchTsv(LAUNCH_URL)]);
  const family = new Map(lvRows.map((r) => [r.LV_Name, r.LV_Family]));

  interface Row {
    tag: string; year: number; date: Date | null; lvType: string; variant: string | null;
    family: string; mission: string | null; agency: string | null; site: string | null;
    category: string; outcome: string; success: boolean; payloadT: number;
  }
  const rows: Row[] = [];
  for (const r of launchRows) {
    const code = r.LaunchCode ?? '';
    const category = code[0];
    const outcome = code.slice(1) || 'U';
    // Orbital + deep-space attempts only; pad explosions/aborts (E/A) never
    // left the ground and don't count as flights.
    if (category !== 'O' && category !== 'D') continue;
    if (outcome[0] === 'E' || outcome[0] === 'A') continue;
    const year = Number(r.Launch_Tag?.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    rows.push({
      tag: r.Launch_Tag,
      year,
      date: parseGcatDate(r.Launch_Date ?? ''),
      lvType: r.LV_Type,
      variant: r.Variant === '-' ? null : r.Variant,
      family: family.get(r.LV_Type) ?? r.LV_Type,
      mission: r.Mission === '-' ? null : r.Mission,
      agency: r.Agency === '-' ? null : r.Agency,
      site: r.Launch_Site === '-' ? null : r.Launch_Site,
      category,
      outcome,
      success: outcome[0] === 'S',
      payloadT: Number(r.OrbPay) || 0,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE gcat_launches');
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((r, j) => {
        values.push(
          r.tag, r.year, r.date, r.lvType, r.variant, r.family, r.mission,
          r.agency, r.site, r.category, r.outcome, r.success, r.payloadT
        );
        const b = j * 13;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
      });
      await client.query(
        `INSERT INTO gcat_launches
           (launch_tag, year, launch_date, lv_type, lv_variant, family, mission,
            agency, site, category, outcome, success, payload_t)
         VALUES ${tuples.join(',')}`,
        values
      );
    }

    // Adopt GCAT masses for matched SpaceX flights (±30 min). payload_t > 0
    // keeps unknowns (e.g. classified with no GCAT figure) on our estimator.
    const adopted = await client.query(
      `UPDATE spaceflight_launches sl
          SET mass_kg = g.payload_t * 1000,
              mass_source = 'gcat',
              mass_note = 'GCAT OrbPay (' || g.launch_tag || ')'
         FROM gcat_launches g
        WHERE g.family IN ('Falcon1', 'Falcon9')
          AND g.launch_date IS NOT NULL
          AND g.payload_t > 0
          AND NOT sl.is_upcoming
          AND sl.vehicle <> 'Starship'
          AND abs(extract(epoch FROM (sl.net - g.launch_date))) < 1800`
    );

    await client.query(
      `INSERT INTO spaceflight_meta (key, value, updated_at)
       VALUES ('last_gcat_sync', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [new Date().toISOString()]
    );
    await client.query('COMMIT');
    return { ingested: rows.length, spacexAdopted: adopted.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
