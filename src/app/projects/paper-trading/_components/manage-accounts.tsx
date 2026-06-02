'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Pencil, Trash2, Check } from 'lucide-react';
import { useAccounts } from '../_lib/account-context';
import { fmtMoney } from '../_lib/format';

export default function ManageAccounts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { accounts, createAccount, renameAccount, deleteAccount } = useAccounts();
  const [newName, setNewName] = useState('');
  const [newSeed, setNewSeed] = useState('10000');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setError(null);
    const seed = Number(newSeed);
    if (!newName.trim()) { setError('Enter an account name'); return; }
    if (!Number.isFinite(seed) || seed <= 0) { setError('Enter a positive seed amount'); return; }
    setBusy(true);
    const res = await createAccount(newName.trim(), seed);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Failed to create'); return; }
    setNewName(''); setNewSeed('10000');
  }

  async function handleRename(id: number) {
    if (!editName.trim()) return;
    setBusy(true);
    await renameAccount(id, editName.trim());
    setBusy(false);
    setEditingId(null);
  }

  async function handleDelete(id: number) {
    setBusy(true);
    await deleteAccount(id);
    setBusy(false);
    setConfirmDelete(null);
  }

  const inputCls = 'rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-foreground/40';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px]" onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-card p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="ws-serif text-2xl font-semibold tracking-tight">Accounts</h2>
              <button onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Existing accounts */}
            <div className="mb-6 max-h-64 space-y-1.5 overflow-y-auto">
              {accounts.length === 0 && <p className="text-sm text-muted-foreground">No accounts yet — create one below.</p>}
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-2xl bg-muted px-3.5 py-3">
                  {editingId === a.id ? (
                    <>
                      <input
                        autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRename(a.id)}
                        className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/40"
                      />
                      <button onClick={() => handleRename(a.id)} disabled={busy} className="rounded-full p-2 pt-gain hover:bg-card" aria-label="Save"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setEditingId(null)} className="rounded-full p-2 text-muted-foreground hover:bg-card" aria-label="Cancel"><X className="h-4 w-4" /></button>
                    </>
                  ) : confirmDelete === a.id ? (
                    <>
                      <span className="flex-1 text-sm">Delete <strong>{a.name}</strong>? This removes all its trades.</span>
                      <button onClick={() => handleDelete(a.id)} disabled={busy} className="rounded-full pt-bg-loss px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">Delete</button>
                      <button onClick={() => setConfirmDelete(null)} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-card">Cancel</button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{a.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">{fmtMoney(a.totalValueCents)} · seed {fmtMoney(a.seedCents)}</div>
                      </div>
                      <button onClick={() => { setEditingId(a.id); setEditName(a.name); }} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-foreground" aria-label="Rename"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setConfirmDelete(a.id)} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-[var(--color-loss)]" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Create */}
            <div className="rounded-2xl bg-muted p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">New account</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Account name"
                  className={`flex-1 ${inputCls}`}
                />
                <div className="relative sm:w-40">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input
                    value={newSeed} onChange={(e) => setNewSeed(e.target.value)} inputMode="decimal" placeholder="10000"
                    className={`w-full pl-7 tabular-nums ${inputCls}`}
                  />
                </div>
                <button onClick={handleCreate} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> Create
                </button>
              </div>
            </div>

            {error && <p className="mt-3 text-sm pt-loss">{error}</p>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
