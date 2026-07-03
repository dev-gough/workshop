import type { AlignedData } from 'uplot';
import type { MetricsResponse } from './use-metrics';
import { fmtBytes } from '@/lib/format';

/**
 * Convert a v2 metrics response into uPlot's AlignedData format. Picks `field`
 * from each point. For multi-label kinds, every label becomes its own series.
 * Returns labels in their iteration order from `response.series`.
 *
 * Buckets across labels are aligned by the API (date_bin is deterministic), so
 * we use the union of all timestamps in order.
 */
export function alignSeries(response: MetricsResponse | null, field: string): { data: AlignedData; labels: string[] } {
  if (!response) return { data: [[]], labels: [] };
  const labels = Object.keys(response.series);
  if (labels.length === 0) return { data: [[]], labels: [] };

  const tsSet = new Set<string>();
  for (const lbl of labels) for (const p of response.series[lbl]) tsSet.add(p.ts as string);
  const xs = Array.from(tsSet).sort();
  const xsNums = xs.map((s) => Math.round(new Date(s).getTime() / 1000));

  const ys = labels.map((lbl) => {
    const pts = response.series[lbl];
    const map = new Map<string, number | null>();
    for (const p of pts) {
      const v = p[field];
      map.set(p.ts as string, typeof v === 'number' && Number.isFinite(v) ? v : null);
    }
    return xs.map((t) => map.get(t) ?? null);
  });

  return { data: [xsNums, ...ys] as AlignedData, labels };
}

/** Multi-field single-label helper: pluck several fields out of series[''] into one chart. */
export function alignFields(response: MetricsResponse | null, fields: string[]): { data: AlignedData; fields: string[] } {
  if (!response) return { data: [[]], fields };
  const pts = response.series[''] ?? Object.values(response.series)[0] ?? [];
  const xs = pts.map((p) => Math.round(new Date(p.ts as string).getTime() / 1000));
  const ys = fields.map((f) => pts.map((p) => {
    const v = p[f];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }));
  return { data: [xs, ...ys] as AlignedData, fields };
}

/** Return the last numeric value of a field from the default (single-label) series. */
export function lastValue(response: MetricsResponse | null, field: string, label = ''): number | null {
  if (!response) return null;
  const pts = response.series[label] ?? Object.values(response.series)[0];
  if (!pts) return null;
  for (let i = pts.length - 1; i >= 0; i--) {
    const v = pts[i][field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function formatBytes(n: number | null | undefined): string {
  // '—' only for missing data; a genuine zero reading (e.g. no swap used)
  // still shows as '0 B'.
  if (n == null || !Number.isFinite(n)) return '—';
  return fmtBytes(n, '0 B');
}

export function formatRate(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec)) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
