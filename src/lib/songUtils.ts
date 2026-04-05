// Shared song name cleaning and track number utilities
// Used by barfoo page, FloatingPlayer, and AudioProvider

export function cleanSongDisplay(raw: string, artist?: string, albumName?: string): string {
  let s = raw;
  if (s.includes('/')) s = s.split('/').pop()!;
  s = s.replace(/\.(flac|mp3|wav|ogg|m4a|aac|opus|wma)$/i, '');
  if (s.includes('_')) s = s.replace(/_/g, ' ');

  const bareAlbum = albumName?.replace(/^\[\d{4}\]\s*/, '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim();

  const artistVariants: string[] = [];
  if (artist) {
    artistVariants.push(artist);
    if (!artist.startsWith('The ')) artistVariants.push('The ' + artist);
    if (artist.startsWith('The ')) artistVariants.push(artist.substring(4));
  }

  const ciStrip = (str: string, prefix: string): string | null =>
    str.length >= prefix.length && str.substring(0, prefix.length).toLowerCase() === prefix.toLowerCase()
      ? str.substring(prefix.length) : null;

  const albumNames = [albumName, bareAlbum].filter((a): a is string => !!a && a.length > 0);
  for (const av of artistVariants) {
    for (const an of albumNames) {
      const rest = ciStrip(s, `${av} - ${an} - `);
      if (rest !== null) { s = rest; break; }
    }
  }

  for (const av of artistVariants) {
    for (const an of albumNames) {
      const rest = ciStrip(s, `${av} ${an} `);
      if (rest !== null) { s = rest; break; }
    }
  }

  for (const av of artistVariants) {
    const escaped = av.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = s.match(new RegExp(`^${escaped} - (\\d+) - `, 'i'));
    if (m) { s = m[1] + ' ' + s.substring(m[0].length); break; }
  }

  let stripped = false;
  for (const av of artistVariants) {
    const m = s.match(/^(\d+[\.\-\s]*\s*)/);
    if (m) {
      const afterNum = s.substring(m[0].length);
      const rest = ciStrip(afterNum, `${av} - `);
      if (rest !== null) { s = rest; stripped = true; break; }
    }
  }

  if (!stripped) {
    for (const av of artistVariants) {
      const rest = ciStrip(s, `${av} - `);
      if (rest !== null) { s = rest; stripped = true; break; }
    }
  }

  for (const an of albumNames) {
    const rest = ciStrip(s, `${an} - `);
    if (rest !== null) { s = rest; break; }
  }

  s = s.replace(/^CD-\d+\s*-\s*/i, '');

  const dtMatch = s.match(/^\d+-\d+[\.\s\-]*\s*/);
  if (dtMatch) {
    const afterDt = s.substring(dtMatch[0].length);
    let dtStripped = false;
    for (const av of artistVariants) {
      const rest = ciStrip(afterDt, `${av} - `);
      if (rest !== null) { s = rest; dtStripped = true; break; }
    }
    if (!dtStripped) s = afterDt;
  }

  s = s.replace(/^\d+[\.\s\-]+\s*/, '');

  if (albumNames.length > 0) {
    for (const an of albumNames) {
      const albumDashRe = new RegExp(`^.+?\\s-\\s${an.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s-\\s`, 'i');
      const am = s.match(albumDashRe);
      if (am) { s = s.substring(am[0].length); break; }
    }
  }
  const genericArtist = s.match(/^(\d+[\.\s\-]*\s+)(\w+(?:\s+\S+)+?)\s+-\s+/);
  if (genericArtist && genericArtist[2].split(/\s+/).length >= 2) {
    s = s.substring(genericArtist[0].length);
  }

  s = s.replace(/^\d+[\.\s\-]+\s*/, '');

  return s.trim();
}

export function extractTrackNumber(s: string): number {
  const name = s.includes('/') ? s.split('/').pop()! : s;
  const m = name.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : Infinity;
}

export function sortedTrackIndices(songs: string[]): number[] {
  return songs.map((_, i) => i).sort((a, b) => {
    const na = extractTrackNumber(songs[a]);
    const nb = extractTrackNumber(songs[b]);
    if (na !== nb) return na - nb;
    return songs[a].localeCompare(songs[b]);
  });
}
