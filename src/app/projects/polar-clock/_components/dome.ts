'use client';

/**
 * The observatory dome is dark-always by design (see `.pc-theme` in
 * globals.css): the page exists to be a wallpaper, and every visualizer in
 * it is authored for a black sky.
 *
 * Backgrounds call this instead of the site-wide `useTheme()` so that a
 * visitor browsing the rest of the workshop in light mode doesn't get a
 * washed-out daylight palette painted onto a black ceiling. It's a hook in
 * shape only — a constant — which keeps the `[width, height, theme]` effect
 * deps in each background honest without special-casing them.
 */
export function useDomeTheme(): { theme: 'dark' } {
  return { theme: 'dark' };
}
