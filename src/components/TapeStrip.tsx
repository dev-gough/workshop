// A short length of punched paper tape, as SVG — the Tape Lab's signature
// motif outside the transport window. Encodes a real BF program with the
// same 3-bit punch code the animator uses (',' = 0 = blank frame, like NUL
// on real tape), plus the sprocket feed row. Long genes are cut and the
// remainder reported on the cut end, so the strip never lies about length.

const PUNCH_CODE: Record<string, number> = {
  ',': 0, '>': 1, '<': 2, '+': 3, '-': 4, '.': 5, '[': 6, ']': 7,
};

interface Props {
  gene: string;
  /** Frames drawn before the strip is cut (default 64). */
  maxFrames?: number;
  /** Tape height in px (default 22). */
  height?: number;
  className?: string;
}

export default function TapeStrip({ gene, maxFrames = 64, height = 22, className }: Props) {
  const frames = Math.min(gene.length, maxFrames);
  const cut = gene.length > maxFrames;
  const cellW = 7;
  const w = frames * cellW + (cut ? 6 : 0);
  const rowGap = height / 4.6;
  const dataR = Math.min(rowGap * 0.36, 1.9);

  const holes: React.ReactNode[] = [];
  for (let i = 0; i < frames; i++) {
    const code = PUNCH_CODE[gene[i]] ?? 0;
    const cx = (i + 0.5) * cellW;
    for (let bit = 0; bit < 3; bit++) {
      const punched = (code >> (2 - bit)) & 1;
      holes.push(
        <circle
          key={`${i}-${bit}`}
          cx={cx}
          cy={rowGap * (bit + 0.9)}
          r={punched ? dataR : dataR * 0.45}
          fill={punched ? 'rgba(24,18,9,0.78)' : 'rgba(58,44,30,0.16)'}
        />,
      );
    }
    // Sprocket feed hole
    holes.push(
      <circle key={`${i}-s`} cx={cx} cy={rowGap * 3.9} r={dataR * 0.45} fill="rgba(24,18,9,0.78)" />,
    );
  }

  return (
    <svg
      width={w}
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      className={className}
      role="img"
      aria-label={`punched tape, ${gene.length} instructions`}
    >
      <title>{gene.length > 120 ? gene.slice(0, 120) + '…' : gene}</title>
      {/* Paper — straight left end, torn right end when cut */}
      {/* Manila paper, hardcoded like the transport's — the strip is a
          physical object and keeps its color in both theme modes. */}
      {cut ? (
        <path
          d={`M0 0 H${w - 6} l3 ${height * 0.25} l-3 ${height * 0.25} l3 ${height * 0.25} l-3 ${height * 0.25} H0 Z`}
          fill="#e4d6b2" stroke="rgba(58,44,30,0.35)"
          strokeWidth="0.5"
        />
      ) : (
        <rect x="0" y="0" width={w} height={height} rx="1.5"
          fill="#e4d6b2" stroke="rgba(58,44,30,0.35)" strokeWidth="0.5" />
      )}
      {holes}
    </svg>
  );
}
