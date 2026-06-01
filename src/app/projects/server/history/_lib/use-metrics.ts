'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

export interface MetricsResponse {
  kind: string;
  from: string;
  to: string;
  bucketSec: number;
  multiLabel: boolean;
  series: Record<string, Array<Record<string, number | string | null>>>;
}

export function useUrlWindow() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromParam = sp.get('from');
  const toParam = sp.get('to');
  const hasUrlWindow = !!(fromParam && toParam);
  const toMs = toParam ? new Date(toParam).getTime() : Date.now();
  const fromMs = fromParam ? new Date(fromParam).getTime() : toMs - 3600_000;

  const setWindow = useCallback((f: number, t: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('from', new Date(f).toISOString());
    params.set('to', new Date(t).toISOString());
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [sp, router, pathname]);

  const clearWindow = useCallback(() => {
    const params = new URLSearchParams(sp.toString());
    params.delete('from');
    params.delete('to');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const setRangeFromNow = useCallback((rangeSec: number) => {
    const now = Date.now();
    setWindow(now - rangeSec * 1000, now);
  }, [setWindow]);

  return { fromMs, toMs, hasUrlWindow, setWindow, clearWindow, setRangeFromNow };
}

/**
 * Polls /api/server/metrics/v2 when window or kind changes. Also re-fetches on
 * a 30s interval as long as the window's right edge is within `liveThresholdMs`
 * of now (i.e. the user is viewing a "live" window).
 */
export function useMetrics(
  kind: string,
  fromMs: number,
  toMs: number,
  opts?: { maxPoints?: number; labels?: string[]; liveThresholdMs?: number; pollIntervalMs?: number },
) {
  const maxPoints = opts?.maxPoints ?? 500;
  const labels = opts?.labels;
  const liveThresholdMs = opts?.liveThresholdMs ?? 60_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 30_000;

  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const labelsKey = labels?.join(',') ?? '';

  useEffect(() => {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return;
    let cancelled = false;
    const myReq = ++reqRef.current;

    const fetchOnce = () => {
      const params = new URLSearchParams({
        kind,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        maxPoints: String(maxPoints),
      });
      if (labelsKey) params.set('labels', labelsKey);
      setLoading(true);
      fetch(`/api/server/metrics/v2?${params}`)
        .then((r) => r.json())
        .then((d: MetricsResponse | { error: string }) => {
          if (cancelled || reqRef.current !== myReq) return;
          if ('error' in d) setError(d.error);
          else { setData(d); setError(null); }
        })
        .catch((e) => { if (!cancelled) setError(String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };

    fetchOnce();

    const isLive = Math.abs(Date.now() - toMs) < liveThresholdMs;
    let interval: NodeJS.Timeout | undefined;
    if (isLive) interval = setInterval(fetchOnce, pollIntervalMs);
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [kind, fromMs, toMs, maxPoints, labelsKey, liveThresholdMs, pollIntervalMs]);

  return { data, loading, error };
}
