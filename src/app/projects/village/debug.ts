/**
 * `window.villageViewer` — a handle on the running scene.
 *
 * A rendered voxel world can only be checked by looking at it, which means
 * every claim about it is "I squinted at a PNG and it seemed fine". That is a
 * thin basis for shipping, and it is how a subtly wrong camera or a marker
 * anchored half a block low gets through. This exposes enough of the scene for
 * a script to make actual assertions: put the camera exactly here, now tell me
 * where citizen 3's label landed in pixels and whether it is on screen.
 *
 * Ungated on purpose. Gating it behind a flag would mean every screenshot and
 * every check needs a special build, which is the reliable way to end up with a
 * debug hook nobody uses. Nothing here is privileged — it is the same scene the
 * page already drew, on a dashboard whose data source binds loopback only.
 */
import type * as ThreeTypes from 'three';
import type { CitizenLayer } from './citizens';
import { cameraLink, readCameraView, type CameraView } from './camera';

export interface MarkerReport {
  id: number;
  name: string;
  job: string | null;
  /** World position the marker is being drawn at, mid-interpolation. */
  world: { x: number; y: number; z: number };
  /** Pixel position within the canvas, or null when behind the camera. */
  screen: { x: number; y: number } | null;
  onScreen: boolean;
  /** Both label lines, newline-separated: name and current AI state. */
  label: string;
  labelVisible: boolean;
}

export interface VillageDebug {
  three: typeof ThreeTypes;
  scene: ThreeTypes.Scene;
  camera: ThreeTypes.PerspectiveCamera;
  renderer: ThreeTypes.WebGLRenderer;
  citizens: CitizenLayer;
  /** Where the camera is and which way it points, in Minecraft angles. */
  view(): CameraView;
  /** Move the camera. Partial: pass only what you want to change. */
  goTo(view: Partial<CameraView>): void;
  /** A pasteable URL for the current view. */
  link(): string;
  /** Every citizen marker, with its position projected into canvas pixels. */
  markers(): MarkerReport[];
  /**
   * Counters, for the kind of bug that has no visual symptom until it is bad.
   * `reactRenders` climbing with `frames` means the render loop is driving the
   * React tree again — the fault that broke pointer-lock look while moving, and
   * the one the phase 4 state HUD is most likely to reintroduce.
   */
  stats(): { frames: number; reactRenders: number; citizens: number; quads: number };
}

declare global {
  interface Window {
    villageViewer?: VillageDebug;
  }
}

export interface DebugSources {
  three: typeof ThreeTypes;
  scene: ThreeTypes.Scene;
  camera: ThreeTypes.PerspectiveCamera;
  renderer: ThreeTypes.WebGLRenderer;
  citizens: CitizenLayer;
  applyView: (view: CameraView) => void;
  frames: () => number;
  reactRenders: () => number;
  quads: () => number;
}

/**
 * Publish the handle, and return the function that removes it again.
 *
 * Removal matters: a stale handle onto a disposed renderer is worse than none,
 * because everything on it still answers and every answer is from a scene that
 * is no longer being drawn.
 */
export function installDebugHandle(sources: DebugSources): () => void {
  const scratch = new sources.three.Vector3();

  const view = () => readCameraView(sources.camera, scratch);

  window.villageViewer = {
    three: sources.three,
    scene: sources.scene,
    camera: sources.camera,
    renderer: sources.renderer,
    citizens: sources.citizens,
    view,
    goTo: (next) => sources.applyView({ ...view(), ...next }),
    link: () => cameraLink(view()),
    markers: () => {
      const canvas = sources.renderer.domElement;
      return sources.citizens.list().map((citizen) => {
        // Project the top of the head rather than the feet: it is where the
        // label is anchored, and the label is what a check is usually about.
        scratch.set(citizen.x, citizen.y + 2.35, citizen.z).project(sources.camera);
        const behind = scratch.z > 1;
        const x = (scratch.x * 0.5 + 0.5) * canvas.clientWidth;
        const y = (-scratch.y * 0.5 + 0.5) * canvas.clientHeight;
        return {
          id: citizen.id,
          name: citizen.name,
          job: citizen.job,
          world: { x: citizen.x, y: citizen.y, z: citizen.z },
          screen: behind ? null : { x, y },
          onScreen:
            !behind && x >= 0 && y >= 0 && x <= canvas.clientWidth && y <= canvas.clientHeight,
          label: citizen.label,
          labelVisible: citizen.labelVisible,
        };
      });
    },
    stats: () => ({
      frames: sources.frames(),
      reactRenders: sources.reactRenders(),
      citizens: sources.citizens.count,
      quads: sources.quads(),
    }),
  };

  return () => {
    delete window.villageViewer;
  };
}
