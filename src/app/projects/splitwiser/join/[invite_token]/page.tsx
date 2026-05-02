'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader, AlertTriangle, Wallet, Users, ArrowRight } from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';

const PALETTE = [
  '#fbbf24', '#22d3ee', '#a78bfa', '#f472b6',
  '#4ade80', '#38bdf8', '#fb7185', '#facc15',
];

interface MeUser { id: number; name: string }
interface InviteGroup { id: number; name: string }

export default function SplitwiserJoinPage() {
  const params = useParams<{ invite_token: string }>();
  const router = useRouter();
  const inviteToken = params?.invite_token ?? '';

  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<InviteGroup | null>(null);
  const [me, setMe] = useState<MeUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Signup form state
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[0]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    (async () => {
      try {
        const [inviteRes, meRes] = await Promise.all([
          fetch(`/api/splitwiser/invites/${inviteToken}`),
          fetch('/api/splitwiser/me'),
        ]);
        const inviteData = await inviteRes.json();
        if (!inviteRes.ok) {
          setError(inviteData.error || 'Invalid invite link');
        } else {
          setGroup(inviteData.group);
        }
        if (meRes.ok) {
          const meData = await meRes.json();
          setMe(meData.user);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [inviteToken]);

  const handleSignup = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/splitwiser/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_token: inviteToken, name: name.trim(), color }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'signup failed');
      } else {
        router.replace(`/projects/splitwiser/groups/${data.group_id}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/splitwiser/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite_token: inviteToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'join failed');
      } else {
        router.replace(`/projects/splitwiser/groups/${data.group.id}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="container mx-auto max-w-md py-8">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader className="h-5 w-5 animate-spin" />
            </div>
          ) : error && !group ? (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/5 p-6 text-center space-y-3">
              <AlertTriangle className="h-8 w-8 mx-auto text-red-400" />
              <h2 className="text-lg font-semibold">Invalid invite</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Link href="/projects/splitwiser" className="inline-block text-xs text-amber-400 hover:text-amber-300">
                Back to SplitWiser
              </Link>
            </div>
          ) : group && me ? (
            <FadeIn>
              <div className="rounded-2xl border border-border/60 bg-card/60 p-6 space-y-4 text-center">
                <Users className="h-10 w-10 mx-auto text-amber-400" />
                <div className="space-y-1">
                  <h2 className="text-xl font-bold">Join {group.name}?</h2>
                  <p className="text-sm text-muted-foreground">You&#39;re signed in as {me.name}.</p>
                </div>
                <button
                  onClick={handleJoin}
                  disabled={submitting}
                  className="w-full px-4 py-2.5 rounded-lg bg-amber-400 text-amber-950 font-medium hover:bg-amber-300 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  Join group
                </button>
                {error && <div className="text-xs text-red-400">{error}</div>}
              </div>
            </FadeIn>
          ) : group ? (
            <FadeIn>
              <div className="rounded-2xl border border-border/60 bg-card/60 p-6 space-y-5">
                <div className="text-center space-y-2">
                  <Wallet className="h-8 w-8 mx-auto text-amber-400" />
                  <h2 className="text-xl font-bold">You&#39;re invited to</h2>
                  <p className="text-2xl font-bold text-amber-400">{group.name}</p>
                  <p className="text-xs text-muted-foreground">Pick a name and color to get started.</p>
                </div>

                <div className="space-y-3">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSignup()}
                    placeholder="Your name"
                    className="w-full px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400/50 focus:border-amber-400/50"
                  />

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Color</div>
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
                    onClick={handleSignup}
                    disabled={submitting || !name.trim()}
                    className="w-full px-4 py-2.5 rounded-lg bg-amber-400 text-amber-950 font-medium hover:bg-amber-300 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Sign up &amp; join {group.name}
                  </button>

                  {error && <div className="text-xs text-red-400">{error}</div>}
                </div>
              </div>
            </FadeIn>
          ) : null}
        </div>
      </div>
    </PageTransition>
  );
}
