'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Boxes, Check, Link2, Loader2, Maximize2, Minimize2, MousePointerClick } from 'lucide-react';
import PageTransition from '@/components/motion/PageTransition';
import { copyText } from '@/lib/clipboard';
// Type-only: the runtime import is dynamic below so three stays out of the
// shared bundle, but the types are erased at compile time and cost nothing.
import type * as ThreeTypes from 'three';
import { decodeChunkData, type AtlasData, type MeshResult } from './mesher';
import { CitizenLayer } from './citizens';
import { applyCameraView, cameraLink, parseCameraQuery, readCameraView } from './camera';
import { installDebugHandle } from './debug';
import type { VillageFrame, VillageRoster } from '@/lib/village';

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

/** Movement, in blocks per second. Ctrl multiplies it, as sprint does in game. */
const WALK_SPEED = 22;
const SPRINT_MULTIPLIER = 4;
const EYE_START_HEIGHT = 24;

export default function VillagePage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState<Progress>({ phase: 'idle', loaded: 0, total: 0, quads: 0 });
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [locked, setLocked] = useState(false);
  // Connected / reconnecting only. The citizen count and tick change ten times a
  // second and are written straight to the DOM below, never through React.
  const [streamLive, setStreamLive] = useState(false);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const streamRef = useRef<HTMLSpanElement>(null);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once the scene exists; returns a pasteable link to wherever the camera
  // is right now. Held in a ref because the scene lives outside React.
  const linkRef = useRef<(() => string) | null>(null);

  // Counts every render of this component, for `window.villageViewer.stats()`.
  // Incrementing during render is impure, but this is a debug counter whose
  // whole job is to notice renders — and React StrictMode double-counting in
  // dev is exactly the sort of thing it should be visible about.
  const reactRenders = useRef(0);
  reactRenders.current++;

  const copyLink = useCallback(() => {
    const link = linkRef.current?.();
    if (!link) {
      return;
    }
    void copyText(link).then((ok) => {
      setFlash({ text: ok ? 'camera link copied' : link, ok });
      if (flashTimer.current) {
        clearTimeout(flashTimer.current);
      }
      // Longer on failure, and showing the link itself, so it can be copied by
      // hand — paddle's rule, for the same reason: over plain LAN HTTP the
      // clipboard API does not exist and the failure has to stay readable.
      flashTimer.current = setTimeout(() => setFlash(null), ok ? 1800 : 8000);
    });
  }, []);

  useEffect(() => () => {
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
    }
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const requestLockRef = useRef<(() => void) | null>(null);

  const enterView = useCallback(() => requestLockRef.current?.(), []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void frameRef.current?.requestFullscreen();
    }
  }, []);

  // The browser can leave fullscreen without asking (esc, or the pointer-lock
  // release that esc also triggers), so the flag follows the document rather
  // than the click that requested it.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

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

      // An explicit ?cam= wins over the default framing, which is what makes a
      // view reproducible — a screenshot script, or a link to the spot where
      // something looked wrong, lands in exactly the same place every time.
      const requested = parseCameraQuery(window.location.search);
      if (requested) {
        applyCameraView(camera, requested);
      } else {
        camera.position.set(colony.center.x, bounds.maxY + EYE_START_HEIGHT, colony.center.z + 60);
      }

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      // Vertex colours already carry Minecraft's per-face directional shading, so
      // the material is unlit — a real light would fight that and wash it out.
      // alphaTest rather than transparency: crops, torches, glass and leaves are
      // cutouts, and without it every transparent texel draws black — which is
      // what turned the wheat fields into rows of black cubes. Discarding beats
      // blending here because cutouts need no depth sorting.
      const material = new THREE.MeshBasicMaterial({
        map: atlasTexture,
        vertexColors: true,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
      });

      const held = new Set<string>();
      const controls = new PointerLockControls(camera, renderer.domElement);
      requestLockRef.current = () => controls.lock();
      controls.addEventListener('lock', () => setLocked(true));
      controls.addEventListener('unlock', () => {
        setLocked(false);
        // Releasing the pointer while a key is down never delivers its keyup,
        // so the camera would drift forever on a key nobody is holding.
        held.clear();
      });

      const onKeyDown = (e: KeyboardEvent) => {
        held.add(e.code);
        // Space scrolls the page and ctrl+W closes the tab; neither is welcome
        // mid-flight, and both are only intercepted while the pointer is locked.
        if (e.code === 'Space' || e.code.startsWith('Arrow')) {
          e.preventDefault();
        }
      };
      const onKeyUp = (e: KeyboardEvent) => held.delete(e.code);
      const onBlur = () => held.clear();
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);

      const onResize = () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };
      window.addEventListener('resize', onResize);
      // Entering fullscreen resizes the container without firing a window
      // resize, so the canvas would keep the old aspect and letterbox itself.
      document.addEventListener('fullscreenchange', onResize);

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

      // ── Citizens ──

      // Opened after the geometry is up, so the first frames land in a world that
      // exists. EventSource rather than fetch + reader: it reconnects on its own,
      // and the mod sends a short retry delay so a redeploy reappears in seconds.
      const citizens = new CitizenLayer(THREE, scene);
      const events = new EventSource(`/api/village/events?colony=${colony.id}`);
      let lastStream = '';

      events.addEventListener('roster', (e) => {
        citizens.setRoster(JSON.parse((e as MessageEvent).data) as VillageRoster);
      });

      events.addEventListener('frame', (e) => {
        const frame = JSON.parse((e as MessageEvent).data) as VillageFrame;
        citizens.setFrame(frame);
        const text = `${frame.citizens.length} citizens · tick ${frame.tick.toLocaleString()}`;
        if (text !== lastStream && streamRef.current) {
          lastStream = text;
          streamRef.current.textContent = text;
        }
      });

      // The mod's own mid-stream failures: it cannot change the status code once
      // the stream is open, so it says so in-band instead.
      events.addEventListener('fault', (e) => {
        const fault = JSON.parse((e as MessageEvent).data) as { error: string };
        setProgress((p) => ({ ...p, message: fault.error }));
      });

      events.addEventListener('open', () => setStreamLive(true));
      // Fires on every disconnect. EventSource retries by itself unless it has
      // been closed, so this reports rather than reacts.
      events.onerror = () => setStreamLive(events.readyState === EventSource.OPEN);

      // ── Loop ──

      const clock = new THREE.Clock();
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      const scratch = new THREE.Vector3();
      const WORLD_UP = new THREE.Vector3(0, 1, 0);
      let raf = 0;
      let frames = 0;
      let sinceReport = 0;
      let lastReadout = '';

      linkRef.current = () => cameraLink(readCameraView(camera, scratch));
      const removeDebugHandle = installDebugHandle({
        three: THREE,
        scene,
        camera,
        renderer,
        citizens,
        applyView: (next) => applyCameraView(camera, next),
        frames: () => frames,
        reactRenders: () => reactRenders.current,
        quads: () => quadTotal,
      });

      const tick = () => {
        raf = requestAnimationFrame(tick);
        frames++;
        const delta = Math.min(clock.getDelta(), 0.1);
        const sprinting = held.has('ControlLeft') || held.has('ControlRight');
        const speed = WALK_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1) * delta;

        // Creative flight, not noclip: WASD stays in the horizontal plane no
        // matter where you are looking, and altitude is space/shift only. Letting
        // W follow the pitch makes precise movement around a building miserable —
        // you sink or climb every time you glance up or down.
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) {
          // Looking straight up or down: no usable heading, so fall back to the
          // camera's own up-vector projection rather than freezing in place.
          forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
          forward.y = 0;
        }
        forward.normalize();
        right.crossVectors(forward, WORLD_UP).normalize();

        if (held.has('KeyW')) camera.position.addScaledVector(forward, speed);
        if (held.has('KeyS')) camera.position.addScaledVector(forward, -speed);
        if (held.has('KeyD')) camera.position.addScaledVector(right, speed);
        if (held.has('KeyA')) camera.position.addScaledVector(right, -speed);
        if (held.has('Space')) camera.position.y += speed;
        if (held.has('ShiftLeft') || held.has('ShiftRight')) camera.position.y -= speed;

        // The readout is written straight to the DOM. Driving it through React
        // state re-rendered the whole page several times a second, and only
        // while the camera was actually moving — which is exactly when the
        // pointer-lock look broke. A 60fps loop has no business in the React
        // render cycle regardless.
        sinceReport += delta;
        if (sinceReport > 0.1) {
          sinceReport = 0;
          const text =
            `x ${Math.round(camera.position.x)}   ` +
            `y ${Math.round(camera.position.y)}   ` +
            `z ${Math.round(camera.position.z)}`;
          if (text !== lastReadout && readoutRef.current) {
            lastReadout = text;
            readoutRef.current.textContent = text;
          }
        }

        citizens.update(delta, camera);
        renderer.render(scene, camera);
      };
      tick();

      cleanupScene = () => {
        cancelAnimationFrame(raf);
        // Close before anything else: the mod allows only three streams at once
        // and each one holds a handler thread, so an abandoned stream from a
        // remounted page is a slot nobody gets back until the server restarts.
        events.close();
        citizens.dispose();
        // A handle onto a disposed renderer is worse than no handle: everything
        // on it still answers, and every answer describes a scene nobody draws.
        removeDebugHandle();
        linkRef.current = null;
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('fullscreenchange', onResize);
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

        <div
          ref={frameRef}
          className={
            fullscreen
              ? 'relative size-full overflow-hidden bg-neutral-900'
              : 'relative aspect-video w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-900 dark:border-neutral-800'
          }
        >
          <div ref={mountRef} className="size-full" />

          {/* Above the click-to-fly overlay, and only reachable with the pointer
              released — which is the moment you have arrived somewhere worth
              keeping, so the ordering works out. */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            {flash && (
              <span
                className={`max-w-md truncate rounded-lg px-2.5 py-1.5 font-mono text-xs ${
                  flash.ok ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-100'
                }`}
              >
                {flash.ok ? flash.text : `clipboard blocked · ${flash.text}`}
              </span>
            )}
            <button
              type="button"
              onClick={copyLink}
              disabled={progress.phase !== 'ready'}
              title="Copy a link to this exact camera position"
              className="rounded-lg bg-neutral-950/60 p-2 text-neutral-200 transition hover:bg-neutral-950/80 disabled:opacity-40"
            >
              {flash?.ok ? <Check className="size-4" /> : <Link2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="rounded-lg bg-neutral-950/60 p-2 text-neutral-200 transition hover:bg-neutral-950/80"
            >
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          </div>

          {/* The text is written imperatively at 10 Hz, so it stays a constant here — anything
              derived from state would be re-patched by React on every reconnect. */}
          {progress.phase === 'ready' && (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg bg-neutral-950/70 px-3 py-1.5 font-mono text-xs text-neutral-200 tabular-nums">
              <span
                className={`size-1.5 rounded-full ${streamLive ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`}
              />
              <span ref={streamRef}>connecting…</span>
            </div>
          )}

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
              <span ref={readoutRef}>x 0   y 0   z 0</span>
              <div className="mt-1 text-neutral-400">WASD move · space/shift up/down · ctrl sprint · esc release</div>
            </div>
          )}
        </div>

        <p className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
          <Boxes className="size-3.5" />
          Every block renders as a full cube — stairs, slabs and fences included. Grass uses a fixed plains tint.
          Citizens stream live at 10 Hz; their labels show the job AI state, or the brain state when they are not
          working. Press esc, then the link button, to copy a URL that reopens this exact camera position.
        </p>
      </div>
    </PageTransition>
  );
}
