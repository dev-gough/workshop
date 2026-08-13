/**
 * The live half of the viewer: a marker per citizen, driven by the mod's event stream.
 *
 * Geometry is fetched once and never moves. Citizens are the part that is alive, and their AI state
 * is the part that explains what they are doing — so a marker here is a body, a facing direction and
 * a label carrying the job AI state, which together turn "the builder is over there" into "the
 * builder is over there, in `GATHERING_REQUIRED_MATERIALS`, and has been for two minutes".
 *
 * Frames arrive at 10 Hz. Rendering them raw would show citizens teleporting ten times a second, so
 * every marker chases its target rather than snapping to it — see `update`.
 *
 * three.js is passed in rather than imported: the viewer loads it dynamically so a 600 KB renderer
 * stays out of every other route's bundle, and this module has to use the same instance.
 */
import type * as ThreeTypes from 'three';
import type { VillageCitizenFrame, VillageFrame, VillageRoster } from '@/lib/village';

type Three = typeof ThreeTypes;

/**
 * How fast a marker converges on its last reported position, per second. Exponential rather than a
 * timed lerp between the last two frames: it needs no frame clock, degrades gracefully when a frame
 * is late, and at this rate the visible lag is under a tenth of a block.
 */
const SMOOTHING = 14;

/**
 * Beyond this, treat a move as a jump rather than a walk. A citizen who is unloaded and reloaded
 * elsewhere, or teleported by a command, would otherwise glide across the village at walking pace
 * through every wall in between.
 */
const TELEPORT_DISTANCE = 8;

/** Labels are readable to about here, and past it they are noise. */
const LABEL_DISTANCE = 56;

const DEG_TO_RAD = Math.PI / 180;

const LABEL_WIDTH = 256;
const LABEL_HEIGHT = 72;

/**
 * Labels hold a constant size on screen, because a nameplate is UI rather than scenery: a citizen a
 * block away should not get a sign that fills the frame, and one across the plaza should still be
 * readable. `sizeAttenuation: false` gets that by cancelling the perspective divide — which means
 * the sprite's scale is then read as the size it would have *one block* from the camera. So the size
 * is expressed as the world size it used to have, divided by the distance it looked right at.
 */
const LABEL_WORLD_HEIGHT = 0.79;
const LABEL_REFERENCE_DISTANCE = 9;
const LABEL_SCALE_Y = LABEL_WORLD_HEIGHT / LABEL_REFERENCE_DISTANCE;
const LABEL_SCALE_X = LABEL_SCALE_Y * (LABEL_WIDTH / LABEL_HEIGHT);

interface Marker {
  group: ThreeTypes.Group;
  sprite: ThreeTypes.Sprite;
  canvas: HTMLCanvasElement;
  texture: ThreeTypes.CanvasTexture;
  body: ThreeTypes.Mesh;
  /** Where the marker is being drawn, chasing `target`. */
  current: { x: number; y: number; z: number; yaw: number };
  target: { x: number; y: number; z: number; yaw: number };
  /** Last text drawn into the canvas, so it is only redrawn when it changes. */
  label: string;
}

export class CitizenLayer {
  private readonly group: ThreeTypes.Group;
  private readonly markers = new Map<number, Marker>();
  private readonly roster = new Map<number, VillageRoster['citizens'][number]>();
  private readonly bodyGeometry: ThreeTypes.BoxGeometry;
  private readonly headGeometry: ThreeTypes.BoxGeometry;
  private readonly headMaterial: ThreeTypes.MeshBasicMaterial;
  private readonly jobMaterials = new Map<string, ThreeTypes.MeshBasicMaterial>();
  /** Reused by `update` so a 60 fps loop allocates nothing. */
  private readonly scratch: ThreeTypes.Vector3;

  constructor(
    private readonly three: Three,
    private readonly scene: ThreeTypes.Scene,
  ) {
    this.group = new three.Group();
    scene.add(this.group);

    // A body and a head, sized like a Minecraft mob so the scale reads correctly against the blocks.
    this.bodyGeometry = new three.BoxGeometry(0.6, 1.2, 0.35);
    this.headGeometry = new three.BoxGeometry(0.5, 0.5, 0.5);
    this.headMaterial = new three.MeshBasicMaterial({ color: 0xe0b48c, fog: false });
    this.scratch = new three.Vector3();
  }

  get count(): number {
    return this.markers.size;
  }

  /** Replace what we know about who exists. Sent by the mod only when it changes. */
  setRoster(roster: VillageRoster): void {
    this.roster.clear();
    for (const citizen of roster.citizens) {
      this.roster.set(citizen.id, citizen);
    }
    // A job change repaints the marker, so invalidate every cached label.
    for (const marker of this.markers.values()) {
      marker.label = '';
    }
  }

  /**
   * Apply one frame.
   *
   * Frames are complete snapshots of the loaded citizens, so anyone absent from this one has been
   * unloaded and their marker goes with them — no timeout bookkeeping needed.
   */
  setFrame(frame: VillageFrame): void {
    const seen = new Set<number>();

    for (const citizen of frame.citizens) {
      seen.add(citizen.id);
      const marker = this.markers.get(citizen.id) ?? this.create(citizen);
      const { target, current } = marker;

      target.x = citizen.x;
      target.y = citizen.y;
      target.z = citizen.z;
      target.yaw = citizen.headYaw;

      const jumped =
        (target.x - current.x) ** 2 + (target.y - current.y) ** 2 + (target.z - current.z) ** 2 >
        TELEPORT_DISTANCE ** 2;
      if (jumped) {
        current.x = target.x;
        current.y = target.y;
        current.z = target.z;
        current.yaw = target.yaw;
      }

      this.relabel(marker, citizen);
    }

    for (const [id, marker] of this.markers) {
      if (!seen.has(id)) {
        this.destroy(marker);
        this.markers.delete(id);
      }
    }
  }

  /**
   * Advance the interpolation and hide distant labels. Call once per rendered frame.
   *
   * @param delta seconds since the last call.
   * @param camera the viewer camera, for label distance.
   */
  update(delta: number, camera: ThreeTypes.Camera): void {
    // Frame-rate independent exponential approach: the same visual convergence at 30 fps and 144.
    const k = 1 - Math.exp(-delta * SMOOTHING);

    for (const marker of this.markers.values()) {
      const { current, target } = marker;
      current.x += (target.x - current.x) * k;
      current.y += (target.y - current.y) * k;
      current.z += (target.z - current.z) * k;

      // Shortest way round: a citizen turning from 350° to 10° must not spin 340° the long way.
      const turn = ((target.yaw - current.yaw + 540) % 360) - 180;
      current.yaw += turn * k;

      marker.group.position.set(current.x, current.y, current.z);
      // Minecraft yaw is degrees clockwise from +Z; three.js rotates counter-clockwise about +Y,
      // so the sign flips and nothing else has to change.
      marker.group.rotation.y = -current.yaw * DEG_TO_RAD;

      this.scratch.set(current.x, current.y, current.z);
      marker.sprite.visible = this.scratch.distanceTo(camera.position) < LABEL_DISTANCE;
    }
  }

  /**
   * Every tracked citizen, for the debug handle. Reads state rather than
   * mutating it, so calling it from the console mid-flight is safe.
   */
  list(): { id: number; name: string; job: string | null; x: number; y: number; z: number; label: string; labelVisible: boolean }[] {
    const out = [];
    for (const [id, marker] of this.markers) {
      const entry = this.roster.get(id);
      out.push({
        id,
        name: entry?.name ?? `#${id}`,
        job: entry?.job ?? null,
        x: marker.current.x,
        y: marker.current.y,
        z: marker.current.z,
        label: marker.label,
        labelVisible: marker.sprite.visible,
      });
    }
    return out;
  }

  dispose(): void {
    for (const marker of this.markers.values()) {
      this.destroy(marker);
    }
    this.markers.clear();
    this.scene.remove(this.group);
    this.bodyGeometry.dispose();
    this.headGeometry.dispose();
    this.headMaterial.dispose();
    for (const material of this.jobMaterials.values()) {
      material.dispose();
    }
    this.jobMaterials.clear();
  }

  /** Build a marker for a citizen we have not seen before. */
  private create(citizen: VillageCitizenFrame): Marker {
    const three = this.three;
    const group = new three.Group();

    const body = new three.Mesh(this.bodyGeometry, this.jobMaterial(this.roster.get(citizen.id)?.job ?? null));
    body.position.y = 0.6;
    group.add(body);

    const head = new three.Mesh(this.headGeometry, this.headMaterial);
    head.position.y = 1.45;
    group.add(head);

    const canvas = document.createElement('canvas');
    canvas.width = LABEL_WIDTH;
    canvas.height = LABEL_HEIGHT;
    const texture = new three.CanvasTexture(canvas);
    texture.colorSpace = three.SRGBColorSpace;

    // depthTest off so a citizen inside a building still shows where they are — the whole point of
    // watching is finding the one who has stopped moving, and they are usually indoors.
    const sprite = new three.Sprite(
      new three.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }),
    );
    sprite.scale.set(LABEL_SCALE_X, LABEL_SCALE_Y, 1);
    sprite.position.y = 2.35;
    sprite.renderOrder = 10;
    group.add(sprite);

    this.group.add(group);

    const marker: Marker = {
      group,
      sprite,
      canvas,
      texture,
      body,
      current: { x: citizen.x, y: citizen.y, z: citizen.z, yaw: citizen.headYaw },
      target: { x: citizen.x, y: citizen.y, z: citizen.z, yaw: citizen.headYaw },
      label: '',
    };
    this.markers.set(citizen.id, marker);
    return marker;
  }

  /**
   * Redraw a label if what it should say has changed.
   *
   * Canvas work is far too expensive to do at 10 Hz across a colony, and the text is stable for
   * seconds at a time — only a state transition changes it.
   */
  private relabel(marker: Marker, citizen: VillageCitizenFrame): void {
    const entry = this.roster.get(citizen.id);
    const name = entry?.name ?? `#${citizen.id}`;
    // The job AI state is the diagnostic; brain state answers "why is the builder not building"
    // when the answer is that they went to eat, and the job name is the fallback for the unemployed.
    const status = citizen.asleep ? 'asleep' : (citizen.state ?? citizen.brain ?? entry?.job ?? '');
    const text = `${name}\n${status}`;
    if (text === marker.label) {
      return;
    }
    marker.label = text;

    const context = marker.canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.clearRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
    context.fillStyle = 'rgba(10, 12, 16, 0.72)';
    context.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);

    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    context.font = '600 26px ui-sans-serif, system-ui, sans-serif';
    context.fillText(name, LABEL_WIDTH / 2, 30, LABEL_WIDTH - 12);

    context.fillStyle = citizen.stuck && citizen.stuck > 0 ? '#fca5a5' : '#a3a3a3';
    context.font = '20px ui-monospace, monospace';
    context.fillText(status, LABEL_WIDTH / 2, 58, LABEL_WIDTH - 12);

    marker.texture.needsUpdate = true;

    // A citizen who changes job changes colour; cheap to re-assign and only happens on a relabel.
    marker.body.material = this.jobMaterial(entry?.job ?? null);
  }

  /**
   * One material per job, so a colony of forty citizens holds a handful of materials rather than
   * forty. Colour comes from the job name itself: arbitrary, but stable across reloads and
   * consistent between citizens doing the same work, which is what makes it readable at a glance.
   */
  private jobMaterial(job: string | null): ThreeTypes.MeshBasicMaterial {
    const key = job ?? '';
    const existing = this.jobMaterials.get(key);
    if (existing) {
      return existing;
    }

    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    const color = new this.three.Color();
    // Unemployed citizens stay grey so they read as "no job" rather than as one more colour.
    color.setHSL(key === '' ? 0 : (hash % 360) / 360, key === '' ? 0 : 0.62, 0.55);

    // fog off: a marker fading into the haze is exactly the marker you were looking for.
    const material = new this.three.MeshBasicMaterial({ color, fog: false });
    this.jobMaterials.set(key, material);
    return material;
  }

  private destroy(marker: Marker): void {
    this.group.remove(marker.group);
    marker.texture.dispose();
    (marker.sprite.material as ThreeTypes.SpriteMaterial).dispose();
  }
}
