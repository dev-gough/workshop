import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changedTransferFrame,
  isActiveTransferState,
  transferCancelPath,
  type TransferSnapshot,
} from './soulseek-transfers';

test('isActiveTransferState excludes every terminal slskd state', () => {
  assert.equal(isActiveTransferState('Queued, Locally'), true);
  assert.equal(isActiveTransferState('InProgress'), true);
  assert.equal(isActiveTransferState('Completed, Succeeded'), false);
  assert.equal(isActiveTransferState('Completed, Cancelled'), false);
  assert.equal(isActiveTransferState('Errored'), false);
  assert.equal(isActiveTransferState('Rejected'), false);
  assert.equal(isActiveTransferState('Aborted'), false);
});

test('changedTransferFrame suppresses identical snapshots and emits changes', () => {
  const first: TransferSnapshot = {
    downloads: { alice: [{ id: 'one', bytesTransferred: 10 }] },
    uploads: {},
  };
  const initial = changedTransferFrame(first, null);

  assert.equal(initial.frame, `data: ${JSON.stringify(first)}\n\n`);
  assert.equal(changedTransferFrame(first, initial.serialized).frame, null);

  const changed: TransferSnapshot = {
    downloads: { alice: [{ id: 'one', bytesTransferred: 20 }] },
    uploads: {},
  };
  assert.notEqual(changedTransferFrame(changed, initial.serialized).frame, null);
});

test('transferCancelPath selects the wire and escapes peer-controlled segments', () => {
  assert.equal(
    transferCancelPath('down', 'peer/name', 'track ? 1'),
    '/api/v0/transfers/downloads/peer%2Fname/track%20%3F%201?remove=true',
  );
  assert.equal(
    transferCancelPath('up', 'listener', '42'),
    '/api/v0/transfers/uploads/listener/42?remove=true',
  );
});
