'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Boxes, Loader2, MousePointerClick } from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
// Type-only: the runtime import is dynamic below so three stays out of the
// shared bundle, but the types are erased at compile time and cost nothing.
import type * as ThreeTypes from 'three';
import { decodeChunkData, type AtlasData, type MeshResult } from './mesher';

// ── Types ──

interface ChunkRef {
  x: number;
  z: number;
  minY: number;
  maxY: number;
}

interface Manifest {
  ok: boolean;
  dimension: string;
  colony: { id: number; name: string; active: boolean; center: { x: number; y: number; z: number } };
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  chunks: ChunkRef[];
  chunkCount: number;
  orphanChunks: number;
  warnings: string[];
}

interface Progress {
  phase: 'idle' | 'atlas' | 'manifest' | 'chunks' | 'ready' | 'error';
  loaded: number;
  total: number;
  quads: number;
  message?: string;
}

/** Movement, in blocks per second. Shift multiplies it. */
const WALK_SPEED = 22;
const SPRINT_MULTIPLIER = 4;
const EYE_START_HEIGHT = 24;

export default function VillagePage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'idle', loaded: 0, total: 0, quads: 0 });
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [locked, setLocked] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0, z: 0 });
  const requestLockRef = useRef<(() => void) | null>(null);

  const enterView = useCallback(() => requestLockRef.current?.(), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    let disposed = false;
    const workers: Worker[] = [];
    let cleanupScene: (() => void) | null = null;

    const run = async () => {
      // three.js is ~600 KB and only this page needs it, so it loads on mount
      // rather than entering the shared bundle for every dashboard route.
      const THREE = await import('three');
      const { PointerLockControls } = await import('three/examples/jsm/controls/PointerLockControls.js');
      if (disposed) {
        return;
      }

      setProgress((p) => ({ ...p, phase: 'atlas' }));
      const [atlas, atlasTexture] = await Promise.all([
        fetch('/village/blocks.json').then((r) => {
          if (!r.ok) {
            throw new Error(
              'atlas not built — run `tools/village_atlas.py` in the MineColonies fork (it is gitignored, so a fresh checkout has none)',
            );
          }
          return r.json() as Promise<AtlasData>;
        }),
        new THREE.TextureLoader().loadAsync('/village/atlas.png'),
      ]);
      if (disposed) {
        return;
      }

      // Pixel art: never interpolate. Mipmaps are off because the atlas carries
      // only a 1px gutter, which the lower mip levels would bleed straight
      // through — distant blocks would sample their neighbours' textures.
      atlasTexture.magFilter = THREE.NearestFilter;
      atlasTexture.minFilter = THREE.NearestFilter;
      atlasTexture.generateMipmaps = false;
      atlasTexture.colorSpace = THREE.SRGBColorSpace;

      setProgress((p) => ({ ...p, phase: 'manifest' }));
      const manifestRes = await fetch('/api/village/world', { cache: 'no-store' });
      const manifestBody = (await manifestRes.json()) as Manifest & { error?: string };
      if (!manifestRes.ok) {
        throw new Error(manifestBody.error ?? `manifest failed (${manifestRes.status})`);
      }
      if (disposed) {
        return;
      }
      setManifest(manifestBody);

      // ── Scene ──

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x8fb8de);
      scene.fog = new THREE.Fog(0x8fb8de, 120, 420);

      const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.1, 1000);
      const { colony, bounds } = manifestBody;
      camera.position.set(colony.center.x, bounds.maxY + EYE_START_HEIGHT, colony.center.z + 60);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      // Vertex colours already carry Minecraft's per-face directional shading, so
      // the material is unlit — a real light would fight that and wash it out.
      const material = new THREE.MeshBasicMaterial({
        map: atlasTexture,
        vertexColors: true,
        side: THREE.DoubleSide,
      });

      const controls = new PointerLockControls(camera, renderer.domElement);
      requestLockRef.current = () => controls.lock();
      controls.addEventListener('lock', () => setLocked(true));
      controls.addEventListener('unlock', () => setLocked(false));

      const held = new Set<string>();
      const onKeyDown = (e: KeyboardEvent) => {
        held.add(e.code);
        if (e.code === 'Space' || e.code.startsWith('Arrow')) {
          e.preventDefault();
        }
      };
      const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      const onResize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };
      window.addEventListener('resize', onResize);

      // ── Meshing ──

      const poolSize = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
      const meshes: ThreeTypes.Mesh[] = [];
      let quadTotal = 0;
      let done = 0;

      const addMesh = (result: MeshResult) => {
        if (result.index.length === 0) {
          return;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(result.position, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(result.uv, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(result.color, 3));
        geometry.setIndex(new THREE.BufferAttribute(result.index, 1));
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        meshes.push(mesh);
      };

      const queue = [...manifestBody.chunks];
      // Nearest chunks first, so the view fills in around the camera rather than
      // from whichever corner the server happened to list first.
      queue.sort((a, b) => {
        const da = (a.x * 16 - colony.center.x) ** 2 + (a.z * 16 - colony.center.z) ** 2;
        const db = (b.x * 16 - colony.center.x) ** 2 + (b.z * 16 - colony.center.z) ** 2;
        return da - db;
      });
      setProgress({ phase: 'chunks', loaded: 0, total: queue.length, quads: 0 });

      await new Promise<void>((resolve) => {
        let started = 0;
        let finished = 0;

        const pump = (worker: Worker) => {
          const next = queue.shift();
          if (!next) {
            return;
          }
          started++;
          fetch(`/api/village/chunk?x=${next.x}&z=${next.z}`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((body) => {
              worker.postMessage({
                type: 'mesh',
                chunk: {
                  x: body.x,
                  z: body.z,
                  minY: body.minY,
                  height: body.height,
                  palette: body.palette,
                  indices: decodeChunkData(body.data),
                },
              });
            })
            .catch(() => {
              finished++;
              done++;
              setProgress((p) => ({ ...p, loaded: done }));
              if (finished === started && queue.length === 0) {
                resolve();
              }
            });
        };

        for (let i = 0; i < poolSize; i++) {
          const worker = new Worker(new URL('./mesher.worker.ts', import.meta.url));
          workers.push(worker);
          worker.onmessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'ready') {
              pump(worker);
              return;
            }
            if (message.type === 'mesh') {
              addMesh(message.result as MeshResult);
              quadTotal += (message.result as MeshResult).quads;
              finished++;
              done++;
              setProgress({ phase: 'chunks', loaded: done, total: manifestBody.chunks.length, quads: quadTotal });
            }
            if (queue.length > 0) {
              pump(worker);
            } else if (finished === started) {
              resolve();
            }
          };
          worker.postMessage({ type: 'init', atlas });
        }
      });

      if (disposed) {
        return;
      }
      setProgress((p) => ({ ...p, phase: 'ready' }));

      // ── Loop ──

      const clock = new THREE.Clock();
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      let raf = 0;
      let sinceReport = 0;

      const tick = () => {
        raf = requestAnimationFrame(tick);
        const delta = Math.min(clock.getDelta(), 0.1);
        const speed = WALK_SPEED * (held.has('ShiftLeft') || held.has('ShiftRight') ? SPRINT_MULTIPLIER : 1) * delta;

        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        if (held.has('KeyW')) camera.position.addScaledVector(forward, speed);
        if (held.has('KeyS')) camera.position.addScaledVector(forward, -speed);
        if (held.has('KeyD')) camera.position.addScaledVector(right, speed);
        if (held.has('KeyA')) camera.position.addScaledVector(right, -speed);
        if (held.has('KeyE') || held.has('Space')) camera.position.y += speed;
        if (held.has('KeyQ')) camera.position.y -= speed;

        sinceReport += delta;
        if (sinceReport > 0.15) {
          sinceReport = 0;
          setPosition({
            x: Math.round(camera.position.x),
            y: Math.round(camera.position.y),
            z: Math.round(camera.position.z),
          });
        }
        renderer.render(scene, camera);
      };
      tick();

      cleanupScene = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onResize);
        controls.dispose();
        meshes.forEach((mesh) => mesh.geometry.dispose());
        material.dispose();
        atlasTexture.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
      };
    };

    run().catch((e: unknown) => {
      if (!disposed) {
        setProgress({ phase: 'error', loaded: 0, total: 0, quads: 0, message: (e as Error).message });
      }
    });

    return () => {
      disposed = true;
      workers.forEach((w) => w.terminate());
      cleanupScene?.();
    };
  }, []);

  const busy = progress.phase !== 'ready' && progress.phase !== 'error';

  return (
    <PageTransition>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Village viewer</h1>
            <p className="text-sm text-neutral-500">
              {manifest
                ? `${manifest.colony.name} — ${manifest.chunkCount} chunks, ${progress.quads.toLocaleString()} quads`
                : 'MineColonies dev world, live from the mod'}
            </p>
          </div>
          {manifest && !manifest.colony.active && (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-600">
              colony not ticking
            </span>
          )}
        </header>

        {manifest?.warnings?.map((warning) => (
          <div
            key={warning}
            className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{warning}</span>
          </div>
        ))}

        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-900 dark:border-neutral-800">
          <div ref={mountRef} className="size-full" />

          {progress.phase === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/90 p-6">
              <div className="max-w-lg text-center">
                <AlertCircle className="mx-auto mb-3 size-8 text-red-400" />
                <p className="text-sm text-neutral-200">{progress.message}</p>
              </div>
            </div>
          )}

          {busy && progress.phase !== 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/80">
              <div className="w-72 text-center">
                <Loader2 className="mx-auto mb-3 size-6 animate-spin text-neutral-300" />
                <p className="mb-2 text-sm text-neutral-300">
                  {progress.phase === 'atlas' && 'Loading texture atlas…'}
                  {progress.phase === 'manifest' && 'Asking the mod what to draw…'}
                  {progress.phase === 'chunks' && `Meshing chunks — ${progress.loaded}/${progress.total}`}
                  {progress.phase === 'idle' && 'Starting…'}
                </p>
                {progress.total > 0 && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-700">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-[width] duration-200"
                      style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {progress.phase === 'ready' && !locked && (
            <button
              type="button"
              onClick={enterView}
              className="absolute inset-0 flex cursor-pointer items-center justify-center bg-neutral-950/60 transition hover:bg-neutral-950/50"
            >
              <span className="flex items-center gap-2 rounded-full bg-white/95 px-5 py-2.5 text-sm font-medium text-neutral-900 shadow-lg">
                <MousePointerClick className="size-4" />
                Click to fly
              </span>
            </button>
          )}

          {locked && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-neutral-950/70 px-3 py-2 font-mono text-xs text-neutral-200 tabular-nums">
              <div>
                x {position.x} &nbsp; y {position.y} &nbsp; z {position.z}
              </div>
              <div className="mt-1 text-neutral-400">WASD move · Q/E down/up · shift sprint · esc release</div>
            </div>
          )}
        </div>

        <p className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
          <Boxes className="size-3.5" />
          Every block renders as a full cube — stairs, slabs and fences included. Grass uses a fixed plains tint.
        </p>
      </div>
    </PageTransition>
  );
}
