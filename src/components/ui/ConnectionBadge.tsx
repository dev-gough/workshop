'use client';

import { Loader, Wifi, WifiOff } from 'lucide-react';

/**
 * Connection status pill extracted from the jellyfin and soulseek pages, which
 * shipped byte-identical copies apart from the prop name (`ok` vs `connected`)
 * and the labels. Unified on `ok`; labels are overridable so both call sites
 * keep their wording ("Daemon up/down" for jellyfin, "Connected/Disconnected"
 * for soulseek). `ok === null` renders the checking state.
 */
export function ConnectionBadge({
  ok,
  upLabel = 'Connected',
  downLabel = 'Disconnected',
  checkingLabel = 'Checking…',
}: {
  ok: boolean | null;
  upLabel?: string;
  downLabel?: string;
  checkingLabel?: string;
}) {
  if (ok === null)
    return (
      <span className="text-xs text-zinc-500 flex items-center gap-1">
        <Loader className="h-3 w-3 animate-spin" /> {checkingLabel}
      </span>
    );
  return ok ? (
    <span className="text-xs text-emerald-400 flex items-center gap-1">
      <Wifi className="h-3 w-3" /> {upLabel}
    </span>
  ) : (
    <span className="text-xs text-red-400 flex items-center gap-1">
      <WifiOff className="h-3 w-3" /> {downLabel}
    </span>
  );
}
