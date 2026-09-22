'use client';

import { useEffect, useRef, useState } from 'react';
import { LIVE_URL, type LiveSnapshot } from './live';

export type LiveStatus = 'connecting' | 'live' | 'offline';

export function useMegabonkLive(onSnapshot: (snap: LiveSnapshot) => void) {
  const handler = useRef(onSnapshot);
  handler.current = onSnapshot;
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [httpsPage, setHttpsPage] = useState(false);

  useEffect(() => {
    setHttpsPage(window.location.protocol === 'https:');
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry = 0;

    const connect = () => {
      if (stopped) return;
      setStatus(current => (current === 'live' ? current : 'connecting'));
      let next: WebSocket;
      try {
        next = new WebSocket(LIVE_URL);
      } catch {
        setStatus('offline');
        retry = window.setTimeout(connect, 2000);
        return;
      }
      socket = next;
      next.onopen = () => setStatus('live');
      next.onmessage = event => {
        try {
          handler.current(JSON.parse(String(event.data)) as LiveSnapshot);
        } catch {
          // A partial frame is the mod's problem; keep the last good snapshot.
        }
      };
      next.onerror = () => next.close();
      next.onclose = () => {
        if (stopped) return;
        setStatus('offline');
        retry = window.setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return { status, httpsPage };
}
