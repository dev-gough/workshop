'use client';

// The artist's counter display — ask the bartender and they pull the
// crate: each record propped up with the vinyl half out of its sleeve
// (it slides out on hover, spins while it plays), the tracklist beside
// it like the back cover. The marquee is backlit by the artist's own
// covers, blurred into lamplight, so every artist tints the room.

import Link from 'next/link';
import { ChevronLeft, ExternalLink, Music, Play, Share2, Shuffle } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useAudio } from '@/components/AudioProvider';
import { cleanSongDisplay, extractTrackNumber, sortedTrackIndices } from '@/lib/songUtils';
import { AlbumContextMenu, EqBars, SongContextMenu } from './shared';

/** Tracks grouped the way the sleeve prints them: one run per disc
    (disc folders like "CD1/…"), each sorted by track number. */
function discGroups(songs: string[]): { disc: string | null; indices: number[] }[] {
  if (!songs.some(s => s.includes('/'))) {
    return [{ disc: null, indices: sortedTrackIndices(songs) }];
  }
  const groups = new Map<string, number[]>();
  songs.forEach((song, idx) => {
    const slash = song.indexOf('/');
    const disc = slash >= 0 ? song.substring(0, slash) : 'Songs';
    if (!groups.has(disc)) groups.set(disc, []);
    groups.get(disc)!.push(idx);
  });
  return [...groups.entries()].map(([disc, idxs]) => ({
    disc,
    indices: idxs.sort((a, b) => {
      const na = extractTrackNumber(songs[a]), nb = extractTrackNumber(songs[b]);
      return na !== nb ? na - nb : songs[a].localeCompare(songs[b]);
    }),
  }));
}

export function ArtistView({ artist, onBack, onOpenAlbum, onShuffled }: {
  artist: string;
  onBack: () => void;
  onOpenAlbum: (index: number) => void;
  /** Called after "Shuffle all" starts playing, so the page can open the queue. */
  onShuffled: () => void;
}) {
  const {
    albums, currentTrack, isPlaying, playSong, playAlbum, playTrack,
    setQueue, setQueueIndex, setShuffleMode,
  } = useAudio();

  const artistAlbums = albums
    .map((a, i) => ({ album: a, index: i }))
    .filter(({ album }) => album.artist === artist);
  const totalSongs = artistAlbums.reduce((sum, { album }) => sum + album.songs.length, 0);
  const covers = artistAlbums.map(({ album }) => album.coverUrl).filter((u): u is string => !!u);

  const shuffleArtist = () => {
    const shuffled = artistAlbums.flatMap(({ album, index }) =>
      album.songs.map((_, si) => ({ albumIndex: index, songIndex: si }))
    );
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (shuffled.length > 0) {
      setQueue(shuffled);
      setQueueIndex(0);
      setShuffleMode(true);
      playTrack(shuffled[0].albumIndex, shuffled[0].songIndex);
      onShuffled();
    }
  };

  return (
    <motion.div key={`artist-${artist}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

      {/* ── The marquee — backlit by the artist's own sleeves ── */}
      <div className="relative overflow-hidden border-b border-border">
        {covers.length > 0 && (
          <div aria-hidden className="absolute inset-0 flex scale-110 opacity-60 blur-2xl saturate-150">
            {covers.map((url, i) => (
              <div key={i} className="flex-1 bg-cover bg-center" style={{ backgroundImage: `url(${url})` }} />
            ))}
          </div>
        )}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-background/15 via-background/45 to-background" />

        <div className="relative px-4 py-4 sm:px-5">
          <button
            onClick={onBack}
            className="flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> The wall
          </button>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mt-7">
            <div className="min-w-0">
              <p className="bar-etch">From the crates</p>
              <h2 className="bar-serif mt-1 truncate text-3xl font-semibold tracking-tight sm:text-4xl">{artist}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                <span className="bar-readout">{artistAlbums.length}</span> record{artistAlbums.length !== 1 ? 's' : ''}
                {' · '}
                <span className="bar-readout">{totalSongs}</span> tracks
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={shuffleArtist}>
                <Shuffle className="mr-1 h-3.5 w-3.5" /> Shuffle all
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
                <Link href={`/projects/soulseek?search=${encodeURIComponent(artist)}`}>
                  <Share2 className="mr-1 h-3.5 w-3.5" /> Find on Soulseek
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-6 sm:px-5">
        {/* A thin shelf is an invitation */}
        {artistAlbums.length <= 2 && (
          <Link
            href={`/projects/soulseek?search=${encodeURIComponent(artist)}`}
            className="mt-4 flex items-center gap-3 rounded-[4px] border border-dashed border-primary/35 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
          >
            <Share2 className="h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Only {artistAlbums.length} record{artistAlbums.length !== 1 ? 's' : ''} on the shelf
              </span>
              <span className="block text-xs text-muted-foreground">Search Soulseek for more by {artist}</span>
            </span>
            <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Link>
        )}

        {/* ── The displays: one propped record per album ── */}
        <div className="divide-y divide-border/60">
          {artistAlbums.map(({ album, index }, row) => {
            const isCurrentAlbum = currentTrack?.albumIndex === index;
            const vinylOut = isCurrentAlbum;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: row * 0.04, duration: 0.35 }}
                className="group/crate flex flex-col gap-4 py-6 sm:flex-row sm:gap-6"
              >
                {/* Sleeve with the record half out of it */}
                <AlbumContextMenu albumIndex={index} artist={album.artist} album={album.name}>
                  <div className="relative h-32 w-[172px] shrink-0 sm:h-44 sm:w-[236px]">
                    <span
                      aria-hidden
                      className={`absolute right-0 top-1/2 block aspect-square h-[116px] -translate-y-1/2 transition-transform duration-500 ease-out motion-reduce:transition-none sm:h-[162px] ${
                        vinylOut ? 'translate-x-0' : '-translate-x-[22px] group-hover/crate:translate-x-0'
                      }`}
                    >
                      <span className="bar-vinyl bar-record" data-spinning={isCurrentAlbum && isPlaying} />
                    </span>
                    <div
                      className="bar-sleeve group/sleeve absolute left-0 top-0 z-10 h-32 w-32 cursor-pointer !transform-none sm:h-44 sm:w-44"
                      data-selected={isCurrentAlbum}
                      onClick={() => onOpenAlbum(index)}
                    >
                      {album.coverUrl ? (
                        <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${album.coverUrl})` }} />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted to-card">
                          <Music className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      {/* Drop the needle — hover play (the button below covers touch) */}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover/sleeve:opacity-100">
                        <button
                          onClick={(e) => { e.stopPropagation(); playAlbum(index); }}
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-background/85 text-primary backdrop-blur-sm transition-transform hover:scale-110"
                          aria-label={`Play ${album.name}`}
                        >
                          <Play className="ml-0.5 h-5 w-5 fill-current" />
                        </button>
                      </span>
                    </div>
                  </div>
                </AlbumContextMenu>

                {/* The back cover: placard + tracklist */}
                <div className="min-w-0 flex-1">
                  <AlbumContextMenu albumIndex={index} artist={album.artist} album={album.name}>
                    <div className="flex items-center gap-2.5">
                      <button
                        className={`bar-serif min-w-0 truncate text-left text-xl font-semibold tracking-tight transition-colors hover:text-primary ${
                          isCurrentAlbum ? 'text-primary' : ''
                        }`}
                        onClick={() => onOpenAlbum(index)}
                      >
                        {album.name}
                      </button>
                      <span className="bar-etch shrink-0">{album.songs.length} tracks</span>
                      {isCurrentAlbum && isPlaying && <EqBars className="shrink-0" />}
                      <Button size="sm" variant="ghost" className="ml-auto h-7 shrink-0 text-xs" onClick={() => playAlbum(index)}>
                        <Play className="mr-1 h-3 w-3" /> Play
                      </Button>
                    </div>
                  </AlbumContextMenu>

                  <div className="mt-2.5 sm:columns-2 sm:gap-x-6 xl:columns-3">
                    {discGroups(album.songs).map(({ disc, indices }) => (
                      <div key={disc ?? 'all'} className="contents">
                        {disc && <h4 className="bar-etch mb-1 mt-2 break-inside-avoid px-2 first:mt-0">{disc}</h4>}
                        {indices.map((si, num) => {
                          const song = album.songs[si];
                          const isCurrent = isCurrentAlbum && currentTrack?.songIndex === si;
                          const cleaned = cleanSongDisplay(song, album.artist, album.name);
                          return (
                            <SongContextMenu key={si} artist={album.artist} album={album.name} song={song}>
                              <div
                                className={`group/track flex cursor-pointer break-inside-avoid items-center gap-2 rounded-[3px] px-2 py-[5px] ${
                                  isCurrent ? 'bg-primary/12 text-primary' : 'hover:bg-muted/50'
                                }`}
                                onClick={() => playSong(index, si)}
                              >
                                <span className={`bar-readout w-5 shrink-0 text-right text-[11px] ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>{num + 1}</span>
                                <span className="min-w-0 flex-1 truncate text-[13px]">{cleaned}</span>
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                  {isCurrent && isPlaying ? (
                                    <EqBars />
                                  ) : (
                                    <Play className="hidden h-3 w-3 text-muted-foreground group-hover/track:block" />
                                  )}
                                </span>
                              </div>
                            </SongContextMenu>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
