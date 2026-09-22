export type PowerMode = 'full' | 'economy';

/**
 * The clock does not need to wake React while nobody can see it. Economy mode
 * also trades the smooth sweep for a once-per-second update.
 */
export function clockTickMs(
  mode: PowerMode,
  smooth: boolean,
  visible: boolean,
): number | null {
  if (!visible) return null;
  if (mode === 'economy') return 1000;
  return smooth ? 50 : 1000;
}

/** Economy mode parks the decorative projector but leaves its slide selected. */
export function shouldRunProjector(
  background: string,
  mode: PowerMode,
  visible: boolean,
): boolean {
  return visible && mode === 'full' && background !== 'none';
}
