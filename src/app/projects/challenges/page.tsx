'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useHeaderConfig } from '@/components/header-config';
import MatchHistory from './_components/match-history';
import { CategoryGlyph, CategoryRail, CrystalDial, LEGACY_ID, RAIL } from './_components/rail';
import { CapstoneRow, GroupRow, ChallengeCard, SectionHeading } from './_components/rows';
import { ChallengeHoverCard } from './_components/hover-card';
import {
  ALL_TIERS, tierVar, progressFraction, progressLabel,
  type ChallengeData, type ChallengeNode,
} from './_components/types';

/** Blurbs match the client's, which name the section rather than the category. */
const SUBTITLE: Record<number, string> = {
  [LEGACY_ID]: 'Seasonal and event challenges that can no longer be progressed.',
};
const subtitleFor = (label: string, id: number) =>
  SUBTITLE[id] ?? `Earn progress from ${label} Capstone Challenges.`;

type SortKey = 'name' | 'closest' | 'rarest' | 'tier';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'closest', label: 'Closest' },
  { key: 'rarest', label: 'Rarest' },
  { key: 'tier', label: 'Tier' },
];

/**
 * Orderings the client doesn't offer but the data supports. "Closest" is the
 * useful one — it surfaces the nearly-closed rings, i.e. what's actually
 * achievable next. Maxed nodes sink rather than pinning the top at 100%.
 */
function sortNodes(nodes: ChallengeNode[], key: SortKey): ChallengeNode[] {
  const out = [...nodes];
  switch (key) {
    case 'closest':
      return out.sort((a, b) => {
        const fa = a.nextThreshold === null ? -1 : progressFraction(a);
        const fb = b.nextThreshold === null ? -1 : progressFraction(b);
        return fb - fa || a.name.localeCompare(b.name);
      });
    case 'rarest':
      // Rarity is the share of players who reached the tier you're on; the
      // rarest achievements are the ones fewest players share.
      return out.sort((a, b) => {
        const ra = a.percentiles[a.level] ?? 1;
        const rb = b.percentiles[b.level] ?? 1;
        return ra - rb || a.name.localeCompare(b.name);
      });
    case 'tier':
      return out.sort((a, b) =>
        ALL_TIERS.indexOf(b.level as (typeof ALL_TIERS)[number]) -
        ALL_TIERS.indexOf(a.level as (typeof ALL_TIERS)[number]) ||
        a.name.localeCompare(b.name));
    default:
      return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ChallengesPage() {
  useHeaderConfig({ scopeClass: 'lol-theme' });

  const [data, setData] = useState<ChallengeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [tab, setTab] = useState<'challenges' | 'games'>('challenges');
  const [active, setActive] = useState<number>(2);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('name');
  const [hover, setHover] = useState<{ node: ChallengeNode; rect: DOMRect } | null>(null);

  useEffect(() => {
    fetch('/api/challenges')
      .then((r) => r.json())
      .then((d: ChallengeData) => setData(d))
      .catch((e) => console.error('Failed to load challenges:', e))
      .finally(() => setLoading(false));
  }, []);

  // Deep-link the selected category. Kept on window.history rather than
  // useSearchParams so the page needs no Suspense boundary to prerender.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const c = Number(p.get('c'));
    if (RAIL.some((r) => r.id === c)) setActive(c);
  }, []);

  const selectCategory = useCallback((id: number) => {
    setActive(id);
    setSearch('');
    setTierFilter(null);
    const url = new URL(window.location.href);
    url.searchParams.set('c', String(id));
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch('/api/challenges/sync', { method: 'POST' });
      const result = await res.json();
      if (result.synced) {
        setData(await (await fetch('/api/challenges')).json());
      } else if (result.reason === 'cooldown') {
        setSyncNote(`On cooldown — ${result.remainingSeconds}s`);
      }
    } catch (e) {
      console.error('Sync failed:', e);
      setSyncNote('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const byId = useMemo(() => {
    const m = new Map<number, ChallengeNode>();
    for (const c of data?.challenges ?? []) m.set(c.challengeId, c);
    return m;
  }, [data]);

  const kids = useCallback(
    (n: ChallengeNode) => sortNodes(
      n.childIds.map((id) => byId.get(id)).filter((c): c is ChallengeNode => !!c),
      sort
    ),
    [byId, sort]
  );

  /** Everything in the active rail bucket, minus the category node itself. */
  const inCategory = useMemo(
    () => (data?.challenges ?? []).filter(
      (c) => c.categoryId === active && c.kind !== 'category'
    ),
    [data, active]
  );

  const capstones = useMemo(
    () => sortNodes(inCategory.filter((c) => c.kind === 'capstone'), sort),
    [inCategory, sort]
  );
  const groups = useMemo(
    () => sortNodes(inCategory.filter((c) => c.kind === 'group'), sort),
    [inCategory, sort]
  );
  /** Leaves with no group above them — the four loose Legacy milestones. */
  const orphans = useMemo(
    () => sortNodes(
      inCategory.filter((c) => c.kind === 'challenge' && (c.parentId === null || !byId.has(c.parentId))),
      sort
    ),
    [inCategory, byId, sort]
  );

  const leaves = useMemo(() => inCategory.filter((c) => c.kind === 'challenge'), [inCategory]);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of leaves) counts[c.level] = (counts[c.level] ?? 0) + 1;
    return counts;
  }, [leaves]);

  const railCounts = useMemo(() => {
    const out: Record<number, { done: number; total: number }> = {};
    for (const c of data?.challenges ?? []) {
      if (c.kind !== 'challenge') continue;
      const b = (out[c.categoryId] ??= { done: 0, total: 0 });
      b.total++;
      if (c.level !== 'NONE') b.done++;
    }
    return out;
  }, [data]);

  const filtering = search.trim().length > 0 || tierFilter !== null;
  const results = useMemo(() => {
    if (!filtering) return [];
    const q = search.trim().toLowerCase();
    return sortNodes(inCategory.filter((c) => {
      if (tierFilter && c.level !== tierFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q)
        || c.description.toLowerCase().includes(q)
        || c.shortDescription.toLowerCase().includes(q);
    }), sort);
  }, [filtering, inCategory, search, tierFilter, sort]);

  const entry = RAIL.find((r) => r.id === active) ?? RAIL[0];
  const categoryNode = byId.get(active);
  const onHover = useCallback(
    (node: ChallengeNode | null, rect?: DOMRect) =>
      setHover(node && rect ? { node, rect } : null),
    []
  );
  const jump = useCallback((id: number) => {
    document.getElementById(`grp-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (loading) {
    return (
      <div className="lol-theme flex min-h-[calc(100vh-57px)] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading challenges…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lol-theme min-h-[calc(100vh-57px)]">
      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          {([['challenges', 'Challenges'], ['games', 'Match History']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative py-4 text-xs font-semibold uppercase tracking-[0.15em] transition-colors ${
                tab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              {tab === id && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-0 bottom-0 h-[2px]"
                  style={{ background: 'var(--lol-gold)' }}
                />
              )}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-3">
            {syncNote && <span className="text-[11px] text-muted-foreground">{syncNote}</span>}
            {data?.lastSyncedAt && (
              <span className="hidden text-[11px] text-[var(--lol-text-muted)] sm:inline">
                synced {timeAgo(new Date(data.lastSyncedAt).getTime())}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 border border-[var(--lol-border-gold)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary transition-colors hover:bg-[var(--lol-bg-elevated)] disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing' : 'Sync'}
            </button>
          </div>
        </div>
      </div>

      {tab === 'games' ? (
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
          <MatchHistory />
        </div>
      ) : (
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
          {/* ── Left column: crystal + rail ──────────────────────── */}
          <aside className="lg:sticky lg:top-6 lg:h-fit lg:w-[264px] lg:flex-shrink-0">
            <CrystalDial node={byId.get(0)} totals={data?.totalPoints ?? null} />
            <div className="mt-6 lol-plate">
              <CategoryRail active={active} counts={railCounts} onSelect={selectCategory} />
            </div>
          </aside>

          {/* ── Right column: the category ───────────────────────── */}
          <main className="min-w-0 flex-1">
            <div className="mb-4 flex items-center gap-3">
              <CategoryGlyph slug={entry.slug} size={26} color="var(--lol-gold)" />
              <h1 className="text-2xl font-bold uppercase tracking-[0.1em] text-foreground">
                {entry.label}
              </h1>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              {subtitleFor(entry.label, entry.id)}
            </p>

            {categoryNode && (
              <div className="lol-bar-track relative mb-4 h-6 overflow-hidden">
                <motion.div
                  className="lol-bar-fill absolute inset-y-0 left-0"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressFraction(categoryNode) * 100}%` }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                />
                <span className="absolute inset-0 flex items-center justify-center font-mono text-xs font-semibold tabular-nums text-foreground">
                  {progressLabel(categoryNode)}
                </span>
              </div>
            )}

            {/* ── Toolbar: search + tier tally ───────────────────── */}
            <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-border pb-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  className="w-52 border border-[var(--lol-border-gold)] bg-[var(--lol-bg-deep)] py-1.5 pl-8 pr-7 text-xs text-foreground outline-none placeholder:text-[var(--lol-text-muted)] focus:border-primary"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center border border-[var(--lol-border-gold)]">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSort(s.key)}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                      sort === s.key
                        ? 'bg-[var(--lol-bg-elevated)] text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {ALL_TIERS.filter((t) => tierCounts[t]).map((t) => {
                  const on = tierFilter === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTierFilter(on ? null : t)}
                      title={`${t} — click to filter`}
                      className={`flex items-center gap-1.5 px-1.5 py-1 transition-opacity ${
                        tierFilter && !on ? 'opacity-40 hover:opacity-70' : ''
                      }`}
                    >
                      <span
                        className="h-3 w-3 rounded-full border"
                        style={{
                          background: `color-mix(in srgb, ${tierVar(t)} 35%, transparent)`,
                          borderColor: tierVar(t),
                          boxShadow: on ? `0 0 6px ${tierVar(t)}` : undefined,
                        }}
                      />
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {tierCounts[t]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Body ───────────────────────────────────────────── */}
            {filtering ? (
              <section>
                <SectionHeading label={`${results.length} Result${results.length === 1 ? '' : 's'}`} kind="group" />
                {results.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Nothing in {entry.label} matches that.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {results.map((c) => (
                      <ChallengeCard key={c.challengeId} node={c} onHover={onHover} />
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <div className="space-y-8">
                {capstones.length > 0 && (
                  <section>
                    <SectionHeading label="Capstones" kind="capstone" />
                    <div className="space-y-3">
                      {capstones.map((c) => (
                        <CapstoneRow
                          key={c.challengeId}
                          node={c}
                          items={kids(c)}
                          onHover={onHover}
                          onJump={jump}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {groups.length > 0 && (
                  <section>
                    <SectionHeading label="Groups" kind="group" />
                    <div className="space-y-3">
                      {groups.map((g) => (
                        <GroupRow key={g.challengeId} node={g} items={kids(g)} onHover={onHover} />
                      ))}
                    </div>
                  </section>
                )}

                {orphans.length > 0 && (
                  <section>
                    <SectionHeading label="Milestones" kind="group" />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {orphans.map((c) => (
                        <ChallengeCard key={c.challengeId} node={c} onHover={onHover} />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {hover && <ChallengeHoverCard node={hover.node} rect={hover.rect} />}
    </div>
  );
}
