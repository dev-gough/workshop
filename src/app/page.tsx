'use client';

import PageTransition from '@/components/motion/PageTransition';
import FadeIn from '@/components/motion/FadeIn';
import { useHeaderConfig } from '@/components/header-config';
import { useHomeData, formatUptime } from './_home/use-home-data';
import {
  ServerRoom, MusicRoom, TradingRoom, ChallengesRoom,
  BrainfuckRoom, JellyfinRoom, SplitwiserRoom, SoulseekRoom,
} from './_home/rooms-live';
import {
  PolarRoom, GrooveRoom, GolRoom, HouseRoom, EcosystemRoom, NeuroRoom, ImageEvolverRoom, MegabonkRoom,
} from './_home/rooms-art';
import { Noticeboard } from './_home/noticeboard';

/**
 * The homepage as a hallway: every project is a room off the corridor,
 * and every tile is a live diorama rendered in that project's own theme
 * (cc-scope, ws-theme, lol-theme, …). The hall itself stays neutral —
 * plaster walls, brass plaques — and lets the doors do the talking.
 */
export default function HomePage() {
  useHeaderConfig({ scopeClass: 'hall-theme' });
  const data = useHomeData();

  return (
    <PageTransition>
      <div className="hall-theme hall-page min-h-[calc(100vh-57px)]">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">

          {/* ── Masthead + building directory ── */}
          <FadeIn>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <h1 className="ws-serif text-4xl font-semibold tracking-tight sm:text-5xl">
                  Devy&apos;s Workshop
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Sixteen rooms off one hallway — pick a door.
                </p>
              </div>
              <DirectoryPlaque data={data} />
            </div>
          </FadeIn>

          {/* ── The doors ── */}
          <FadeIn delay={0.05}>
            <div
              className="grid auto-rows-[176px] grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6"
              style={{ perspective: '1400px' }}
            >
              <ServerRoom server={data.server} services={data.services} className="col-span-2 row-span-2" />
              <MusicRoom music={data.music} albums={data.albums} className="col-span-2 row-span-2" />
              <TradingRoom accounts={data.accounts} className="col-span-2" />
              <ChallengesRoom challenges={data.challenges} games={data.games} className="col-span-2" />
              <PolarRoom className="col-span-2" />
              <GrooveRoom className="col-span-2" />
              <GolRoom className="col-span-2" />
              <BrainfuckRoom brainfuck={data.brainfuck} className="col-span-2" />
              <JellyfinRoom fetches={data.fetches} className="col-span-2" />
              <SplitwiserRoom splitwiser={data.splitwiser} className="col-span-2" />
              <SoulseekRoom soulseek={data.soulseek} className="col-span-2" />
              <MegabonkRoom className="col-span-2" />
              <HouseRoom className="col-span-1" />
              <EcosystemRoom className="col-span-1" />
              <NeuroRoom className="col-span-1" />
              <ImageEvolverRoom className="col-span-1" />
            </div>
          </FadeIn>

          {/* ── Noticeboard ── */}
          <FadeIn delay={0.1}>
            <Noticeboard
              music={data.music}
              games={data.games}
              fetches={data.fetches}
              splitwiser={data.splitwiser}
              brainfuck={data.brainfuck}
            />
          </FadeIn>

        </div>
      </div>
    </PageTransition>
  );
}

/** The little engraved plate by the front door: host, uptime, services. */
function DirectoryPlaque({ data }: { data: ReturnType<typeof useHomeData> }) {
  const { server, services } = data;
  const running = services.filter(s => s.status === 'running').length;
  const failed = services.some(s => s.status === 'failed');

  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3.5 py-2 text-xs shadow-[0_1px_3px_rgb(0_0_0/0.08)]">
      <span className={`h-2 w-2 rounded-full ${failed ? 'bg-red-400' : server ? 'animate-pulse bg-emerald-400' : 'bg-zinc-400'}`} />
      {server ? (
        <span className="font-mono text-muted-foreground">
          <span className="font-semibold text-foreground">{server.hostname}</span>
          {' · '}up {formatUptime(server.uptimeSeconds)}
          {' · '}{running}/{services.length} services
          {' · '}load {server.loadAverage['1m'].toFixed(2)}
        </span>
      ) : (
        <span className="font-mono text-muted-foreground">ringing the bell…</span>
      )}
    </div>
  );
}
