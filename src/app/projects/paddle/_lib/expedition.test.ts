import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDaylightPlan, fmtClock, solarWindow, torontoOffsetMinutes } from './expedition';

test('solar window follows Ontario civil time and daylight saving', () => {
  assert.equal(torontoOffsetMinutes('2026-06-21'), -240);
  assert.equal(torontoOffsetMinutes('2026-12-21'), -300);

  const summer = solarWindow('2026-06-21', 45.5, -79);
  assert.ok(summer.sunriseMin > 5 * 60 && summer.sunriseMin < 6 * 60);
  assert.ok(summer.sunsetMin > 20.75 * 60 && summer.sunsetMin < 21.75 * 60);
});

test('daylight plan advances dates and flags negative light reserve', () => {
  const plan = buildDaylightPlan(
    [
      { paddleM: 20_000, portageM: 500, carries: 2, timeH: 7 },
      { paddleM: 25_000, portageM: 800, carries: 3, timeH: 14 },
    ],
    '2026-09-10',
    8 * 60,
    [-79, 45.5],
  );

  assert.equal(plan[0].date, '2026-09-10');
  assert.equal(plan[1].date, '2026-09-11');
  assert.equal(plan[0].landMin, 15 * 60);
  assert.ok(plan[0].reserveMin > 0);
  assert.ok(plan[1].reserveMin < 0);
  assert.equal(fmtClock(13 * 60 + 5), '1:05pm');
});
