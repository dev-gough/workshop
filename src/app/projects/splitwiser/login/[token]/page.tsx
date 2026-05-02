'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader, AlertTriangle, Wallet } from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';

export default function SplitwiserLoginPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params?.token;
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/splitwiser/login/${token}`, { method: 'POST' });
        if (res.ok) {
          router.replace('/projects/splitwiser');
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || 'Invalid login link');
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [params, router]);

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="container mx-auto max-w-md py-16">
          {!error ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Wallet className="h-8 w-8 text-amber-400/70" />
              <Loader className="h-5 w-5 animate-spin" />
              <span className="text-sm">Signing you in…</span>
            </div>
          ) : (
            <div className="rounded-2xl border border-red-400/30 bg-red-500/5 p-6 text-center space-y-3">
              <AlertTriangle className="h-8 w-8 mx-auto text-red-400" />
              <h2 className="text-lg font-semibold">Couldn&#39;t sign you in</h2>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Link
                href="/projects/splitwiser"
                className="inline-block text-xs text-amber-400 hover:text-amber-300"
              >
                Back to SplitWiser
              </Link>
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
