'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Loader, Wallet, Copy, Check, LogOut, AlertTriangle, Save,
} from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

const PALETTE = [
  '#fbbf24', '#22d3ee', '#a78bfa', '#f472b6',
  '#4ade80', '#38bdf8', '#fb7185', '#facc15',
];

interface Me {
  id: number;
  name: string;
  color: string;
  login_token: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showLink, setShowLink] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/splitwiser/me');
      if (!res.ok) {
        router.replace('/projects/splitwiser');
        return;
      }
      const data = await res.json();
      setMe(data.user);
      setName(data.user.name);
      setColor(data.user.color);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { refresh(); }, [refresh]);

  const dirty = me && (name.trim() !== me.name || color !== me.color);

  const save = async () => {
    if (!me || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/splitwiser/users/${me.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'save failed');
      } else {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
        refresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    if (!confirm('Sign out of SplitWiser on this device?')) return;
    await fetch('/api/splitwiser/logout', { method: 'POST' });
    router.replace('/projects/splitwiser');
  };

  if (loading || !me) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const loginUrl = me.login_token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/projects/splitwiser/login/${me.login_token}`
    : null;

  const copyLogin = async () => {
    if (!loginUrl) return;
    await navigator.clipboard.writeText(loginUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="container mx-auto max-w-md space-y-5">

          <FadeIn>
            <div className="flex items-center gap-3">
              <Link
                href="/projects/splitwiser"
                className="p-2 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground -ml-2"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="text-xl font-bold">Settings</h1>
            </div>
          </FadeIn>

          <FadeIn delay={0.05}>
            <div className="rounded-2xl border border-border/60 bg-card/60 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <span
                  className="h-12 w-12 rounded-full flex items-center justify-center text-base font-bold text-background"
                  style={{ backgroundColor: color }}
                >
                  {(name || me.name).charAt(0).toUpperCase()}
                </span>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Profile</div>
                  <div className="text-base font-semibold">{me.name}</div>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50 focus:border-amber-400/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 block">Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`h-8 w-8 rounded-full transition-transform ${color === c ? 'scale-110' : ''}`}
                        style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${c}` : 'none' }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                </div>

                <button
                  onClick={save}
                  disabled={!dirty || saving}
                  className="w-full px-4 py-2.5 rounded-lg bg-amber-400 text-amber-950 font-medium hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <Loader className="h-4 w-4 animate-spin" /> :
                    savedFlash ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {savedFlash ? 'Saved' : 'Save changes'}
                </button>

                {error && (
                  <div className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" /> {error}
                  </div>
                )}
              </div>
            </div>
          </FadeIn>

          {loginUrl && (
            <FadeIn delay={0.1}>
              <div className="rounded-2xl border border-border/60 bg-card/60 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-amber-400" />
                  <h2 className="text-sm font-semibold">Add another device</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Open this link on any other device to sign in as {me.name} there. Anyone with this link
                  can sign in as you, so don&#39;t share it.
                </p>
                {!showLink ? (
                  <button
                    onClick={() => setShowLink(true)}
                    className="text-xs text-amber-400 hover:text-amber-300"
                  >
                    Reveal my login link
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      value={loginUrl}
                      readOnly
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full px-2 py-1.5 rounded bg-black/30 border border-border/40 text-xs font-mono"
                    />
                    <button
                      onClick={copyLogin}
                      className="w-full px-3 py-2 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 text-amber-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                )}
              </div>
            </FadeIn>
          )}

          <FadeIn delay={0.15}>
            <button
              onClick={logout}
              className="w-full px-4 py-2.5 rounded-xl border border-border/60 hover:border-red-400/40 hover:bg-red-500/5 text-sm text-muted-foreground hover:text-red-400 transition-colors flex items-center justify-center gap-2"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </FadeIn>
        </div>
      </div>
    </PageTransition>
  );
}
