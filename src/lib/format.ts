/**
 * Shared human-readable formatters for media/server pages.
 *
 * These consolidate the near-identical `fmtBytes`/`fmtSpeed`/`fmtTime`/`fmtEta`/
 * `fmtDuration` copies that were pasted into the jellyfin and soulseek pages, and
 * reconcile with the `formatBytes`/`formatRate` pair under server/history so all
 * call sites can migrate onto these later. Behaviour is the union of the copies:
 *
 *  - `fmtBytes` accepts number | string | null | undefined, scales up to TB, and
 *    returns a placeholder for empty/non-positive input (the caller passes the
 *    placeholder it wants — jellyfin used '–', soulseek '0 B', server '—').
 *  - `fmtSpeed` matches the soulseek copy (has a B/s tier) which is a superset of
 *    the jellyfin one.
 *  - `fmtEta` / `fmtDuration` keep the jellyfin semantics (compact d/h/m/s); the
 *    soulseek page's clock-style `m:ss` duration is a different shape and is left
 *    to that page as a local helper.
 */

/**
 * Human-readable byte size (up to TB). `placeholder` is returned for
 * empty/null/NaN input and for `0`. Negative input (e.g. a byte-delta) is
 * formatted as `-` + the absolute value so signed deltas still display; only
 * exact `0` collapses to the placeholder.
 */
export function fmtBytes(
  bytes: number | string | null | undefined,
  placeholder = '–',
): string {
  const n = typeof bytes === 'string' ? parseInt(bytes) : bytes;
  if (n == null || !Number.isFinite(n) || n === 0) return placeholder;
  if (n < 0) return '-' + fmtBytes(-n, placeholder);
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
  if (n < 1024 ** 4) return (n / 1024 ** 3).toFixed(2) + ' GB';
  return (n / 1024 ** 4).toFixed(2) + ' TB';
}

/** Human-readable transfer speed (B/s → MB/s). */
export function fmtSpeed(bytesPerSec: number, placeholder = '0 KB/s'): string {
  if (!bytesPerSec || bytesPerSec <= 0) return placeholder;
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
}

/** Compact ETA (s / m / "h m" / d). */
export function fmtEta(seconds: number): string {
  if (!seconds || seconds < 0) return '–';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Compact duration (s / m / h / d). */
export function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/**
 * Locale time/date. Same-day timestamps show only the time; older ones prepend
 * a "Mon D" date. Empty input returns ''. Accepts null so it can format nullable
 * columns directly.
 */
export function fmtTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
