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
}

const GSMOL = ({ width, height, cellSize = 10, minimal = false }: GameOfLifeProps) => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [grid, setGrid] = useState<boolean[][]>([]);
  const [running, setRunning] = useState(minimal);
  const [generation, setGeneration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedCells, setDraggedCells] = useState<Set<string>>(new Set());
  const rows = Math.floor(height / cellSize);
  const cols = Math.floor(width / cellSize);

  const initGrid = useCallback(() => {
    const newGrid = Array(rows).fill(null).map(() =>
      Array(cols).fill(null).map(() => Math.random() > 0.7)
    );
    setGrid(newGrid);
    setGeneration(0);
  }, [rows, cols]);

  const clearGrid = useCallback(() => {
    const newGrid = Array(rows).fill(null).map(() =>
      Array(cols).fill(null).map(() => false)
    );
    setGrid(newGrid);
    setGeneration(0);
  }, [rows, cols]);

  const nextGeneration = useCallback(() => {
    setGrid(currentGrid => {
      if (currentGrid.length === 0) return currentGrid;
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
      return newGrid;
    });
    setGeneration(gen => gen + 1);
  }, [rows, cols]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || grid.length === 0) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme === 'dark' ? '#e2e8f0' : '#0f172a';
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (grid[i] && grid[i][j]) {
          ctx.fillRect(j * cellSize, i * cellSize, cellSize, cellSize);
        }
      }
    }
  }, [grid, width, height, cellSize, rows, cols, theme]);

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
    setGrid(currentGrid => {
      const newGrid = currentGrid.map(arr => [...arr]);
      newGrid[i][j] = !newGrid[i][j];
      return newGrid;
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCellPosition(e);
    if (pos) {
      setIsDragging(true);
      setDraggedCells(new Set([`${pos.i}-${pos.j}`]));
      toggleCell(pos.i, pos.j);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const pos = getCellPosition(e);
    if (pos) {
      const key = `${pos.i}-${pos.j}`;
      if (!draggedCells.has(key)) {
        setDraggedCells(prev => new Set([...prev, key]));
        toggleCell(pos.i, pos.j);
      }
    }
  };

  const handleMouseUp = () => setIsDragging(false);
  const handleMouseLeave = () => setIsDragging(false);

  useEffect(() => { initGrid(); }, [initGrid]);
  useEffect(() => { draw(); }, [draw]);

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
