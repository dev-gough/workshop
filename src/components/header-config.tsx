'use client';

import {
  createContext, useContext, useEffect, useLayoutEffect, useMemo, useState,
  type ReactNode,
} from 'react';

/**
 * Per-page configuration for the global site Header. Pages declare what they
 * want; the Header reads it. Today that's just a theme `scopeClass` (e.g.
 * 'ws-theme') so the bar can recolor/refont itself to match a themed page —
 * but this is the extension point for future per-page chrome (accent, a
 * center slot, hiding nav, …). Add fields here and read them in Header.
 */
export interface HeaderConfig {
  /** A theme-scope class to apply to the <header> (remaps --color-* + font). */
  scopeClass?: string;
}

interface HeaderConfigCtx {
  config: HeaderConfig;
  setConfig: (c: HeaderConfig) => void;
}

const HeaderConfigContext = createContext<HeaderConfigCtx | null>(null);

// useLayoutEffect on the server warns; fall back to useEffect there.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function HeaderConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<HeaderConfig>({});
  const value = useMemo(() => ({ config, setConfig }), [config]);
  return <HeaderConfigContext.Provider value={value}>{children}</HeaderConfigContext.Provider>;
}

/** Read the active config (used by the Header itself). */
export function useHeaderConfigValue(): HeaderConfig {
  return useContext(HeaderConfigContext)?.config ?? {};
}

/**
 * Page-side hook: apply a header config for the lifetime of the calling
 * component, resetting on unmount. Runs as a layout effect so client-side
 * navigations apply before paint (a hard refresh may briefly show the
 * default header before hydration — acceptable for our purposes).
 */
export function useHeaderConfig({ scopeClass }: HeaderConfig) {
  const ctx = useContext(HeaderConfigContext);
  useIsoLayoutEffect(() => {
    if (!ctx) return;
    ctx.setConfig({ scopeClass });
    return () => ctx.setConfig({});
    // Depend on the primitive fields, not the (re-created) object literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, scopeClass]);
}
