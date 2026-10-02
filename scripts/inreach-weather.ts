/**
 * inReach weather bot.
 *
 *   npx tsx scripts/inreach-weather.ts              # IMAP poll + 6am daily window
 *   npx tsx scripts/inreach-weather.ts --preview     # print daily/3h/today, no mail
 *   npx tsx scripts/inreach-weather.ts --send-daily  # force today's brief to every sub
 *   npx tsx scripts/inreach-weather.ts --dry-run     # poll + pack, do not POST
 *
 * Check-ins are free outbound. Replies still count as 1 inbound.
 * okay = today's go/no-go, starting my trip = nowcast, ending my trip = tomorrow.
 */
import { ImapFlow } from 'imapflow';
import path from 'node:path';
import { getConfig, resetConfigCache, type InreachWeatherConfig } from '../src/lib/config';
import { makePool } from '../src/lib/db';
import {
  HELP_TEXT,
  fetchForecast,
  hourMinuteInTz,
  loadState,
  packDaily,
  packForCommand,
  packHourly,
  packToday,
  parseCommand,
  parseGarminEmail,
  pickDailyRecipients,
  ensureGarminGuid,
  resolveForecastPoint,
  saveState,
  sendGarminText,
  splitTripDays,
  subscriberFix,
  upsertSubscriber,
  type Forecast,
  type ForecastPoint,
  type Subscriber,
  type TripWaypoint,
  type WeatherState,
  type WxCommand,
} from '../src/lib/inreach-weather';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const PREVIEW = args.has('--preview');
const SEND_DAILY = args.has('--send-daily');
const MIN_GAP_MS = 90_000;

function log(msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  if (extra !== undefined) console.log(`${ts} ${msg}`, extra);
  else console.log(`${ts} ${msg}`);
}

function resolveStateFile(rel: string): string {
  return path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel);
}

async function loadTrip(
  slug: string | null,
  _park: string,
): Promise<{ name: string; slug: string; waypoints: TripWaypoint[] } | null> {
  const pool = makePool('workshop');
  try {
    if (!slug) return null;
    const { rows } = await pool.query<{ name: string; slug: string; waypoints: TripWaypoint[] }>(
      `SELECT name, slug, waypoints FROM paddle_trips WHERE slug = $1`,
      [slug],
    );
    return rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

function pointFor(
  cfg: InreachWeatherConfig,
  trip: { name: string; waypoints: TripWaypoint[] } | null,
  opts: { along: boolean; shiftDays?: number; fix?: { lat: number; lon: number } | null },
  now = new Date(),
): ForecastPoint {
  return resolveForecastPoint({
    waypoints: trip?.waypoints ?? null,
    startDate: cfg.startDate,
    now,
    timezone: cfg.timezone,
    fallbackLat: cfg.lat,
    fallbackLon: cfg.lon,
    along: opts.along,
    shiftDays: opts.shiftDays,
    tripName: trip?.name,
    fixLat: opts.fix?.lat,
    fixLon: opts.fix?.lon,
  });
}

async function preview() {
  const cfg = getConfig().inreachWeather;
  const lat = cfg?.lat ?? 47.075;
  const lon = cfg?.lon ?? -80.15;
  const timezone = cfg?.timezone ?? 'America/Toronto';
  const now = new Date();

  let trip = null;
  let fix: { lat: number; lon: number } | null = null;
  if (cfg) {
    try {
      trip = await loadTrip(cfg.tripSlug, cfg.park);
    } catch (err) {
      console.warn('trip load failed:', (err as Error).message);
    }
    try {
      const state = await loadState(resolveStateFile(cfg.stateFile));
      const recips = Object.values(state.subscribers);
      console.log(`subscribers ${recips.length}: ${recips.map((s) => `${s.name} ${s.guid.slice(0, 8)}…`).join(', ') || '(none)'}`);
      fix = recips[0] ? subscriberFix(recips[0]) : null;
    } catch (err) {
      console.warn('state load failed:', (err as Error).message);
    }
  }
  const camp = cfg
    ? pointFor(cfg, trip, { along: false, fix }, now)
    : { lat, lon, tag: '', source: 'fixed' as const, dayIndex: 0, dayCount: 0 };
  const along = cfg
    ? pointFor(cfg, trip, { along: true, fix }, now)
    : camp;
  const tom = cfg
    ? pointFor(cfg, trip, { along: false, shiftDays: 1, fix }, now)
    : camp;

  if (trip) {
    const days = splitTripDays(trip.waypoints);
    console.log(`trip ${trip.slug} "${trip.name}" · ${trip.waypoints.length} wps · ${days.length} days`);
    days.forEach((d, i) => {
      console.log(
        `  day ${i + 1}: ${d.start[1].toFixed(4)},${d.start[0].toFixed(4)} -> ${d.end[1].toFixed(4)},${d.end[0].toFixed(4)}`,
      );
    });
  } else {
    console.log('no paddle trip loaded — last GPS or fallback lat/lon');
  }
  console.log(`camp ${camp.source} ${camp.tag || `${camp.lat},${camp.lon}`}`);
  console.log(`along ${along.tag || `${along.lat},${along.lon}`}`);
  console.log(`tom  ${tom.tag || `${tom.lat},${tom.lon}`}`);

  const forecast = await fetchForecast({ lat: camp.lat, lon: camp.lon, timezone });
  const daily = packDaily(forecast, now, camp.tag);
  const hourly = packHourly(forecast, now, 3, along.tag);
  const tomorrow = packToday(forecast, now, tom.tag);
  console.log(`alerts ${forecast.alerts.length}: ${forecast.alerts.map((a) => a.name).join(', ') || '(none)'}`);
  console.log(`\n--- 6am/okay CALL ${daily.length}c ---\n${daily}`);
  console.log(`\n--- start NOWCAST ${hourly.length}c ---\n${hourly}`);
  console.log(`\n--- end TOMORROW ${tomorrow.length}c ---\n${tomorrow}`);
  console.log(`\n--- HELP ${HELP_TEXT.length}c ---\n${HELP_TEXT}`);
  for (const sample of [
    "I'm checking in, everything is okay.",
    "I'm starting my trip.",
    "I'm ending my trip.",
    '3H',
    'wx',
  ]) {
    console.log(`parse ${JSON.stringify(sample)} -> ${parseCommand(sample)}`);
  }
}

async function deliver(
  sub: Subscriber,
  message: string,
  kind: string,
  opts: { dry: boolean; ymd?: string },
): Promise<boolean> {
  log(`send ${kind} -> ${sub.name} (${sub.guid.slice(0, 8)}…) ${message.length}c${opts.dry ? ' [dry]' : ''}`);
  log(`  ${message.replace(/\n/g, ' | ')}`);
  if (opts.dry) return true;
  try {
    await sendGarminText({
      guid: sub.guid,
      formOrigin: sub.formOrigin,
      replyAddress: sub.replyAddress,
      message,
    });
    sub.lastSentAt = new Date().toISOString();
    sub.lastCommand = kind;
    sub.lastError = null;
    if (opts.ymd) sub.lastDailyOn = opts.ymd;
    return true;
  } catch (err) {
    sub.lastError = (err as Error).message;
    log(`  FAIL ${sub.lastError}`);
    return false;
  }
}

function recentlySent(sub: Subscriber, kind: string): boolean {
  if (!sub.lastSentAt) return false;
  if (sub.lastCommand && sub.lastCommand !== kind) return false;
  return Date.now() - Date.parse(sub.lastSentAt) < MIN_GAP_MS;
}

type ForecastFn = (opts: {
  along: boolean;
  shiftDays?: number;
  fix?: { lat: number; lon: number } | null;
}) => Promise<{ forecast: Forecast; tag: string }>;

async function handleInbound(
  state: WeatherState,
  raw: string,
  envelopeName: string | undefined,
  getForecast: ForecastFn,
  replyAddress: string,
  dry: boolean,
  ymd: string,
): Promise<void> {
  const inbound = parseGarminEmail(raw, envelopeName);
  if (!inbound) {
    log('skip mail: no Garmin extId/guid');
    return;
  }
  try {
    inbound.guid = await ensureGarminGuid(inbound.guid);
  } catch (err) {
    log(`guid resolve failed: ${(err as Error).message}`);
    return;
  }
  const { sub, isNew } = upsertSubscriber(state, inbound, replyAddress);
  const cmd = parseCommand(`${inbound.text}\n${raw}`);
  const fix = subscriberFix(sub);
  log(
    `mail from ${sub.name} guid=${inbound.guid.slice(0, 8)} cmd=${cmd}` +
      `${isNew ? ' new' : ''} text=${JSON.stringify(inbound.text)}` +
      `${fix ? ` fix=${fix.lat.toFixed(4)},${fix.lon.toFixed(4)}` : ''}`,
  );

  if (cmd === 'stop') {
    sub.muted = true;
    const packed = await getForecast({ along: false, fix });
    await deliver(sub, packForCommand('stop', packed.forecast, new Date(), packed.tag), 'stop', { dry });
    return;
  }
  if (cmd === 'start') {
    sub.muted = false;
  }

  const action: WxCommand =
    cmd === 'register' ? (isNew || !sub.ackSent ? 'help' : 'daily') : cmd;

  if (recentlySent(sub, action) && action !== 'help') {
    log(`debounce ${sub.name} ${action}, last sent ${sub.lastSentAt}`);
    return;
  }

  const packed = await getForecast({
    along: action === 'hourly',
    shiftDays: action === 'today' ? 1 : 0,
    fix,
  });
  const payload = packForCommand(action, packed.forecast, new Date(), packed.tag);
  const dailyKind = action === 'daily' || action === 'start';
  const ok = await deliver(sub, payload, action, { dry, ymd: dailyKind ? ymd : undefined });
  if (ok && (action === 'help' || isNew)) sub.ackSent = true;
}

interface ImapAuth {
  user: string;
  pass: string;
}

async function pollInbox(
  auth: ImapAuth,
  state: WeatherState,
  getForecast: ForecastFn,
  replyAddress: string,
  dry: boolean,
  ymd: string,
): Promise<number> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth,
    logger: false,
  });

  let handled = 0;
  await client.connect();
  try {
    for (const boxName of ['INBOX', '[Gmail]/Spam']) {
      let lock;
      try {
        lock = await client.getMailboxLock(boxName);
      } catch {
        continue;
      }
      try {
        // Search then fetchOne — do not STORE \Seen while a FETCH iterator is open
        // (imapflow deadlocks on Gmail if you mix the two).
        const uids = await client.search({ seen: false }, { uid: true });
        for (const uid of uids || []) {
          const uidKey = `${boxName}:${uid}`;
          if (state.seenUids.includes(uidKey)) continue;
          const msg = await client.fetchOne(
            uid,
            { source: true, envelope: true, uid: true },
            { uid: true },
          );
          if (!msg) continue;
          const source = Buffer.isBuffer(msg.source)
            ? msg.source.toString('utf8')
            : String(msg.source ?? '');
          const fromName =
            msg.envelope?.from?.[0]?.name ||
            msg.envelope?.subject?.replace(/^inReach message from\s+/i, '');
          try {
            await handleInbound(state, source, fromName, getForecast, replyAddress, dry, ymd);
            handled += 1;
          } catch (err) {
            log(`handleInbound failed: ${(err as Error).message}`);
          }
          state.seenUids.push(uidKey);
          try {
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          } catch (err) {
            log(`could not mark seen ${uidKey}: ${(err as Error).message}`);
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
  return handled;
}

async function sendDailyWindow(
  state: WeatherState,
  getForecast: ForecastFn,
  timezone: string,
  sendHour: number,
  force: boolean,
  dry: boolean,
): Promise<number> {
  const { hour, ymd } = hourMinuteInTz(new Date(), timezone);
  const inWindow = force || (hour >= sendHour && hour < sendHour + 4);
  if (!inWindow) return 0;

  let sent = 0;
  for (const sub of pickDailyRecipients(state, ymd, force)) {
    const packed = await getForecast({ along: false, fix: subscriberFix(sub) });
    const ok = await deliver(sub, packDaily(packed.forecast, new Date(), packed.tag), 'daily', { dry, ymd });
    if (ok) sent += 1;
  }
  return sent;
}

async function runOnce() {
  resetConfigCache();
  const cfg = getConfig().inreachWeather;
  if (!cfg) {
    // Timer is installed site-wide; stay quiet until Gmail creds land in config.json.
    return;
  }

  const stateFile = resolveStateFile(cfg.stateFile);
  const state = await loadState(stateFile);

  let trip = null;
  try {
    trip = await loadTrip(cfg.tripSlug, cfg.park);
  } catch (err) {
    log(`trip load failed: ${(err as Error).message}`);
  }
  if (trip) {
    const days = splitTripDays(trip.waypoints);
    log(`trip ${trip.slug} "${trip.name}" days=${days.length} start=${cfg.startDate ?? '(unset, day 1)'}`);
  } else {
    log(`no paddle trip (${cfg.tripSlug ?? 'tripSlug unset'}) — last GPS or fallback ${cfg.lat},${cfg.lon}`);
  }

  const cache = new Map<string, Forecast>();
  const getForecast: ForecastFn = async (opts) => {
    const pt = pointFor(cfg, trip, opts);
    const key = `${pt.lat.toFixed(3)},${pt.lon.toFixed(3)}`;
    let forecast = cache.get(key);
    if (!forecast) {
      forecast = await fetchForecast({ lat: pt.lat, lon: pt.lon, timezone: cfg.timezone });
      cache.set(key, forecast);
    }
    return { forecast, tag: pt.tag };
  };

  const { ymd } = hourMinuteInTz(new Date(), cfg.timezone);
  const nBefore = Object.keys(state.subscribers).length;
  const pass = cfg.gmailAppPassword.replace(/\s+/g, '');
  const handled = await pollInbox(
    { user: cfg.gmailUser, pass },
    state,
    getForecast,
    cfg.gmailUser,
    DRY,
    ymd,
  );

  const daily = await sendDailyWindow(
    state,
    getForecast,
    cfg.timezone,
    cfg.sendHour,
    SEND_DAILY,
    DRY,
  );

  await saveState(stateFile, state);
  const n = Object.keys(state.subscribers).length;
  if (n !== nBefore) log(`coalesced subscribers ${nBefore} -> ${n}`);
  log(`done inbox=${handled} daily=${daily} subs=${n} dry=${DRY}`);
}

async function main() {
  if (PREVIEW) {
    await preview();
    return;
  }
  await runOnce();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
