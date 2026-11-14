// Look-dev scene S03 "stroke distance ladder" (visual-target 6.2; M0-W3-T04): the same hand strokes and one Lane Broom pass
// seen from 1 / 3 / 10 / 25 m at pitch -30 deg, noon. Variants `d1`, `d3`, `d10`, `d25`.
// Checks: VT-M1-05 (berm line pair lit - shaded >= 12 luma, >= 2 px wide, at the per-preset distance of visual-target 2.2),
// VT-M0-07 stroke edge, no seams or shimmer from the mask mip chain at distance; RF-01 clean-path contrast and overlapping passes.
// The mask is a static 0.78 cm texel texture: it says what the MATERIAL does at distance, not what the M1 atlas (20/40 cm) will.

import type { FrameInfo } from "@moon-cleanup/shared";
import { Group, Vector3 } from "three/webgpu";
import {
  createMaskBuffer,
  createMaskTextureFromBuffer,
  createRegolithMaterial,
  stampStroke,
  type MaskWorldRect,
  type RegolithMaterial,
} from "../materials";
import {
  aimCamera,
  applyUniformOverrides,
  createGround,
  groundLine,
  LookdevSun,
  readVariant,
  refreshCamera,
  type LookdevHooks,
  type LookdevHookTarget,
  type LookdevProbes,
  type LookdevScene,
  type LookdevSceneOptions,
} from "./s02-lookdev-kit";

export const S03_SCENE_ID = "s03";
const MASK_RECT: MaskWorldRect = { originX: -6, originZ: -6, sizeX: 12, sizeZ: 12 };
const MASK_RES = 1536;
const SETTLE_FRAMES = 6;
const PITCH_DEG = 30;
/** Distances of the ladder in metres (camera to the aim point). */
const LADDER_M: Readonly<Record<string, number>> = { d1: 1, d3: 3, d10: 10, d25: 25 };
/** Lane Broom pass width: a TUNING ESTIMATE (the doc table gives hand-tool widths only for the Desk Duster, 0.15 m). */
const LANE_BROOM_WIDTH_M = 0.6;
const DUSTER_WIDTH_M = 0.15;
/** Aim point on the ground: between the hand strokes, the Lane Broom pass is to its right. */
const AIM = new Vector3(0.3, 0, 0);

export class S03Scene implements LookdevScene {
  readonly id = S03_SCENE_ID;

  private readonly options: LookdevSceneOptions;
  private readonly group = new Group();
  private readonly rig: LookdevSun;
  private readonly regolith: RegolithMaterial;
  private readonly extra: { dispose(): void }[] = [];
  private readonly target: LookdevHookTarget;
  private variant = "d3";
  private frames = 0;
  private error: string | null = null;

  constructor(options: LookdevSceneOptions) {
    this.options = options;
    this.target = options.target ?? (globalThis as unknown as LookdevHookTarget);
    const { roots } = options;
    this.group.name = "mc:lookdev-s03";
    roots.world.add(this.group);

    // Three Desk Duster strokes (two overlap by 4 cm) running along the view direction so their berms read side-lit,
    // one Lane Broom pass to the right, and a short cross stroke.
    const buffer = createMaskBuffer(MASK_RES, MASK_RES, MASK_RECT);
    stampStroke(buffer, { x0: -0.9, z0: -0.8, x1: -0.9, z1: 0.8, widthM: DUSTER_WIDTH_M });
    stampStroke(buffer, { x0: -0.2, z0: -0.8, x1: -0.2, z1: 0.8, widthM: DUSTER_WIDTH_M });
    stampStroke(buffer, { x0: -0.09, z0: -0.7, x1: -0.09, z1: 0.9, widthM: DUSTER_WIDTH_M });
    stampStroke(buffer, {
      x0: 1.1,
      z0: -2.0,
      x1: 1.1,
      z1: 2.0,
      widthM: LANE_BROOM_WIDTH_M,
      cornerM: 0.04,
      bermHeightM: 0.03,
      bermWidthM: 0.12,
    });
    stampStroke(buffer, { x0: -1.3, z0: 1.3, x1: 0.5, z1: 1.3, widthM: DUSTER_WIDTH_M });
    const maskTexture = createMaskTextureFromBuffer(buffer);
    const debugView = Number(new URLSearchParams(options.search).get("dbg") ?? 0);
    this.regolith = createRegolithMaterial({
      mask: maskTexture,
      maskRect: MASK_RECT,
      maskSize: [MASK_RES, MASK_RES],
      debugView: Number.isFinite(debugView) ? debugView : 0,
    });
    this.extra.push(maskTexture);
    applyUniformOverrides(options.search, this.regolith.uniforms as unknown as Record<string, { value: number }>);
    const ground = createGround(this.regolith.material);
    this.group.add(ground);
    this.extra.push(ground.geometry);

    this.rig = new LookdevSun(options);
    this.apply(readVariant(options.search, "d3"));
    this.installHooks();
    (options.log ?? ((line) => console.info(line)))(
      `[lookdev] s03 variant=${this.variant} fetches=${String(this.regolith.fetchCount)} textures=${String(this.regolith.textureBindings)}`,
    );
  }

  private apply(variant: string): void {
    const distance = LADDER_M[variant] ?? LADDER_M["d3"] ?? 3;
    this.variant = LADDER_M[variant] === undefined ? "d3" : variant;
    this.rig.setSun(60, 90);
    const pitch = (PITCH_DEG * Math.PI) / 180;
    aimCamera(
      this.options.roots.camera,
      new Vector3(AIM.x, distance * Math.sin(pitch), AIM.z - distance * Math.cos(pitch)),
      AIM,
    );
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
    const key = this.rig.keyState;
    return {
      chips: {},
      lines: {
        // Across the left Desk Duster stroke (x = -0.9): outer berm, edge, floor, edge, inner berm.
        duster: groundLine(camera, -1.25, 0, -0.55, 0, w, h),
        // Across the overlapping pair (x = -0.2 and -0.09).
        pair: groundLine(camera, -0.5, 0.1, 0.2, 0.1, w, h),
        // Across the Lane Broom pass (x = 1.1, 0.6 m wide).
        broom: groundLine(camera, 0.6, 0, 1.6, 0, w, h),
      },
      facts: {
        variant: this.variant,
        distanceM: LADDER_M[this.variant] ?? 0,
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
      scene: S03_SCENE_ID,
      get ready() {
        return isReady();
      },
      get error() {
        return readError();
      },
      variants: Object.keys(LADDER_M),
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
    if (this.target.__mcLookdev?.scene === S03_SCENE_ID) delete this.target.__mcLookdev;
    this.rig.dispose();
    this.group.removeFromParent();
    this.regolith.dispose();
    for (const item of this.extra) item.dispose();
    this.extra.length = 0;
  }
}
