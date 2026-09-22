import type { DayTotals } from './use-trip-plan';

const RAD = Math.PI / 180;

export interface DaylightDay {
  date: string;
  sunriseMin: number;
  sunsetMin: number;
  landMin: number;
  reserveMin: number;
}

/** Toronto's civil offset on a date, including daylight-saving time. */
export function torontoOffsetMinutes(date: string): number {
  const atNoon = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    timeZoneName: 'longOffset',
  })
    .formatToParts(atNoon)
    .find((p) => p.type === 'timeZoneName')?.value;
  const match = part?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return -300;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '+' ? minutes : -minutes;
}

/** NOAA solar approximation, returned as civil-clock minutes for the location. */
export function solarWindow(
  date: string,
  lat: number,
  lon: number,
  utcOffsetMin = torontoOffsetMinutes(date),
): { sunriseMin: number; sunsetMin: number } {
  const noon = new Date(`${date}T12:00:00Z`);
  const yearStart = Date.UTC(noon.getUTCFullYear(), 0, 0);
  const day = Math.floor((noon.getTime() - yearStart) / 86_400_000);
  const gamma = (2 * Math.PI / 365) * (day - 1);
  const equation =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const latRad = lat * RAD;
  const cosHour =
    (Math.cos(90.833 * RAD) / (Math.cos(latRad) * Math.cos(declination))) -
    Math.tan(latRad) * Math.tan(declination);
  const hourDeg = Math.acos(Math.max(-1, Math.min(1, cosHour))) / RAD;
  const solarNoonUtc = 720 - 4 * lon - equation;
  return {
    sunriseMin: solarNoonUtc - hourDeg * 4 + utcOffsetMin,
    sunsetMin: solarNoonUtc + hourDeg * 4 + utcOffsetMin,
  };
}

export function addDateDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildDaylightPlan(
  days: DayTotals[],
  startDate: string,
  launchMin: number,
  location: [number, number],
): DaylightDay[] {
  return days.map((day, index) => {
    const date = addDateDays(startDate, index);
    const light = solarWindow(date, location[1], location[0]);
    const landMin = launchMin + day.timeH * 60;
    return { date, ...light, landMin, reserveMin: light.sunsetMin - landMin };
  });
}

export function fmtClock(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const minute = ((rounded % 60) + 60) % 60;
  const hour24 = ((Math.floor(rounded / 60) % 24) + 24) % 24;
  const suffix = hour24 >= 12 ? 'pm' : 'am';
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')}${suffix}`;
}
