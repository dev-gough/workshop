'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface Account {
  id: number;
  name: string;
  seedCents: number;
  cashCents: number;
  holdingsCents: number;
  totalValueCents: number;
  totalPnlCents: number;
  positionCount: number;
  createdAt: string;
}

interface AccountContextValue {
  accounts: Account[];
  selected: Account | null;
  selectedId: number | null;
  loading: boolean;
  select: (id: number) => void;
  refresh: () => Promise<void>;
  createAccount: (name: string, seedDollars: number) => Promise<{ ok: boolean; error?: string }>;
  renameAccount: (id: number, name: string) => Promise<{ ok: boolean; error?: string }>;
  deleteAccount: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

const STORAGE_KEY = 'paper-trading:selected-account';

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/paper-trading/accounts');
      const data = await res.json();
      const list: Account[] = data.accounts ?? [];
      setAccounts(list);
      setSelectedId((prev) => {
        if (prev != null && list.some((a) => a.id === prev)) return prev;
        const stored = typeof window !== 'undefined' ? Number(localStorage.getItem(STORAGE_KEY)) : NaN;
        if (Number.isFinite(stored) && list.some((a) => a.id === stored)) return stored;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      console.error('failed to load accounts', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const select = useCallback((id: number) => {
    setSelectedId(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch { /* ignore */ }
  }, []);

  const createAccount = useCallback(async (name: string, seedDollars: number) => {
    const res = await fetch('/api/paper-trading/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, seedDollars }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    await refresh();
    if (data.account?.id) select(data.account.id);
    return { ok: true };
  }, [refresh, select]);

  const renameAccount = useCallback(async (id: number, name: string) => {
    const res = await fetch(`/api/paper-trading/accounts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    await refresh();
    return { ok: true };
  }, [refresh]);

  const deleteAccount = useCallback(async (id: number) => {
    const res = await fetch(`/api/paper-trading/accounts/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error };
    if (selectedId === id) setSelectedId(null);
    await refresh();
    return { ok: true };
  }, [refresh, selectedId]);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  return (
    <AccountContext.Provider value={{ accounts, selected, selectedId, loading, select, refresh, createAccount, renameAccount, deleteAccount }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccounts(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccounts must be used within AccountProvider');
  return ctx;
}
