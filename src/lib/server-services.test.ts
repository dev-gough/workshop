import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServiceSnapshotCache,
  parseSystemctlSnapshot,
  type SystemdServiceState,
} from './server-services';

const SYSTEMCTL_OUTPUT = `Id=alpha.service
ActiveState=active
SubState=running
Description=Alpha worker
MainPID=42
MemoryCurrent=2048
ActiveEnterTimestamp=Mon 2026-09-21 12:00:00 EDT
UnitFileState=enabled
ExecMainStatus=0

Id=beta.service
ActiveState=failed
SubState=failed
Description=Beta worker
MainPID=0
MemoryCurrent=[not set]
ActiveEnterTimestamp=
UnitFileState=disabled
ExecMainStatus=1
`;

test('parseSystemctlSnapshot preserves requested order and derives service health', () => {
  const services = parseSystemctlSnapshot(SYSTEMCTL_OUTPUT, ['beta', 'missing', 'alpha']);

  assert.deepEqual(services.map(({ name, status }) => ({ name, status })), [
    { name: 'beta', status: 'failed' },
    { name: 'missing', status: 'unknown' },
    { name: 'alpha', status: 'running' },
  ]);
  assert.equal(services[2].displayName, 'Alpha worker');
  assert.equal(services[2].pid, 42);
  assert.equal(services[2].memoryBytes, 2048);
  assert.equal(services[1].activeState, 'unknown');
});

test('parseSystemctlSnapshot treats systemd SIGTERM exit as stopped', () => {
  const output = SYSTEMCTL_OUTPUT.replace('ExecMainStatus=1', 'ExecMainStatus=143');
  assert.equal(parseSystemctlSnapshot(output, ['beta'])[0].status, 'stopped');
});

test('service snapshot cache batches loads, expires, and invalidates', () => {
  let now = 1_000;
  let loads = 0;
  const service: SystemdServiceState = parseSystemctlSnapshot(SYSTEMCTL_OUTPUT, ['alpha'])[0];
  const cache = createServiceSnapshotCache({
    load: () => {
      loads += 1;
      return [service];
    },
    ttlMs: 4_000,
    now: () => now,
  });

  const first = cache.get();
  now += 3_999;
  const hit = cache.get();

  assert.equal(loads, 1);
  assert.equal(first.cacheHit, false);
  assert.equal(hit.cacheHit, true);
  assert.equal(hit.capturedAt, first.capturedAt);

  now += 1;
  assert.equal(cache.get().cacheHit, false);
  assert.equal(loads, 2);

  cache.invalidate();
  assert.equal(cache.get().cacheHit, false);
  assert.equal(loads, 3);
});
