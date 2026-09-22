export interface TransferSnapshot {
  downloads: Record<string, unknown[]>;
  uploads: Record<string, unknown[]>;
}

export type TransferDirection = 'down' | 'up';

export function transferCancelPath(
  direction: TransferDirection,
  username: string,
  id: string,
): string {
  const wire = direction === 'down' ? 'downloads' : 'uploads';
  return `/api/v0/transfers/${wire}/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=true`;
}

/** Terminal slskd states should not keep occupying the live-transfer panels. */
export function isActiveTransferState(state: string): boolean {
  return !['Completed', 'Cancelled', 'Errored', 'Rejected', 'Aborted'].some(
    terminal => state.includes(terminal),
  );
}

/**
 * Returns an SSE data frame only when the transfer snapshot changed.
 * JSON preserves insertion order for these API objects, so the serialized
 * value also doubles as the payload sent to the browser.
 */
export function changedTransferFrame(
  snapshot: TransferSnapshot,
  previous: string | null,
): { frame: string | null; serialized: string } {
  const serialized = JSON.stringify(snapshot);
  return {
    frame: serialized === previous ? null : `data: ${serialized}\n\n`,
    serialized,
  };
}
