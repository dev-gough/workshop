// Data model for the Drafting Room (RM 11) — all lengths are stored in
// inches; display units convert at the edge.

export type Rotation = 0 | 90 | 180 | 270;
export type DisplayUnit = 'in' | 'ft' | 'cm' | 'm';
export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** A piece of furniture you own — measured once, kept in the catalogue. */
export interface CatalogueItem {
  id: number;
  label: string;
  width: number;   // inches
  height: number;  // inches
  icon: string;
  color: string;
}

/** A placed instance of a piece on the current sheet. */
export interface FurnitureItem {
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

/** A rectangular notch removed from a corner of the room (L/T/U shapes). */
export interface Cutout {
  corner: Corner;
  w: number; // inches, along the room's width
  d: number; // inches, along the room's depth
}

export interface RoomSpec {
  w: number; // inches
  h: number; // inches
  cutouts: Cutout[];
}

export interface SavedLayout {
  name: string;
  items: FurnitureItem[];
  nextId: number;
  roomWidth: number;
  roomHeight: number;
  cutouts?: Cutout[];
  doors?: DoorItem[];
  unit?: DisplayUnit;
}

export interface Rect { x: number; y: number; w: number; h: number }

// ── Units ──

export const UNIT_LABELS: Record<DisplayUnit, string> = { in: 'inches', ft: 'feet', cm: 'cm', m: 'meters' };
export const UNIT_ABBR: Record<DisplayUnit, string> = { in: '"', ft: "'", cm: 'cm', m: 'm' };

export function toBase(val: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'in': return val;
    case 'ft': return val * 12;
    case 'cm': return val / 2.54;
    case 'm': return val * 100 / 2.54;
  }
}

export function fromBase(val: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'in': return val;
    case 'ft': return val / 12;
    case 'cm': return val * 2.54;
    case 'm': return val * 2.54 / 100;
  }
}

export function formatDim(val: number, unit: DisplayUnit): string {
  const converted = fromBase(val, unit);
  if (unit === 'ft') {
    // Feet-and-inches, the way a tape measure reads: 6'3"
    const ft = Math.floor(val / 12);
    const inches = Math.round(val - ft * 12);
    if (inches === 0) return `${ft}'`;
    if (inches === 12) return `${ft + 1}'`;
    return `${ft}'${inches}"`;
  }
  if (unit === 'm') return `${converted.toFixed(2)}m`;
  return `${Math.round(converted)}${UNIT_ABBR[unit]}`;
}

/** Major grid pitch in inches for a display unit. */
export function gridMajorInterval(unit: DisplayUnit): number {
  switch (unit) {
    case 'in': return 12;
    case 'ft': return 12;
    case 'cm': return Math.round(50 / 2.54);  // 50cm
    case 'm': return Math.round(100 / 2.54);  // 1m
  }
}

export const SNAP_INCREMENT = 1; // inches

// ── Geometry ──

export function effectiveDims(item: FurnitureItem): { w: number; h: number } {
  return (item.rotation === 90 || item.rotation === 270)
    ? { w: item.height, h: item.width }
    : { w: item.width, h: item.height };
}

export function itemRect(item: FurnitureItem): Rect {
  const { w, h } = effectiveDims(item);
  return { x: item.x, y: item.y, w, h };
}

export function cutoutRect(c: Cutout, room: RoomSpec): Rect {
  const w = Math.min(c.w, room.w);
  const d = Math.min(c.d, room.h);
  return {
    x: c.corner === 'ne' || c.corner === 'se' ? room.w - w : 0,
    y: c.corner === 'sw' || c.corner === 'se' ? room.h - d : 0,
    w, h: d,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Fully inside the walls: within the bounding rect and clear of every notch. */
export function fitsInRoom(item: FurnitureItem, room: RoomSpec): boolean {
  const r = itemRect(item);
  if (r.x < 0 || r.y < 0 || r.x + r.w > room.w || r.y + r.h > room.h) return false;
  return !room.cutouts.some(c => rectsOverlap(r, cutoutRect(c, room)));
}

/** Floor area in square inches (bounding rect minus notches). */
export function floorArea(room: RoomSpec): number {
  return room.cutouts.reduce((area, c) => {
    const r = cutoutRect(c, room);
    return area - r.w * r.h;
  }, room.w * room.h);
}

/**
 * The wall outline as a clockwise point list (inches), corner notches
 * folded in. Shared by the sheet canvas and the shape-editor preview.
 */
export function wallPolygon(room: RoomSpec): [number, number][] {
  const { w: W, h: H } = room;
  const get = (corner: Corner) => room.cutouts.find(c => c.corner === corner);
  const nw = get('nw'), ne = get('ne'), se = get('se'), sw = get('sw');
  const pts: [number, number][] = [];
  if (nw) pts.push([0, nw.d], [nw.w, nw.d], [nw.w, 0]); else pts.push([0, 0]);
  if (ne) pts.push([W - ne.w, 0], [W - ne.w, ne.d], [W, ne.d]); else pts.push([W, 0]);
  if (se) pts.push([W, H - se.d], [W - se.w, H - se.d], [W - se.w, H]); else pts.push([W, H]);
  if (sw) pts.push([sw.w, H], [sw.w, H - sw.d], [0, H - sw.d]); else pts.push([0, H]);
  return pts;
}

// ── Furniture library (standard sizes, in inches) ──

export interface FurniturePreset {
  label: string;
  width: number;
  height: number;
  icon: string;
  color: string;
}

export const CATEGORY_COLORS: Record<string, string> = {
  'Beds': '#8b5cf6',
  'Seating': '#3b82f6',
  'Tables': '#d97706',
  'Storage': '#10b981',
  'Appliances': '#6366f1',
  'Bathroom': '#0891b2',
};

export const SWATCHES: { name: string; color: string }[] = [
  { name: 'Violet', color: '#8b5cf6' },
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Amber', color: '#d97706' },
  { name: 'Green', color: '#10b981' },
  { name: 'Indigo', color: '#6366f1' },
  { name: 'Cyan', color: '#0891b2' },
  { name: 'Rose', color: '#e11d48' },
  { name: 'Slate', color: '#71717a' },
];

export const PICKER_ICONS = [
  'Square', 'BedDouble', 'Sofa', 'Armchair', 'Table', 'Archive',
  'Tv', 'Monitor', 'Lamp', 'Refrigerator', 'WashingMachine', 'Bath',
] as const;

export const FURNITURE_PRESETS: Record<string, FurniturePreset[]> = {
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

const LAYOUTS_KEY = 'houseplanner-layouts';
const CATALOGUE_KEY = 'houseplanner-catalogue';
const SESSION_KEY = 'houseplanner-session';

export function loadLayouts(): SavedLayout[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(LAYOUTS_KEY);
    if (!data) return [];
    const layouts: SavedLayout[] = JSON.parse(data);
    return layouts.map(l => ({
      ...l,
      unit: l.unit || 'in',
      cutouts: l.cutouts || [],
      items: l.items.map(item => ({
        ...{ rotation: 0 as Rotation, locked: false, icon: 'Square', color: '#71717a' },
        ...item,
      })),
    }));
  } catch { return []; }
}

export function persistLayouts(layouts: SavedLayout[]) {
  localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
}

export interface CatalogueStore { items: CatalogueItem[]; nextId: number }

export function loadCatalogue(): CatalogueStore {
  if (typeof window === 'undefined') return { items: [], nextId: 1 };
  try {
    const data = localStorage.getItem(CATALOGUE_KEY);
    if (!data) return { items: [], nextId: 1 };
    return JSON.parse(data);
  } catch { return { items: [], nextId: 1 }; }
}

export function persistCatalogue(store: CatalogueStore) {
  localStorage.setItem(CATALOGUE_KEY, JSON.stringify(store));
}

/** The working sheet, autosaved so a refresh never loses the plan. */
export interface SessionState {
  items: FurnitureItem[];
  doors: DoorItem[];
  nextId: number;
  room: RoomSpec;
  unit: DisplayUnit;
}

export function loadSession(): SessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const data = localStorage.getItem(SESSION_KEY);
    if (!data) return null;
    const s = JSON.parse(data);
    if (!s?.room?.w || !s?.room?.h) return null;
    return { doors: [], ...s, room: { cutouts: [], ...s.room } };
  } catch { return null; }
}

export function persistSession(s: SessionState) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

// ── Doors ──

export type Wall = 'n' | 'e' | 's' | 'w';

export const WALL_NAMES: Record<Wall, string> = {
  n: 'north', e: 'east', s: 'south', w: 'west',
};

/** A door in a wall: position along the wall, leaf width, hinge end. */
export interface DoorItem {
  id: number;
  wall: Wall;
  pos: number;   // inches from the wall's start corner (NW for n/w walls)
  width: number; // leaf width, inches
  hinge: 'start' | 'end';
}

export function wallLength(room: RoomSpec, wall: Wall): number {
  return wall === 'n' || wall === 's' ? room.w : room.h;
}

export interface DoorGeom {
  hx: number; hy: number;   // hinge (arc centre)
  sx: number; sy: number;   // strike jamb
  lx: number; ly: number;   // leaf tip, drawn open 90°
  quarter: Rect;            // bounding square of the swing quarter-disc
}

/** Door geometry in room inches. The swing is always into the room. */
export function doorGeom(door: DoorItem, room: RoomSpec): DoorGeom {
  const len = wallLength(room, door.wall);
  const pos = Math.max(0, Math.min(len - door.width, door.pos));
  let start: [number, number], dir: [number, number], inward: [number, number];
  switch (door.wall) {
    case 'n': start = [0, 0]; dir = [1, 0]; inward = [0, 1]; break;
    case 's': start = [0, room.h]; dir = [1, 0]; inward = [0, -1]; break;
    case 'w': start = [0, 0]; dir = [0, 1]; inward = [1, 0]; break;
    case 'e': start = [room.w, 0]; dir = [0, 1]; inward = [-1, 0]; break;
  }
  const j1: [number, number] = [start[0] + dir[0] * pos, start[1] + dir[1] * pos];
  const j2: [number, number] = [start[0] + dir[0] * (pos + door.width), start[1] + dir[1] * (pos + door.width)];
  const [hx, hy] = door.hinge === 'start' ? j1 : j2;
  const [sx, sy] = door.hinge === 'start' ? j2 : j1;
  const lx = hx + inward[0] * door.width;
  const ly = hy + inward[1] * door.width;
  const xs = [j1[0], j2[0], j1[0] + inward[0] * door.width, j2[0] + inward[0] * door.width];
  const ys = [j1[1], j2[1], j1[1] + inward[1] * door.width, j2[1] + inward[1] * door.width];
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return {
    hx, hy, sx, sy, lx, ly,
    quarter: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
  };
}

/** Is the doorway actually in a wall with floor behind it (not a notch)? */
export function doorOnFloor(door: DoorItem, room: RoomSpec): boolean {
  const len = wallLength(room, door.wall);
  if (door.pos < -0.001 || door.pos + door.width > len + 0.001) return false;
  const g = doorGeom(door, room);
  // A thin strip just inside the wall across the doorway span.
  const q = g.quarter;
  let strip: Rect;
  switch (door.wall) {
    case 'n': strip = { x: q.x, y: 0, w: door.width, h: 0.5 }; break;
    case 's': strip = { x: q.x, y: room.h - 0.5, w: door.width, h: 0.5 }; break;
    case 'w': strip = { x: 0, y: q.y, w: 0.5, h: door.width }; break;
    case 'e': strip = { x: room.w - 0.5, y: q.y, w: 0.5, h: door.width }; break;
  }
  return !room.cutouts.some(c => rectsOverlap(strip, cutoutRect(c, room)));
}

/** Does a rectangle intrude into the door's swing quarter-disc? */
export function rectInSwing(r: Rect, door: DoorItem, room: RoomSpec): boolean {
  const g = doorGeom(door, room);
  const q = g.quarter;
  const ix = Math.max(r.x, q.x), iy = Math.max(r.y, q.y);
  const ax = Math.min(r.x + r.w, q.x + q.w), ay = Math.min(r.y + r.h, q.y + q.h);
  if (ix >= ax || iy >= ay) return false;
  // Closest point of the clipped rect to the hinge.
  const cx = Math.max(ix, Math.min(g.hx, ax));
  const cy = Math.max(iy, Math.min(g.hy, ay));
  return (cx - g.hx) ** 2 + (cy - g.hy) ** 2 < door.width ** 2;
}
