/**
 * inReach weather bot: fetch GEM, pack into a 160-char SMS, parse Garmin
 * handshake emails, POST replies through Garmin's txtmsg form.
 *
 * Incoming satellite texts still count against the inReach plan. This module
 * never splits a payload into a second message — it truncates instead.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const CHAR_LIMIT = 160;

const GEM_URL = 'https://api.open-meteo.com/v1/gem';
const ALERTS_URL = 'https://api.weather.gc.ca/collections/weather-alerts/items';
const UA = 'devys-workshop-inreach-weather (temagami trip bot)';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export type WxCommand = 'daily' | 'hourly' | 'today' | 'stop' | 'start' | 'help';

export interface ForecastHour {
  time: Date;
  tempC: number | null;
  precipMm: number | null;
  popPct: number | null;
  weatherCode: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  windDirDeg: number | null;
}

export interface ForecastDay {
  date: string; // YYYY-MM-DD in the requested timezone
  hiC: number | null;
  loC: number | null;
  precipMm: number | null;
  popPct: number | null;
  weatherCode: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  windDirDeg: number | null;
}

export interface Alert {
  name: string;
  type: string;
  colour: string;
  area: string;
  text: string;
}

export interface Forecast {
  fetchedAt: Date;
  timezone: string;
  hours: ForecastHour[];
  days: ForecastDay[];
  alerts: Alert[];
}

export interface Subscriber {
  guid: string;
  formOrigin: string;
  replyAddress: string;
  name: string;
  muted: boolean;
  ackSent: boolean;
  registeredAt: string;
  lastDailyOn: string | null;
  lastSentAt: string | null;
  lastCommand: string | null;
  lastError: string | null;
  /** Last GPS from a Garmin check-in email. Null until the first fix. */
  lastLat: number | null;
  lastLon: number | null;
  lastFixAt: string | null;
}

/** Paddle trip waypoint: [lon, lat, dayEnd] as stored on paddle_trips. */
export type TripWaypoint = [number, number, number];

export interface TripDay {
  start: [number, number];
  end: [number, number];
  pts: [number, number][];
}

export interface ForecastPoint {
  lat: number;
  lon: number;
  dayIndex: number;
  dayCount: number;
  tag: string;
  source: 'fix' | 'trip' | 'fixed';
  tripName?: string;
}

export interface WeatherState {
  subscribers: Record<string, Subscriber>;
  seenUids: string[];
}

export interface GarminInbound {
  guid: string;
  formOrigin: string;
  text: string;
  name: string;
  lat: number | null;
  lon: number | null;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function dirFromDeg(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return '';
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return DIRS[i];
}

function rnd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '?';
  return String(Math.round(n));
}

/** WMO weather_code → short ASCII token. Empty string = not worth saying. */
export function wxToken(code: number | null, precipMm: number | null): string {
  const c = code ?? -1;
  const p = precipMm ?? 0;
  if (c >= 95) return 'TSTM';
  if (c >= 85) return 'SNSH';
  if (c === 82) return 'DWNPR';
  if (c >= 80) return p >= 5 ? 'HVYSH' : 'SHWR';
  if (c >= 71) return 'SN';
  if (c >= 66) return 'FZRA';
  if (c >= 61) return p >= 8 ? 'HVY' : 'RAIN';
  if (c >= 56) return 'FZDZ';
  if (c >= 51) return 'DZ';
  if (c >= 45) return 'FOG';
  if (p >= 0.4) return 'RAIN';
  if (c === 3) return 'CLD';
  if (c === 2) return 'PC';
  return '';
}

function windToken(dirDeg: number | null, spd: number | null, gust: number | null): string {
  const dir = dirFromDeg(dirDeg);
  if (!dir || spd == null) return '';
  const s = Math.round(spd);
  const g = gust == null ? s : Math.round(gust);
  if (g >= s + 8) return `${dir}${s}g${g}`;
  return `${dir}${s}`;
}

function mmToken(mm: number | null): string {
  if (mm == null || mm < 0.5) return '';
  return `${Math.round(mm)}mm`;
}

function hourInTz(d: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d),
  );
}

function ymdInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const grab = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${grab('year')}-${grab('month')}-${grab('day')}`;
}

function mdInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d);
  const grab = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${grab('month')}/${grab('day')}`;
}

function ymdToUtcDays(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toR = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]);
  const dLon = toR(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Split planner waypoints on day-end flags; the last waypoint always closes a day. */
export function splitTripDays(waypoints: TripWaypoint[]): TripDay[] {
  if (waypoints.length === 0) return [];
  const days: TripDay[] = [];
  let pts: [number, number][] = [[Number(waypoints[0][0]), Number(waypoints[0][1])]];
  for (let i = 1; i < waypoints.length; i++) {
    const lon = Number(waypoints[i][0]);
    const lat = Number(waypoints[i][1]);
    const dayEnd = Number(waypoints[i][2]) !== 0;
    pts.push([lon, lat]);
    if (dayEnd || i === waypoints.length - 1) {
      days.push({ start: pts[0], end: pts[pts.length - 1], pts });
      pts = [[lon, lat]];
    }
  }
  return days;
}

export function alongDay(day: TripDay, t: number): [number, number] {
  const u = Math.max(0, Math.min(1, t));
  const pts = day.pts;
  if (pts.length === 1) return pts[0];
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = haversineKm(pts[i], pts[i + 1]);
    segs.push(d);
    total += d;
  }
  if (total < 0.01) return pts[0];
  let remain = u * total;
  for (let i = 0; i + 1 < pts.length; i++) {
    if (remain <= segs[i] || i + 2 === pts.length) {
      const f = segs[i] ? remain / segs[i] : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      ];
    }
    remain -= segs[i];
  }
  return pts[pts.length - 1];
}

/** 06:00 = still in last night's camp; 18:00 = tonight's camp. */
export function progressT(hour: number, along: boolean): number {
  if (!along) return 0;
  return Math.max(0, Math.min(1, (hour - 6) / 12));
}

export function resolveForecastPoint(opts: {
  waypoints: TripWaypoint[] | null;
  startDate: string | null;
  now: Date;
  timezone: string;
  fallbackLat: number;
  fallbackLon: number;
  along: boolean;
  /** 0 = today's trip day, 1 = tomorrow's camp, etc. */
  shiftDays?: number;
  tripName?: string;
  /** Last inReach GPS. Wins over trip camps and the config fallback. */
  fixLat?: number | null;
  fixLon?: number | null;
}): ForecastPoint {
  if (isFiniteNum(opts.fixLat) && isFiniteNum(opts.fixLon)) {
    const lat = opts.fixLat;
    const lon = opts.fixLon;
    return {
      lat,
      lon,
      dayIndex: 0,
      dayCount: 0,
      tag: `${lat.toFixed(2)},${lon.toFixed(2)}`,
      source: 'fix',
      tripName: opts.tripName,
    };
  }
  const days = opts.waypoints?.length ? splitTripDays(opts.waypoints) : [];
  if (!days.length) {
    return {
      lat: opts.fallbackLat,
      lon: opts.fallbackLon,
      dayIndex: 0,
      dayCount: 0,
      tag: '',
      source: 'fixed',
    };
  }
  const today = ymdInTz(opts.now, opts.timezone);
  let idx = 0;
  if (opts.startDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.startDate)) {
    idx = Math.round(ymdToUtcDays(today) - ymdToUtcDays(opts.startDate));
  }
  idx += opts.shiftDays ?? 0;
  idx = Math.max(0, Math.min(days.length - 1, idx));
  const hour = hourInTz(opts.now, opts.timezone);
  const [lon, lat] = alongDay(days[idx], progressT(hour, opts.along));
  return {
    lat,
    lon,
    dayIndex: idx + 1,
    dayCount: days.length,
    tag: `d${idx + 1} ${lat.toFixed(2)},${lon.toFixed(2)}`,
    source: 'trip',
    tripName: opts.tripName,
  };
}

function toAscii(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/[^A-Za-z0-9 .,:;/%+=\-\n]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** Never emit a second billed satellite message. Truncate with a marker. */
export function clamp160(s: string): string {
  const ascii = toAscii(s);
  if (ascii.length <= CHAR_LIMIT) return ascii;
  return ascii.slice(0, CHAR_LIMIT - 1).trimEnd() + '+';
}

function joinBits(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(' ');
}

function hourLine(h: ForecastHour, tz: string): string {
  const hh = String(hourInTz(h.time, tz)).padStart(2, '0');
  return joinBits([
    hh,
    windToken(h.windDirDeg, h.windKmh, h.gustKmh),
    h.tempC == null ? '' : `${rnd(h.tempC)}c`,
    wxToken(h.weatherCode, h.precipMm),
    mmToken(h.precipMm),
  ]);
}

function alertLine(alerts: Alert[]): string | null {
  if (alerts.length === 0) return null;
  const a = alerts[0];
  const colour = (a.colour || '').slice(0, 3).toUpperCase();
  const name = toAscii(a.name).slice(0, 24);
  // Prefer a compact hazard + amount from the body when present.
  const mm = a.text.match(/(\d+\s*-\s*\d+\s*mm|\d+\s*mm)/i);
  const bits = [colour, toAscii(a.type).slice(0, 8), name, mm ? toAscii(mm[1].replace(/\s+/g, '')) : '']
    .filter(Boolean);
  const line = bits.join(' ');
  return line.length > 0 ? line : null;
}

function upcomingHours(forecast: Forecast, now: Date, n: number): ForecastHour[] {
  const start = now.getTime() - 20 * 60 * 1000;
  return forecast.hours.filter((h) => h.time.getTime() >= start).slice(0, n);
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function mdFromYmd(ymd: string): string {
  const [, m, d] = ymd.split('-');
  return `${Number(m)}/${Number(d)}`;
}

interface TravelStats {
  hours: ForecastHour[];
  maxGust: number;
  maxSpd: number;
  dirDeg: number | null;
  precipMm: number;
  hiC: number | null;
  loC: number | null;
  tstorm: { from: number; to: number } | null;
  worstCode: number;
}

function hoursOnDate(forecast: Forecast, ymd: string, now?: Date): ForecastHour[] {
  const tz = forecast.timezone;
  const today = now ? ymdInTz(now, tz) : null;
  const nowH = now ? hourInTz(now, tz) : 0;
  return forecast.hours.filter((h) => {
    if (ymdInTz(h.time, tz) !== ymd) return false;
    const hh = hourInTz(h.time, tz);
    if (hh < 6 || hh > 20) return false;
    if (today && ymd === today && hh < nowH) return false;
    return true;
  });
}

function travelStats(hours: ForecastHour[], tz: string): TravelStats | null {
  if (hours.length === 0) return null;
  const temps = hours.map((h) => h.tempC).filter(isFiniteNum);
  const dirSrc = hours.reduce((best, h) => ((h.windKmh ?? 0) > (best.windKmh ?? 0) ? h : best), hours[0]);
  const storm = hours
    .filter((h) => (h.weatherCode ?? 0) >= 95)
    .map((h) => hourInTz(h.time, tz));
  return {
    hours,
    maxGust: Math.max(...hours.map((h) => h.gustKmh ?? h.windKmh ?? 0)),
    maxSpd: Math.max(...hours.map((h) => h.windKmh ?? 0)),
    dirDeg: dirSrc.windDirDeg,
    precipMm: hours.reduce((s, h) => s + (h.precipMm ?? 0), 0),
    hiC: temps.length ? Math.max(...temps) : null,
    loC: temps.length ? Math.min(...temps) : null,
    tstorm: storm.length ? { from: Math.min(...storm), to: Math.max(...storm) } : null,
    worstCode: Math.max(...hours.map((h) => h.weatherCode ?? 0)),
  };
}

/** Paddling call for a travel window. Gusts and storms dominate. */
export function paddleCall(s: TravelStats, alerts: Alert[]): 'GO' | 'EARLY' | 'SIT' {
  const warn = alerts.some(
    (a) => /warning|watch/i.test(a.type) || /red|orange/i.test(a.colour),
  );
  const tstormTravel =
    s.tstorm != null && s.tstorm.from < 18 && s.tstorm.to >= 8;
  if (s.maxGust >= 40 || s.precipMm >= 15 || (tstormTravel && s.maxGust >= 28)) return 'SIT';
  if (s.maxGust >= 30 || s.tstorm != null || s.precipMm >= 8 || warn) return 'EARLY';
  return 'GO';
}

function tstormTok(s: TravelStats): string {
  if (!s.tstorm) return '';
  const a = String(s.tstorm.from).padStart(2, '0');
  const b = String(s.tstorm.to).padStart(2, '0');
  return a === b ? `TSTM ${a}h` : `TSTM ${a}-${b}`;
}

function packCallForHours(forecast: Forecast, hours: ForecastHour[], now: Date, tag: string, label: string): string {
  const s = travelStats(hours, forecast.timezone);
  const alert = alertLine(forecast.alerts);
  if (!s) {
    return clamp160(joinBits([label, tag, 'no data']));
  }
  const call = paddleCall(s, forecast.alerts);
  const lines = [
    joinBits([call, label, tag]),
    joinBits([
      windToken(s.dirDeg, s.maxSpd, s.maxGust),
      mmToken(s.precipMm),
      wxToken(s.worstCode, s.precipMm),
      tstormTok(s),
    ]),
    joinBits([
      s.hiC != null && s.loC != null ? `${rnd(s.hiC)}/${rnd(s.loC)}` : '',
      alert,
    ]),
  ];
  return clamp160(lines.filter(Boolean).join('\n'));
}

/** 6am push + "okay" check-in: go/no-go for the rest of today's water. */
export function packDaily(forecast: Forecast, now = new Date(), tag = ''): string {
  const ymd = ymdInTz(now, forecast.timezone);
  let hours = hoursOnDate(forecast, ymd, now);
  // After 20h there is no remaining travel window — still summarize the day
  // rather than sending "no data" on an evening okay-check.
  if (hours.length === 0) hours = hoursOnDate(forecast, ymd);
  return packCallForHours(forecast, hours, now, tag, mdInTz(now, forecast.timezone));
}

/** "starting my trip" / 3H: next 3 hours only. Quiet if nothing is happening. */
export function packHourly(forecast: Forecast, now = new Date(), n = 3, tag = ''): string {
  const hours = upcomingHours(forecast, now, n);
  if (hours.length === 0) return clamp160(joinBits(['NOW', tag, 'no data']));
  const s = travelStats(hours, forecast.timezone);
  const quiet =
    s != null &&
    s.maxGust < 25 &&
    s.precipMm < 0.4 &&
    s.worstCode < 80 &&
    forecast.alerts.length === 0;
  if (quiet && s) {
    return clamp160(
      joinBits(['QUIET', tag, windToken(s.dirDeg, s.maxSpd, s.maxGust), s.hiC == null ? '' : `${rnd(s.hiC)}c`]),
    );
  }
  const lines = [
    joinBits(['NOW', tag]),
    ...hours.map((h) => hourLine(h, forecast.timezone)),
  ];
  return clamp160(lines.filter(Boolean).join('\n'));
}

/** "ending my trip": tomorrow's travel-day call. */
export function packToday(forecast: Forecast, now = new Date(), tag = ''): string {
  const tom = addDaysYmd(ymdInTz(now, forecast.timezone), 1);
  const hours = hoursOnDate(forecast, tom);
  if (hours.length === 0) {
    const day = forecast.days.find((d) => d.date === tom);
    if (!day) return clamp160(joinBits(['TOM', tag, 'no data']));
    const fake: TravelStats = {
      hours: [],
      maxGust: day.gustKmh ?? day.windKmh ?? 0,
      maxSpd: day.windKmh ?? 0,
      dirDeg: day.windDirDeg,
      precipMm: day.precipMm ?? 0,
      hiC: day.hiC,
      loC: day.loC,
      tstorm: (day.weatherCode ?? 0) >= 95 ? { from: 12, to: 16 } : null,
      worstCode: day.weatherCode ?? 0,
    };
    const call = paddleCall(fake, forecast.alerts);
    return clamp160(
      [
        joinBits([call, 'TOM', mdFromYmd(tom), tag]),
        joinBits([
          windToken(fake.dirDeg, fake.maxSpd, fake.maxGust),
          mmToken(fake.precipMm),
          wxToken(fake.worstCode, fake.precipMm),
        ]),
        fake.hiC != null ? `${rnd(fake.hiC)}/${rnd(fake.loC)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return packCallForHours(forecast, hours, now, tag, `TOM ${mdFromYmd(tom)}`);
}

export const HELP_TEXT = clamp160('wx on. 6am call. check-ins: okay=call start=now end=tom. STOP mute');

export function packForCommand(cmd: WxCommand, forecast: Forecast, now = new Date(), tag = ''): string {
  switch (cmd) {
    case 'hourly':
      return packHourly(forecast, now, 3, tag);
    case 'today':
      return packToday(forecast, now, tag);
    case 'help':
      return HELP_TEXT;
    case 'stop':
      return clamp160('muted. GO to resume daily 6am');
    case 'start':
      return packDaily(forecast, now, tag);
    case 'daily':
    default:
      return packDaily(forecast, now, tag);
  }
}

export function parseCommand(raw: string): WxCommand | 'register' {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!t) return 'register';
  // Garmin check-ins — match the canned sentence anywhere in the email.
  if (/\bchecking in\b/.test(t) || /\beverything is okay\b/.test(t)) return 'daily';
  if (/\bstarting my trip\b/.test(t) || /\bstarting trip\b/.test(t)) return 'hourly';
  if (/\bending my trip\b/.test(t) || /\bending trip\b/.test(t)) return 'today';
  const head = t.split(/\s+/)[0] ?? t;
  if (['stop', 'mute', 'off', 'quiet'].includes(head)) return 'stop';
  // Unmute. Not "start" — that collides with the check-in phrase after punctuation strip.
  if (['go', 'on', 'yes', 'resume', 'wxon'].includes(head) && t.split(/\s+/).length <= 2) return 'start';
  if (['help', 'cmd', 'cmds'].includes(head)) return 'help';
  if (['today', 'day', '12h', '12hr', 'tom', 'tmrw', 'tomorrow', 'end'].includes(head)) return 'today';
  if (['3h', '3hr', '3hrs', 'now', 'hr', 'hour', 'hourly'].includes(head)) return 'hourly';
  if (['wx', 'daily', '3d', '3day', 'forecast', 'fcst'].includes(head)) return 'daily';
  return 'register';
}

interface OpenMeteoPayload {
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    precipitation?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    weather_code?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
  daily?: {
    time?: string[];
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    weather_code?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
    wind_gusts_10m_max?: Array<number | null>;
    wind_direction_10m_dominant?: Array<number | null>;
  };
  error?: boolean;
  reason?: string;
}

interface AlertFeature {
  properties?: {
    alert_name_en?: string;
    alert_short_name_en?: string;
    alert_type?: string;
    alert_text_en?: string;
    feature_name_en?: string;
    risk_colour_en?: string;
    province?: string;
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function fetchForecast(opts: {
  lat: number;
  lon: number;
  timezone: string;
}): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(opts.lat),
    longitude: String(opts.lon),
    timezone: opts.timezone,
    forecast_days: '4',
    wind_speed_unit: 'kmh',
    hourly: [
      'temperature_2m',
      'precipitation',
      'precipitation_probability',
      'weather_code',
      'wind_speed_10m',
      'wind_gusts_10m',
      'wind_direction_10m',
    ].join(','),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'weather_code',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'wind_direction_10m_dominant',
    ].join(','),
  });

  const [wxRaw, alertRaw] = await Promise.all([
    fetchJson(`${GEM_URL}?${params.toString()}`),
    fetchAlerts(opts.lat, opts.lon).catch((err) => {
      console.warn('inreach-weather: alerts fetch failed:', (err as Error).message);
      return [] as Alert[];
    }),
  ]);

  const wx = wxRaw as OpenMeteoPayload;
  if (wx.error) throw new Error(`open-meteo: ${wx.reason ?? 'unknown error'}`);

  const ht = wx.hourly?.time ?? [];
  const hours: ForecastHour[] = ht.map((t, i) => ({
    time: new Date(t),
    tempC: wx.hourly?.temperature_2m?.[i] ?? null,
    precipMm: wx.hourly?.precipitation?.[i] ?? null,
    popPct: wx.hourly?.precipitation_probability?.[i] ?? null,
    weatherCode: wx.hourly?.weather_code?.[i] ?? null,
    windKmh: wx.hourly?.wind_speed_10m?.[i] ?? null,
    gustKmh: wx.hourly?.wind_gusts_10m?.[i] ?? null,
    windDirDeg: wx.hourly?.wind_direction_10m?.[i] ?? null,
  }));

  const dt = wx.daily?.time ?? [];
  const days: ForecastDay[] = dt.map((date, i) => ({
    date,
    hiC: wx.daily?.temperature_2m_max?.[i] ?? null,
    loC: wx.daily?.temperature_2m_min?.[i] ?? null,
    precipMm: wx.daily?.precipitation_sum?.[i] ?? null,
    popPct: wx.daily?.precipitation_probability_max?.[i] ?? null,
    weatherCode: wx.daily?.weather_code?.[i] ?? null,
    windKmh: wx.daily?.wind_speed_10m_max?.[i] ?? null,
    gustKmh: wx.daily?.wind_gusts_10m_max?.[i] ?? null,
    windDirDeg: wx.daily?.wind_direction_10m_dominant?.[i] ?? null,
  }));

  return {
    fetchedAt: new Date(),
    timezone: opts.timezone,
    hours,
    days,
    alerts: alertRaw as Alert[],
  };
}

async function fetchAlerts(lat: number, lon: number): Promise<Alert[]> {
  // ~80 km box around the point. Temagami park is larger; bbox is passed from the caller via lat/lon.
  const d = 0.7;
  const bbox = [lon - d, lat - d, lon + d, lat + d].map((n) => n.toFixed(3)).join(',');
  const url = `${ALERTS_URL}?f=json&limit=8&bbox=${bbox}`;
  const raw = (await fetchJson(url)) as { features?: AlertFeature[] };
  const out: Alert[] = [];
  for (const f of raw.features ?? []) {
    const p = f.properties ?? {};
    out.push({
      name: p.alert_short_name_en || p.alert_name_en || 'alert',
      type: p.alert_type || '',
      colour: p.risk_colour_en || '',
      area: p.feature_name_en ?? '',
      text: p.alert_text_en || '',
    });
  }
  return out;
}

/** Quoted-printable unfold so Garmin URLs survive MIME wrapping.
 *  Only the body is unfolded — header values ending in `=` (e.g. X-Entity-ID)
 *  would otherwise eat the header/body blank line and swallow the message text.
 */
export function unfoldMime(raw: string): string {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headers = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const body = headerEnd >= 0 ? raw.slice(headerEnd) : '';
  const unfoldedBody = body
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/&amp;/gi, '&');
  return headers + unfoldedBody;
}

const GUID_RE =
  /(?:explore\.garmin\.com|inreach\.garmin\.com)\/(?:TextMessage\/TxtMsg|textmessage\/txtmsg)\?[^"'<\s]*?[?&]?extId=([0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12})/i;

/** 2026+ emails use inreachlink.com/TOKEN instead of explore.garmin.com?...extId=UUID. */
const SHORT_LINK_RE =
  /(?:inreachlink\.com\/|messenger\.garmin\.com\/r\?extId=)([A-Za-z0-9_-]{8,})/i;

const ORIGIN_RE = /(https?:\/\/(?:[a-z0-9-]+\.)?explore\.garmin\.com|https?:\/\/inreach\.garmin\.com)/i;

const BOILERPLATE =
  /sent (you |the following )?message|do not reply|inreach satellite|view the location|to reply|garmin\.com|mapshare|explore\.garmin|https?:\/\/|lat[itude]*|lon[gitude]*|coordinates|sent from/i;

const COMMAND_LINE =
  /^(3h|3hr|3hrs|now|hr|hour|hourly|today|day|12h|12hr|wx|daily|3d|3day|forecast|fcst|stop|mute|off|quiet|start|go|on|yes|resume|help|cmd|cmds)\b/i;

/** Garmin emails include `Lat 47.07 Lon -80.15` (and the older Latitude:/Longitude: pair). */
export function parseGarminCoords(text: string): { lat: number; lon: number } | null {
  const patterns = [
    /Lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s+Lon(?:gitude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i,
    /Latitude\s*[:=]\s*(-?\d+(?:\.\d+)?)[\s\S]{0,80}?Longitude\s*[:=]\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    if (lat === 0 && lon === 0) continue;
    return { lat, lon };
  }
  return null;
}

export function parseGarminEmail(raw: string, envelopeName?: string): GarminInbound | null {
  const text = unfoldMime(raw);
  const uuidMatch = text.match(/extId=([0-9a-f-]{36})/i) ?? text.match(GUID_RE);
  const shortMatch = text.match(SHORT_LINK_RE);
  if (!uuidMatch && !shortMatch) return null;
  // Keep short-token case: inreachlink ids are mixed-case and case-sensitive.
  const guid = uuidMatch ? uuidMatch[1].toLowerCase() : shortMatch![1];

  const originMatch = text.match(ORIGIN_RE);
  const formOrigin = (originMatch ? originMatch[1] : 'https://explore.garmin.com')
    .replace(/\/$/, '')
    .replace(/^http:/i, 'https:');

  const headerEnd = text.search(/\r?\n\r?\n/);
  const bodyPart = headerEnd >= 0 ? text.slice(headerEnd) : text;
  const lines = bodyPart
    .split(/\r?\n/)
    .map((l) => l.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').trim())
    .filter((l) => l.length > 0 && l.length <= 160 && !BOILERPLATE.test(l) && !/extId=/i.test(l));

  const quoted = bodyPart.match(/"([^"\n]{1,160})"/);
  const commandLine = lines.find((l) => COMMAND_LINE.test(l));
  const shortLine = lines.find((l) => /^[A-Za-z0-9 .,:;/%+\-]{1,80}$/.test(l));
  const body = (commandLine || quoted?.[1] || shortLine || lines[0] || '').trim();

  let name = envelopeName?.trim() || '';
  if (!name) {
    const from = text.match(/^From:\s*(?:"([^"]+)"|([^<\n]+))/im);
    name = (from?.[1] || from?.[2] || '').replace(/<.*?>/g, '').trim();
  }
  if (/inreach|garmin|noreply|no\.reply/i.test(name)) name = '';
  const subj = text.match(/^Subject:\s*(?:inReach message from\s+)?(.+)$/im);
  if (!name && subj) {
    name = subj[1].replace(/^inReach message from\s+/i, '').trim();
  }

  const coords = parseGarminCoords(text);
  return {
    guid,
    formOrigin,
    text: body,
    name: name.slice(0, 40),
    lat: coords?.lat ?? null,
    lon: coords?.lon ?? null,
  };
}

/** Short inreachlink tokens are not POST-able; scrape the UUID off Garmin's txtmsg page. */
export async function ensureGarminGuid(guid: string): Promise<string> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid)) {
    return guid.toLowerCase();
  }
  const url = `https://explore.garmin.com/textmessage/txtmsg?extId=${encodeURIComponent(guid)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`garmin guid resolve HTTP ${res.status}`);
  const html = await res.text();
  const m =
    html.match(/id="Guid"[^>]*\bvalue="([0-9a-f-]{36})"/i) ??
    html.match(/name="Guid"[^>]*\bvalue="([0-9a-f-]{36})"/i);
  if (!m) throw new Error('garmin guid resolve: no Guid on txtmsg page');
  return m[1].toLowerCase();
}

export async function sendGarminText(opts: {
  guid: string;
  formOrigin: string;
  replyAddress: string;
  message: string;
}): Promise<void> {
  const message = clamp160(opts.message);
  if (!message) throw new Error('refusing to send empty inReach message');
  const guid = await ensureGarminGuid(opts.guid);

  const origin = opts.formOrigin.replace(/\/$/, '');
  const endpoints = unique([
    `${origin}/TextMessage/TxtMsg`,
    'https://explore.garmin.com/TextMessage/TxtMsg',
    'https://inreach.garmin.com/TextMessage/TxtMsg',
  ]);

  const body = new URLSearchParams({
    ReplyAddress: opts.replyAddress,
    ReplyMessage: message,
    Guid: guid,
  }).toString();

  let lastErr: Error | null = null;
  for (const url of endpoints) {
    try {
      const referer = `${origin}/textmessage/txtmsg?extId=${guid}`;
      const host = new URL(url).host;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Origin: `${new URL(url).protocol}//${host}`,
          Referer: referer,
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': UA,
          Accept: '*/*',
        },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = new Error(`${url} HTTP ${res.status}: ${text.slice(0, 180)}`);
        continue;
      }
      // Garmin returns JSON { Success: true } on the explore host; inreach.garmin.com may vary.
      try {
        const json = JSON.parse(text) as { Success?: boolean; success?: boolean };
        if (json.Success === false || json.success === false) {
          lastErr = new Error(`${url} Success=false: ${text.slice(0, 180)}`);
          continue;
        }
      } catch {
        // Non-JSON 200: treat as ok if it isn't an obvious HTML error page.
        if (/<html/i.test(text) && /error|denied|login/i.test(text)) {
          lastErr = new Error(`${url} HTML error page`);
          continue;
        }
      }
      return;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error('garmin txtmsg POST failed');
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

export function emptyState(): WeatherState {
  return { subscribers: {}, seenUids: [] };
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function asCoord(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalizeSubscriber(raw: Partial<Subscriber> & { guid?: string }): Subscriber {
  const guid = typeof raw.guid === 'string' ? raw.guid : '';
  return {
    guid,
    formOrigin: typeof raw.formOrigin === 'string' ? raw.formOrigin : 'https://explore.garmin.com',
    replyAddress: typeof raw.replyAddress === 'string' ? raw.replyAddress : '',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'inreach',
    muted: !!raw.muted,
    ackSent: !!raw.ackSent,
    registeredAt: isIsoDate(raw.registeredAt) ? raw.registeredAt : new Date(0).toISOString(),
    lastDailyOn: isIsoDate(raw.lastDailyOn) ? raw.lastDailyOn : null,
    lastSentAt: isIsoDate(raw.lastSentAt) ? raw.lastSentAt : null,
    lastCommand: typeof raw.lastCommand === 'string' ? raw.lastCommand : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    lastLat: asCoord(raw.lastLat),
    lastLon: asCoord(raw.lastLon),
    lastFixAt: isIsoDate(raw.lastFixAt) ? raw.lastFixAt : null,
  };
}

/** One key per person. Garmin mints a new conversation UUID on every outbound text. */
export function subscriberIdentity(name: string | undefined, guid: string): string {
  const n = (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (n && n !== 'inreach') return `name:${n}`;
  return `guid:${guid.toLowerCase()}`;
}

/**
 * Collapse leftover conversation UUIDs into one subscriber per person.
 * Newest handshake wins the live GUID and mute flag.
 */
export function coalesceSubscribers(subs: Record<string, Subscriber>): Record<string, Subscriber> {
  const byId = new Map<string, Subscriber>();
  const list = Object.values(subs).map(normalizeSubscriber);
  list.sort((a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt));
  for (const sub of list) {
    if (!sub.guid) continue;
    const id = subscriberIdentity(sub.name, sub.guid);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...sub });
      continue;
    }
    prev.guid = sub.guid;
    prev.formOrigin = sub.formOrigin || prev.formOrigin;
    prev.replyAddress = sub.replyAddress || prev.replyAddress;
    if (sub.name && sub.name.toLowerCase() !== 'inreach') prev.name = sub.name;
    prev.muted = sub.muted;
    prev.ackSent = prev.ackSent || sub.ackSent;
    if (!prev.lastDailyOn || (sub.lastDailyOn && sub.lastDailyOn > prev.lastDailyOn)) {
      prev.lastDailyOn = sub.lastDailyOn;
    }
    if (!prev.lastSentAt || (sub.lastSentAt && sub.lastSentAt > prev.lastSentAt)) {
      prev.lastSentAt = sub.lastSentAt;
      prev.lastCommand = sub.lastCommand;
    }
    prev.lastError = sub.lastError;
    if (sub.lastFixAt && (!prev.lastFixAt || sub.lastFixAt > prev.lastFixAt)) {
      prev.lastLat = sub.lastLat;
      prev.lastLon = sub.lastLon;
      prev.lastFixAt = sub.lastFixAt;
    }
  }
  return Object.fromEntries(byId);
}

/** Unmuted people who have not already received today's 6am CALL. */
export function pickDailyRecipients(
  state: WeatherState,
  ymd: string,
  force: boolean,
): Subscriber[] {
  return Object.values(coalesceSubscribers(state.subscribers)).filter((sub) => {
    if (sub.muted) return false;
    if (!force && sub.lastDailyOn === ymd) return false;
    return true;
  });
}

export function subscriberFix(sub: Subscriber): { lat: number; lon: number } | null {
  if (sub.lastLat == null || sub.lastLon == null) return null;
  return { lat: sub.lastLat, lon: sub.lastLon };
}

export async function loadState(file: string): Promise<WeatherState> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf-8')) as Partial<WeatherState>;
    return {
      subscribers: coalesceSubscribers(raw.subscribers ?? {}),
      seenUids: Array.isArray(raw.seenUids) ? raw.seenUids : [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return emptyState();
    throw err;
  }
}

export async function saveState(file: string, state: WeatherState): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = file + '.tmp';
  const trimmed: WeatherState = {
    subscribers: state.subscribers,
    seenUids: state.seenUids.slice(-800),
  };
  await fs.writeFile(tmp, JSON.stringify(trimmed, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, file);
}

export function upsertSubscriber(
  state: WeatherState,
  inbound: GarminInbound,
  replyAddress: string,
): { sub: Subscriber; isNew: boolean } {
  state.subscribers = coalesceSubscribers(state.subscribers);
  const id = subscriberIdentity(inbound.name, inbound.guid);
  const byGuid = Object.entries(state.subscribers).find(([, s]) => s.guid === inbound.guid);
  const existing = state.subscribers[id] ?? byGuid?.[1];
  const nowIso = new Date().toISOString();

  const applyFix = (sub: Subscriber) => {
    if (inbound.lat == null || inbound.lon == null) return;
    sub.lastLat = inbound.lat;
    sub.lastLon = inbound.lon;
    sub.lastFixAt = nowIso;
  };

  if (existing) {
    if (byGuid && byGuid[0] !== id) delete state.subscribers[byGuid[0]];
    existing.guid = inbound.guid;
    existing.formOrigin = inbound.formOrigin || existing.formOrigin;
    existing.replyAddress = replyAddress;
    if (inbound.name && inbound.name.toLowerCase() !== 'inreach') existing.name = inbound.name;
    existing.lastError = null;
    applyFix(existing);
    state.subscribers[id] = existing;
    return { sub: existing, isNew: false };
  }

  const sub: Subscriber = {
    guid: inbound.guid,
    formOrigin: inbound.formOrigin,
    replyAddress,
    name: inbound.name || 'inreach',
    muted: false,
    ackSent: false,
    registeredAt: nowIso,
    lastDailyOn: null,
    lastSentAt: null,
    lastCommand: null,
    lastError: null,
    lastLat: inbound.lat,
    lastLon: inbound.lon,
    lastFixAt: inbound.lat != null ? nowIso : null,
  };
  state.subscribers[id] = sub;
  return { sub, isNew: true };
}

export function hourMinuteInTz(now: Date, tz: string): { hour: number; minute: number; ymd: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const grab = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return { hour: grab('hour'), minute: grab('minute'), ymd: `${y}-${m}-${d}` };
}
