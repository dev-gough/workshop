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

/**
 * Find the closest whole-inch position where a piece fits without colliding
 * with another piece or a usable door swing. Stable tie-breaking keeps the
 * result predictable for undo/redo and repeated clicks.
 */
export function findNearestFreePosition(
  item: FurnitureItem,
  items: FurnitureItem[],
  room: RoomSpec,
  doors: DoorItem[] = [],
): { x: number; y: number } | null {
  const { w, h } = effectiveDims(item);
  const maxX = Math.floor(room.w - w);
  const maxY = Math.floor(room.h - h);
  if (maxX < 0 || maxY < 0) return null;

  const others = items.filter(other => other.id !== item.id).map(itemRect);
  let best: { x: number; y: number; distance: number } | null = null;

  for (let y = 0; y <= maxY; y += SNAP_INCREMENT) {
    for (let x = 0; x <= maxX; x += SNAP_INCREMENT) {
      const candidate = { ...item, x, y };
      const rect = itemRect(candidate);
      if (!fitsInRoom(candidate, room)) continue;
      if (others.some(other => rectsOverlap(rect, other))) continue;
      if (doors.some(door => doorOnFloor(door, room) && rectInSwing(rect, door, room))) continue;

      const distance = (x - item.x) ** 2 + (y - item.y) ** 2;
      if (!best || distance < best.distance) best = { x, y, distance };
    }
  }

  return best ? { x: best.x, y: best.y } : null;
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

/**
 * A door hangs in a wall frame: one of the four bounding walls, or — when
 * `face` names a corner notch — one of the two interior faces that notch
 * creates (a closet wall). `wall` gives the face's orientation; `pos` is
 * measured along the same axis as the matching bounding wall.
 */
export interface DoorItem {
  id: number;
  wall: Wall;
  face?: Corner; // set → the door is on that notch's face parallel to `wall`
  pos: number;   // inches along the wall axis (x for n/s, y for w/e)
  width: number; // leaf width, inches
  hinge: 'start' | 'end';
}

export function wallLength(room: RoomSpec, wall: Wall): number {
  return wall === 'n' || wall === 's' ? room.w : room.h;
}

/** The stretch of a bounding wall that is real wall — corner notches removed. */
export function wallFreeSpan(room: RoomSpec, wall: Wall): [number, number] {
  const get = (c: Corner) => room.cutouts.find(x => x.corner === c);
  const nw = get('nw'), ne = get('ne'), sw = get('sw'), se = get('se');
  switch (wall) {
    case 'n': return [nw?.w ?? 0, room.w - (ne?.w ?? 0)];
    case 's': return [sw?.w ?? 0, room.w - (se?.w ?? 0)];
    case 'w': return [nw?.d ?? 0, room.h - (sw?.d ?? 0)];
    case 'e': return [ne?.d ?? 0, room.h - (se?.d ?? 0)];
  }
}

/** A straight run of wall a door can hang in. */
export interface WallFrame {
  horizontal: boolean;      // runs along x (n/s style) or y (w/e style)
  line: number;             // the wall line: y if horizontal, else x
  inwardSign: 1 | -1;       // which side of the line is floor
  span: [number, number];   // real wall extent along the wall axis
}

/** Resolve a door location to its frame; null if the named face is gone. */
export function wallFrame(room: RoomSpec, wall: Wall, face?: Corner): WallFrame | null {
  const horizontal = wall === 'n' || wall === 's';
  if (!face) {
    const line = wall === 'n' ? 0 : wall === 's' ? room.h : wall === 'w' ? 0 : room.w;
    const inwardSign = wall === 'n' || wall === 'w' ? 1 : -1;
    return { horizontal, line, inwardSign, span: wallFreeSpan(room, wall) };
  }
  const c = room.cutouts.find(x => x.corner === face);
  if (!c) return null;
  const r = cutoutRect(c, room);
  switch (wall) {
    case 'n': return face === 'nw' || face === 'ne'
      ? { horizontal: true, line: r.y + r.h, inwardSign: 1, span: [r.x, r.x + r.w] } : null;
    case 's': return face === 'sw' || face === 'se'
      ? { horizontal: true, line: r.y, inwardSign: -1, span: [r.x, r.x + r.w] } : null;
    case 'w': return face === 'nw' || face === 'sw'
      ? { horizontal: false, line: r.x + r.w, inwardSign: 1, span: [r.y, r.y + r.h] } : null;
    case 'e': return face === 'ne' || face === 'se'
      ? { horizontal: false, line: r.x, inwardSign: -1, span: [r.y, r.y + r.h] } : null;
  }
}

/** Every frame a door could hang in for this room shape. */
export function allWallFrames(room: RoomSpec): { wall: Wall; face?: Corner }[] {
  const out: { wall: Wall; face?: Corner }[] = [
    { wall: 'n' }, { wall: 's' }, { wall: 'w' }, { wall: 'e' },
  ];
  for (const c of room.cutouts) {
    const [w1, w2]: [Wall, Wall] =
      c.corner === 'nw' ? ['n', 'w'] : c.corner === 'ne' ? ['n', 'e']
      : c.corner === 'sw' ? ['s', 'w'] : ['s', 'e'];
    out.push({ wall: w1, face: c.corner }, { wall: w2, face: c.corner });
  }
  return out;
}

export interface DoorGeom {
  hx: number; hy: number;   // hinge (arc centre)
  sx: number; sy: number;   // strike jamb
  lx: number; ly: number;   // leaf tip, drawn open 90°
  quarter: Rect;            // bounding square of the swing quarter-disc
}

/** Door geometry in room inches. The swing is always toward the floor side. */
export function doorGeom(door: DoorItem, room: RoomSpec): DoorGeom {
  const frame = wallFrame(room, door.wall, door.face) ?? wallFrame(room, door.wall)!;
  const [a, b] = frame.span;
  const pos = Math.max(a, Math.min(Math.max(a, b - door.width), door.pos));
  const pt = (along: number, out: number): [number, number] => frame.horizontal
    ? [along, frame.line + out * frame.inwardSign]
    : [frame.line + out * frame.inwardSign, along];
  const j1 = pt(pos, 0);
  const j2 = pt(pos + door.width, 0);
  const hingeAlong = door.hinge === 'start' ? pos : pos + door.width;
  const [hx, hy] = door.hinge === 'start' ? j1 : j2;
  const [sx, sy] = door.hinge === 'start' ? j2 : j1;
  const [lx, ly] = pt(hingeAlong, door.width);
  const corners = [j1, j2, pt(pos, door.width), pt(pos + door.width, door.width)];
  const minX = Math.min(...corners.map(p => p[0]));
  const minY = Math.min(...corners.map(p => p[1]));
  return {
    hx, hy, sx, sy, lx, ly,
    quarter: {
      x: minX, y: minY,
      w: Math.max(...corners.map(p => p[0])) - minX,
      h: Math.max(...corners.map(p => p[1])) - minY,
    },
  };
}

/** Is the doorway in real wall, with floor on its swing side? */
export function doorOnFloor(door: DoorItem, room: RoomSpec): boolean {
  const frame = wallFrame(room, door.wall, door.face);
  if (!frame) return false;
  const [a, b] = frame.span;
  if (door.pos < a - 0.001 || door.pos + door.width > b + 0.001) return false;
  // A thin strip just inside the wall across the doorway span.
  const lo = frame.inwardSign === 1 ? frame.line : frame.line - 0.5;
  const strip: Rect = frame.horizontal
    ? { x: door.pos, y: lo, w: door.width, h: 0.5 }
    : { x: lo, y: door.pos, w: 0.5, h: door.width };
  if (strip.x < -0.001 || strip.y < -0.001
    || strip.x + strip.w > room.w + 0.001 || strip.y + strip.h > room.h + 0.001) return false;
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

/** Clamp a door into its frame's span — snaps to the nearest vertex. */
export function clampDoorPos(room: RoomSpec, wall: Wall, width: number, pos: number, face?: Corner): number {
  const frame = wallFrame(room, wall, face);
  if (!frame) return Math.round(pos);
  const [a, b] = frame.span;
  return Math.round(Math.max(a, Math.min(Math.max(a, b - width), pos)));
}

/**
 * Re-seat every door after a shape change: doors on a face that no longer
 * exists fall back to the matching bounding wall; everything clamps into
 * its span; exact duplicates (stacked twins) collapse to one.
 */
export function tidyDoors(doors: DoorItem[], room: RoomSpec): DoorItem[] {
  const seen = new Set<string>();
  const out: DoorItem[] = [];
  for (let d of doors) {
    if (d.face && !wallFrame(room, d.wall, d.face)) d = { ...d, face: undefined };
    const pos = clampDoorPos(room, d.wall, d.width, d.pos, d.face);
    if (pos !== d.pos) d = { ...d, pos };
    const key = `${d.wall}:${d.face ?? '-'}:${d.pos}:${d.width}:${d.hinge}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
