'use client';

// One artist's shelf — every album of theirs in the house, with quick
// track access, a shuffle for the lot, and the wire to Soulseek when
// the shelf looks thin.

import Link from 'next/link';
import { ChevronLeft, ExternalLink, Music, Play, Share2, Shuffle } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { useAudio } from '@/components/AudioProvider';
import { cleanSongDisplay, sortedTrackIndices } from '@/lib/songUtils';
import { EqBars, SongContextMenu } from './shared';

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
    <motion.div key={`artist-${artist}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-5 p-4 sm:p-5">
      {/* Shelf header */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={onBack}
          className="rounded-[4px] p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          aria-label="Back to the wall"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        {/* Composite cover: the first four sleeves in a block */}
        <div className="bar-sleeve grid h-20 w-20 shrink-0 !transform-none grid-cols-2 grid-rows-2 overflow-hidden">
          {artistAlbums.slice(0, 4).map(({ album, index }) => (
            album.coverUrl ? (
              <div key={index} className="bg-cover bg-center" style={{ backgroundImage: `url(${album.coverUrl})` }} />
            ) : (
              <div key={index} className="flex items-center justify-center bg-muted">
                <Music className="h-3 w-3 text-muted-foreground" />
              </div>
            )
          ))}
          {artistAlbums.length < 4 && Array.from({ length: 4 - Math.min(artistAlbums.length, 4) }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-muted/50" />
          ))}
        </div>
        <div className="min-w-0">
          <h2 className="bar-serif truncate text-xl font-semibold tracking-tight">{artist}</h2>
          <p className="text-sm text-muted-foreground">
            {artistAlbums.length} album{artistAlbums.length !== 1 ? 's' : ''} · {totalSongs} tracks
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
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

      {/* A thin shelf is an invitation */}
      {artistAlbums.length <= 2 && (
        <Link
          href={`/projects/soulseek?search=${encodeURIComponent(artist)}`}
          className="flex items-center gap-3 rounded-[4px] border border-dashed border-primary/35 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
        >
          <Share2 className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Only {artistAlbums.length} album{artistAlbums.length !== 1 ? 's' : ''} on the shelf
            </span>
            <span className="block text-xs text-muted-foreground">Search Soulseek for more by {artist}</span>
          </span>
          <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {/* Albums with inline track grids */}
      <div className="space-y-3">
        {artistAlbums.map(({ album, index }) => {
          const sorted = sortedTrackIndices(album.songs);
          const isCurrentAlbum = currentTrack?.albumIndex === index;
          return (
            <div key={index} className="bar-panel overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <button
                  className="bar-sleeve h-12 w-12 shrink-0 !transform-none cursor-pointer overflow-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenAlbum(index)}
                  aria-label={`Open ${album.name}`}
                >
                  {album.coverUrl ? (
                    <span className="block h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${album.coverUrl})` }} />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-muted">
                      <Music className="h-4 w-4 text-muted-foreground" />
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <h3
                    className="cursor-pointer truncate text-sm font-semibold transition-colors hover:text-primary"
                    onClick={() => onOpenAlbum(index)}
                  >
                    {album.name}
                  </h3>
                  <p className="bar-etch mt-0.5">{album.songs.length} tracks</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={() => playAlbum(index)}>
                  <Play className="mr-1 h-3 w-3" /> Play
                </Button>
              </div>

              {/* Track grid — stable layout, no reflow on re-render */}
              <div className="grid grid-cols-2 border-t border-border/60 px-1 py-1 lg:grid-cols-3">
                {sorted.map((si, num) => {
                  const song = album.songs[si];
                  const isCurrent = isCurrentAlbum && currentTrack?.songIndex === si;
                  const cleaned = cleanSongDisplay(song, album.artist, album.name);
                  return (
                    <SongContextMenu key={si} artist={album.artist} album={album.name} song={song}>
                      <div
                        className={`group flex cursor-pointer items-center gap-2 rounded-[3px] px-2.5 py-1 ${
                          isCurrent ? 'bg-primary/12 text-primary' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => playSong(index, si)}
                      >
                        <span className={`bar-readout w-4 shrink-0 text-right text-[11px] ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>{num + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{cleaned}</span>
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {isCurrent && isPlaying ? (
                            <EqBars />
                          ) : (
                            <Play className="hidden h-3 w-3 text-muted-foreground group-hover:block" />
                          )}
                        </span>
                      </div>
                    </SongContextMenu>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
