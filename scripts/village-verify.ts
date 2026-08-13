/**
 * Geometry regression suite for the village viewer. Run after any change to the
 * mesher, the atlas extractor, or the mod's chunk format:
 *
 *   npm run village-verify [-- --base http://127.0.0.1:3000] [-- --chunks 12]
 *
 * The renderer can only be judged by eye. This checks everything that cannot:
 * that chunks decode to the length they claim, that the mesher emits
 * self-consistent buffers, that no vertex escapes its own chunk, that every UV
 * lands inside the atlas, and that every palette entry in the whole region
 * resolves to six faces.
 *
 * That last check is the one that earns its keep. Domum Ornamentum blocks are
 * about a third of every building and resolve through a completely different
 * path from vanilla ones — a regression there is invisible in a screenshot of
 * anywhere you did not happen to be standing.
 *
 * Needs the workshop running and the mod reachable behind it; the atlas is read
 * straight off disk.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  decodeChunkData,
  meshChunk,
  resolveEntry,
  type AtlasData,
  type PaletteEntry,
} from '../src/app/projects/village/mesher';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const base = arg('--base') ?? 'http://127.0.0.1:3000';
const sampleSize = Number(arg('--chunks') ?? 12);

const atlasPath = path.join(process.cwd(), 'public/village/blocks.json');
let atlas: AtlasData;
try {
  atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as AtlasData;
} catch {
  console.error(
    `no atlas at ${atlasPath} — run tools/village_atlas.py in the MineColonies fork.\n` +
      'It is gitignored (derived from All-Rights-Reserved assets), so a fresh checkout has none.',
  );
  process.exit(1);
}

interface ChunkBody {
  x: number;
  z: number;
  minY: number;
  maxY: number;
  height: number;
  palette: PaletteEntry[];
  data: string;
}

const problems: string[] = [];
const fail = (message: string) => problems.push(message);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `${url} returned ${res.status}`);
  }
  return body;
}

async function main() {
  const manifest = await getJson<{ chunks: { x: number; z: number }[]; chunkCount: number }>(
    `${base}/api/village/world`,
  );

  let quads = 0;
  let vertices = 0;
  let uvMin = Infinity;
  let uvMax = -Infinity;

  for (const ref of manifest.chunks.slice(0, sampleSize)) {
    const at = `${ref.x},${ref.z}`;
    const body = await getJson<ChunkBody>(`${base}/api/village/chunk?x=${ref.x}&z=${ref.z}`);
    const indices = decodeChunkData(body.data);

    if (indices.length !== body.height * 256) {
      fail(`${at}: decoded ${indices.length} blocks, expected ${body.height * 256}`);
    }

    const mesh = meshChunk(atlas, {
      x: body.x,
      z: body.z,
      minY: body.minY,
      height: body.height,
      palette: body.palette,
      indices,
    });
    quads += mesh.quads;
    vertices += mesh.position.length / 3;

    // Every quad is four vertices and six indices. A mismatch means the buffers
    // have drifted apart, which renders as garbage triangles rather than an error.
    if (mesh.index.length !== mesh.quads * 6) {
      fail(`${at}: ${mesh.index.length} indices for ${mesh.quads} quads`);
    }
    if (mesh.position.length / 3 !== mesh.quads * 4) {
      fail(`${at}: ${mesh.position.length / 3} vertices for ${mesh.quads} quads`);
    }
    if (mesh.color.length !== mesh.position.length) {
      fail(`${at}: colour buffer does not match the position buffer`);
    }

    for (let i = 0; i < mesh.index.length; i++) {
      if (mesh.index[i] >= mesh.position.length / 3) {
        fail(`${at}: index ${mesh.index[i]} past the end of the vertex buffer`);
        break;
      }
    }

    // A vertex outside its own chunk means the origin offset is wrong, which
    // looks like a chunk shifted one column over — subtle at a distance and
    // maddening up close.
    for (let i = 0; i < mesh.position.length; i += 3) {
      const [x, y, z] = [mesh.position[i], mesh.position[i + 1], mesh.position[i + 2]];
      if (!Number.isFinite(x + y + z)) {
        fail(`${at}: non-finite vertex position`);
        break;
      }
      if (x < body.x * 16 || x > body.x * 16 + 16 || z < body.z * 16 || z > body.z * 16 + 16) {
        fail(`${at}: vertex (${x}, ${z}) outside the chunk`);
        break;
      }
      if (y < body.minY || y > body.maxY + 1) {
        fail(`${at}: vertex y ${y} outside [${body.minY}, ${body.maxY + 1}]`);
        break;
      }
    }

    for (let i = 0; i < mesh.uv.length; i++) {
      uvMin = Math.min(uvMin, mesh.uv[i]);
      uvMax = Math.max(uvMax, mesh.uv[i]);
    }
  }

  if (uvMin < 0 || uvMax > 1) {
    fail(`UVs run ${uvMin.toFixed(4)}..${uvMax.toFixed(4)}, outside the atlas`);
  }

  // Resolution is checked across *every* chunk, not just the meshed sample: an
  // unresolvable block is a hole in the world wherever it happens to be placed.
  let checked = 0;
  let unresolved = 0;
  let domum = 0;
  const missing = new Set<string>();
  for (const ref of manifest.chunks) {
    const body = await getJson<ChunkBody>(`${base}/api/village/chunk?x=${ref.x}&z=${ref.z}`);
    for (const entry of body.palette) {
      if (entry.block === 'minecraft:air') {
        continue;
      }
      checked++;
      if (entry.materials) {
        domum++;
      }
      const faces = resolveEntry(atlas, entry);
      if (!faces || faces.tex.length !== 6) {
        unresolved++;
        missing.add(entry.block);
      }
    }
  }
  if (unresolved > 0) {
    fail(`${unresolved} palette entries did not resolve: ${[...missing].slice(0, 8).join(', ')}`);
  }

  console.log(`  base               : ${base}`);
  console.log(`  chunks meshed      : ${Math.min(sampleSize, manifest.chunks.length)} of ${manifest.chunkCount}`);
  console.log(`  quads / vertices   : ${quads.toLocaleString()} / ${vertices.toLocaleString()}`);
  console.log(`  uv range           : ${uvMin.toFixed(4)} .. ${uvMax.toFixed(4)} (must be within 0..1)`);
  console.log(`  palette entries    : ${checked} across all chunks, ${domum} domum, ${unresolved} unresolved`);
  console.log(`  problems           : ${problems.length}`);
  problems.slice(0, 12).forEach((p) => console.log(`    ${p}`));
  console.log(`\n  ${problems.length === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(`village-verify: ${(e as Error).message}`);
  process.exit(1);
});
