'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet, Users, Plus, ArrowRight, Loader, Settings, Sparkles, Copy, Check,
} from 'lucide-react';
// (Users icon used by both filled-state group cards and the empty placeholder.)
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

// ── Types ──

interface Me {
  id: number;
  name: string;
  color: string;
  login_token: string | null;
}

interface Group {
  id: number;
  name: string;
  invite_token: string;
  invite_enabled: boolean;
  created_at: string;
  archived_at: string | null;
}

interface Balance {
  id: number;
  name: string;
  color: string;
  is_ghost: boolean;
  balance_cents: string;
}

// ── Helpers ──

const PALETTE = [
  '#fbbf24', '#22d3ee', '#a78bfa', '#f472b6',
  '#4ade80', '#38bdf8', '#fb7185', '#facc15',
];

function fmtMoney(cents: number | string): string {
  const n = typeof cents === 'string' ? parseInt(cents, 10) : cents;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

// ── Bootstrap / signup landing (unauth) ──

function SignupLanding({ isBootstrap }: { isBootstrap: boolean }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/splitwiser/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'signup failed');
      } else {
        window.location.href = '/projects/splitwiser';
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isBootstrap) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center space-y-3">
        <Sparkles className="h-8 w-8 mx-auto text-amber-400/70" />
        <h2 className="text-lg font-semibold">You need an invite</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          SplitWiser is invite-only. Ask the person who shared this with you for the invite link to your group.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-6 space-y-5">
      <div className="text-center space-y-2">
        <Sparkles className="h-8 w-8 mx-auto text-amber-400" />
        <h2 className="text-xl font-bold">First-time setup</h2>
        <p className="text-sm text-muted-foreground">
          You&#39;re the first user. Pick a name and a color.
        </p>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Your name"
          className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50 focus:border-amber-400/50"
        />

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Color</div>
          <div className="flex gap-2 flex-wrap">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-offset-background scale-110' : ''}`}
                style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${c}` : 'none' }}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        <button
          onClick={submit}
          disabled={submitting || !name.trim()}
          className="w-full px-4 py-2.5 rounded-lg bg-amber-400 text-amber-950 font-medium hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Continue
        </button>

        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </div>
  );
}

// ── Group card with overall balance ──

function GroupCard({ group, balance }: { group: Group; balance: number | null }) {
  const positive = balance !== null && balance > 0;
  const negative = balance !== null && balance < 0;
  return (
    <Link href={`/projects/splitwiser/groups/${group.id}`} className="block group">
      <motion.div
        whileHover={{ y: -2, scale: 1.005 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-amber-400/30"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-amber-400/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{group.name}</div>
              {balance === null ? (
                <div className="text-xs text-muted-foreground">tap to view</div>
              ) : balance === 0 ? (
                <div className="text-xs text-muted-foreground">all settled up</div>
              ) : (
                <div className={`text-xs ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {positive ? "you're owed" : 'you owe'} {fmtMoney(Math.abs(balance))}
                </div>
              )}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-40 group-hover:opacity-80 transition-opacity" />
        </div>
      </motion.div>
    </Link>
  );
}

// ── Create-group inline form ──

function CreateGroupForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/splitwiser/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        const url = `${window.location.origin}/projects/splitwiser/join/${data.group.invite_token}`;
        setCreatedInvite(url);
        setName('');
        onCreated();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!createdInvite) return;
    await navigator.clipboard.writeText(createdInvite);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (createdInvite) {
    return (
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/5 p-4 space-y-3">
        <div className="text-sm font-medium text-emerald-400">Group created. Share this link:</div>
        <div className="flex items-center gap-2">
          <input
            value={createdInvite}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 px-2 py-1.5 rounded bg-black/30 border border-border/40 text-xs font-mono text-foreground"
          />
          <button
            onClick={copyLink}
            className="shrink-0 px-3 py-1.5 rounded bg-emerald-400/20 hover:bg-emerald-400/30 text-emerald-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <button
          onClick={() => { setCreatedInvite(null); setOpen(false); }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full px-4 py-3 rounded-xl border border-dashed border-border/60 hover:border-amber-400/40 text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="h-4 w-4" />
        New group
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3">
      <input
        type="text"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Camping 2026, Roommates, …"
        className="w-full px-3 py-2 rounded-lg bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50 focus:border-amber-400/50"
      />
      <div className="flex gap-2">
        <button
          onClick={() => { setOpen(false); setName(''); }}
          className="flex-1 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || !name.trim()}
          className="flex-1 px-3 py-2 rounded-lg bg-amber-400 text-amber-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {submitting ? <Loader className="h-3 w-3 animate-spin" /> : null}
          Create
        </button>
      </div>
    </div>
  );
}

// ── Page ──

export default function SplitwiserHomePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [balances, setBalances] = useState<Map<number, number>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const meRes = await fetch('/api/splitwiser/me');
      if (meRes.ok) {
        const meData = await meRes.json();
        setMe(meData.user);
        const g = await fetch('/api/splitwiser/groups').then((r) => r.json());
        setGroups(g.groups || []);
        // Pull balances per group in parallel
        const meId = meData.user.id;
        const balancesEntries = await Promise.all(
          (g.groups || []).map(async (grp: Group) => {
            try {
              const b = await fetch(`/api/splitwiser/groups/${grp.id}/balances`).then((r) => r.json());
              const mine = b.balances?.find((x: Balance) => x.id === meId);
              return [grp.id, mine ? parseInt(mine.balance_cents, 10) : 0] as const;
            } catch {
              return [grp.id, 0] as const;
            }
          }),
        );
        setBalances(new Map(balancesEntries));
      } else {
        setMe(null);
        const status = await fetch('/api/splitwiser/status').then((r) => r.json());
        setNeedsBootstrap((status.user_count ?? 0) === 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const overallBalance = Array.from(balances.values()).reduce((a, b) => a + b, 0);

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="container mx-auto max-w-2xl space-y-5">
          <FadeIn>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-400/15 flex items-center justify-center">
                  <Wallet className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold leading-none">SplitWiser</h1>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {me ? `Hi, ${me.name}` : 'Split expenses with friends'}
                  </p>
                </div>
              </div>
              {me && (
                <Link
                  href="/projects/splitwiser/settings"
                  className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              )}
            </div>
          </FadeIn>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader className="h-5 w-5 animate-spin" />
            </div>
          ) : !me ? (
            <FadeIn delay={0.05}>
              <SignupLanding isBootstrap={needsBootstrap} />
            </FadeIn>
          ) : (
            <>
              <FadeIn delay={0.05}>
                <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-amber-950/40 to-card/60 p-5">
                  <div className="text-[10px] uppercase tracking-widest text-amber-400/70 mb-1">Overall</div>
                  <div className="text-3xl font-bold tabular-nums">
                    {overallBalance === 0 ? (
                      <span className="text-muted-foreground">$0.00</span>
                    ) : overallBalance > 0 ? (
                      <span className="text-emerald-400">+{fmtMoney(overallBalance)}</span>
                    ) : (
                      <span className="text-red-400">{fmtMoney(overallBalance)}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {overallBalance === 0
                      ? 'all settled up'
                      : overallBalance > 0
                        ? "you're owed across all groups"
                        : 'you owe across all groups'}
                  </div>
                </div>
              </FadeIn>

              <FadeIn delay={0.1}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Groups</h2>
                    <span className="text-xs text-muted-foreground">{groups.length}</span>
                  </div>

                  {groups.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-6 text-center space-y-2">
                      <Users className="h-6 w-6 mx-auto text-amber-400/60" />
                      <p className="text-sm text-foreground">No groups yet</p>
                      <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                        Create one for each shared expense pool — a trip, a household, a recurring dinner club.
                      </p>
                    </div>
                  ) : (
                    <AnimatePresence>
                      {groups.map((g) => (
                        <motion.div
                          key={g.id}
                          layout
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <GroupCard group={g} balance={balances.get(g.id) ?? null} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  )}

                  <CreateGroupForm onCreated={refresh} />
                </div>
              </FadeIn>
            </>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
