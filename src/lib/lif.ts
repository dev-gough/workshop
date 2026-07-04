// Parser for the Life 1.05/1.06-style .lif pattern files in /public/patterns.
// Returns cells normalized so the top-left of the bounding box is (0, 0).

export interface LifCell {
  x: number;
  y: number;
}

export function parseLif(content: string): LifCell[] {
  const lines = content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && (!l.startsWith('#') || l.startsWith('#P')));
  let cx = 0, cy = 0;
  const pattern: LifCell[] = [];
  for (const line of lines) {
    if (line.startsWith('#P')) {
      const parts = line.split(/\s+/);
      cx = parseInt(parts[1]);
      cy = parseInt(parts[2]);
    } else {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '*') pattern.push({ x: cx + i, y: cy });
      }
      cy++;
    }
  }
  let minX = Infinity, minY = Infinity;
  for (const p of pattern) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
  }
  return pattern.map(p => ({ x: p.x - minX, y: p.y - minY }));
}
