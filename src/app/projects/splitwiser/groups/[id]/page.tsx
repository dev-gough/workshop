'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Plus, Loader, Users, Receipt, Sparkles,
  Copy, Check, X, Settings, Send, Trash2, AlertTriangle,
  HandCoins, ArrowRightLeft,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import {
  Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader,
} from '@/components/ui/sheet';

// ── Types ──

interface Me { id: number; name: string; color: string }
interface Member {
  id: number; name: string; color: string;
  is_ghost: boolean; created_by: number | null;
  joined_at: string; removed_at: string | null;
}
interface Group {
  id: number; name: string; invite_token: string;
  invite_enabled: boolean; created_by: number; archived_at: string | null;
}
interface Balance {
  id: number; name: string; color: string;
  is_ghost: boolean; balance_cents: string;
}
interface Expense {
  id: number; group_id: number; paid_by: number;
  description: string; total_cents: string; currency: string;
  occurred_on: string; note: string | null;
  created_by: number; created_at: string; deleted_at: string | null;
  shares: { user_id: number; share_cents: string }[];
}

// ── Helpers ──

function fmtMoney(cents: number | string): string {
  const n = typeof cents === 'string' ? parseInt(cents, 10) : cents;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

// ── Add-expense Sheet ──

function AddExpenseSheet({
  open, onOpenChange, groupId, members, me, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: number;
  members: Member[];
  me: Me;
  onSaved: () => void;
}) {
  const activeMembers = useMemo(() => members.filter((m) => !m.removed_at), [members]);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paidBy, setPaidBy] = useState<number>(me.id);
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [shareIds, setShareIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the sheet opens
  useEffect(() => {
    if (open) {
      setAmount('');
      setDescription('');
      setPaidBy(me.id);
      setOccurredOn(todayISO());
      setShareIds(new Set(activeMembers.map((m) => m.id)));
      setError(null);
    }
  }, [open, me.id, activeMembers]);

  const totalCents = (() => {
    const f = parseFloat(amount);
    if (!Number.isFinite(f) || f <= 0) return 0;
    return Math.round(f * 100);
  })();

  const toggleShare = (id: number) => {
    setShareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (totalCents <= 0) { setError('Enter an amount'); return; }
    if (!description.trim()) { setError('Add a description'); return; }
    if (shareIds.size === 0) { setError('Select at least one person'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/splitwiser/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          description: description.trim(),
          total_cents: totalCents,
          paid_by: paidBy,
          occurred_on: occurredOn,
          share_user_ids: Array.from(shareIds).sort(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'failed to save');
      } else {
        onSaved();
        onOpenChange(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const splitPreview = totalCents > 0 && shareIds.size > 0
    ? Math.floor(totalCents / shareIds.size)
    : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] sm:max-h-[80vh] sm:max-w-lg sm:mx-auto sm:rounded-t-2xl rounded-t-2xl px-0 pt-0 overflow-y-auto"
        showCloseButton={false}
      >
        <SheetHeader className="border-b border-border/40 sticky top-0 bg-background z-10 flex-row items-center justify-between gap-3 px-4 py-3">
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <SheetTitle className="text-base">New expense</SheetTitle>
          <button
            onClick={submit}
            disabled={submitting || totalCents <= 0 || !description.trim() || shareIds.size === 0}
            className="px-3 py-1.5 rounded-lg bg-amber-400 text-amber-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </button>
        </SheetHeader>

        <SheetDescription className="sr-only">Record a new expense to split among group members.</SheetDescription>

        <div className="space-y-5 px-4 pb-8 pt-4">
          {/* Amount */}
          <div className="text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-xl text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0.00"
                className="w-32 bg-transparent text-4xl font-bold text-center tabular-nums focus:outline-none placeholder:text-muted-foreground/40"
              />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mt-1">CAD</div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dinner, gas, groceries…"
              className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50 focus:border-amber-400/50"
            />
          </div>

          {/* Paid by + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Paid by</label>
              <select
                value={paidBy}
                onChange={(e) => setPaidBy(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50"
              >
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.id === me.id ? `${m.name} (you)` : m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Date</label>
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50"
              />
            </div>
          </div>

          {/* Split with */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Split equally between</label>
              <button
                onClick={() => setShareIds(
                  shareIds.size === activeMembers.length
                    ? new Set([me.id])
                    : new Set(activeMembers.map((m) => m.id)),
                )}
                className="text-[10px] text-amber-400 hover:text-amber-300"
              >
                {shareIds.size === activeMembers.length ? 'just me' : 'everyone'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeMembers.map((m) => {
                const on = shareIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleShare(m.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 border ${
                      on
                        ? 'bg-amber-400/15 border-amber-400/40 text-foreground'
                        : 'bg-muted/30 border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: on ? m.color : `${m.color}60` }}
                    />
                    {m.name}
                  </button>
                );
              })}
            </div>
            {splitPreview > 0 && (
              <div className="text-[11px] text-muted-foreground mt-2">
                ≈ {fmtMoney(splitPreview)} each
              </div>
            )}
          </div>

          {error && (
            <div className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> {error}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Settle-up Sheet ──

function SettleUpSheet({
  open, onOpenChange, groupId, members, me, defaultOtherId, balanceOf, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: number;
  members: Member[];
  me: Me;
  defaultOtherId: number | null;
  balanceOf: (id: number) => number;
  onSaved: () => void;
}) {
  const activeMembers = useMemo(() => members.filter((m) => !m.removed_at && m.id !== me.id), [members, me.id]);
  const myBalance = balanceOf(me.id);

  const [otherId, setOtherId] = useState<number>(defaultOtherId ?? activeMembers[0]?.id ?? 0);
  const [direction, setDirection] = useState<'i_pay' | 'they_pay'>('i_pay');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-pick a sensible default amount + direction when the sheet opens or
  // the counterparty changes.
  useEffect(() => {
    if (!open) return;
    const startId = defaultOtherId ?? activeMembers[0]?.id;
    if (!startId) return;
    setOtherId(startId);
    setOccurredOn(todayISO());
    setNote('');
    setError(null);
    // Pick direction based on signs: if I owe (negative) and they're owed (positive) → i_pay
    const otherBalance = balanceOf(startId);
    if (myBalance < 0 && otherBalance > 0) {
      setDirection('i_pay');
      setAmount((Math.min(Math.abs(myBalance), otherBalance) / 100).toFixed(2));
    } else if (myBalance > 0 && otherBalance < 0) {
      setDirection('they_pay');
      setAmount((Math.min(myBalance, Math.abs(otherBalance)) / 100).toFixed(2));
    } else {
      setDirection(myBalance < 0 ? 'i_pay' : 'they_pay');
      setAmount('');
    }
  }, [open, defaultOtherId, activeMembers, myBalance, balanceOf]);

  const totalCents = (() => {
    const f = parseFloat(amount);
    if (!Number.isFinite(f) || f <= 0) return 0;
    return Math.round(f * 100);
  })();

  const fromUser = direction === 'i_pay' ? me.id : otherId;
  const toUser = direction === 'i_pay' ? otherId : me.id;
  const otherMember = members.find((m) => m.id === otherId);

  const submit = async () => {
    if (totalCents <= 0) { setError('Enter an amount'); return; }
    if (!otherId) { setError('Pick someone'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/splitwiser/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          from_user: fromUser,
          to_user: toUser,
          amount_cents: totalCents,
          occurred_on: occurredOn,
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'failed to save');
      } else {
        onSaved();
        onOpenChange(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] sm:max-h-[80vh] sm:max-w-lg sm:mx-auto sm:rounded-t-2xl rounded-t-2xl px-0 pt-0 overflow-y-auto"
        showCloseButton={false}
      >
        <SheetHeader className="border-b border-border/40 sticky top-0 bg-background z-10 flex-row items-center justify-between gap-3 px-4 py-3">
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <SheetTitle className="text-base flex items-center gap-1.5">
            <HandCoins className="h-4 w-4 text-amber-400" />
            Settle up
          </SheetTitle>
          <button
            onClick={submit}
            disabled={submitting || totalCents <= 0 || !otherId}
            className="px-3 py-1.5 rounded-lg bg-amber-400 text-amber-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-40 transition-colors"
          >
            {submitting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Record'}
          </button>
        </SheetHeader>

        <SheetDescription className="sr-only">Record a settle-up payment between two members.</SheetDescription>

        <div className="space-y-5 px-4 pb-8 pt-4">
          {/* Direction toggle */}
          <div className="flex items-center justify-center gap-2">
            <div
              className="px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
              style={{
                backgroundColor: direction === 'i_pay' ? `${me.color}20` : 'transparent',
                color: direction === 'i_pay' ? me.color : 'var(--muted-foreground)',
              }}
            >
              {direction === 'i_pay' ? me.name : otherMember?.name || '?'}
            </div>
            <button
              onClick={() => setDirection(direction === 'i_pay' ? 'they_pay' : 'i_pay')}
              className="p-2 rounded-full hover:bg-muted/60 text-muted-foreground"
              aria-label="Swap direction"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </button>
            <div
              className="px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
              style={{
                backgroundColor: direction === 'i_pay' ? 'transparent' : `${me.color}20`,
                color: direction === 'i_pay' ? 'var(--muted-foreground)' : me.color,
              }}
            >
              {direction === 'i_pay' ? otherMember?.name || '?' : me.name}
            </div>
          </div>
          <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground -mt-3">
            {direction === 'i_pay' ? 'you pay them' : 'they pay you'}
          </div>

          {/* Amount */}
          <div className="text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-xl text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0.00"
                className="w-32 bg-transparent text-4xl font-bold text-center tabular-nums focus:outline-none placeholder:text-muted-foreground/40"
              />
            </div>
          </div>

          {/* Counterparty */}
          {activeMembers.length > 1 && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">
                With
              </label>
              <select
                value={otherId}
                onChange={(e) => setOtherId(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50"
              >
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date + note */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Date</label>
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e-transfer, cash…"
                className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm"
              />
            </div>
          </div>

          {error && (
            <div className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> {error}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Promote-ghost reveal modal ──

function PromoteResult({
  url, onClose,
}: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-2xl bg-card border border-border/60 p-5 space-y-3"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Promoted! Send them this link:</h3>
        </div>
        <input
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          className="w-full px-2 py-1.5 rounded bg-black/30 border border-border/40 text-xs font-mono"
        />
        <div className="flex gap-2">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="flex-1 px-3 py-2 rounded-lg bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 text-xs font-medium"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Page ──

export default function GroupPage() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params?.id ?? '0', 10);

  const [me, setMe] = useState<Me | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleWithId, setSettleWithId] = useState<number | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [addingGhost, setAddingGhost] = useState(false);
  const [ghostName, setGhostName] = useState('');
  const [promoteUrl, setPromoteUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!Number.isFinite(groupId) || groupId <= 0) return;
    try {
      const [meRes, groupRes, balRes, expRes] = await Promise.all([
        fetch('/api/splitwiser/me'),
        fetch(`/api/splitwiser/groups/${groupId}`),
        fetch(`/api/splitwiser/groups/${groupId}/balances`),
        fetch(`/api/splitwiser/expenses?group_id=${groupId}`),
      ]);
      if (!meRes.ok) { setError('not signed in'); return; }
      if (!groupRes.ok) { setError('not a member of this group'); return; }
      const meData = await meRes.json();
      const gData = await groupRes.json();
      const bData = await balRes.json();
      const eData = await expRes.json();
      setMe(meData.user);
      setGroup(gData.group);
      setMembers(gData.members);
      setBalances(bData.balances || []);
      setExpenses(eData.expenses || []);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { refresh(); }, [refresh]);

  const myBalance = useMemo(() => {
    if (!me) return 0;
    const b = balances.find((x) => x.id === me.id);
    return b ? parseInt(b.balance_cents, 10) : 0;
  }, [me, balances]);

  const balanceFor = (userId: number) => {
    const b = balances.find((x) => x.id === userId);
    return b ? parseInt(b.balance_cents, 10) : 0;
  };

  const memberById = (id: number) => members.find((m) => m.id === id);

  const inviteUrl = group
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/projects/splitwiser/join/${group.invite_token}`
    : '';

  const submitGhost = async () => {
    if (!ghostName.trim() || !group) return;
    const res = await fetch(`/api/splitwiser/groups/${group.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ghostName.trim() }),
    });
    if (res.ok) {
      setGhostName('');
      setAddingGhost(false);
      refresh();
    }
  };

  const promoteGhost = async (userId: number) => {
    const res = await fetch(`/api/splitwiser/users/${userId}/promote`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.login_url) setPromoteUrl(data.login_url);
  };

  const deleteExpense = async (id: number) => {
    if (!confirm('Delete this expense?')) return;
    await fetch(`/api/splitwiser/expenses/${id}`, { method: 'DELETE' });
    refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !group || !me) {
    return (
      <PageTransition>
        <div className="p-6">
          <div className="container mx-auto max-w-md">
            <div className="rounded-2xl border border-red-400/30 bg-red-500/5 p-6 text-center space-y-3">
              <AlertTriangle className="h-8 w-8 mx-auto text-red-400" />
              <p className="text-sm">{error || 'something went wrong'}</p>
              <Link href="/projects/splitwiser" className="inline-block text-xs text-amber-400">
                Back to SplitWiser
              </Link>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8 pb-24">
        <div className="container mx-auto max-w-2xl space-y-5">

          {/* Header */}
          <FadeIn>
            <div className="flex items-center gap-3">
              <Link
                href="/projects/splitwiser"
                className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground -ml-2"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="text-xl font-bold flex-1 truncate">{group.name}</h1>
              <button
                onClick={() => setShowInvite(!showInvite)}
                className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                aria-label="Group settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </FadeIn>

          <FadeIn delay={0.05}>
            <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-amber-950/40 to-card/60 p-4 text-center">
              {myBalance === 0 ? (
                <>
                  <div className="text-2xl font-bold text-muted-foreground">all settled up</div>
                  <div className="text-xs text-muted-foreground/70 mt-1">$0.00</div>
                </>
              ) : myBalance > 0 ? (
                <>
                  <div className="text-2xl font-bold text-emerald-400 tabular-nums">+{fmtMoney(myBalance)}</div>
                  <div className="text-xs text-muted-foreground mt-1">you&#39;re owed in this group</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-red-400 tabular-nums">{fmtMoney(myBalance)}</div>
                  <div className="text-xs text-muted-foreground mt-1">you owe in this group</div>
                </>
              )}
            </div>
          </FadeIn>

          {/* Invite link panel */}
          <AnimatePresence>
            {showInvite && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Invite link</div>
                  <div className="flex items-center gap-2">
                    <input
                      value={inviteUrl}
                      readOnly
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 px-2 py-1.5 rounded bg-black/30 border border-border/40 text-xs font-mono"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(inviteUrl)}
                      className="shrink-0 p-1.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                      aria-label="Copy"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Share this in your group chat. Anyone with this link can join.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Members + balances */}
          <FadeIn delay={0.1}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Members</h2>
                <span className="text-xs text-muted-foreground ml-auto">{members.filter((m) => !m.removed_at).length}</span>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/60 divide-y divide-border/40">
                {members.filter((m) => !m.removed_at).map((m) => {
                  const bal = balanceFor(m.id);
                  const canPromote = m.is_ghost && m.created_by === me.id;
                  const canSettle = m.id !== me.id && (myBalance !== 0 || bal !== 0);
                  return (
                    <div
                      key={m.id}
                      onClick={canSettle ? () => { setSettleWithId(m.id); setSettleOpen(true); } : undefined}
                      className={`flex items-center gap-3 px-4 py-3 ${canSettle ? 'cursor-pointer hover:bg-muted/30 transition-colors' : ''}`}>
                      <span
                        className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-background shrink-0"
                        style={{ backgroundColor: m.color }}
                      >
                        {m.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate flex items-center gap-1.5">
                          {m.name}
                          {m.id === me.id && <span className="text-[10px] text-muted-foreground">(you)</span>}
                          {m.is_ghost && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/20 text-zinc-400">ghost</span>}
                        </div>
                      </div>
                      <div className={`text-sm tabular-nums shrink-0 ${
                        bal === 0 ? 'text-muted-foreground' :
                        bal > 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {bal === 0 ? '–' : (bal > 0 ? '+' : '') + fmtMoney(bal)}
                      </div>
                      {canPromote && (
                        <button
                          onClick={(e) => { e.stopPropagation(); promoteGhost(m.id); }}
                          className="shrink-0 px-2 py-1 rounded text-[10px] bg-amber-400/15 hover:bg-amber-400/25 text-amber-300 font-medium flex items-center gap-1"
                          title="Generate a magic link for this user"
                        >
                          <Send className="h-3 w-3" /> promote
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Add ghost row */}
                {addingGhost ? (
                  <div className="flex items-center gap-2 px-4 py-3">
                    <input
                      type="text"
                      autoFocus
                      value={ghostName}
                      onChange={(e) => setGhostName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && submitGhost()}
                      placeholder="Name"
                      className="flex-1 px-2 py-1.5 rounded bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                    />
                    <button onClick={submitGhost} disabled={!ghostName.trim()}
                      className="px-2 py-1.5 rounded bg-amber-400 text-amber-950 text-xs font-medium disabled:opacity-50">
                      Add
                    </button>
                    <button onClick={() => { setAddingGhost(false); setGhostName(''); }}
                      className="p-1.5 rounded hover:bg-muted/60 text-muted-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingGhost(true)}
                    className="w-full px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-3 w-3" /> Add a person (ghost)
                  </button>
                )}
              </div>
            </div>
          </FadeIn>

          {/* Expenses */}
          <FadeIn delay={0.15}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Expenses</h2>
                <span className="text-xs text-muted-foreground ml-auto">{expenses.length}</span>
              </div>
              {expenses.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                  No expenses yet. Tap the <Plus className="h-3 w-3 inline mx-0.5" /> button to add one.
                </div>
              ) : (
                <div className="rounded-xl border border-border/60 bg-card/60 divide-y divide-border/40">
                  {expenses.map((e) => {
                    const payer = memberById(e.paid_by);
                    const myShare = e.shares.find((s) => s.user_id === me.id);
                    const myShareCents = myShare ? parseInt(myShare.share_cents, 10) : 0;
                    const iPaid = e.paid_by === me.id;
                    const total = parseInt(e.total_cents, 10);
                    return (
                      <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex flex-col items-center justify-center w-10 shrink-0 text-[10px] text-muted-foreground uppercase tabular-nums">
                          <span className="text-amber-400/80 font-bold leading-none">
                            {fmtDate(e.occurred_on).split(' ')[0]}
                          </span>
                          <span className="text-base text-foreground font-bold leading-none">
                            {fmtDate(e.occurred_on).split(' ')[1]}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{e.description}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {payer?.name}{iPaid ? ' (you)' : ''} paid {fmtMoney(total)} · {e.shares.length} ways
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm tabular-nums ${
                            iPaid ? 'text-emerald-400' : myShareCents > 0 ? 'text-red-400' : 'text-muted-foreground'
                          }`}>
                            {iPaid
                              ? `+${fmtMoney(total - myShareCents)}`
                              : myShareCents > 0 ? `-${fmtMoney(myShareCents)}` : '—'}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {iPaid ? 'lent' : myShareCents > 0 ? 'your share' : 'not in split'}
                          </div>
                        </div>
                        {e.created_by === me.id && (
                          <button
                            onClick={() => deleteExpense(e.id)}
                            className="shrink-0 p-1.5 rounded hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </FadeIn>

          {/* FABs */}
          <div className="fixed bottom-6 right-6 sm:right-1/2 sm:translate-x-[19rem] z-30 flex flex-col gap-3">
            {myBalance !== 0 && members.filter((m) => !m.removed_at).length > 1 && (
              <button
                onClick={() => { setSettleWithId(null); setSettleOpen(true); }}
                className="h-12 w-12 rounded-full bg-card border border-amber-400/40 text-amber-400 shadow-lg hover:bg-amber-400/10 transition-all flex items-center justify-center"
                aria-label="Settle up"
                title="Settle up"
              >
                <HandCoins className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={() => setAddOpen(true)}
              className="h-14 w-14 rounded-full bg-amber-400 text-amber-950 shadow-lg hover:bg-amber-300 transition-all flex items-center justify-center"
              aria-label="Add expense"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
        </div>
      </div>

      <AddExpenseSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        groupId={group.id}
        members={members}
        me={me}
        onSaved={refresh}
      />

      <SettleUpSheet
        open={settleOpen}
        onOpenChange={setSettleOpen}
        groupId={group.id}
        members={members}
        me={me}
        defaultOtherId={settleWithId}
        balanceOf={balanceFor}
        onSaved={refresh}
      />

      {promoteUrl && <PromoteResult url={promoteUrl} onClose={() => setPromoteUrl(null)} />}
    </PageTransition>
  );
}
