// Look-dev scene S02 "first stroke" (visual-target 6.2; M0-W3-T04): a 1 m Desk Duster stroke mid-frame on dusty regolith
// with a second, overlapping brush-width pass and a cross pass, the albedo calibration chart at the frame edge.
// Camera: first person, eye 1.6 m, pitch -45 deg, sun azimuth 90 deg to the view. Variants `noon` (sun 60 deg) and `dawn` (4 deg).
// Checks: VT-M0-06 chart, VT-M0-07 stroke edge + berm, VT-M0-08 grime vs clean, VT-M0-09 backend parity; RF-01 clean-path contrast.

import type { FrameInfo } from "@moon-cleanup/shared";
import { Group, Vector3 } from "three/webgpu";
import { GRIME_TINT } from "../materials/regolith-constants";
import {
  createMaskBuffer,
  createChipMaterial,
  createMaskTextureFromBuffer,
  createRegolithMaterial,
  stampStroke,
  type MaskWorldRect,
  type RegolithMaterial,
} from "../materials";
import {
  aimCamera,
  applyUniformOverrides,
  chipRect,
  createChart,
  createGround,
  groundLine,
  LookdevSun,
  readVariant,
  refreshCamera,
  type ChartChip,
  type LookdevHooks,
  type LookdevHookTarget,
  type LookdevProbes,
  type LookdevScene,
  type LookdevSceneOptions,
  type PixelRect,
} from "./s02-lookdev-kit";

export const S02_SCENE_ID = "s02";
const MASK_RECT: MaskWorldRect = { originX: -4, originZ: -4, sizeX: 8, sizeZ: 8 };
const MASK_RES = 1024;
const SETTLE_FRAMES = 6;

interface Variant {
  readonly elevationDeg: number;
  readonly azimuthDeg: number;
}

const VARIANTS: Readonly<Record<string, Variant>> = {
  noon: { elevationDeg: 60, azimuthDeg: 90 },
  dawn: { elevationDeg: 4, azimuthDeg: 90 },
};

/** Desk Duster: 0.15 m brush (progression-and-economy table T1). */
const DUSTER_WIDTH_M = 0.15;

export class S02Scene implements LookdevScene {
  readonly id = S02_SCENE_ID;

  private readonly options: LookdevSceneOptions;
  private readonly group = new Group();
  private readonly rig: LookdevSun;
  private readonly regolith: RegolithMaterial;
  private readonly chips: ChartChip[];
  private readonly extra: { dispose(): void }[] = [];
  private readonly target: LookdevHookTarget;
  private variant = "noon";
  private frames = 0;
  private error: string | null = null;

  constructor(options: LookdevSceneOptions) {
    this.options = options;
    this.target = options.target ?? (globalThis as unknown as LookdevHookTarget);
    const { roots } = options;
    this.group.name = "mc:lookdev-s02";
    roots.world.add(this.group);

    // Mask: three brush-width passes (the second overlaps the first by 4 cm; the cross pass ends short of them).
    const buffer = createMaskBuffer(MASK_RES, MASK_RES, MASK_RECT);
    stampStroke(buffer, { x0: 0, z0: -0.5, x1: 0, z1: 0.5, widthM: DUSTER_WIDTH_M });
    stampStroke(buffer, { x0: 0.11, z0: -0.45, x1: 0.11, z1: 0.55, widthM: DUSTER_WIDTH_M });
    stampStroke(buffer, { x0: -0.45, z0: 0.72, x1: 0.4, z1: 0.72, widthM: DUSTER_WIDTH_M });
    const maskTexture = createMaskTextureFromBuffer(buffer);
    const debugView = Number(new URLSearchParams(options.search).get("dbg") ?? 0);
    this.regolith = createRegolithMaterial({
      mask: maskTexture,
      maskRect: MASK_RECT,
      maskSize: [MASK_RES, MASK_RES],
      debugView: Number.isFinite(debugView) ? debugView : 0,
      normalMode: Number(new URLSearchParams(options.search).get("nm") ?? 3),
    });
    this.extra.push(maskTexture);
    applyUniformOverrides(options.search, this.regolith.uniforms as unknown as Record<string, { value: number }>);

    if (new URLSearchParams(options.search).get("nonormal") === "1") {
      this.regolith.material.normalNode = null;
      this.regolith.material.needsUpdate = true;
    }
    const flat = new URLSearchParams(options.search).get("flat") === "1";
    const ground = createGround(flat ? createChipMaterial(0.085, GRIME_TINT, "flat-ground") : this.regolith.material);
    // `?noshadow=1`: ground does not receive cascade shadows (isolates the material from the shadow rig).
    if (new URLSearchParams(options.search).get("noshadow") === "1") ground.receiveShadow = false;
    this.group.add(ground);
    this.extra.push(ground.geometry);

    const chart = createChart(this.group, new Vector3(-1.4, 0, -0.6));
    this.chips = chart.chips;
    this.extra.push(...chart.materials, this.chips[0]?.mesh.geometry ?? { dispose: () => undefined });

    this.rig = new LookdevSun(options);
    this.apply(readVariant(options.search, "noon"));
    this.installHooks();
    (options.log ?? ((line) => console.info(line)))(
      `[lookdev] s02 variant=${this.variant} fetches=${String(this.regolith.fetchCount)} textures=${String(this.regolith.textureBindings)}`,
    );
  }

  private apply(variant: string): void {
    const def = VARIANTS[variant] ?? VARIANTS["noon"];
    if (def === undefined) return;
    this.variant = VARIANTS[variant] === undefined ? "noon" : variant;
    this.rig.setSun(def.elevationDeg, def.azimuthDeg);
    // First person, eye 1.6 m, pitch -45 deg: aim point 1.6 m ahead on the ground.
    aimCamera(this.options.roots.camera, new Vector3(0, 1.6, -1.6), new Vector3(0, 0, 0));
    this.frames = 0;
  }

  update(frame: FrameInfo): void {
    try {
      this.rig.update(this.options.roots.camera, frame);
      this.frames += 1;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private probes(): LookdevProbes {
    const { camera } = this.options.roots;
    refreshCamera(camera);
    const { widthCssPx: w, heightCssPx: h } = this.options.renderer.viewport;
    const chips: Record<string, PixelRect> = {};
    for (const chip of this.chips) chips[chip.id] = chipRect(camera, chip, w, h);
    const key = this.rig.keyState;
    return {
      chips,
      lines: {
        // Across the outer edge of pass A (shaded outer slope, berm crest, lit inner slope, edge, clean floor) and of pass B.
        edgeLeft: groundLine(camera, -0.3, -0.2, -0.02, -0.2, w, h),
        edgeRight: groundLine(camera, 0.1, -0.2, 0.34, -0.2, w, h),
        // Across both overlapping passes (shows the shared floor and the removed inner berm).
        overlap: groundLine(camera, -0.2, 0.1, 0.4, 0.1, w, h),
      },
      facts: {
        variant: this.variant,
        sunLux: key.sunLux,
        ev100: key.ev100,
        fetches: this.regolith.fetchCount,
        textureBindings: this.regolith.textureBindings,
        maskTexelCm: (MASK_RECT.sizeX / MASK_RES) * 100,
      },
    };
  }

  private installHooks(): void {
    const isReady = (): boolean => this.error === null && this.frames >= SETTLE_FRAMES;
    const readError = (): string | null => this.error;
    const readVariantNow = (): string => this.variant;
    const hooks: LookdevHooks = {
      scene: S02_SCENE_ID,
      get ready() {
        return isReady();
      },
      get error() {
        return readError();
      },
      variants: Object.keys(VARIANTS),
      get variant() {
        return readVariantNow();
      },
      settleFrames: SETTLE_FRAMES,
      setVariant: (variant) => {
        this.apply(variant);
      },
      probes: () => this.probes(),
    };
    this.target.__mcLookdev = hooks;
  }

  dispose(): void {
    if (this.target.__mcLookdev?.scene === S02_SCENE_ID) delete this.target.__mcLookdev;
    this.rig.dispose();
    this.group.removeFromParent();
    this.regolith.dispose();
    for (const item of this.extra) item.dispose();
    this.extra.length = 0;
  }
}
