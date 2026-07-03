'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from '@/components/ThemeProvider';

// ── GOL Engine (lightweight, for background) ────────────────────
class GOLEngine {
  rows: number; cols: number;
  current: Uint8Array; next: Uint8Array;
  constructor(rows: number, cols: number) {
    this.rows = rows; this.cols = cols;
    this.current = new Uint8Array(rows * cols);
    this.next = new Uint8Array(rows * cols);
  }
  randomize() {
    for (let i = 0; i < this.current.length; i++)
      this.current[i] = Math.random() > 0.7 ? 1 : 0;
  }
  step() {
    const { rows, cols, current, next } = this;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols)
              n += current[nr * cols + nc];
          }
        }
        const idx = r * cols + c;
        next[idx] = current[idx] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
      }
    }
    [this.current, this.next] = [this.next, this.current];
  }
}

// ── Background: Game of Life ────────────────────────────────────
export function GOLBackground({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GOLEngine | null>(null);
  const { theme } = useTheme();
  const cellSize = 8;

  useEffect(() => {
    if (!width || !height) return;
    const cols = Math.ceil(width / cellSize);
    const rows = Math.ceil(height / cellSize);
    const engine = new GOLEngine(rows, cols);
    engine.randomize();
    engineRef.current = engine;

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const cellColor = theme === 'dark' ? 'rgba(100,140,200,0.12)' : 'rgba(60,90,140,0.08)';

    let raf: number;
    let lastStep = 0;
    const draw = (t: number) => {
      if (t - lastStep > 150) {
        engine.step();
        lastStep = t;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = cellColor;
        for (let r = 0; r < engine.rows; r++) {
          for (let c = 0; c < engine.cols; c++) {
            if (engine.current[r * engine.cols + c]) {
              ctx.fillRect(c * cellSize, r * cellSize, cellSize - 1, cellSize - 1);
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, theme]);

  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />;
}
