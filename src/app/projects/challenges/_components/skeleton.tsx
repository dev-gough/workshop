'use client';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for the challenges room.
 *
 * Mirrors the real layout's geometry rather than showing a spinner, so the
 * page doesn't jump when data lands: the rail, the crystal dial, the header
 * block and the row stack all occupy the same space they will once filled.
 *
 * Uses the shared `Skeleton`, whose `bg-muted` resolves through the scope to
 * the room's own elevated navy — no bespoke shimmer needed. Corners are
 * squared off because nothing in this room is rounded.
 */

/** Square-cornered plate to match `.lol-plate`. */
function Bar({ className = '' }: { className?: string }) {
  return <Skeleton className={`rounded-none ${className}`} />;
}

function RowSkeleton({ tokenSize, children }: { tokenSize: number; children?: React.ReactNode }) {
  return (
    <div className="lol-plate relative">
      <div className="flex items-center gap-5 p-5 pl-8">
        <Skeleton
          className="flex-shrink-0 rounded-full"
          style={{ width: tokenSize, height: tokenSize }}
        />
        <div className="min-w-0 flex-1">
          <Bar className="mb-2 h-4 w-40" />
          <Bar className="h-[22px] w-full" />
          <Bar className="mt-2 h-3 w-56" />
        </div>
      </div>
      {children}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="lol-plate flex flex-col items-center px-3 pb-4 pt-6">
      <Skeleton className="h-[84px] w-[84px] rounded-full" />
      <Bar className="mt-3 h-3.5 w-24" />
      <Bar className="mt-2 h-2.5 w-28" />
      <Bar className="mt-1.5 h-2.5 w-20" />
    </div>
  );
}

export function ChallengesSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
      <aside className="lg:w-[264px] lg:flex-shrink-0">
        <Skeleton className="mx-auto h-[176px] w-[176px] rounded-full" />
        <div className="lol-plate mt-6 p-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-[18px] w-[18px] rounded-none" />
              <Bar className="h-3 flex-1" />
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Bar className="mb-4 h-8 w-64" />
        <Bar className="mb-3 h-5 w-96 max-w-full" />
        <Bar className="mb-4 h-6 w-full" />
        <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
          <Bar className="h-[34px] w-52" />
          <Bar className="h-[34px] w-56" />
          <Bar className="ml-auto hidden h-[26px] w-64 sm:block" />
        </div>

        <Bar className="mb-3 h-7 w-48" />
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <RowSkeleton key={i} tokenSize={116} />
          ))}
        </div>

        <Bar className="mb-3 mt-8 h-7 w-40" />
        <div className="space-y-3">
          <RowSkeleton tokenSize={104}>
            <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          </RowSkeleton>
        </div>
      </main>
    </div>
  );
}

/** Loading state for the Match History tab: a stack of game rows. */
export function MatchHistorySkeleton() {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Bar className="h-6 w-24" />
        <Bar className="h-6 w-28" />
        <Bar className="h-6 w-36" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="lol-plate flex items-center gap-5 px-5 py-4">
            <Bar className="h-3 w-10" />
            <div className="w-28">
              <Bar className="h-3.5 w-20" />
              <Bar className="mt-1.5 h-2.5 w-16" />
            </div>
            <Bar className="h-4 w-24" />
            <Bar className="h-3 w-12" />
            <Bar className="h-5 w-24" />
            <Bar className="ml-auto h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
