'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface GameOfLifeProps {
  width: number;
  height: number;
  cellSize?: number;
  minimal?: boolean;
  cellColor?: string; // fixed cell color (e.g. chalk on the GoL room tile); defaults to theme ink
}

// Decorative Game of Life. The simulation grid lives in a ref and the canvas is
// driven directly from the interval — no per-tick React state clone/reconcile.
// Visuals are identical to the previous setState-driven version.

const GSMOL = ({ width, height, cellSize = 10, minimal = false, cellColor }: GameOfLifeProps) => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rows = Math.floor(height / cellSize);
  const cols = Math.floor(width / cellSize);

  // Grid is a ref: mutated in place each tick, never triggers a re-render.
  const gridRef = useRef<boolean[][]>([]);
  const isDraggingRef = useRef(false);
  const draggedCellsRef = useRef<Set<string>>(new Set());
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const [running, setRunning] = useState(minimal);
  const [generation, setGeneration] = useState(0);

  // ── Imperative draw straight from the ref ──
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const grid = gridRef.current;
    if (!ctx || grid.length === 0) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = cellColor ?? (themeRef.current === 'dark' ? '#e2e8f0' : '#0f172a');
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (grid[i] && grid[i][j]) {
          ctx.fillRect(j * cellSize, i * cellSize, cellSize, cellSize);
        }
      }
    }
  }, [width, height, cellSize, rows, cols, cellColor]);

  const initGrid = useCallback(() => {
    gridRef.current = Array(rows).fill(null).map(() =>
      Array(cols).fill(null).map(() => Math.random() > 0.7)
    );
    setGeneration(0);
    draw();
  }, [rows, cols, draw]);

  const clearGrid = useCallback(() => {
    gridRef.current = Array(rows).fill(null).map(() =>
      Array(cols).fill(null).map(() => false)
    );
    setGeneration(0);
    draw();
  }, [rows, cols, draw]);

  const nextGeneration = useCallback(() => {
    const currentGrid = gridRef.current;
    if (currentGrid.length === 0) return;
    const newGrid = currentGrid.map(arr => [...arr]);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        let neighbors = 0;
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            if (di === 0 && dj === 0) continue;
            const ni = i + di;
            const nj = j + dj;
            if (ni >= 0 && ni < rows && nj >= 0 && nj < cols && currentGrid[ni] && currentGrid[ni][nj]) {
              neighbors += 1;
            }
          }
        }
        if (currentGrid[i] && currentGrid[i][j]) {
          newGrid[i][j] = neighbors === 2 || neighbors === 3;
        } else {
          newGrid[i][j] = neighbors === 3;
        }
      }
    }
    gridRef.current = newGrid;
    setGeneration(gen => gen + 1);
    draw();
  }, [rows, cols, draw]);

  const getCellPosition = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const j = Math.floor(x / cellSize);
    const i = Math.floor(y / cellSize);
    if (i >= 0 && i < rows && j >= 0 && j < cols) {
      return { i, j };
    }
    return null;
  };

  const toggleCell = (i: number, j: number) => {
    const grid = gridRef.current;
    if (!grid[i]) return;
    grid[i][j] = !grid[i][j];
    draw();
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCellPosition(e);
    if (pos) {
      isDraggingRef.current = true;
      draggedCellsRef.current = new Set([`${pos.i}-${pos.j}`]);
      toggleCell(pos.i, pos.j);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const pos = getCellPosition(e);
    if (pos) {
      const key = `${pos.i}-${pos.j}`;
      if (!draggedCellsRef.current.has(key)) {
        draggedCellsRef.current.add(key);
        toggleCell(pos.i, pos.j);
      }
    }
  };

  const handleMouseUp = () => { isDraggingRef.current = false; };
  const handleMouseLeave = () => { isDraggingRef.current = false; };

  useEffect(() => { initGrid(); }, [initGrid]);

  // Redraw on theme change (grid unchanged, colours differ).
  useEffect(() => { draw(); }, [theme, draw]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(nextGeneration, 100);
    return () => clearInterval(interval);
  }, [running, nextGeneration]);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        className="border border-border cursor-pointer rounded-md"
      />
      {!minimal && (
        <>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={() => setRunning(!running)}>
              {running ? 'Pause' : 'Play'}
            </Button>
            <Button size="sm" variant="secondary" onClick={initGrid}>
              Reset
            </Button>
            <Button size="sm" variant="destructive" onClick={clearGrid}>
              Clear
            </Button>
          </div>
          <Badge variant="outline" className="mt-2">
            Generation: {generation}
          </Badge>
        </>
      )}
    </div>
  );
};

export default GSMOL;
