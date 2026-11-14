// `window.__mcLook`: the look-dev scenes' hooks for the capture driver and the visual checks (no gameplay use).
// Reads and sets the sun / Earth state, switches views, projects named probe points to canvas pixels and measures patches of a
// screenshot data URL in the page (so the driver needs no image library).

import type { PerspectiveCamera } from "three/webgpu";
import { Vector3 } from "three/webgpu";
import { maxLumaStep, meanPatch, type PatchStats, type Rect } from "./analysis";
import type { LookScene, LookState } from "./scene-base";

export interface LookInfo {
  readonly scene: string;
  readonly keyMode: string;
  readonly ev100: number;
  readonly cascades: readonly { index: number; texelM: number; endM: number }[];
  readonly preset: string;
  readonly backend: string;
  readonly postPasses: readonly string[];
  /** URL knobs that differ from the shipped look (`look-knobs.ts`), `default` when none. */
  readonly knobs: string;
  /** How the sky backdrop is drawn: from the baked texture or per pixel. */
  readonly skyDome: string;
  /** PCF kernel of the sun cascades. */
  readonly shadowFilter: string;
  readonly state: LookState;
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
  /** Named probe points of the scene at the current sun. */
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
  readonly info: () => Omit<LookInfo, "state" | "scene">;
  readonly setGrade: (patch: { saturation?: number; contrast?: number }) => void;
  readonly setBump: (strength: number) => void;
}

const _v = new Vector3();

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
        const [x, y, z] = fn(sources.state);
        out[name] = { world: [x, y, z], px: project(x, y, z) };
      }
      return out;
    },
    info() {
      return { scene: sources.sceneId, state: { ...sources.state }, ...sources.info() };
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
