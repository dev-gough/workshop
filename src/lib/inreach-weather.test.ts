/**
 * Regression tests for the inReach weather bot.
 *
 * The Temagami trip registered 11 Garmin conversation UUIDs for one person
 * and the 6am job POSTed a copy to each of them. These tests fail that way.
 *
 *   npx tsx --test src/lib/inreach-weather.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  coalesceSubscribers,
  emptyState,
  parseGarminCoords,
  parseGarminEmail,
  pickDailyRecipients,
  resolveForecastPoint,
  subscriberIdentity,
  upsertSubscriber,
  type Subscriber,
} from './inreach-weather';

const ORIGIN = 'https://explore.garmin.com';
const MAIL = 'bot@example.com';

/** The 11 GUIDs that produced 8–11 identical 6am copies on the Temagami trip. */
const TEMAGAMI_GUIDS = [
  '08df057a-53a2-062a-6045-bd7c48220000',
  '08df05ff-9527-5790-0022-487bbc140000',
  '08df05ff-a4ac-da6d-7ced-8d78f42b0000',
  '08df0646-dfba-bb3f-7ced-8d78f42b0000',
  '08df0759-7a8f-a784-7ced-8d79b8390000',
  '08df07b1-4ff6-91ab-0022-487bbc140000',
  '08df07b4-caf5-c0a1-7c1e-526ce42d0000',
  '08df07c2-2c6d-d1af-6045-bdb644350000',
  '08df0b8d-a14b-4708-7ced-8d78f42b0000',
  '08df0b93-1ef0-043f-7ced-8d78f42b0000',
  '08df0b95-8dcf-6f7b-6045-bdb644350000',
];

function sub(over: Partial<Subscriber> & { guid: string; name?: string }): Subscriber {
  return {
    guid: over.guid,
    formOrigin: ORIGIN,
    replyAddress: MAIL,
    name: over.name ?? 'Devon Gough',
    muted: over.muted ?? false,
    ackSent: over.ackSent ?? true,
    registeredAt: over.registeredAt ?? '2026-08-29T03:05:06.000Z',
    lastDailyOn: over.lastDailyOn ?? null,
    lastSentAt: over.lastSentAt ?? null,
    lastCommand: over.lastCommand ?? null,
    lastError: over.lastError ?? null,
    lastLat: over.lastLat ?? null,
    lastLon: over.lastLon ?? null,
    lastFixAt: over.lastFixAt ?? null,
  };
}

function garminMail(opts: {
  guid?: string;
  token?: string;
  name?: string;
  body?: string;
  lat?: number;
  lon?: number;
}): string {
  const name = opts.name ?? 'Devon Gough';
  const body = opts.body ?? "I'm checking in. Everything is okay.";
  const lat = opts.lat ?? 47.1234;
  const lon = opts.lon ?? -80.2222;
  const link = opts.guid
    ? `https://explore.garmin.com/textmessage/txtmsg?extId=${opts.guid}`
    : `https://inreachlink.com/${opts.token ?? 'gnJgDfoC1G_UEbPo9VdKmMQ'}`;
  return [
    `From: "Garmin" <noreply@garmin.com>`,
    `Subject: inReach message from ${name}`,
    `To: ${MAIL}`,
    ``,
    body,
    ``,
    `View the location or send a reply to ${name}:`,
    link,
    ``,
    `${name} sent this message from: Lat ${lat} Lon ${lon}`,
    ``,
    `Do not reply directly to this message.`,
  ].join('\n');
}

describe('subscriber identity', () => {
  it('keys one person by name, not by Garmin conversation UUID', () => {
    assert.equal(subscriberIdentity('Devon Gough', TEMAGAMI_GUIDS[0]), 'name:devon gough');
    assert.equal(subscriberIdentity(' devon   gough ', TEMAGAMI_GUIDS[1]), 'name:devon gough');
    assert.equal(
      subscriberIdentity('Devon Gough', TEMAGAMI_GUIDS[0]),
      subscriberIdentity('Devon Gough', TEMAGAMI_GUIDS[10]),
    );
  });

  it('keeps nameless handshakes on their own UUID', () => {
    assert.equal(subscriberIdentity('', TEMAGAMI_GUIDS[0]), `guid:${TEMAGAMI_GUIDS[0]}`);
    assert.equal(subscriberIdentity('inreach', TEMAGAMI_GUIDS[0]), `guid:${TEMAGAMI_GUIDS[0]}`);
  });
});

describe('coalesce + 6am daily', () => {
  it('the Temagami 11-GUID pile is one daily recipient', () => {
    const subscribers: Record<string, Subscriber> = {};
    TEMAGAMI_GUIDS.forEach((guid, i) => {
      subscribers[guid] = sub({
        guid,
        registeredAt: new Date(Date.parse('2026-08-29T03:05:06.000Z') + i * 3600_000).toISOString(),
      });
    });

    const merged = coalesceSubscribers(subscribers);
    assert.equal(Object.keys(merged).length, 1);
    const only = Object.values(merged)[0];
    assert.equal(only.name, 'Devon Gough');
    assert.equal(only.guid, TEMAGAMI_GUIDS[TEMAGAMI_GUIDS.length - 1]);

    const recips = pickDailyRecipients({ subscribers, seenUids: [] }, '2026-09-02', false);
    assert.equal(recips.length, 1, '6am must POST once, not once per leftover conversation');
    assert.equal(recips[0].guid, TEMAGAMI_GUIDS[TEMAGAMI_GUIDS.length - 1]);
  });

  it('two different names stay two recipients', () => {
    const subscribers = {
      a: sub({ guid: TEMAGAMI_GUIDS[0], name: 'Devon Gough' }),
      b: sub({ guid: TEMAGAMI_GUIDS[1], name: 'Pat Gough' }),
    };
    assert.equal(pickDailyRecipients({ subscribers, seenUids: [] }, '2026-09-02', false).length, 2);
  });

  it('skips muted and already-sent-today', () => {
    const subscribers = {
      a: sub({ guid: TEMAGAMI_GUIDS[0], lastDailyOn: '2026-09-02' }),
      b: sub({ guid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Pat Gough', muted: true }),
    };
    assert.equal(pickDailyRecipients({ subscribers, seenUids: [] }, '2026-09-02', false).length, 0);
    assert.equal(pickDailyRecipients({ subscribers, seenUids: [] }, '2026-09-02', true).length, 1);
    assert.equal(pickDailyRecipients({ subscribers, seenUids: [] }, '2026-09-03', false).length, 1);
  });
});

describe('upsertSubscriber', () => {
  it('a new check-in UUID updates the live GUID instead of adding a person', () => {
    const state = emptyState();
    const first = upsertSubscriber(
      state,
      {
        guid: TEMAGAMI_GUIDS[0],
        formOrigin: ORIGIN,
        name: 'Devon Gough',
        text: 'okay',
        lat: 47.07,
        lon: -80.15,
      },
      MAIL,
    );
    assert.equal(first.isNew, true);
    const second = upsertSubscriber(
      state,
      {
        guid: TEMAGAMI_GUIDS[1],
        formOrigin: ORIGIN,
        name: 'Devon Gough',
        text: 'starting',
        lat: 47.21,
        lon: -80.22,
      },
      MAIL,
    );
    assert.equal(second.isNew, false);
    assert.equal(Object.keys(state.subscribers).length, 1);
    assert.equal(second.sub.guid, TEMAGAMI_GUIDS[1]);
    assert.equal(second.sub.lastLat, 47.21);
    assert.equal(second.sub.lastLon, -80.22);
  });

  it('STOP survives the next check-in UUID', () => {
    const state = emptyState();
    const { sub: live } = upsertSubscriber(
      state,
      {
        guid: TEMAGAMI_GUIDS[0],
        formOrigin: ORIGIN,
        name: 'Devon Gough',
        text: 'stop',
        lat: null,
        lon: null,
      },
      MAIL,
    );
    live.muted = true;
    const next = upsertSubscriber(
      state,
      {
        guid: TEMAGAMI_GUIDS[1],
        formOrigin: ORIGIN,
        name: 'Devon Gough',
        text: "I'm checking in. Everything is okay.",
        lat: 47.1,
        lon: -80.2,
      },
      MAIL,
    );
    assert.equal(next.sub.muted, true);
    assert.equal(next.sub.guid, TEMAGAMI_GUIDS[1]);
    assert.equal(pickDailyRecipients(state, '2026-09-02', false).length, 0);
  });

  it('an okay-check in the 6am window marks lastDailyOn so the pusher does not send a second copy', () => {
    const state = emptyState();
    const { sub: live } = upsertSubscriber(
      state,
      {
        guid: TEMAGAMI_GUIDS[0],
        formOrigin: ORIGIN,
        name: 'Devon Gough',
        text: "I'm checking in. Everything is okay.",
        lat: 47.1,
        lon: -80.2,
      },
      MAIL,
    );
    live.lastDailyOn = '2026-08-31';
    live.lastCommand = 'daily';
    assert.equal(pickDailyRecipients(state, '2026-08-31', false).length, 0);
  });
});

describe('Garmin GPS', () => {
  it('reads Lat/Lon off the 2026 inreachlink.com check-in', () => {
    const raw = garminMail({
      token: 'gnJgDfoC1G_UEbPo9VdKmMQ',
      lat: 44.980592,
      lon: -78.41114,
    });
    const inbound = parseGarminEmail(raw);
    assert.ok(inbound);
    assert.equal(inbound!.name, 'Devon Gough');
    assert.equal(inbound!.text, "I'm checking in. Everything is okay.");
    assert.equal(inbound!.lat, 44.980592);
    assert.equal(inbound!.lon, -78.41114);
    assert.equal(inbound!.guid, 'gnJgDfoC1G_UEbPo9VdKmMQ');
  });

  it('reads the older Latitude:/Longitude: pair', () => {
    const coords = parseGarminCoords('Latitude: 47.075000\nLongitude: -80.150000');
    assert.deepEqual(coords, { lat: 47.075, lon: -80.15 });
  });
});

describe('resolveForecastPoint', () => {
  const trip: Array<[number, number, number]> = [
    [-80.15, 47.075, 0],
    [-80.22, 47.21, 1],
    [-80.3, 47.3, 1],
  ];
  const now = new Date('2026-08-30T10:00:00Z');

  it('prefers last check-in GPS over the planned camp and the put-in fallback', () => {
    const pt = resolveForecastPoint({
      waypoints: trip,
      startDate: '2026-08-29',
      now,
      timezone: 'America/Toronto',
      fallbackLat: 1,
      fallbackLon: 2,
      along: false,
      fixLat: 47.33,
      fixLon: -80.44,
    });
    assert.equal(pt.source, 'fix');
    assert.equal(pt.lat, 47.33);
    assert.equal(pt.lon, -80.44);
    assert.match(pt.tag, /47\.33,-80\.44/);
  });

  it('uses the trip camp when there is no GPS yet', () => {
    const pt = resolveForecastPoint({
      waypoints: trip,
      startDate: '2026-08-29',
      now,
      timezone: 'America/Toronto',
      fallbackLat: 1,
      fallbackLon: 2,
      along: false,
    });
    assert.equal(pt.source, 'trip');
    assert.equal(pt.dayIndex, 2);
  });

  it('falls back to the config point with no GPS and no trip', () => {
    const pt = resolveForecastPoint({
      waypoints: null,
      startDate: null,
      now,
      timezone: 'America/Toronto',
      fallbackLat: 47.075,
      fallbackLon: -80.15,
      along: false,
    });
    assert.equal(pt.source, 'fixed');
    assert.equal(pt.lat, 47.075);
  });
});
