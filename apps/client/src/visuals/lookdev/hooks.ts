// `window.__mcLook`: the look-dev scenes' hooks for the capture driver and the visual checks (no gameplay use).
// Reads and sets the sun / Earth state, switches views, projects named probe points to canvas pixels and measures patches of a
// screenshot data URL in the page (so the driver needs no image library).

import type { PerspectiveCamera } from "three/webgpu";
import { Quaternion, Vector3 } from "three/webgpu";
import { maxLumaStep, meanPatch, type PatchStats, type Rect } from "./analysis";
import type { LookScene, LookState } from "./scene-base";

/**
 * The view camera at the time of the call, for capture sidecars (VT-M0-12). A snapshot of plain numbers: nothing in it
 * refers to the live camera, so a tool cannot move the camera through it.
 */
export interface LookCameraInfo {
  /** World position, metres. */
  readonly position: readonly [number, number, number];
  /** World orientation as a unit quaternion (x, y, z, w). */
  readonly quaternion: readonly [number, number, number, number];
  /** Unit view direction in world space (the camera looks down its local -Z). */
  readonly forward: readonly [number, number, number];
  /** Vertical field of view in degrees, with the camera zoom applied. */
  readonly vfovDeg: number;
  /** Width / height of the projection. */
  readonly aspect: number;
  readonly nearM: number;
  readonly farM: number;
}

/**
 * The dust tile atlas of a scene that runs the dust layer (`?scene=dust`): its layout and live counters, read when
 * `info()` is called (plain field reads of the atlas bookkeeping; nothing is added to a frame).
 */
export interface LookDustAtlasInfo {
  /** Atlas preset of the tiles (`low` | `medium` | `high`). */
  readonly preset: string;
  /** Size of the atlas texture in pixels. */
  readonly widthPx: number;
  readonly heightPx: number;
  /** Edge of one tile slot in pixels, and the number of slots. */
  readonly slotPx: number;
  readonly slots: number;
  /** World size of one atlas texel in centimetres (rendering-pipeline section 14 `dust.atlas.texelCm`). */
  readonly texelCm: number;
  /** Tiles that own a slot now, and rebuilds waiting (the running one included). */
  readonly tilesResident: number;
  readonly rebuildBacklog: number;
  /** Totals since the scene started. */
  readonly rebuilds: number;
  readonly evictions: number;
  readonly strokesReplayed: number;
  readonly tileStrokeDraws: number;
  /** Live strokes that did not fit a batch (their tiles were rebuilt instead). */
  readonly liveOverflows: number;
  /** Main-thread milliseconds of the last atlas frame that had rebuild work, and the largest ever. */
  readonly cpuMsLast: number;
  readonly cpuMsMax: number;
}

export interface LookInfo {
  readonly scene: string;
  readonly keyMode: string;
  readonly ev100: number;
  readonly cascades: readonly { index: number; texelM: number; endM: number }[];
  /**
   * Edge in pixels of one sun-cascade shadow map: the allocated depth target once the cascades are built, the size the
   * preset asks for before that; 0 = sun shadows off (VT-M0-03 "map size"). Lamp shadow maps are not included.
   */
  readonly shadowMapSize: number;
  /**
   * Weight of eye adaptation on the exposure (visual-target 6.6). 0: the exposure is scripted from the key state (`ev100`)
   * every frame and nothing adapts.
   */
  readonly adaptationMultiplier: number;
  /**
   * Day clock (M1-W2-T02): whether it drives the sun, its contract time and speed, the scripted EV100 before the
   * adaptation ramp (`ev100` is the value in force), the Earth's lit fraction from the sun / Earth geometry and the
   * stars' limiting magnitude this frame.
   */
  readonly dayClock?: {
    readonly on: boolean;
    readonly timeS: number;
    readonly rate: number;
    readonly scriptedEv100: number;
    readonly earthLitFraction: number;
    readonly limitingMagnitude: number;
    /** Lux the fill is scaled from, and the ambient floor / night carry-over (before pre-exposure). */
    readonly keyLux: number;
    readonly floorLux: number;
  };
  /** The active quality preset (`low` | `medium` | `high` | `ultra`). */
  readonly preset: string;
  readonly backend: string;
  readonly postPasses: readonly string[];
  /** URL knobs that differ from the shipped look (`look-knobs.ts`), `default` when none. */
  readonly knobs: string;
  /** How the sky backdrop is drawn: from the baked texture or per pixel. */
  readonly skyDome: string;
  /** PCF kernel of the sun cascades. */
  readonly shadowFilter: string;
  /** Dust tile atlas stats; `null` in a scene without the dust layer. */
  readonly dustAtlas: LookDustAtlasInfo | null;
  /** Host stroke feed numbers (Solo ledger view); `null` when the dust scene runs its seeded scenario or no dust. */
  readonly dustFeed?: Readonly<Record<string, number | boolean>> | null;
  /**
   * Preset features this build does not run yet. Their sidecar knobs are deliberately NOT reported, so a capture never
   * shows a table value for something that is not on screen: `dustRing` (`dustRingTexelCm`), `particles` (`particlePool`,
   * `particlesLive`).
   */
  readonly notBuilt: readonly string[];
  readonly state: LookState;
  /** View camera pose and vertical FOV (read-only snapshot). */
  readonly camera: LookCameraInfo;
}

export interface LookHooks {
  readonly scene: string;
  readonly views: readonly string[];
  set(patch: Partial<LookState>): void;
  setView(name: string): void;
  setGrade(patch: { saturation?: number; contrast?: number }): void;
  setBump(strength: number): void;
  /** Turns the far-occluder (horizon map) term on or off, for A/B captures. */
  setHorizon(enabled: boolean): void;
  /** `false` while async scene content (baked terrain) is loading. */
  isReady(): boolean;
  /** Canvas CSS pixel of a world point; `visible` is false behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean };
  /** Named probe points of the scene at the current sun; a probe that does not exist at this sun is left out. */
  probes(): Record<string, { world: [number, number, number]; px: { x: number; y: number; visible: boolean } }>;
  info(): LookInfo;
  /** Mean colour of `rects` (CSS px of the page screenshot at DPR 1) in a screenshot given as a data URL. */
  measure(dataUrl: string, rects: Rect[]): Promise<PatchStats[]>;
  /** Largest luma step between `step`-px neighbours along a band (VT-M0-15 seam check). */
  lumaStep(dataUrl: string, band: Rect, step: number): Promise<number>;
}

export interface LookHookHost {
  __mcLook?: LookHooks;
}

export interface HookSources {
  readonly sceneId: string;
  readonly scene: () => LookScene | null;
  readonly state: LookState;
  readonly camera: PerspectiveCamera;
  readonly viewport: () => { widthCssPx: number; heightCssPx: number };
  readonly info: () => Omit<LookInfo, "state" | "scene" | "camera">;
  readonly setGrade: (patch: { saturation?: number; contrast?: number }) => void;
  readonly setBump: (strength: number) => void;
}

const _v = new Vector3();
const _q = new Quaternion();

/**
 * Snapshot of `camera` in world space. Reads only: the world matrix is refreshed from the camera's own transform (as the
 * renderer does every frame), position / rotation / projection are left as they are. Allocates; for tools, not per frame.
 */
export function readLookCamera(camera: PerspectiveCamera): LookCameraInfo {
  camera.getWorldPosition(_v);
  const position: [number, number, number] = [_v.x, _v.y, _v.z];
  camera.getWorldQuaternion(_q);
  const quaternion: [number, number, number, number] = [_q.x, _q.y, _q.z, _q.w];
  camera.getWorldDirection(_v);
  const forward: [number, number, number] = [_v.x, _v.y, _v.z];
  return {
    position,
    quaternion,
    forward,
    vfovDeg: camera.getEffectiveFOV(),
    aspect: camera.aspect,
    nearM: camera.near,
    farM: camera.far,
  };
}

async function readPixels(dataUrl: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("look hooks: no 2d context");
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { data: image.data, width: image.width, height: image.height };
}

export function installLookHooks(host: LookHookHost, sources: HookSources): () => void {
  const project = (x: number, y: number, z: number): { x: number; y: number; visible: boolean } => {
    sources.camera.updateMatrixWorld();
    _v.set(x, y, z).project(sources.camera);
    const vp = sources.viewport();
    return {
      x: ((_v.x + 1) / 2) * vp.widthCssPx,
      y: ((1 - _v.y) / 2) * vp.heightCssPx,
      visible: _v.z > -1 && _v.z < 1 && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1,
    };
  };
  host.__mcLook = {
    scene: sources.sceneId,
    get views() {
      return sources.scene()?.views ?? [];
    },
    set(patch) {
      Object.assign(sources.state, patch);
    },
    setView(name) {
      sources.scene()?.setView(name);
    },
    setGrade: sources.setGrade,
    setBump: sources.setBump,
    setHorizon(enabled) {
      const h = sources.scene()?.horizon;
      if (h !== undefined && h !== null) h.enabled.value = enabled ? 1 : 0;
    },
    isReady() {
      return sources.scene()?.ready ?? true;
    },
    project,
    probes() {
      const out: Record<string, { world: [number, number, number]; px: { x: number; y: number; visible: boolean } }> =
        {};
      const probes = sources.scene()?.probes ?? {};
      for (const [name, fn] of Object.entries(probes)) {
        const point = fn(sources.state);
        if (point === null) continue;
        const [x, y, z] = point;
        out[name] = { world: [x, y, z], px: project(x, y, z) };
      }
      return out;
    },
    info() {
      return {
        scene: sources.sceneId,
        state: { ...sources.state },
        ...sources.info(),
        camera: readLookCamera(sources.camera),
      };
    },
    async measure(dataUrl, rects) {
      const img = await readPixels(dataUrl);
      return rects.map((r) => meanPatch(img.data, img.width, img.height, r));
    },
    async lumaStep(dataUrl, band, step) {
      const img = await readPixels(dataUrl);
      return maxLumaStep(img.data, img.width, img.height, band, step);
    },
  } as LookHooks;
  return () => {
    delete host.__mcLook;
  };
}
