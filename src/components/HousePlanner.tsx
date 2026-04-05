'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BedDouble, Sofa, Armchair, Table, Archive, Refrigerator, Bath,
  Square, Plus, Search, RotateCw, Lock, Unlock, Copy, Trash2,
  Undo2, Redo2, Save, FolderOpen, ChevronDown, ChevronRight,
  X, Pencil, Monitor, Lamp, DoorOpen, Tv, Microwave, WashingMachine,
  type LucideIcon,
} from 'lucide-react';

// ── Types ──

type Rotation = 0 | 90 | 180 | 270;
type DisplayUnit = 'in' | 'ft' | 'cm' | 'm';

interface FurnitureItem {
  id: number;
  label: string;
  width: number;   // inches
  height: number;  // inches
  x: number;       // inches
  y: number;       // inches
  rotation: Rotation;
  locked: boolean;
  icon: string;
  color: string;
}

interface SavedLayout {
  name: string;
  items: FurnitureItem[];
  nextId: number;
  roomWidth: number;   // inches
  roomHeight: number;  // inches
  unit?: DisplayUnit;
}

// ── Icon Map ──

const ICON_MAP: Record<string, LucideIcon> = {
  BedDouble, Sofa, Armchair, Table, Archive, Refrigerator, Bath,
  Square, Monitor, Lamp, DoorOpen, Tv, Microwave, WashingMachine,
};

function getIcon(key: string): LucideIcon {
  return ICON_MAP[key] || Square;
}

// ── Unit Conversion ──

const UNIT_LABELS: Record<DisplayUnit, string> = { 'in': 'inches', 'ft': 'feet', 'cm': 'cm', 'm': 'meters' };
const UNIT_ABBR: Record<DisplayUnit, string> = { 'in': '"', 'ft': "'", 'cm': 'cm', 'm': 'm' };

function toBase(val: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'in': return val;
    case 'ft': return val * 12;
    case 'cm': return val / 2.54;
    case 'm': return val * 100 / 2.54;
  }
}

function fromBase(val: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'in': return val;
    case 'ft': return val / 12;
    case 'cm': return val * 2.54;
    case 'm': return val * 2.54 / 100;
  }
}

function formatDim(val: number, unit: DisplayUnit): string {
  const converted = fromBase(val, unit);
  if (unit === 'ft') return converted % 1 === 0 ? `${converted}'` : `${converted.toFixed(1)}'`;
  if (unit === 'm') return `${converted.toFixed(2)}m`;
  return `${Math.round(converted)}${UNIT_ABBR[unit]}`;
}

// Grid major line interval in inches for each unit
function gridMajorInterval(unit: DisplayUnit): number {
  switch (unit) {
    case 'in': return 12;
    case 'ft': return 12;
    case 'cm': return Math.round(10 / 2.54); // ~4" = 10cm
    case 'm': return Math.round(100 / 2.54); // ~39" = 1m
  }
}

// Snap increment in inches
function snapIncrement(unit: DisplayUnit): number {
  switch (unit) {
    case 'in': return 1;
    case 'ft': return 1;
    case 'cm': return 1;
    case 'm': return 1;
  }
}

// ── Furniture Presets ──

interface FurniturePreset {
  label: string;
  width: number;  // inches
  height: number; // inches
  icon: string;
  color: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Beds': '#8b5cf6',
  'Seating': '#3b82f6',
  'Tables': '#f59e0b',
  'Storage': '#10b981',
  'Appliances': '#6366f1',
  'Bathroom': '#06b6d4',
};

const FURNITURE_PRESETS: Record<string, FurniturePreset[]> = {
  'Beds': [
    { label: 'Twin Bed', width: 39, height: 75, icon: 'BedDouble', color: CATEGORY_COLORS['Beds'] },
    { label: 'Full Bed', width: 54, height: 75, icon: 'BedDouble', color: CATEGORY_COLORS['Beds'] },
    { label: 'Queen Bed', width: 60, height: 80, icon: 'BedDouble', color: CATEGORY_COLORS['Beds'] },
    { label: 'King Bed', width: 76, height: 80, icon: 'BedDouble', color: CATEGORY_COLORS['Beds'] },
    { label: 'Crib', width: 28, height: 52, icon: 'BedDouble', color: CATEGORY_COLORS['Beds'] },
  ],
  'Seating': [
    { label: 'Sofa', width: 84, height: 36, icon: 'Sofa', color: CATEGORY_COLORS['Seating'] },
    { label: 'Loveseat', width: 60, height: 36, icon: 'Sofa', color: CATEGORY_COLORS['Seating'] },
    { label: 'Armchair', width: 36, height: 34, icon: 'Armchair', color: CATEGORY_COLORS['Seating'] },
    { label: 'Office Chair', width: 26, height: 26, icon: 'Armchair', color: CATEGORY_COLORS['Seating'] },
    { label: 'Dining Chair', width: 18, height: 18, icon: 'Armchair', color: CATEGORY_COLORS['Seating'] },
  ],
  'Tables': [
    { label: 'Dining Table', width: 72, height: 36, icon: 'Table', color: CATEGORY_COLORS['Tables'] },
    { label: 'Coffee Table', width: 48, height: 24, icon: 'Table', color: CATEGORY_COLORS['Tables'] },
    { label: 'End Table', width: 24, height: 24, icon: 'Table', color: CATEGORY_COLORS['Tables'] },
    { label: 'Desk', width: 60, height: 30, icon: 'Table', color: CATEGORY_COLORS['Tables'] },
    { label: 'Nightstand', width: 20, height: 20, icon: 'Table', color: CATEGORY_COLORS['Tables'] },
  ],
  'Storage': [
    { label: 'Dresser', width: 60, height: 18, icon: 'Archive', color: CATEGORY_COLORS['Storage'] },
    { label: 'Bookshelf', width: 36, height: 12, icon: 'Archive', color: CATEGORY_COLORS['Storage'] },
    { label: 'Wardrobe', width: 48, height: 24, icon: 'DoorOpen', color: CATEGORY_COLORS['Storage'] },
    { label: 'TV Stand', width: 60, height: 18, icon: 'Tv', color: CATEGORY_COLORS['Storage'] },
    { label: 'Filing Cabinet', width: 18, height: 24, icon: 'Archive', color: CATEGORY_COLORS['Storage'] },
  ],
  'Appliances': [
    { label: 'Fridge', width: 36, height: 30, icon: 'Refrigerator', color: CATEGORY_COLORS['Appliances'] },
    { label: 'Stove', width: 30, height: 27, icon: 'Microwave', color: CATEGORY_COLORS['Appliances'] },
    { label: 'Dishwasher', width: 24, height: 24, icon: 'WashingMachine', color: CATEGORY_COLORS['Appliances'] },
    { label: 'Washer', width: 27, height: 27, icon: 'WashingMachine', color: CATEGORY_COLORS['Appliances'] },
    { label: 'Dryer', width: 27, height: 27, icon: 'WashingMachine', color: CATEGORY_COLORS['Appliances'] },
  ],
  'Bathroom': [
    { label: 'Bathtub', width: 60, height: 30, icon: 'Bath', color: CATEGORY_COLORS['Bathroom'] },
    { label: 'Shower', width: 36, height: 36, icon: 'Bath', color: CATEGORY_COLORS['Bathroom'] },
    { label: 'Toilet', width: 18, height: 28, icon: 'Bath', color: CATEGORY_COLORS['Bathroom'] },
    { label: 'Vanity', width: 48, height: 22, icon: 'Bath', color: CATEGORY_COLORS['Bathroom'] },
  ],
};

// ── Storage ──

const STORAGE_KEY = 'houseplanner-layouts';

function loadLayouts(): SavedLayout[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const layouts: SavedLayout[] = JSON.parse(data);
    // Backward compat: add missing fields
    return layouts.map(l => ({
      ...l,
      unit: l.unit || 'in',
      items: l.items.map(item => ({
        ...{ rotation: 0 as Rotation, locked: false, icon: 'Square', color: '#6366f1' },
        ...item,
      })),
    }));
  } catch { return []; }
}

function persistLayouts(layouts: SavedLayout[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
}

// ── Helpers ──

function effectiveDims(item: FurnitureItem): { w: number; h: number } {
  return (item.rotation === 90 || item.rotation === 270)
    ? { w: item.height, h: item.width }
    : { w: item.width, h: item.height };
}

// ── Component ──

export default function HousePlanner() {
  const { theme } = useTheme();

  // State
  const [items, setItems] = useState<FurnitureItem[]>([]);
  const [nextId, setNextId] = useState(1);
  const [roomWidthIn, setRoomWidthIn] = useState(240); // 20ft in inches
  const [roomHeightIn, setRoomHeightIn] = useState(240);
  const [unit, setUnit] = useState<DisplayUnit>('ft');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>([]);
  const [layoutName, setLayoutName] = useState('');
  const [showSaveLoad, setShowSaveLoad] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.keys(FURNITURE_PRESETS).map(k => [k, true]))
  );
  const [customLabel, setCustomLabel] = useState('');
  const [customWidth, setCustomWidth] = useState('24');
  const [customHeight, setCustomHeight] = useState('24');
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const draggingRef = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragElRef = useRef<HTMLDivElement | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // History
  const historyRef = useRef<FurnitureItem[][]>([[]]);
  const historyIndexRef = useRef(0);

  const pushHistory = useCallback((newItems: FurnitureItem[]) => {
    const h = historyRef.current;
    const idx = historyIndexRef.current;
    // Truncate any redo states
    historyRef.current = h.slice(0, idx + 1);
    historyRef.current.push(JSON.parse(JSON.stringify(newItems)));
    if (historyRef.current.length > 50) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
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

  // Update items with history
  const updateItems = useCallback((newItems: FurnitureItem[]) => {
    setItems(newItems);
    pushHistory(newItems);
  }, [pushHistory]);

  // Load saved layouts on mount
  useEffect(() => { setSavedLayouts(loadLayouts()); }, []);

  // ResizeObserver for container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pixels per inch
  const pxPerInch = containerSize.width > 0 ? containerSize.width / roomWidthIn : 1;

  // ── Canvas Grid Drawing ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerSize.width === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerSize.width * dpr;
    canvas.height = containerSize.height * dpr;
    canvas.style.width = `${containerSize.width}px`;
    canvas.style.height = `${containerSize.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, containerSize.width, containerSize.height);

    const isDark = theme === 'dark';
    const gridMajor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
    const gridMinor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
    const majorInterval = gridMajorInterval(unit);
    const ppi = pxPerInch;

    // Minor grid lines (every inch)
    ctx.strokeStyle = gridMinor;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= roomWidthIn; i++) {
      if (i % majorInterval === 0) continue;
      const x = i * ppi;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, containerSize.height); ctx.stroke();
    }
    for (let i = 0; i <= roomHeightIn; i++) {
      if (i % majorInterval === 0) continue;
      const y = i * ppi;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(containerSize.width, y); ctx.stroke();
    }

    // Major grid lines
    ctx.strokeStyle = gridMajor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= roomWidthIn; i += majorInterval) {
      const x = i * ppi;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, containerSize.height); ctx.stroke();
    }
    for (let i = 0; i <= roomHeightIn; i += majorInterval) {
      const y = i * ppi;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(containerSize.width, y); ctx.stroke();
    }

    // Dimension labels along top
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let i = majorInterval; i < roomWidthIn; i += majorInterval) {
      ctx.fillText(formatDim(i, unit), i * ppi, 12);
    }
    // Along left
    ctx.textAlign = 'left';
    for (let i = majorInterval; i < roomHeightIn; i += majorInterval) {
      ctx.fillText(formatDim(i, unit), 3, i * ppi + 12);
    }

    // Room border
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, containerSize.width, containerSize.height);
  }, [containerSize, roomWidthIn, roomHeightIn, unit, theme, pxPerInch]);

  // ── Item Actions ──

  const addPreset = useCallback((preset: FurniturePreset) => {
    const newItem: FurnitureItem = {
      id: nextId,
      label: preset.label,
      width: preset.width,
      height: preset.height,
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      icon: preset.icon,
      color: preset.color,
    };
    const newItems = [...items, newItem];
    setNextId(nextId + 1);
    updateItems(newItems);
    setSelectedId(newItem.id);
  }, [items, nextId, updateItems]);

  const addCustom = useCallback(() => {
    if (!customLabel.trim()) return;
    const wIn = toBase(parseFloat(customWidth) || 24, unit);
    const hIn = toBase(parseFloat(customHeight) || 24, unit);
    const newItem: FurnitureItem = {
      id: nextId,
      label: customLabel.trim(),
      width: Math.max(1, Math.round(wIn)),
      height: Math.max(1, Math.round(hIn)),
      x: 0, y: 0,
      rotation: 0, locked: false,
      icon: 'Square', color: '#71717a',
    };
    const newItems = [...items, newItem];
    setNextId(nextId + 1);
    updateItems(newItems);
    setSelectedId(newItem.id);
    setCustomLabel('');
  }, [items, nextId, unit, customLabel, customWidth, customHeight, updateItems]);

  const deleteItem = useCallback((id: number) => {
    updateItems(items.filter(i => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [items, selectedId, updateItems]);

  const duplicateItem = useCallback((id: number) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const newItem = { ...item, id: nextId, x: Math.min(item.x + 12, roomWidthIn - item.width), y: Math.min(item.y + 12, roomHeightIn - item.height) };
    setNextId(nextId + 1);
    const newItems = [...items, newItem];
    updateItems(newItems);
    setSelectedId(newItem.id);
  }, [items, nextId, roomWidthIn, roomHeightIn, updateItems]);

  const rotateItem = useCallback((id: number) => {
    const newItems = items.map(item => {
      if (item.id !== id) return item;
      const newRotation = ((item.rotation + 90) % 360) as Rotation;
      const newItem = { ...item, rotation: newRotation };
      // Clamp position after rotation
      const { w, h } = effectiveDims(newItem);
      newItem.x = Math.max(0, Math.min(roomWidthIn - w, newItem.x));
      newItem.y = Math.max(0, Math.min(roomHeightIn - h, newItem.y));
      return newItem;
    });
    updateItems(newItems);
  }, [items, roomWidthIn, roomHeightIn, updateItems]);

  const toggleLock = useCallback((id: number) => {
    updateItems(items.map(i => i.id === id ? { ...i, locked: !i.locked } : i));
  }, [items, updateItems]);

  // ── Drag & Drop ──

  const handlePointerDown = useCallback((e: React.PointerEvent, item: FurnitureItem) => {
    if (item.locked) { setSelectedId(item.id); return; }
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const itemPxX = item.x * pxPerInch;
    const itemPxY = item.y * pxPerInch;
    draggingRef.current = { id: item.id, offsetX: mouseX - itemPxX, offsetY: mouseY - itemPxY };
    dragPosRef.current = { x: item.x, y: item.y };
    // Capture the item's DOM element for direct manipulation during drag
    const el = (e.currentTarget as HTMLDivElement);
    dragElRef.current = el;
    el.setPointerCapture(e.pointerId);
    setSelectedId(item.id);
    setDraggingId(item.id);
  }, [pxPerInch]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const snap = snapIncrement(unit);
    let newX = Math.round((mouseX - d.offsetX) / pxPerInch / snap) * snap;
    let newY = Math.round((mouseY - d.offsetY) / pxPerInch / snap) * snap;

    // Find the item for boundary clamping
    const item = items.find(i => i.id === d.id);
    if (item) {
      const { w, h } = effectiveDims(item);
      newX = Math.max(0, Math.min(roomWidthIn - w, newX));
      newY = Math.max(0, Math.min(roomHeightIn - h, newY));
    }

    dragPosRef.current = { x: newX, y: newY };

    // Update DOM directly for performance
    const el = dragElRef.current;
    if (el) {
      el.style.left = `${newX * pxPerInch}px`;
      el.style.top = `${newY * pxPerInch}px`;
    }
  }, [items, pxPerInch, roomWidthIn, roomHeightIn, unit]);

  const handlePointerUp = useCallback(() => {
    const d = draggingRef.current;
    const pos = dragPosRef.current;
    if (d && pos) {
      const newItems = items.map(i => i.id === d.id ? { ...i, x: pos.x, y: pos.y } : i);
      updateItems(newItems);
    }
    draggingRef.current = null;
    dragPosRef.current = null;
    dragElRef.current = null;
    setDraggingId(null);
  }, [items, updateItems]);

  // ── Keyboard Shortcuts ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle when typing in inputs
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      if (e.key === 'Escape') { setSelectedId(null); setEditingLabel(null); return; }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }

      if (selectedId == null) return;

      if (e.key === 'r' || e.key === 'R') { rotateItem(selectedId); return; }
      if (e.key === 'l' || e.key === 'L') { toggleLock(selectedId); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItem(selectedId); return; }
      if (e.key === 'd' || e.key === 'D') { if (e.ctrlKey || e.metaKey) { e.preventDefault(); duplicateItem(selectedId); } return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, rotateItem, toggleLock, deleteItem, duplicateItem, undo, redo]);

  // ── Save/Load ──

  const handleSave = useCallback(() => {
    const name = layoutName.trim() || `Layout ${savedLayouts.length + 1}`;
    const layout: SavedLayout = { name, items, nextId, roomWidth: roomWidthIn, roomHeight: roomHeightIn, unit };
    const existing = savedLayouts.findIndex(l => l.name === name);
    let updated: SavedLayout[];
    if (existing >= 0) {
      updated = [...savedLayouts];
      updated[existing] = layout;
    } else {
      updated = [...savedLayouts, layout];
    }
    persistLayouts(updated);
    setSavedLayouts(updated);
    setLayoutName('');
  }, [layoutName, items, nextId, roomWidthIn, roomHeightIn, unit, savedLayouts]);

  const handleLoad = useCallback((layout: SavedLayout) => {
    setItems(layout.items);
    setNextId(layout.nextId);
    setRoomWidthIn(layout.roomWidth);
    setRoomHeightIn(layout.roomHeight);
    if (layout.unit) setUnit(layout.unit);
    setSelectedId(null);
    pushHistory(layout.items);
    setShowSaveLoad(false);
  }, [pushHistory]);

  const handleDeleteLayout = useCallback((name: string) => {
    const updated = savedLayouts.filter(l => l.name !== name);
    persistLayouts(updated);
    setSavedLayouts(updated);
  }, [savedLayouts]);

  // ── Room size handlers ──

  const setRoomW = useCallback((val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) setRoomWidthIn(Math.round(toBase(n, unit)));
  }, [unit]);

  const setRoomH = useCallback((val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) setRoomHeightIn(Math.round(toBase(n, unit)));
  }, [unit]);

  // ── Selected item ──
  const selectedItem = items.find(i => i.id === selectedId) ?? null;

  // ── Filtered presets ──
  const searchLower = sidebarSearch.toLowerCase();
  const filteredPresets = Object.entries(FURNITURE_PRESETS).map(([cat, presets]) => ({
    category: cat,
    items: presets.filter(p => !searchLower || p.label.toLowerCase().includes(searchLower)),
  })).filter(g => g.items.length > 0);

  // Calculate canvas container height from aspect ratio
  const aspectRatio = roomWidthIn / roomHeightIn;

  return (
    <div className="flex flex-col gap-2 h-[calc(100vh-12rem)]">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 p-2 bg-card rounded-lg border border-border">
        {/* Unit selector */}
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Unit:</Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as DisplayUnit)}>
            <SelectTrigger size="sm" className="w-24 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">Inches</SelectItem>
              <SelectItem value="ft">Feet</SelectItem>
              <SelectItem value="cm">Centimeters</SelectItem>
              <SelectItem value="m">Meters</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Room dimensions */}
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Room:</Label>
          <Input
            type="number" min="1" step={unit === 'ft' ? 1 : unit === 'm' ? 0.5 : 10}
            value={parseFloat(fromBase(roomWidthIn, unit).toFixed(2))}
            onChange={(e) => setRoomW(e.target.value)}
            className="w-16 h-7 text-xs px-1.5"
          />
          <span className="text-xs text-muted-foreground">x</span>
          <Input
            type="number" min="1" step={unit === 'ft' ? 1 : unit === 'm' ? 0.5 : 10}
            value={parseFloat(fromBase(roomHeightIn, unit).toFixed(2))}
            onChange={(e) => setRoomH(e.target.value)}
            className="w-16 h-7 text-xs px-1.5"
          />
          <span className="text-xs text-muted-foreground">{UNIT_LABELS[unit]}</span>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Undo/Redo */}
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={undo} title="Undo (Ctrl+Z)">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={redo} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Save/Load */}
        <div className="relative">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowSaveLoad(!showSaveLoad)}>
            <Save className="h-3 w-3" /> Layouts
          </Button>
          {showSaveLoad && (
            <div className="absolute top-9 left-0 z-50 w-64 p-3 bg-popover border border-border rounded-lg shadow-xl">
              <div className="flex items-center gap-1.5 mb-2">
                <Input
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  className="h-7 text-xs flex-1"
                  placeholder="Layout name"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                />
                <Button onClick={handleSave} size="sm" className="h-7 text-xs px-2">Save</Button>
              </div>
              {savedLayouts.length > 0 ? (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {savedLayouts.map(l => (
                    <div key={l.name} className="flex items-center gap-1 text-xs">
                      <button onClick={() => handleLoad(l)} className="flex-1 text-left px-2 py-1 rounded hover:bg-muted truncate">
                        <FolderOpen className="h-3 w-3 inline mr-1.5" />{l.name}
                      </button>
                      <button onClick={() => handleDeleteLayout(l.name)} className="p-1 text-destructive hover:text-destructive/80">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No saved layouts</p>
              )}
            </div>
          )}
        </div>

        {/* Item count */}
        <span className="text-xs text-muted-foreground ml-auto">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Main Area: Sidebar + Canvas ── */}
      <div className="flex gap-2 flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-52 shrink-0 bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                className="h-7 text-xs pl-7"
                placeholder="Search furniture..."
              />
            </div>
          </div>

          {/* Preset categories */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {filteredPresets.map(({ category, items: presets }) => (
              <div key={category}>
                <button
                  onClick={() => setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }))}
                  className="flex items-center gap-1.5 w-full px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground rounded transition-colors"
                >
                  {expandedCategories[category] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
                  {category}
                </button>
                {expandedCategories[category] && (
                  <div className="ml-2 space-y-0.5">
                    {presets.map(preset => {
                      const Icon = getIcon(preset.icon);
                      return (
                        <button
                          key={preset.label}
                          onClick={() => addPreset(preset)}
                          className="flex items-center gap-2 w-full px-2 py-1 text-xs rounded hover:bg-muted transition-colors group"
                        >
                          <Icon className="h-3 w-3 shrink-0" style={{ color: preset.color }} />
                          <span className="truncate">{preset.label}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            {formatDim(preset.width, unit)} x {formatDim(preset.height, unit)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Custom item */}
            <div className="border-t border-border pt-2 mt-2">
              <p className="text-xs font-medium text-muted-foreground px-2 mb-1.5">Custom Item</p>
              <div className="px-2 space-y-1.5">
                <Input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  className="h-6 text-xs"
                  placeholder="Name"
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
                />
                <div className="flex items-center gap-1">
                  <Input
                    type="number" min="1"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    className="h-6 text-xs flex-1"
                    placeholder="W"
                  />
                  <span className="text-[10px] text-muted-foreground">x</span>
                  <Input
                    type="number" min="1"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(e.target.value)}
                    className="h-6 text-xs flex-1"
                    placeholder="H"
                  />
                  <span className="text-[10px] text-muted-foreground">{UNIT_ABBR[unit]}</span>
                </div>
                <Button onClick={addCustom} size="sm" className="h-6 text-xs w-full gap-1">
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Canvas + Overlay */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            ref={containerRef}
            className="relative flex-1 border border-border rounded-lg overflow-hidden bg-card cursor-crosshair"
            style={{ aspectRatio }}
            onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'CANVAS') setSelectedId(null); }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Grid Canvas */}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }} />

            {/* Item Overlays */}
            {items.map(item => {
              const { w, h } = effectiveDims(item);
              const isSelected = item.id === selectedId;
              const isDragging = item.id === draggingId;
              const Icon = getIcon(item.icon);
              const pxW = w * pxPerInch;
              const pxH = h * pxPerInch;

              return (
                <div
                  key={item.id}
                  className={`absolute flex flex-col items-center justify-center select-none ${
                    isSelected ? 'ring-2 ring-primary shadow-lg z-20' : 'z-10'
                  } ${item.locked ? 'border-dashed' : 'border-solid'} ${
                    isDragging ? 'shadow-2xl z-30 opacity-90' : ''
                  }`}
                  style={{
                    left: `${item.x * pxPerInch}px`,
                    top: `${item.y * pxPerInch}px`,
                    width: `${pxW}px`,
                    height: `${pxH}px`,
                    backgroundColor: `${item.color}20`,
                    borderWidth: '1.5px',
                    borderColor: isSelected ? 'var(--color-primary)' : `${item.color}80`,
                    cursor: item.locked ? 'default' : 'grab',
                    touchAction: 'none',
                  }}
                  onPointerDown={(e) => handlePointerDown(e, item)}
                  onDoubleClick={() => { setEditingLabel(item.id); setEditLabelValue(item.label); }}
                >
                  {/* Content rotated visually */}
                  <div className="flex flex-col items-center justify-center w-full h-full overflow-hidden gap-0.5 pointer-events-none"
                    style={{ transform: `rotate(${item.rotation}deg)` }}>
                    {pxW > 24 && pxH > 24 && (
                      <Icon className="shrink-0" style={{ color: item.color, width: Math.min(pxW * 0.3, 20), height: Math.min(pxH * 0.3, 20) }} />
                    )}
                    {pxW > 40 && pxH > 20 && (
                      <span className="text-[9px] font-medium truncate max-w-[90%] leading-tight text-foreground/80">
                        {item.label}
                      </span>
                    )}
                    {pxW > 50 && pxH > 30 && (
                      <span className="text-[8px] text-muted-foreground truncate max-w-[90%] leading-tight">
                        {formatDim(item.width, unit)} x {formatDim(item.height, unit)}
                      </span>
                    )}
                  </div>

                  {/* Lock indicator */}
                  {item.locked && pxW > 20 && pxH > 20 && (
                    <Lock className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-muted-foreground" />
                  )}
                </div>
              );
            })}

            {/* Inline label editor */}
            {editingLabel != null && (() => {
              const item = items.find(i => i.id === editingLabel);
              if (!item) return null;
              const { w } = effectiveDims(item);
              return (
                <div
                  className="absolute z-40 flex items-center"
                  style={{
                    left: `${item.x * pxPerInch}px`,
                    top: `${item.y * pxPerInch - 28}px`,
                    width: `${w * pxPerInch}px`,
                  }}
                >
                  <Input
                    autoFocus
                    value={editLabelValue}
                    onChange={(e) => setEditLabelValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateItems(items.map(i => i.id === editingLabel ? { ...i, label: editLabelValue } : i));
                        setEditingLabel(null);
                      }
                      if (e.key === 'Escape') setEditingLabel(null);
                    }}
                    onBlur={() => {
                      updateItems(items.map(i => i.id === editingLabel ? { ...i, label: editLabelValue } : i));
                      setEditingLabel(null);
                    }}
                    className="h-6 text-xs"
                  />
                </div>
              );
            })()}
          </div>

          {/* ── Selected Item Bar ── */}
          {selectedItem && (
            <div className="flex items-center gap-3 mt-2 p-2 bg-card border border-border rounded-lg">
              {(() => {
                const Icon = getIcon(selectedItem.icon);
                return <Icon className="h-4 w-4 shrink-0" style={{ color: selectedItem.color }} />;
              })()}
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-sm font-medium truncate">{selectedItem.label}</span>
                <button onClick={() => { setEditingLabel(selectedItem.id); setEditLabelValue(selectedItem.label); }}
                  className="p-0.5 text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDim(selectedItem.width, unit)} x {formatDim(selectedItem.height, unit)}
              </span>
              <span className="text-xs text-muted-foreground">
                @ {formatDim(selectedItem.x, unit)}, {formatDim(selectedItem.y, unit)}
              </span>
              {selectedItem.rotation !== 0 && (
                <span className="text-xs text-muted-foreground">{selectedItem.rotation}deg</span>
              )}

              <div className="flex items-center gap-0.5 ml-auto">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => rotateItem(selectedItem.id)} title="Rotate (R)">
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => toggleLock(selectedItem.id)}
                  title={selectedItem.locked ? 'Unlock (L)' : 'Lock (L)'}>
                  {selectedItem.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => duplicateItem(selectedItem.id)} title="Duplicate (Ctrl+D)">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteItem(selectedItem.id)} title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
