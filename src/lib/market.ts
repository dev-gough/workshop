/**
 * NYSE market-hours calendar for the paper-trading project.
 *
 * Regular session is 09:30–16:00 America/New_York, Monday–Friday, minus US market
 * holidays. We deliberately ignore half-day early closes — this is paper trading,
 * and a fill a few hours late on a holiday-eve costs nothing. All reasoning is done
 * on the wall-clock time in New York (which handles EST/EDT automatically via Intl).
 */

// Full-day market closures. Extend as years roll over. Format: YYYY-MM-DD (ET).
const MARKET_HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King Jr. Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
  // 2027
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18', // Juneteenth (observed)
  '2027-07-05', // Independence Day (observed)
  '2027-09-06',
  '2027-11-25',
  '2027-12-24', // Christmas (observed)
]);

interface EtParts {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
  hour: number;
  minute: number;
}

const PART_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Decompose an instant into its New-York wall-clock parts. */
function etParts(date: Date): EtParts {
  const parts: Record<string, string> = {};
  for (const p of PART_FMT.formatToParts(date)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
    hour,
    minute: parseInt(parts.minute, 10),
  };
}

function isoDate(p: EtParts): string {
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** A weekday that isn't a holiday — i.e. a day the market trades. */
function isTradingDay(p: EtParts): boolean {
  if (p.weekday === 0 || p.weekday === 6) return false;
  return !MARKET_HOLIDAYS.has(isoDate(p));
}

/** True when the regular NYSE session is open at `date`. */
export function isMarketOpen(date: Date = new Date()): boolean {
  const p = etParts(date);
  if (!isTradingDay(p)) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * The instant the regular session opens (09:30 ET) on `date`'s trading day, or null
 * when `date` falls on a non-trading day (weekend/holiday). Used to detect quotes
 * captured before today's session began. Computed by walking back from a fixed 09:30
 * ET wall-clock guess until its ET parts land on the same calendar day at 09:30.
 */
export function todaysMarketOpen(date: Date = new Date()): Date | null {
  const p = etParts(date);
  if (!isTradingDay(p)) return null;
  // Minute-by-minute is overkill; instead, binary-free: probe candidate UTC instants
  // for the same ET calendar day at 09:30. ET is UTC-5 (EST) or UTC-4 (EDT), so the
  // open lands at 13:30 or 14:30 UTC. Try both and pick the one whose ET parts match.
  for (const utcHour of [13, 14]) {
    const candidate = new Date(Date.UTC(p.year, p.month - 1, p.day, utcHour, 30, 0, 0));
    const cp = etParts(candidate);
    if (cp.year === p.year && cp.month === p.month && cp.day === p.day && cp.hour === 9 && cp.minute === 30) {
      return candidate;
    }
  }
  return null;
}

/**
 * The next instant the market opens at or after `date`. Used for display
 * ("queued — fills at next open"). Steps forward minute-by-minute and snaps to the
 * first open minute; bounded so a long stretch of closures can't loop forever.
 */
export function nextMarketOpen(date: Date = new Date()): Date | null {
  const start = new Date(date);
  start.setSeconds(0, 0);
  // Already open → the "next open" is effectively now.
  if (isMarketOpen(start)) return start;
  const cursor = new Date(start);
  for (let i = 0; i < 20_000; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    if (isMarketOpen(cursor)) return new Date(cursor);
  }
  return null;
}
