'use client';

// RM 11 — the Drafting Room. A measured plan on a drafting board:
// pencil-on-vellum in the light, cyanotype blueprint in the dark.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { Input } from '@/components/ui/input';
import {
  RotateCw, Lock, Unlock, Copy, Trash2, Undo2, Redo2, Save,
  FolderOpen, X, Scissors, AlertTriangle,
} from 'lucide-react';
import {
  type FurnitureItem, type SavedLayout, type DisplayUnit, type RoomSpec,
  type Corner, type CatalogueItem, type CatalogueStore, type Rect,
  UNIT_ABBR, toBase, fromBase, formatDim, gridMajorInterval, SNAP_INCREMENT,
  effectiveDims, itemRect, cutoutRect, rectsOverlap, fitsInRoom, floorArea,
  wallPolygon, loadLayouts, persistLayouts, loadCatalogue, persistCatalogue,
  loadSession, persistSession,
} from './model';
import { getIcon } from './icons';
import CataloguePanel, { type PlaceSpec } from './CataloguePanel';

// Sheet margins (px) — room for the dimension strings.
const MT = 46, ML = 50, MR = 26, MB = 26;

const CORNERS: { key: Corner; label: string }[] = [
  { key: 'nw', label: 'Top left' },
  { key: 'ne', label: 'Top right' },
  { key: 'sw', label: 'Bottom left' },
  { key: 'se', label: 'Bottom right' },
];

/** Notch-aware distances from an item to the nearest wall on each side. */
function clearances(r: Rect, room: RoomSpec) {
  let left = 0, right = room.w, top = 0, bottom = room.h;
  for (const c of room.cutouts) {
    const cr = cutoutRect(c, room);
    const vOverlap = cr.y < r.y + r.h && cr.y + cr.h > r.y;
    const hOverlap = cr.x < r.x + r.w && cr.x + cr.w > r.x;
    if (vOverlap && cr.x + cr.w <= r.x) left = Math.max(left, cr.x + cr.w);
    if (vOverlap && cr.x >= r.x + r.w) right = Math.min(right, cr.x);
    if (hOverlap && cr.y + cr.h <= r.y) top = Math.max(top, cr.y + cr.h);
    if (hOverlap && cr.y >= r.y + r.h) bottom = Math.min(bottom, cr.y);
  }
  return {
    left: r.x - left,
    right: right - (r.x + r.w),
    top: r.y - top,
    bottom: bottom - (r.y + r.h),
  };
}

export default function RoomPlanner() {
  const { theme } = useTheme();

  // ── State ──
  const [items, setItems] = useState<FurnitureItem[]>([]);
  const [nextId, setNextId] = useState(1);
  const [room, setRoom] = useState<RoomSpec>({ w: 168, h: 144, cutouts: [] }); // 14' × 12'
  const [unit, setUnit] = useState<DisplayUnit>('ft');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueStore>({ items: [], nextId: 1 });
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [layoutName, setLayoutName] = useState('');
  const [popover, setPopover] = useState<'layouts' | 'shape' | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // ── Refs ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const draggingRef = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragElRef = useRef<HTMLDivElement | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // ── History ──
  const historyRef = useRef<FurnitureItem[][]>([[]]);
  const historyIndexRef = useRef(0);

  const pushHistory = useCallback((newItems: FurnitureItem[]) => {
    const h = historyRef.current.slice(0, historyIndexRef.current + 1);
    h.push(JSON.parse(JSON.stringify(newItems)));
    if (h.length > 50) h.shift();
    historyRef.current = h;
    historyIndexRef.current = h.length - 1;
  }, []);

  const undo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx > 0) {
      historyIndexRef.current = idx - 1;
      setItems(JSON.parse(JSON.stringify(historyRef.current[idx - 1])));
    }
  }, []);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx < historyRef.current.length - 1) {
      historyIndexRef.current = idx + 1;
      setItems(JSON.parse(JSON.stringify(historyRef.current[idx + 1])));
    }
  }, []);

  const updateItems = useCallback((newItems: FurnitureItem[]) => {
    setItems(newItems);
    pushHistory(newItems);
  }, [pushHistory]);

  // ── Hydrate from localStorage ──
  useEffect(() => {
    setSavedLayouts(loadLayouts());
    setCatalogue(loadCatalogue());
    const s = loadSession();
    if (s) {
      setItems(s.items);
      setNextId(s.nextId);
      setRoom(s.room);
      setUnit(s.unit);
      pushHistory(s.items);
    }
    setHydrated(true);
  }, [pushHistory]);

  // Autosave the working sheet.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => persistSession({ items, nextId, room, unit }), 300);
    return () => clearTimeout(t);
  }, [hydrated, items, nextId, room, unit]);

  // ── Sheet measurement ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    const availW = containerSize.width - ML - MR;
    const availH = containerSize.height - MT - MB;
    if (availW <= 0 || availH <= 0) return null;
    const ppi = Math.min(availW / room.w, availH / room.h);
    return {
      ppi,
      ox: ML + (availW - room.w * ppi) / 2,
      oy: MT + (availH - room.h * ppi) / 2,
    };
  }, [containerSize, room]);

  // ── Fit checks ──
  const misfitIds = useMemo(() => {
    const s = new Set<number>();
    for (const it of items) if (!fitsInRoom(it, room)) s.add(it.id);
    return s;
  }, [items, room]);

  const overlapIds = useMemo(() => {
    const s = new Set<number>();
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (rectsOverlap(itemRect(items[i]), itemRect(items[j]))) {
          s.add(items[i].id); s.add(items[j].id);
        }
      }
    }
    return s;
  }, [items]);

  // ── Canvas: grid, walls, dimension strings, clearances ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !view) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerSize.width * dpr;
    canvas.height = containerSize.height * dpr;
    canvas.style.width = `${containerSize.width}px`;
    canvas.style.height = `${containerSize.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerSize.width, containerSize.height);

    const css = getComputedStyle(container);
    const col = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const cGrid = col('--bp-grid', '#dbe6f2');
    const cGridMajor = col('--bp-grid-major', '#bccfe4');
    const cWall = col('--bp-wall', '#222');
    const cSheet = col('--bp-sheet', '#f6f8fb');
    const cDim = col('--bp-dim', '#667');
    const cFaint = col('--bp-faint', '#99a');
    const cAccent = col('--bp-accent', '#b33');
    const mono = css.getPropertyValue('--font-geist-mono').trim() || 'ui-monospace, monospace';

    const { ppi, ox, oy } = view;
    const W = room.w * ppi, H = room.h * ppi;
    const poly = wallPolygon(room).map(([x, y]) => [ox + x * ppi, oy + y * ppi] as [number, number]);
    const tracePoly = () => {
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
    };

    // Graph-paper grid, clipped to the floor.
    ctx.save();
    tracePoly();
    ctx.clip();
    const major = gridMajorInterval(unit);
    const minor = unit === 'cm' || unit === 'm' ? 10 / 2.54 : 1;
    const drawLines = (pitch: number, style: string, width: number, skipMajor: boolean) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (let i = 0; i <= room.w + 0.001; i += pitch) {
        if (skipMajor && Math.abs((i / major) - Math.round(i / major)) < 0.001) continue;
        const x = ox + i * ppi;
        ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + H); ctx.stroke();
      }
      for (let i = 0; i <= room.h + 0.001; i += pitch) {
        if (skipMajor && Math.abs((i / major) - Math.round(i / major)) < 0.001) continue;
        const y = oy + i * ppi;
        ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + W, y); ctx.stroke();
      }
    };
    if (minor * ppi > 4) drawLines(minor, cGrid, 0.5, true);
    drawLines(major, cGridMajor, 1, false);
    ctx.restore();

    // Notches: poché hatch — this is not floor.
    for (const c of room.cutouts) {
      const r = cutoutRect(c, room);
      const rx = ox + r.x * ppi, ry = oy + r.y * ppi, rw = r.w * ppi, rh = r.h * ppi;
      ctx.save();
      ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
      ctx.strokeStyle = cFaint;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.75;
      for (let d = -rh; d < rw; d += 7) {
        ctx.beginPath();
        ctx.moveTo(rx + d, ry + rh);
        ctx.lineTo(rx + d + rh, ry);
        ctx.stroke();
      }
      ctx.restore();
      // Notch size, pencilled in the void.
      if (rw > 40 && rh > 22) {
        ctx.font = `500 9px ${mono}`;
        ctx.fillStyle = cFaint;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${formatDim(r.w, unit)} × ${formatDim(r.h, unit)}`, rx + rw / 2, ry + rh / 2);
      }
    }

    // Walls: double-line poché (heavy stroke with a sheet-colored core).
    tracePoly(); ctx.strokeStyle = cWall; ctx.lineWidth = 5; ctx.lineJoin = 'miter'; ctx.stroke();
    tracePoly(); ctx.strokeStyle = cSheet; ctx.lineWidth = 2.5; ctx.stroke();

    // Dimension strings — architectural ticks and extension lines.
    const tick = (x: number, y: number) => {
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y + 3.5);
      ctx.lineTo(x + 3.5, y - 3.5);
      ctx.stroke();
    };
    ctx.strokeStyle = cDim;
    ctx.fillStyle = cDim;
    ctx.lineWidth = 1;
    ctx.font = `600 10px ${mono}`;

    // Overall width, above the sheet.
    const dyT = oy - 18;
    ctx.beginPath(); ctx.moveTo(ox, oy - 6); ctx.lineTo(ox, dyT - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox + W, oy - 6); ctx.lineTo(ox + W, dyT - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, dyT); ctx.lineTo(ox + W, dyT); ctx.stroke();
    tick(ox, dyT); tick(ox + W, dyT);
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(formatDim(room.w, unit), ox + W / 2, dyT - 3);

    // Overall depth, left of the sheet.
    const dxL = ox - 18;
    ctx.beginPath(); ctx.moveTo(ox - 6, oy); ctx.lineTo(dxL - 4, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox - 6, oy + H); ctx.lineTo(dxL - 4, oy + H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dxL, oy); ctx.lineTo(dxL, oy + H); ctx.stroke();
    tick(dxL, oy); tick(dxL, oy + H);
    ctx.save();
    ctx.translate(dxL - 5, oy + H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(formatDim(room.h, unit), 0, 0);
    ctx.restore();

    // Selected piece: clearance strings to the walls, in the revision pen.
    const sel = items.find(i => i.id === selectedId);
    if (sel && !misfitIds.has(sel.id)) {
      const r = itemRect(sel);
      const cl = clearances(r, room);
      ctx.strokeStyle = cAccent;
      ctx.fillStyle = cAccent;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.font = `600 9px ${mono}`;
      const midY = oy + (r.y + r.h / 2) * ppi;
      const midX = ox + (r.x + r.w / 2) * ppi;
      const halo = (text: string, x: number, y: number) => {
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = cSheet;
        ctx.strokeText(text, x, y);
        ctx.restore();
        ctx.fillText(text, x, y);
      };
      ctx.textBaseline = 'middle';
      if (cl.left > 0.5) {
        const x0 = ox + (r.x - cl.left) * ppi, x1 = ox + r.x * ppi;
        ctx.beginPath(); ctx.moveTo(x0, midY); ctx.lineTo(x1, midY); ctx.stroke();
        ctx.textAlign = 'center';
        halo(formatDim(cl.left, unit), (x0 + x1) / 2, midY - 8);
      }
      if (cl.right > 0.5) {
        const x0 = ox + (r.x + r.w) * ppi, x1 = ox + (r.x + r.w + cl.right) * ppi;
        ctx.beginPath(); ctx.moveTo(x0, midY); ctx.lineTo(x1, midY); ctx.stroke();
        ctx.textAlign = 'center';
        halo(formatDim(cl.right, unit), (x0 + x1) / 2, midY - 8);
      }
      if (cl.top > 0.5) {
        const y0 = oy + (r.y - cl.top) * ppi, y1 = oy + r.y * ppi;
        ctx.beginPath(); ctx.moveTo(midX, y0); ctx.lineTo(midX, y1); ctx.stroke();
        ctx.textAlign = 'left';
        halo(formatDim(cl.top, unit), midX + 6, (y0 + y1) / 2);
      }
      if (cl.bottom > 0.5) {
        const y0 = oy + (r.y + r.h) * ppi, y1 = oy + (r.y + r.h + cl.bottom) * ppi;
        ctx.beginPath(); ctx.moveTo(midX, y0); ctx.lineTo(midX, y1); ctx.stroke();
        ctx.textAlign = 'left';
        halo(formatDim(cl.bottom, unit), midX + 6, (y0 + y1) / 2);
      }
      ctx.setLineDash([]);
    }
  }, [containerSize, view, room, unit, theme, items, selectedId, misfitIds]);

  // ── Item actions ──

  const placeSpec = useCallback((spec: PlaceSpec) => {
    // Drop it on the first clear patch of floor (coarse scan), else centre.
    let x = Math.max(0, Math.round((room.w - spec.width) / 2));
    let y = Math.max(0, Math.round((room.h - spec.height) / 2));
    const probe: FurnitureItem = {
      id: -1, label: spec.label, width: spec.width, height: spec.height,
      x, y, rotation: 0, locked: false, icon: spec.icon, color: spec.color,
    };
    const clearOfItems = (r: Rect) => !items.some(i => rectsOverlap(r, itemRect(i)));
    if (!fitsInRoom(probe, room) || !clearOfItems(itemRect(probe))) {
      outer:
      for (let py = 0; py <= room.h - spec.height; py += 6) {
        for (let px = 0; px <= room.w - spec.width; px += 6) {
          probe.x = px; probe.y = py;
          if (fitsInRoom(probe, room) && clearOfItems(itemRect(probe))) { x = px; y = py; break outer; }
        }
      }
    } else { x = probe.x; y = probe.y; }

    const newItem: FurnitureItem = {
      id: nextId, label: spec.label, width: spec.width, height: spec.height,
      x, y, rotation: 0, locked: false, icon: spec.icon, color: spec.color,
    };
    setNextId(nextId + 1);
    updateItems([...items, newItem]);
    setSelectedId(newItem.id);
  }, [items, nextId, room, updateItems]);

  const deleteItem = useCallback((id: number) => {
    updateItems(items.filter(i => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [items, selectedId, updateItems]);

  const duplicateItem = useCallback((id: number) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const newItem = {
      ...item, id: nextId, locked: false,
      x: Math.min(item.x + 12, Math.max(0, room.w - item.width)),
      y: Math.min(item.y + 12, Math.max(0, room.h - item.height)),
    };
    setNextId(nextId + 1);
    updateItems([...items, newItem]);
    setSelectedId(newItem.id);
  }, [items, nextId, room, updateItems]);

  const rotateItem = useCallback((id: number) => {
    updateItems(items.map(item => {
      if (item.id !== id || item.locked) return item;
      const rotated = { ...item, rotation: ((item.rotation + 90) % 360) as FurnitureItem['rotation'] };
      const { w, h } = effectiveDims(rotated);
      rotated.x = Math.max(0, Math.min(room.w - w, rotated.x));
      rotated.y = Math.max(0, Math.min(room.h - h, rotated.y));
      return rotated;
    }));
  }, [items, room, updateItems]);

  const toggleLock = useCallback((id: number) => {
    updateItems(items.map(i => i.id === id ? { ...i, locked: !i.locked } : i));
  }, [items, updateItems]);

  const nudgeItem = useCallback((id: number, dx: number, dy: number) => {
    updateItems(items.map(item => {
      if (item.id !== id || item.locked) return item;
      const { w, h } = effectiveDims(item);
      return {
        ...item,
        x: Math.max(0, Math.min(room.w - w, item.x + dx)),
        y: Math.max(0, Math.min(room.h - h, item.y + dy)),
      };
    }));
  }, [items, room, updateItems]);

  const renameItem = useCallback((id: number, label: string) => {
    if (!label.trim()) return;
    updateItems(items.map(i => i.id === id ? { ...i, label: label.trim() } : i));
  }, [items, updateItems]);

  // ── Catalogue actions ──

  const addCatalogue = useCallback((spec: PlaceSpec) => {
    setCatalogue(prev => {
      const next = {
        items: [...prev.items, { id: prev.nextId, ...spec }],
        nextId: prev.nextId + 1,
      };
      persistCatalogue(next);
      return next;
    });
  }, []);

  const updateCatalogue = useCallback((item: CatalogueItem) => {
    setCatalogue(prev => {
      const next = { ...prev, items: prev.items.map(i => i.id === item.id ? item : i) };
      persistCatalogue(next);
      return next;
    });
  }, []);

  const deleteCatalogue = useCallback((id: number) => {
    setCatalogue(prev => {
      const next = { ...prev, items: prev.items.filter(i => i.id !== id) };
      persistCatalogue(next);
      return next;
    });
  }, []);

  // ── Drag & drop ──

  const handlePointerDown = useCallback((e: React.PointerEvent, item: FurnitureItem) => {
    if (item.locked || !view) { setSelectedId(item.id); return; }
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    draggingRef.current = {
      id: item.id,
      offsetX: mouseX - (view.ox + item.x * view.ppi),
      offsetY: mouseY - (view.oy + item.y * view.ppi),
    };
    dragPosRef.current = { x: item.x, y: item.y };
    const el = e.currentTarget as HTMLDivElement;
    dragElRef.current = el;
    el.setPointerCapture(e.pointerId);
    setSelectedId(item.id);
    setDraggingId(item.id);
  }, [view]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d || !view) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    let newX = Math.round((mouseX - d.offsetX - view.ox) / view.ppi / SNAP_INCREMENT) * SNAP_INCREMENT;
    let newY = Math.round((mouseY - d.offsetY - view.oy) / view.ppi / SNAP_INCREMENT) * SNAP_INCREMENT;
    const item = items.find(i => i.id === d.id);
    if (item) {
      const { w, h } = effectiveDims(item);
      newX = Math.max(0, Math.min(room.w - w, newX));
      newY = Math.max(0, Math.min(room.h - h, newY));
    }
    dragPosRef.current = { x: newX, y: newY };
    const el = dragElRef.current;
    if (el) {
      el.style.left = `${view.ox + newX * view.ppi}px`;
      el.style.top = `${view.oy + newY * view.ppi}px`;
    }
  }, [items, view, room]);

  const handlePointerUp = useCallback(() => {
    const d = draggingRef.current;
    const pos = dragPosRef.current;
    if (d && pos) {
      updateItems(items.map(i => i.id === d.id ? { ...i, x: pos.x, y: pos.y } : i));
    }
    draggingRef.current = null;
    dragPosRef.current = null;
    dragElRef.current = null;
    setDraggingId(null);
  }, [items, updateItems]);

  // ── Keyboard ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape') { setSelectedId(null); setPopover(null); return; }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (selectedId == null) return;

      const step = e.shiftKey ? 12 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeItem(selectedId, -step, 0); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); nudgeItem(selectedId, step, 0); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); nudgeItem(selectedId, 0, -step); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); nudgeItem(selectedId, 0, step); return; }
      if (e.key === 'r' || e.key === 'R') { rotateItem(selectedId); return; }
      if (e.key === 'l' || e.key === 'L') { toggleLock(selectedId); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItem(selectedId); return; }
      if ((e.key === 'd' || e.key === 'D') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); duplicateItem(selectedId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, rotateItem, toggleLock, deleteItem, duplicateItem, nudgeItem, undo, redo]);

  // ── Save / load ──

  const handleSave = useCallback(() => {
    const name = layoutName.trim() || `Plan ${savedLayouts.length + 1}`;
    const layout: SavedLayout = {
      name, items, nextId,
      roomWidth: room.w, roomHeight: room.h, cutouts: room.cutouts, unit,
    };
    const existing = savedLayouts.findIndex(l => l.name === name);
    const updated = existing >= 0
      ? savedLayouts.map((l, i) => i === existing ? layout : l)
      : [...savedLayouts, layout];
    persistLayouts(updated);
    setSavedLayouts(updated);
    setLayoutName('');
  }, [layoutName, items, nextId, room, unit, savedLayouts]);

  const handleLoad = useCallback((layout: SavedLayout) => {
    setItems(layout.items);
    setNextId(layout.nextId);
    setRoom({ w: layout.roomWidth, h: layout.roomHeight, cutouts: layout.cutouts || [] });
    if (layout.unit) setUnit(layout.unit);
    setSelectedId(null);
    pushHistory(layout.items);
    setPopover(null);
  }, [pushHistory]);

  const handleDeleteLayout = useCallback((name: string) => {
    const updated = savedLayouts.filter(l => l.name !== name);
    persistLayouts(updated);
    setSavedLayouts(updated);
  }, [savedLayouts]);

  // ── Room shape ──

  const setRoomDim = useCallback((axis: 'w' | 'h', val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) {
      setRoom(prev => ({ ...prev, [axis]: Math.round(toBase(n, unit)) }));
    }
  }, [unit]);

  const setCutout = useCallback((corner: Corner, on: boolean) => {
    setRoom(prev => ({
      ...prev,
      cutouts: on
        ? [...prev.cutouts.filter(c => c.corner !== corner), {
            corner,
            w: Math.max(6, Math.round(prev.w / 3)),
            d: Math.max(6, Math.round(prev.h / 3)),
          }]
        : prev.cutouts.filter(c => c.corner !== corner),
    }));
  }, []);

  const setCutoutDim = useCallback((corner: Corner, axis: 'w' | 'd', val: string) => {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return;
    setRoom(prev => ({
      ...prev,
      cutouts: prev.cutouts.map(c => c.corner === corner
        ? { ...c, [axis]: Math.round(toBase(n, unit)) }
        : c),
    }));
  }, [unit]);

  // ── Derived readouts ──
  const selectedItem = items.find(i => i.id === selectedId) ?? null;
  const areaIn2 = floorArea(room);
  const usedIn2 = items.reduce((sum, i) => sum + i.width * i.height, 0);
  const metric = unit === 'cm' || unit === 'm';
  const fmtArea = (in2: number) => metric
    ? `${(in2 * 0.00064516).toFixed(1)} m²`
    : `${Math.round(in2 / 144)} ft²`;
  const freePct = areaIn2 > 0 ? Math.max(0, Math.round((1 - usedIn2 / areaIn2) * 100)) : 0;
  const scaleRatio = view ? Math.max(1, Math.round(96 / view.ppi)) : null;

  const dimInput = (axis: 'w' | 'h') => (
    <Input
      type="number" min="1" step={unit === 'ft' ? 0.5 : unit === 'm' ? 0.1 : 1}
      value={parseFloat(fromBase(axis === 'w' ? room.w : room.h, unit).toFixed(2))}
      onChange={(e) => setRoomDim(axis, e.target.value)}
      className="bp-readout h-7 w-16 rounded-[3px] px-1.5 text-xs"
    />
  );

  const toolBtn = 'bp-chip flex h-7 w-7 items-center justify-center';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
      {/* ── The flat file (catalogue) ── */}
      <aside className="bp-paper order-2 h-[380px] w-full shrink-0 overflow-hidden lg:order-1 lg:h-auto lg:w-60">
        <CataloguePanel
          unit={unit}
          catalogue={catalogue.items}
          onPlace={placeSpec}
          onAddCatalogue={addCatalogue}
          onUpdateCatalogue={updateCatalogue}
          onDeleteCatalogue={deleteCatalogue}
        />
      </aside>

      {/* ── The board ── */}
      <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:order-2">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="bp-etch">Room</span>
            {dimInput('w')}
            <span className="text-xs text-muted-foreground">×</span>
            {dimInput('h')}
          </div>

          <div className="flex items-center gap-0.5">
            {(['ft', 'in', 'cm', 'm'] as DisplayUnit[]).map(u => (
              <button key={u} onClick={() => setUnit(u)} data-on={unit === u || undefined}
                className="bp-chip bp-readout px-1.5 py-1 text-[10px] leading-none">
                {u}
              </button>
            ))}
          </div>

          {/* Shape popover */}
          <div className="relative">
            <button onClick={() => setPopover(popover === 'shape' ? null : 'shape')}
              className="bp-chip flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium"
              data-on={room.cutouts.length > 0 || popover === 'shape' || undefined}>
              <Scissors className="h-3 w-3" />
              Shape{room.cutouts.length > 0 ? ` · ${room.cutouts.length}` : ''}
            </button>
            {popover === 'shape' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
                <div className="bp-paper absolute left-0 top-9 z-50 w-72 p-3">
                  <p className="bp-etch mb-1">Notch the corners</p>
                  <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                    Cut rectangles out of the corners for L-shaped and odd rooms. Hatched area isn&apos;t floor.
                  </p>
                  <div className="mb-2 flex justify-center">
                    <svg viewBox={`-6 -6 ${room.w + 12} ${room.h + 12}`} className="h-20" style={{ aspectRatio: `${room.w}/${room.h}` }}>
                      <polygon
                        points={wallPolygon(room).map(p => p.join(',')).join(' ')}
                        fill="color-mix(in srgb, var(--bp-accent) 8%, transparent)"
                        stroke="var(--bp-wall)"
                        strokeWidth={Math.max(room.w, room.h) / 40}
                      />
                    </svg>
                  </div>
                  <div className="space-y-1.5">
                    {CORNERS.map(({ key, label }) => {
                      const c = room.cutouts.find(c => c.corner === key);
                      return (
                        <div key={key} className="flex items-center gap-1.5 text-xs">
                          <button onClick={() => setCutout(key, !c)} data-on={!!c || undefined}
                            className="bp-chip w-24 shrink-0 px-1.5 py-1 text-left text-[10px] font-medium">
                            {label}
                          </button>
                          {c && (
                            <>
                              <Input type="number" min="1" step="any"
                                value={parseFloat(fromBase(c.w, unit).toFixed(2))}
                                onChange={(e) => setCutoutDim(key, 'w', e.target.value)}
                                className="bp-readout h-6 w-14 rounded-[3px] px-1 text-[11px]" />
                              <span className="text-[10px] text-muted-foreground">×</span>
                              <Input type="number" min="1" step="any"
                                value={parseFloat(fromBase(c.d, unit).toFixed(2))}
                                onChange={(e) => setCutoutDim(key, 'd', e.target.value)}
                                className="bp-readout h-6 w-14 rounded-[3px] px-1 text-[11px]" />
                              <span className="text-[10px] text-muted-foreground">{UNIT_ABBR[unit]}</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="hidden h-5 w-px bg-border sm:block" />

          <div className="flex items-center gap-0.5">
            <button className={toolBtn} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 className="h-3.5 w-3.5" /></button>
            <button className={toolBtn} onClick={redo} title="Redo (Ctrl+Shift+Z)"><Redo2 className="h-3.5 w-3.5" /></button>
          </div>

          {/* Layouts popover */}
          <div className="relative">
            <button onClick={() => setPopover(popover === 'layouts' ? null : 'layouts')}
              className="bp-chip flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium"
              data-on={popover === 'layouts' || undefined}>
              <Save className="h-3 w-3" /> Plans
            </button>
            {popover === 'layouts' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPopover(null)} />
                <div className="bp-paper absolute left-0 top-9 z-50 w-64 p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Input
                      value={layoutName}
                      onChange={(e) => setLayoutName(e.target.value)}
                      className="h-7 flex-1 rounded-[3px] text-xs"
                      placeholder="Plan name"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                    />
                    <button onClick={handleSave} className="bp-chip px-2 py-1 text-[11px] font-medium" data-on="true">Save</button>
                  </div>
                  {savedLayouts.length > 0 ? (
                    <div className="max-h-44 space-y-px overflow-y-auto">
                      {savedLayouts.map(l => (
                        <div key={l.name} className="flex items-center gap-1 text-xs">
                          <button onClick={() => handleLoad(l)}
                            className="flex-1 truncate rounded-[3px] px-2 py-1 text-left hover:bg-muted">
                            <FolderOpen className="mr-1.5 inline h-3 w-3" />{l.name}
                          </button>
                          <button onClick={() => handleDeleteLayout(l.name)}
                            className="p-1 text-muted-foreground hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No saved plans yet — the current sheet autosaves.</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Fit report */}
          <div className="ml-auto flex items-center gap-3">
            {misfitIds.size > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--bp-accent)' }}>
                <AlertTriangle className="h-3 w-3" />
                {misfitIds.size} outside the walls
              </span>
            )}
            {misfitIds.size === 0 && overlapIds.size > 0 && (
              <span className="text-[11px] text-muted-foreground">{overlapIds.size} pieces overlap</span>
            )}
            <span className="bp-etch hidden sm:inline">{items.length} placed</span>
          </div>
        </div>

        {/* ── The sheet ── */}
        <div
          ref={containerRef}
          className="bp-paper relative min-h-[420px] flex-1 touch-none overflow-hidden"
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t === e.currentTarget || t.tagName === 'CANVAS') setSelectedId(null);
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <canvas ref={canvasRef} className="absolute inset-0" style={{ touchAction: 'none' }} />

          {/* Furniture */}
          {view && items.map(item => {
            const { w, h } = effectiveDims(item);
            const isSelected = item.id === selectedId;
            const isDragging = item.id === draggingId;
            const misfit = misfitIds.has(item.id);
            const bumped = !misfit && overlapIds.has(item.id);
            const Icon = getIcon(item.icon);
            const pxW = w * view.ppi;
            const pxH = h * view.ppi;
            const sideways = item.rotation === 90 || item.rotation === 270;

            return (
              <div
                key={item.id}
                className={`absolute select-none ${misfit ? 'bp-hatch' : ''} ${isDragging ? 'z-30' : isSelected ? 'z-20' : 'z-10'}`}
                style={{
                  left: `${view.ox + item.x * view.ppi}px`,
                  top: `${view.oy + item.y * view.ppi}px`,
                  width: `${pxW}px`,
                  height: `${pxH}px`,
                  backgroundColor: misfit
                    ? 'color-mix(in srgb, var(--bp-accent) 10%, transparent)'
                    : `color-mix(in srgb, ${item.color} ${isSelected ? 22 : 14}%, transparent)`,
                  border: `1.5px ${bumped ? 'dashed' : item.locked ? 'dashed' : 'solid'} ${
                    misfit ? 'var(--bp-accent)' : isSelected ? 'var(--bp-accent)' : item.color}`,
                  boxShadow: isDragging
                    ? '0 8px 20px hsl(215 45% 15% / 0.25)'
                    : isSelected ? '0 2px 8px hsl(215 45% 15% / 0.15)' : 'none',
                  cursor: item.locked ? 'default' : isDragging ? 'grabbing' : 'grab',
                  touchAction: 'none',
                }}
                onPointerDown={(e) => handlePointerDown(e, item)}
              >
                <div
                  className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden"
                  style={{ transform: sideways ? 'rotate(-90deg)' : undefined }}
                >
                  {pxW > 26 && pxH > 26 && (
                    <Icon className="shrink-0" style={{
                      color: misfit ? 'var(--bp-accent)' : item.color,
                      width: Math.min(pxW * 0.3, 18), height: Math.min(pxH * 0.3, 18),
                    }} />
                  )}
                  {Math.max(pxW, pxH) > 44 && Math.min(pxW, pxH) > 20 && (
                    <span className="bp-readout max-w-[92%] truncate text-[9px] font-semibold uppercase tracking-wide leading-tight text-foreground/85">
                      {item.label}
                    </span>
                  )}
                  {Math.max(pxW, pxH) > 56 && Math.min(pxW, pxH) > 34 && (
                    <span className="bp-readout max-w-[92%] truncate text-[8px] leading-tight text-muted-foreground">
                      {formatDim(item.width, unit)} × {formatDim(item.height, unit)}
                    </span>
                  )}
                </div>
                {item.locked && pxW > 20 && pxH > 20 && (
                  <Lock className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-muted-foreground" />
                )}
              </div>
            );
          })}

          {/* Empty sheet note */}
          {hydrated && items.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="bp-etch max-w-56 text-center leading-relaxed" style={{ letterSpacing: '0.12em' }}>
                An empty floor.<br />Place furniture from the drawer.
              </p>
            </div>
          )}

          {/* Title block — the sheet's signature corner */}
          <div className="bp-readout pointer-events-none absolute bottom-0 right-0 z-20 border-l border-t bg-card"
            style={{ borderColor: 'var(--bp-wall)' }}>
            <div className="flex items-stretch divide-x" style={{ borderColor: 'var(--bp-wall)' }}>
              <div className="px-2.5 py-1.5">
                <p className="bp-etch" style={{ fontSize: 8, letterSpacing: '0.2em' }}>Devys Workshop · RM 11</p>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em]">Room plan</p>
              </div>
              <div className="hidden px-2.5 py-1.5 sm:block" style={{ borderColor: 'var(--bp-wall)' }}>
                <p className="bp-etch" style={{ fontSize: 8, letterSpacing: '0.2em' }}>Scale</p>
                <p className="text-[11px]">{scaleRatio ? `1:${scaleRatio}` : '—'}</p>
              </div>
              <div className="hidden px-2.5 py-1.5 sm:block" style={{ borderColor: 'var(--bp-wall)' }}>
                <p className="bp-etch" style={{ fontSize: 8, letterSpacing: '0.2em' }}>Floor</p>
                <p className="text-[11px]">{fmtArea(areaIn2)}</p>
              </div>
              <div className="px-2.5 py-1.5" style={{ borderColor: 'var(--bp-wall)' }}>
                <p className="bp-etch" style={{ fontSize: 8, letterSpacing: '0.2em' }}>Free</p>
                <p className="text-[11px]" style={{ color: freePct < 30 ? 'var(--bp-accent)' : undefined }}>{freePct}%</p>
              </div>
              <div className="px-2.5 py-1.5" style={{ borderColor: 'var(--bp-wall)' }}>
                <p className="bp-etch" style={{ fontSize: 8, letterSpacing: '0.2em' }}>Sheet</p>
                <p className="text-[11px]">A-01</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Inspector strip — always present so the sheet never shifts ── */}
        {selectedItem ? (
          <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5">
            {(() => {
              const Icon = getIcon(selectedItem.icon);
              return <Icon className="h-4 w-4 shrink-0" style={{ color: selectedItem.color }} />;
            })()}
            <Input
              key={selectedItem.id}
              defaultValue={selectedItem.label}
              onBlur={(e) => renameItem(selectedItem.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="h-7 w-40 rounded-[3px] text-xs font-medium"
            />
            <span className="bp-readout text-[11px] text-muted-foreground">
              {formatDim(selectedItem.width, unit)} × {formatDim(selectedItem.height, unit)}
            </span>
            <span className="bp-readout text-[11px] text-muted-foreground">
              at {formatDim(selectedItem.x, unit)}, {formatDim(selectedItem.y, unit)}
            </span>
            {selectedItem.rotation !== 0 && (
              <span className="bp-readout text-[11px] text-muted-foreground">{selectedItem.rotation}°</span>
            )}
            {misfitIds.has(selectedItem.id) && (
              <span className="text-[11px] font-medium" style={{ color: 'var(--bp-accent)' }}>
                doesn&apos;t fit here
              </span>
            )}
            <div className="ml-auto flex items-center gap-0.5">
              <button className={toolBtn} onClick={() => rotateItem(selectedItem.id)} title="Rotate (R)">
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button className={toolBtn} onClick={() => toggleLock(selectedItem.id)}
                data-on={selectedItem.locked || undefined}
                title={selectedItem.locked ? 'Unlock (L)' : 'Lock (L)'}>
                {selectedItem.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              </button>
              <button className={toolBtn} onClick={() => duplicateItem(selectedItem.id)} title="Duplicate (Ctrl+D)">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button className={`${toolBtn} hover:!text-[--bp-accent]`} onClick={() => deleteItem(selectedItem.id)} title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="bp-etch">Nothing selected</span>
            <span className="text-[11px] text-muted-foreground">
              Click a piece on the sheet to see its clearances.
            </span>
            <span className="bp-readout ml-auto hidden text-[10px] text-muted-foreground md:inline">
              R rotate · L lock · arrows nudge · ⇧ = 1' · ⌫ delete · ⌘Z undo
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
