// Shared kit of the regolith look-dev scenes S02 (first-stroke macro) and S03 (distance ladder), M0-W3-T04.
// A scene class takes the render module's services (`LookdevSceneOptions`), builds its world under `roots.world`, drives the
// key light with the SAME `SunRig` the look-dev lighting task ships, and publishes `window.__mcLookdev` for the capture driver
// (`s02-run.mjs`). In the app `VisualsModule` routes `?scene=s02` / `?scene=s03` to these classes and passes `host`: the
// scene then writes its sun into the module's look state and the module's own rig (sun, sky, post look) lights it, so there
// is exactly one key light. `s02-dev-entry.ts` boots them on their own page without a host (own `SunRig`, tone map only).

import type { FrameInfo } from "@moon-cleanup/shared";
import {
  BoxGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Vector3,
  type Material,
  type MeshStandardNodeMaterial,
  type PerspectiveCamera,
} from "three/webgpu";
import type { RenderQualityService, RenderRendererService, SceneRoots } from "../../render";
import { createKeyState, resolveKey } from "../lighting/key-light";
import type { LookState } from "./scene-base";
import { SunRig } from "../lighting/sun-rig";
import { createChipMaterial } from "../materials/regolith-material";
import { ALBEDO_CLEAN, ALBEDO_GRIME, CLEAN_TINT, GRIME_TINT } from "../materials/regolith-constants";

const DEG = Math.PI / 180;

export interface LookdevSceneOptions {
  readonly roots: SceneRoots;
  readonly renderer: RenderRendererService;
  readonly quality: RenderQualityService;
  readonly search: string;
  readonly log?: (line: string) => void;
  readonly target?: LookdevHookTarget;
  /** Set when the scene runs inside `VisualsModule`: the module's rig lights the scene (see `LookdevSun`). */
  readonly host?: LookdevHost;
}

/** What a hosting look rig lends a look-dev scene. */
export interface LookdevHost {
  /** The host's sun / Earth state; the scene writes its sun here. */
  readonly state: LookState;
  /** Key state of the host's last update (lux, EV100, pre-exposure scale). */
  readonly keyState: () => LookdevKeyState;
}

export interface LookdevKeyState {
  readonly sunLux: number;
  readonly ev100: number;
  readonly scale: number;
}

/** A look-dev scene: `update` once per frame, `dispose` removes everything it added. */
export interface LookdevScene {
  readonly id: string;
  update(frame: FrameInfo): void;
  dispose(): void;
}

/** Pixel rectangle in CSS pixels of the canvas. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A line across a feature in CSS pixels, sampled by the driver. */
export interface PixelLine {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface LookdevProbes {
  readonly chips: Readonly<Record<string, PixelRect>>;
  readonly lines: Readonly<Record<string, PixelLine>>;
  readonly facts: Readonly<Record<string, string | number | boolean>>;
}

export interface LookdevHooks {
  readonly scene: string;
  readonly ready: boolean;
  readonly error: string | null;
  readonly variants: readonly string[];
  readonly variant: string;
  readonly settleFrames: number;
  setVariant(variant: string): void;
  probes(): LookdevProbes;
}

export interface LookdevHookTarget {
  __mcLookdev?: LookdevHooks;
}

/** Sun direction (unit, toward the sun) from elevation and azimuth measured from +z toward +x. Writes `out`. */
export function sunDirection(elevationDeg: number, azimuthDeg: number, out: Vector3): Vector3 {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/** Sun + regolith bounce through the shared `SunRig`; the Earth is below the horizon (no earthshine in these scenes). */
export class LookdevRig {
  readonly sun: SunRig;
  private readonly key = createKeyState();
  private readonly direction = new Vector3(0, 1, 0);
  private elevationDeg = 60;
  private azimuthDeg = 90;
  private applied: unknown = null;

  constructor(roots: SceneRoots) {
    this.sun = new SunRig(roots.scene);
  }

  setSun(elevationDeg: number, azimuthDeg: number): void {
    this.elevationDeg = elevationDeg;
    this.azimuthDeg = azimuthDeg;
  }

  update(camera: PerspectiveCamera, frame: FrameInfo): void {
    if (this.applied !== frame.quality) {
      this.applied = frame.quality;
      this.sun.applyQuality(frame.quality);
    }
    sunDirection(this.elevationDeg, this.azimuthDeg, this.direction);
    resolveKey(this.elevationDeg, -90, 0, this.key);
    this.sun.update(camera, this.key, this.direction);
  }

  /** Key state of the last update: lux and EV100 of the capture. */
  get keyState(): { readonly sunLux: number; readonly ev100: number; readonly scale: number } {
    return this.key;
  }

  dispose(): void {
    this.sun.dispose();
  }
}

/**
 * The sun of a look-dev scene: its own `LookdevRig` on a stand-alone page, or the hosting module's rig (the scene only sets
 * the sun in the host's state; azimuth is converted from this kit's "+z toward +x" to the module's "+x toward +z").
 */
export class LookdevSun {
  private readonly rig: LookdevRig | null;
  private readonly host: LookdevHost | null;

  constructor(options: LookdevSceneOptions) {
    this.host = options.host ?? null;
    this.rig = this.host === null ? new LookdevRig(options.roots) : null;
  }

  setSun(elevationDeg: number, azimuthDeg: number): void {
    this.rig?.setSun(elevationDeg, azimuthDeg);
    const state = this.host?.state;
    if (state !== undefined) {
      state.sunElevationDeg = elevationDeg;
      state.sunAzimuthDeg = 90 - azimuthDeg;
      state.sunRateDegPerS = 0;
      // No earthshine in these scenes: the Earth is below the horizon.
      state.earthElevationDeg = -90;
    }
  }

  update(camera: PerspectiveCamera, frame: FrameInfo): void {
    this.rig?.update(camera, frame);
  }

  get keyState(): LookdevKeyState {
    return this.rig?.keyState ?? this.host?.keyState() ?? { sunLux: 0, ev100: 0, scale: 1 };
  }

  dispose(): void {
    this.rig?.dispose();
  }
}

/** Large ground plane at y = 0 (normal +y); `material` should be the regolith material. */
export function createGround(material: Material, sizeM = 600): Mesh {
  const ground = new Mesh(new PlaneGeometry(sizeM, sizeM, 1, 1), material);
  ground.name = "mc:lookdev-ground";
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.castShadow = false;
  return ground;
}

export interface ChartChip {
  readonly id: string;
  readonly albedo: number;
  readonly mesh: Mesh;
}

export const CHIP_SIZE_M = 0.2;
export const CHIP_HEIGHT_M = 0.012;

/**
 * The albedo calibration chart (VT-M0-06, VT-M0-08): flat, matte slabs lying on the ground. Three neutral chips of linear
 * albedo 0.10 / 0.33 / 0.80 and two regolith-family chips (grime 0.085 warm, clean 0.34 neutral) with the macro multiplier
 * forced to 1, so the chart measures the albedo and the lighting only. Chips are laid out along +z from `origin`.
 */
export function createChart(
  parent: Group,
  origin: Vector3,
  spacingM = 0.3,
): { chips: ChartChip[]; materials: MeshStandardNodeMaterial[] } {
  const defs: { id: string; albedo: number; tint?: readonly [number, number, number] }[] = [
    { id: "a010", albedo: 0.1 },
    { id: "a033", albedo: 0.33 },
    { id: "a080", albedo: 0.8 },
    { id: "grime", albedo: ALBEDO_GRIME, tint: GRIME_TINT },
    { id: "clean", albedo: ALBEDO_CLEAN, tint: CLEAN_TINT },
  ];
  const geometry = new BoxGeometry(CHIP_SIZE_M, CHIP_HEIGHT_M, CHIP_SIZE_M);
  const chips: ChartChip[] = [];
  const materials: MeshStandardNodeMaterial[] = [];
  defs.forEach((def, i) => {
    const material = createChipMaterial(def.albedo, def.tint ?? [1, 1, 1], def.id);
    materials.push(material);
    const mesh = new Mesh(geometry, material);
    mesh.name = `mc:chart-${def.id}`;
    mesh.position.set(origin.x, CHIP_HEIGHT_M / 2, origin.z + i * spacingM);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    chips.push({ id: def.id, albedo: def.albedo, mesh });
  });
  return { chips, materials };
}

const projected = new Vector3();

/** Refreshes the camera matrices the projection helpers read (they are otherwise only updated at render time). */
export function refreshCamera(camera: PerspectiveCamera): void {
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.updateProjectionMatrix();
}

/** CSS-pixel position of a world point for `camera` on a canvas of `width` x `height` CSS px. Allocates nothing. */
export function toPixels(
  camera: PerspectiveCamera,
  point: Vector3,
  width: number,
  height: number,
  out: { x: number; y: number },
): void {
  projected.copy(point).project(camera);
  out.x = (projected.x * 0.5 + 0.5) * width;
  out.y = (-projected.y * 0.5 + 0.5) * height;
}

/** Axis-aligned pixel rectangle of the inner `fraction` of a flat chip's top face. */
export function chipRect(
  camera: PerspectiveCamera,
  chip: ChartChip,
  width: number,
  height: number,
  fraction = 0.45,
): PixelRect {
  const half = (CHIP_SIZE_M * fraction) / 2;
  const centre = chip.mesh.position;
  const p = { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corner = new Vector3();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      corner.set(centre.x + sx * half, CHIP_HEIGHT_M, centre.z + sz * half);
      toPixels(camera, corner, width, height, p);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Pixel line of a ground segment (y = 0) from (x0, z0) to (x1, z1). */
export function groundLine(
  camera: PerspectiveCamera,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  width: number,
  height: number,
): PixelLine {
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  toPixels(camera, new Vector3(x0, 0, z0), width, height, a);
  toPixels(camera, new Vector3(x1, 0, z1), width, height, b);
  return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
}

/** Places the camera at `position` looking at `target` (gameplay owns this in the game; look-dev scenes set it directly). */
export function aimCamera(camera: PerspectiveCamera, position: Vector3, target: Vector3, vfovDeg = 60): void {
  camera.position.copy(position);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  if (camera.fov !== vfovDeg) {
    camera.fov = vfovDeg;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);
}

/** `?variant=` of the page URL, or `fallback`. */
export function readVariant(search: string, fallback: string): string {
  return new URLSearchParams(search).get("variant") ?? fallback;
}

/** `?u=detailGain:0,layerGain:0.2,...`: sets named regolith uniforms from the URL (tuning and isolation in captures). */
export function applyUniformOverrides(search: string, uniforms: Readonly<Record<string, { value: number }>>): void {
  const raw = new URLSearchParams(search).get("u");
  if (raw === null) return;
  for (const pair of raw.split(",")) {
    const [name, value] = pair.split(":");
    const target = name === undefined ? undefined : uniforms[name];
    if (target !== undefined && value !== undefined && Number.isFinite(Number(value))) target.value = Number(value);
  }
}
