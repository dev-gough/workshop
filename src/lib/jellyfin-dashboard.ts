export type JellyfinPollStream = 'transfers' | 'history' | 'stats';

export interface SharingProjection {
  ratio: number;
  progress: number;
  remainingBytes: number;
  secondsAtCurrentRate: number | null;
  reached: boolean;
}

export function sharingProjection(
  uploadedBytes: number,
  downloadedBytes: number,
  uploadBytesPerSecond: number,
  targetRatio = 10,
): SharingProjection | null {
  if (downloadedBytes <= 0 || targetRatio <= 0) return null;

  const targetBytes = downloadedBytes * targetRatio;
  const remainingBytes = Math.max(0, targetBytes - uploadedBytes);
  const ratio = Math.max(0, uploadedBytes / downloadedBytes);

  return {
    ratio,
    progress: Math.min(1, uploadedBytes / targetBytes),
    remainingBytes,
    secondsAtCurrentRate:
      remainingBytes > 0 && uploadBytesPerSecond > 0
        ? Math.ceil(remainingBytes / uploadBytesPerSecond)
        : null,
    reached: remainingBytes === 0,
  };
}

export function jellyfinPollInterval(
  stream: JellyfinPollStream,
  hasActiveTransfer: boolean,
): number {
  if (stream === 'transfers') return hasActiveTransfer ? 2_000 : 8_000;
  if (stream === 'history') return hasActiveTransfer ? 6_000 : 30_000;
  return hasActiveTransfer ? 5_000 : 15_000;
}

// Polling payloads are small and JSON-compatible. Returning the previous
// reference lets React skip a full room render when a poll changed nothing.
export function reuseEqualSnapshot<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
