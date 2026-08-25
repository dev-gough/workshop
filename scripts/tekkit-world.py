#!/usr/bin/env python3
"""Read Tekkit Classic (Anvil 1.2.5) region files: chests, other inventories, overhead map."""
from __future__ import annotations

import gzip
import json
import struct
import sys
import zlib
from pathlib import Path

WORLD = Path('/home/server/tekkit/world')
PLAYER = WORLD / 'players' / 'Devy_10.dat'
OUT_MAP = Path('/tmp/workshop-ui-shots/tekkit-map.png')

# --- NBT ---
class NBT:
    def __init__(self, buf: bytes):
        self.b = buf
        self.i = 0
    def _need(self, n):
        if self.i + n > len(self.b):
            raise EOFError(f'need {n} at {self.i}/{len(self.b)}')
    def u8(self):
        self._need(1)
        v = self.b[self.i]; self.i += 1; return v
    def i8(self):
        self._need(1)
        v = struct.unpack('>b', self.b[self.i:self.i+1])[0]; self.i += 1; return v
    def i16(self):
        self._need(2)
        v, = struct.unpack('>h', self.b[self.i:self.i+2]); self.i += 2; return v
    def i32(self):
        self._need(4)
        v, = struct.unpack('>i', self.b[self.i:self.i+4]); self.i += 4; return v
    def i64(self):
        self._need(8)
        v, = struct.unpack('>q', self.b[self.i:self.i+8]); self.i += 8; return v
    def f32(self):
        self._need(4)
        v, = struct.unpack('>f', self.b[self.i:self.i+4]); self.i += 4; return v
    def f64(self):
        self._need(8)
        v, = struct.unpack('>d', self.b[self.i:self.i+8]); self.i += 8; return v
    def strn(self):
        n = self.i16()
        if n < 0: n = 0
        self._need(n)
        s = self.b[self.i:self.i+n].decode('utf-8', 'replace'); self.i += n
        return s
    def payload(self, t):
        if t == 1: return self.i8()
        if t == 2: return self.i16()
        if t == 3: return self.i32()
        if t == 4: return self.i64()
        if t == 5: return self.f32()
        if t == 6: return self.f64()
        if t == 7:
            n = self.i32()
            if n < 0: n = 0
            self._need(n)
            d = self.b[self.i:self.i+n]; self.i += n
            return d
        if t == 8: return self.strn()
        if t == 9:
            lt = self.u8(); n = self.i32()
            if n < 0: n = 0
            return [self.payload(lt) for _ in range(n)]
        if t == 10: return self.compound()
        if t == 11:
            n = self.i32()
            if n < 0: n = 0
            self._need(4 * n)
            out = [self.i32() for _ in range(n)]
            return out
        raise ValueError(f'tag {t} at {self.i}')
    def compound(self):
        d = {}
        while True:
            t = self.u8()
            if t == 0: break
            name = self.strn()
            d[name] = self.payload(t)
        return d
    def root(self):
        t = self.u8(); self.strn()
        return self.payload(t)

def load_gzip_nbt(path: Path):
    raw = path.read_bytes()
    return NBT(gzip.decompress(raw)).root()

NAMES = {
    1:'Stone',2:'Grass',3:'Dirt',4:'Cobble',5:'Planks',6:'Sapling',7:'Bedrock',
    8:'Water',9:'Water',12:'Sand',13:'Gravel',14:'Gold Ore',15:'Iron Ore',16:'Coal Ore',
    17:'Wood',18:'Leaves',20:'Glass',21:'Lapis Ore',35:'Wool',37:'Dandelion',38:'Rose',
    49:'Obsidian',50:'Torch',54:'Chest',56:'Diamond Ore',58:'Crafting Table',61:'Furnace',
    73:'Redstone Ore',81:'Cactus',87:'Netherrack',88:'Soul Sand',89:'Glowstone',
    256:'Iron Shovel',257:'Iron Pick',258:'Iron Axe',259:'Flint&Steel',260:'Apple',
    262:'Arrow',263:'Coal',264:'Diamond',265:'Iron Ingot',266:'Gold Ingot',
    267:'Iron Sword',268:'Wood Sword',269:'Wood Shovel',270:'Wood Pick',271:'Wood Axe',
    272:'Stone Sword',273:'Stone Shovel',274:'Stone Pick',275:'Stone Axe',
    276:'Diamond Sword',277:'Diamond Shovel',278:'Diamond Pick',279:'Diamond Axe',
    280:'Stick',297:'Bread',318:'Flint',319:'Raw Pork',320:'Cooked Pork',
    325:'Bucket',326:'Water Bucket',327:'Lava Bucket',331:'Redstone',344:'Egg',
    345:'Compass',347:'Clock',348:'Glowstone Dust',364:'Steak',
    27270:"Philosopher's Stone",27285:'Dark Matter',29960:'Rubber',29961:'Resin',
    29992:'Copper',29991:'Tin',29956:'Treetap',
}

def item_name(iid, dmg):
    if iid == 17: return ['Oak','Spruce','Birch','Jungle'][dmg & 3] + ' Wood' if dmg & 3 < 4 else 'Wood'
    if iid == 263: return 'Charcoal' if dmg == 1 else 'Coal'
    if iid == 6: return ['Oak','Spruce','Birch','Jungle'][dmg & 3] + ' Sapling' if dmg & 3 < 4 else 'Sapling'
    base = NAMES.get(iid, f'id {iid}')
    return f'{base}:{dmg}' if dmg and iid not in (17, 263, 6) else base

PALETTE = {
    0:(0,0,0), 1:(128,128,128), 2:(90,160,70), 3:(134,96,67), 4:(100,100,100),
    5:(157,128,79), 8:(40,70,180), 9:(40,70,180), 10:(200,80,20), 11:(200,80,20),
    12:(210,190,130), 13:(120,110,105), 14:(250,210,80), 15:(200,160,140),
    16:(50,50,50), 17:(100,70,40), 18:(50,120,40), 20:(160,200,220),
    24:(210,190,140), 31:(70,140,50), 35:(220,220,220), 49:(20,15,30),
    50:(255,200,80), 54:(150,90,30), 56:(80,220,220), 61:(90,90,90),
    62:(180,90,30), 73:(160,20,20), 78:(240,240,250), 79:(140,180,220),
    80:(245,245,255), 81:(20,140,30), 82:(150,150,160), 87:(90,30,30),
    88:(70,55,45), 89:(255,220,120),
}

def parse_mca(path: Path):
    data = path.read_bytes()
    chunks = []
    for idx in range(1024):
        loc = struct.unpack('>I', data[idx*4:idx*4+4])[0]
        if loc == 0: continue
        off = (loc >> 8) * 4096
        if off + 5 > len(data): continue
        length = struct.unpack('>I', data[off:off+4])[0]
        comp = data[off+4]
        payload = data[off+5:off+4+length]
        try:
            if comp == 1: raw = zlib.decompress(payload, 16 + zlib.MAX_WBITS)
            elif comp == 2: raw = zlib.decompress(payload)
            else: continue
            nbt = NBT(raw).root()
        except Exception as e:
            if not hasattr(parse_mca, '_err'):
                parse_mca._err = True
                print(f'chunk skip {path.name} idx={idx}: {type(e).__name__}: {e}', file=sys.stderr)
            continue
        level = nbt.get('Level', nbt) if isinstance(nbt, dict) else None
        if isinstance(level, dict):
            chunks.append(level)
    return chunks

def top_block(level, lx, lz):
    """Highest non-air block at local x,z in a chunk. Returns (y, id) or None."""
    sections = level.get('Sections') or []
    by_y = {}
    for sec in sections:
        if not isinstance(sec, dict): continue
        by_y[int(sec.get('Y', 0))] = sec
    if by_y:
        for sy in range(7, -1, -1):
            sec = by_y.get(sy)
            if not sec: continue
            blocks = sec.get('Blocks')
            if not blocks: continue
            base = sy * 16
            for y in range(15, -1, -1):
                # Anvil: y<<8 | z<<4 | x
                i = (y << 8) | (lz << 4) | lx
                bid = blocks[i] if isinstance(blocks, (bytes, bytearray)) else (blocks[i] if i < len(blocks) else 0)
                if isinstance(bid, int) and bid < 0: bid += 256
                if bid:
                    return base + y, bid
        return None
    # Legacy 128-high Blocks array
    blocks = level.get('Blocks')
    if not blocks: return None
    for y in range(127, -1, -1):
        i = y + lz * 128 + lx * 128 * 16
        bid = blocks[i]
        if isinstance(bid, int) and bid < 0: bid += 256
        if bid:
            return y, bid
    return None

def fmt_items(items):
    if not items: return []
    out = []
    for it in items:
        if not isinstance(it, dict): continue
        iid = int(it.get('id') or 0)
        dmg = int(it.get('Damage') or 0)
        cnt = int(it.get('Count') or 1)
        slot = int(it.get('Slot') or 0)
        out.append({'slot': slot, 'count': cnt, 'name': item_name(iid, dmg), 'id': iid, 'dmg': dmg})
    out.sort(key=lambda x: x['slot'])
    return out

def player_pos(player_file: Path | None = None):
    path = player_file or PLAYER
    if not path.exists():
        return None
    try:
        d = load_gzip_nbt(path)
    except Exception as e:
        print(f'player.dat parse failed ({e}); using origin', file=sys.stderr)
        return None
    pos = d.get('Pos') or [0, 0, 0]
    return float(pos[0]), float(pos[1]), float(pos[2]), int(d.get('Dimension') or 0)

def collect_inventories(need_heights=True):
    inventories = []
    tiles = 0
    heights = {}
    for mca in sorted((WORLD / 'region').glob('*.mca')):
        for level in parse_mca(mca):
            if need_heights:
                cx = int(level.get('xPos') or 0)
                cz = int(level.get('zPos') or 0)
                for lx in range(16):
                    for lz in range(16):
                        tb = top_block(level, lx, lz)
                        if tb:
                            heights[(cx * 16 + lx, cz * 16 + lz)] = tb
            for te in level.get('TileEntities') or []:
                if not isinstance(te, dict): continue
                tiles += 1
                tid = str(te.get('id') or '?')
                x, y, z = int(te.get('x') or 0), int(te.get('y') or 0), int(te.get('z') or 0)
                items = fmt_items(te.get('Items') or [])
                extra = {k: te[k] for k in ('facing', 'BurnTime', 'CookTime', 'progress') if k in te}
                if items or tid.lower() in {'chest', 'furnace', 'trap', 'ironchest', 'goldchest',
                                            'diamondchest', 'copperchest', 'silverchest', 'crystalchest'}:
                    inventories.append({'id': tid, 'x': x, 'y': y, 'z': z, 'items': items, 'extra': extra})
    return inventories, tiles, heights

def dump_json(player_name: str, radius: int):
    player_file = WORLD / 'players' / f'{player_name}.dat'
    px, py, pz, dim = player_pos(player_file) or (0, 64, 0, 0)
    inventories, tiles, _heights = collect_inventories(need_heights=False)
    nearby = []
    for inv in inventories:
        dist = ((inv['x'] - px) ** 2 + (inv['y'] - py) ** 2 + (inv['z'] - pz) ** 2) ** 0.5
        if dist > radius:
            continue
        nearby.append({
            'id': inv['id'], 'x': inv['x'], 'y': inv['y'], 'z': inv['z'],
            'dist': round(dist, 1), 'items': inv['items'],
        })
    nearby.sort(key=lambda i: i['dist'])
    json.dump({
        'player': {'name': player_name, 'x': px, 'y': py, 'z': pz, 'dim': dim},
        'tilesScanned': tiles,
        'nearby': nearby[:16],
    }, sys.stdout, separators=(',', ':'))
    sys.stdout.write('\n')

def main():
    from PIL import Image, ImageDraw

    px, py, pz, dim = player_pos() or (0, 64, 0, 0)
    inventories, tiles, heights = collect_inventories()

    radius = 96
    x0, z0 = int(px) - radius, int(pz) - radius
    size = radius * 2
    scale = 4
    img = Image.new('RGB', (size * scale, size * scale), (12, 14, 18))
    px_ = img.load()
    for dz in range(size):
        for dx in range(size):
            wx, wz = x0 + dx, z0 + dz
            cell = heights.get((wx, wz))
            if not cell:
                color = (12, 14, 18)
            else:
                y, bid = cell
                color = PALETTE.get(bid, (90, 90, 100))
                # darken deep, lighten high
                shade = max(0.55, min(1.25, 0.45 + y / 96))
                color = tuple(min(255, int(c * shade)) for c in color)
            for oy in range(scale):
                for ox in range(scale):
                    px_[dx * scale + ox, dz * scale + oy] = color

    draw = ImageDraw.Draw(img)
    for inv in inventories:
        if not (x0 <= inv['x'] < x0 + size and z0 <= inv['z'] < z0 + size):
            continue
        sx = (inv['x'] - x0) * scale
        sz = (inv['z'] - z0) * scale
        draw.rectangle([sx, sz, sx + scale - 1, sz + scale - 1], outline=(240, 180, 40))

    sx = int(px) - x0
    sz = int(pz) - z0
    if 0 <= sx < size and 0 <= sz < size:
        cx, cy = sx * scale + scale // 2, sz * scale + scale // 2
        draw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], outline=(255, 60, 160), width=2)
        draw.line([(cx, cy), (cx + 8, cy + 4)], fill=(255, 60, 160), width=2)

    OUT_MAP.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT_MAP)

    print(f'player  {px:.1f} {py:.1f} {pz:.1f}  dim={dim}')
    print(f'chunks  {len(heights)} columns   tile-entities scanned={tiles}')
    print(f'map     {OUT_MAP}  {size}x{size} blocks around you, gold = inventories, pink = you')
    print(f'inventories with items: {sum(1 for i in inventories if i["items"])} / {len(inventories)}')
    print()
    if not inventories:
        print('No chests/furnaces on disk yet (place one, wait for the next save).')
        return
    for inv in sorted(inventories, key=lambda i: (i['x']-px)**2 + (i['z']-pz)**2):
        dist = ((inv['x']-px)**2 + (inv['y']-py)**2 + (inv['z']-pz)**2) ** 0.5
        print(f'{inv["id"]:16}  {inv["x"]:4},{inv["y"]:3},{inv["z"]:4}  {dist:5.1f}m')
        if not inv['items']:
            print('    (empty)')
            continue
        for it in inv['items']:
            print(f'    slot {it["slot"]:2}  {it["count"]:3}x  {it["name"]}')

if __name__ == '__main__':
    if '--json' in sys.argv:
        args = sys.argv[1:]
        player = 'Devy_10'
        radius = 48
        if '--player' in args:
            player = args[args.index('--player') + 1]
        if '--radius' in args:
            radius = int(args[args.index('--radius') + 1])
        dump_json(player, radius)
    else:
        main()
