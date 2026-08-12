/**
 * Turn one chunk of palette indices into renderable geometry.
 *
 * Pure functions over typed arrays, with no three.js and no DOM, so this runs
 * unchanged on the main thread or inside the worker that normally drives it.
 *
 * The MVP renders every block as a full cube — stairs, slabs, fences and doors
 * included — which is chunky but readable, and keeps the whole mesher to face
 * culling plus atlas lookups. Real model geometry is a later phase.
 */

/** Face order is fixed by the atlas extractor; blocks.json depends on it. */
export const DIRECTIONS = ['down', 'up', 'north', 'south', 'west', 'east'] as const;

/**
 * Per-face brightness, the same trick Minecraft uses. Without it a textured
 * voxel scene reads as flat — every cube face lit identically gives no edge
 * definition at all, and the village turns into a single beige mass.
 */
const SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

/**
 * Fixed plains grass tint for `tintindex` faces. Grass, leaves and water take
 * their colour from biome colormaps rather than the texture, so untinted grass
 * renders a flat grey. Sampling the real colormaps is a later phase.
 */
const PLAINS_TINT = [0x91 / 255, 0xbd / 255, 0x59 / 255];

/** Corner offsets and UV order per face, wound counter-clockwise seen from outside. */
const FACES: { corners: [number, number, number][] }[] = [
  { corners: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] }, // down
  { corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }, // up
  { corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // north (-Z)
  { corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // south (+Z)
  { corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }, // west (-X)
  { corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // east (+X)
];

const UV_CORNERS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

export interface AtlasData {
  atlas: { file: string; width: number; height: number; tile: number; pad: number };
  directions: string[];
  textures: string[];
  /** Pixel rects into atlas.png, parallel to `textures`: [x, y, w, h]. */
  uvs: [number, number, number, number][];
  /** [textureIndices[6], tintFlags[6], occludes] — atlas version 2. */
  facesets: [number[], number[], number][];
  blocks: Record<string, { variants: { when: Record<string, string>; set: number }[] }>;
}

export interface PaletteEntry {
  block: string;
  properties?: Record<string, string>;
  materials?: Record<string, string>;
}

export interface ChunkPayload {
  x: number;
  z: number;
  minY: number;
  height: number;
  palette: PaletteEntry[];
  /** Little-endian uint16, indexed ((y - minY) * 16 + z) * 16 + x. */
  indices: Uint16Array;
}

export interface MeshResult {
  x: number;
  z: number;
  position: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  quads: number;
}

/**
 * Resolve one palette entry to its six face texture indices and tint flags.
 *
 * **Materials win over the block's own atlas entry.** Domum Ornamentum blocks
 * carry no real texture — they are baked client-side from component materials
 * chosen at placement — but they *do* ship placeholder models, so looking the
 * block up directly always succeeds and quietly returns the default skin. That
 * is how every domum block in the colony ended up wearing oak planks regardless
 * of what it was actually built from. If the mod resolved materials for this
 * block, those materials are the answer.
 *
 * First slot only: colonies dress a given block in one material overwhelmingly
 * often, and the MVP's cubes cannot show a per-slot split anyway.
 */
export function resolveEntry(
  atlas: AtlasData,
  entry: PaletteEntry,
): { tex: number[]; tint: number[]; occludes: boolean } | null {
  for (const material of entry.materials ? Object.values(entry.materials) : []) {
    const viaMaterial = lookup(atlas, material, {});
    if (viaMaterial) {
      return viaMaterial;
    }
  }
  return lookup(atlas, entry.block, entry.properties ?? {});
}

function lookup(atlas: AtlasData, block: string, properties: Record<string, string>) {
  const record = atlas.blocks[block];
  if (!record) {
    return null;
  }
  for (const variant of record.variants) {
    let matches = true;
    for (const key of Object.keys(variant.when)) {
      if (properties[key] !== variant.when[key]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      const [tex, tint, occludes] = atlas.facesets[variant.set];
      return { tex, tint, occludes: occludes === 1 };
    }
  }
  // A block whose variants are all keyed on properties we were not given — a log
  // referenced as a domum material, say. Any variant is a better answer than a hole.
  const [tex, tint, occludes] = atlas.facesets[record.variants[0].set];
  return { tex, tint, occludes: occludes === 1 };
}

/**
 * Mesh a chunk: emit every face whose neighbour does not fully occlude it.
 *
 * Neighbours outside this chunk count as air. That over-draws the shell where
 * two chunks meet, but those faces sit buried inside solid terrain and are
 * invisible from outside; the alternative is threading six neighbours into every
 * worker task to save triangles nobody can see.
 */
export function meshChunk(atlas: AtlasData, chunk: ChunkPayload): MeshResult {
  const { indices, height, minY, palette } = chunk;

  // Resolve the palette once per chunk rather than once per block face.
  const resolved = palette.map((entry, i) =>
    i === 0 || entry.block === 'minecraft:air' ? null : resolveEntry(atlas, entry),
  );
  // A neighbour only hides a face if it actually fills its cube with opaque
  // texels. Crops, torches, slabs, fences, glass and leaves do not, so the face
  // behind them still has to be drawn — otherwise alpha testing punches the
  // sprite out and you see through the hole into nothing.
  const occludes = resolved.map((r) => r?.occludes === true);

  const position: number[] = [];
  const uv: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const { width, height: atlasHeight } = atlas.atlas;

  const at = (x: number, y: number, z: number): number => {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y >= height) {
      return 0;
    }
    return indices[(y * 16 + z) * 16 + x];
  };

  const originX = chunk.x * 16;
  const originZ = chunk.z * 16;
  let quads = 0;

  for (let y = 0; y < height; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const id = indices[(y * 16 + z) * 16 + x];
        if (id === 0) {
          continue;
        }
        const faces = resolved[id];
        if (!faces) {
          continue;
        }
        for (let f = 0; f < 6; f++) {
          const nx = x + (f === 4 ? -1 : f === 5 ? 1 : 0);
          const ny = y + (f === 0 ? -1 : f === 1 ? 1 : 0);
          const nz = z + (f === 2 ? -1 : f === 3 ? 1 : 0);
          const neighbour = at(nx, ny, nz);
          // Cull against an opaque neighbour, or against an identical one. The
          // second rule is what stops a lake drawing every internal water face:
          // the palette index encodes block state and materials, so matching
          // indices really are the same block, and the shared face is never
          // visible from either side.
          if (neighbour === id || occludes[neighbour]) {
            continue;
          }

          const rect = atlas.uvs[faces.tex[f]];
          const shade = SHADE[f];
          const tinted = faces.tint[f] === 1;
          const r = shade * (tinted ? PLAINS_TINT[0] : 1);
          const g = shade * (tinted ? PLAINS_TINT[1] : 1);
          const b = shade * (tinted ? PLAINS_TINT[2] : 1);

          const base = position.length / 3;
          for (let c = 0; c < 4; c++) {
            const [cx, cy, cz] = FACES[f].corners[c];
            position.push(originX + x + cx, minY + y + cy, originZ + z + cz);
            const [u, v] = UV_CORNERS[c];
            // Atlas rects are in pixels; v is flipped because image space runs
            // top-down and texture space runs bottom-up.
            uv.push(
              (rect[0] + u * rect[2]) / width,
              1 - (rect[1] + (1 - v) * rect[3]) / atlasHeight,
            );
            color.push(r, g, b);
          }
          index.push(base, base + 1, base + 2, base, base + 2, base + 3);
          quads++;
        }
      }
    }
  }

  return {
    x: chunk.x,
    z: chunk.z,
    position: new Float32Array(position),
    uv: new Float32Array(uv),
    color: new Float32Array(color),
    index: new Uint32Array(index),
    quads,
  };
}

/** Decode the base64 uint16 payload the mod sends. */
export function decodeChunkData(base64: string): Uint16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}
