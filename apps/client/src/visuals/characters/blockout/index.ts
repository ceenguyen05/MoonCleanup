// Blockout custodian + Desk Duster v0 (M1-W3-T07). Public barrel.
//
//   const cast = await BlockoutCast.load();            // cold: manifest + 2 GLBs (lazy GLTF loader chunk)
//   const me = cast.spawn(0);                           // player slot P01
//   roots.world.add(me.object);                         // caller sets me.object position + tangent frame
//   me.input.vx = ...; me.input.vz = ...; me.update(dt); // per frame, no allocation
//   me.nameTagAnchor / me.handAnchor / me.lampAnchor    // UI name tag, tool contact, Crown Lamp light
//
// Driven by the animation pool (M1-W5-T04) instead of the procedural motion: `CustodianAvatarView` (avatar-view.ts).
//
// Placeholder (art-direction 13.4): replaced by the production suit and tools in M1-W4-T07.

import { BlockoutCustodian } from "./custodian";
import { createCustodianMaterial, type CustodianMaterial } from "./material";
import { loadBlockoutAssets, loadProductionAssets, type Ktx2Renderer, type LoadedAsset } from "./assets";

export { BlockoutCustodian, CUSTODIAN_LOD_DISTANCES, DUSTER_LOD_DISTANCES, type CustodianInput } from "./custodian";
export { createCustodianMaterial, createShading, type CustodianMaterial, type CustodianShading } from "./material";
export { CustodianAvatarView, type AnimatorSource, type PoseMapper } from "./avatar-view";
export {
  BlockoutPoser,
  DEFAULT_POSER_TUNING,
  STANCE_DROP_M,
  blockoutRigGeometry,
  blockoutRigProfile,
  planarTwoBoneIO,
  type BlockoutRigGeometry,
  type PoserTuning,
} from "./rig-adapter";
export { CustodianMotion, DEFAULT_MOTION_TUNING, MOON_G, type MotionTuning } from "./motion";
export { PART, PLAYER_COLORS, SLOT, SLOTS, playerSlot, srgbHexToLinear } from "./palette";
export {
  BLOCKOUT_BASE_URL,
  CHARACTERS_BASE_URL,
  SUIT_ASSET_ID,
  TOOLS_BASE_URL,
  TOOL_ASSET_IDS,
  loadProductionAssets,
  CUSTODIAN_ASSET_ID,
  DUSTER_ASSET_ID,
  extractAsset,
  loadBlockoutAssets,
  type LoadedAsset,
} from "./assets";

const PIVOTS = [
  ["hipL", "pivot_hip_L"],
  ["hipR", "pivot_hip_R"],
  ["kneeL", "pivot_knee_L"],
  ["kneeR", "pivot_knee_R"],
  ["shoulderL", "pivot_shoulder_L"],
  ["shoulderR", "pivot_shoulder_R"],
  ["elbowL", "pivot_elbow_L"],
  ["elbowR", "pivot_elbow_R"],
] as const;

/** The loaded asset set and the one shared material; spawns custodians. */
export class BlockoutCast {
  readonly material: CustodianMaterial;

  /** True when the production suit and tools (M1-W4-T07) loaded; false on the blockout fallback. */
  readonly production: boolean;

  constructor(
    readonly custodian: LoadedAsset,
    readonly duster: LoadedAsset | null,
    readonly tools: ReadonlyMap<number, LoadedAsset> = new Map(),
  ) {
    this.production = tools.size > 0;
    this.material = createCustodianMaterial({ glyphs: custodian.glyphs ?? null });
    for (const [key, name] of PIVOTS) {
      const s = custodian.sockets.get(name);
      if (s === undefined) throw new Error(`${custodian.id}: ${name} missing`);
      this.material.pivots[key].copy(s.position);
    }
  }

  /**
   * Loads the production custodian + T1-T4 tools (M1-W4-T07); on any failure (missing manifest, decode error) falls
   * back to the W3-T07 blockout. `base` (a blockout folder) or `production: false` loads the blockout only.
   */
  static async load(
    base?: string,
    options: { production?: boolean; renderer?: Ktx2Renderer | null; onFallback?: (error: unknown) => void } = {},
  ): Promise<BlockoutCast> {
    if (base === undefined && options.production !== false) {
      try {
        const { custodian, tools } = await loadProductionAssets(options.renderer ?? null);
        return new BlockoutCast(custodian, tools.get(1) ?? null, tools);
      } catch (error) {
        (options.onFallback ?? ((e: unknown) => console.warn("custodian: production assets failed, blockout", e)))(
          error,
        );
      }
    }
    const { custodian, duster } = await loadBlockoutAssets(base);
    return new BlockoutCast(custodian, duster);
  }

  spawn(player = 0): BlockoutCustodian {
    return new BlockoutCustodian({
      custodian: this.custodian,
      duster: this.duster,
      tools: this.tools,
      material: this.material,
      player,
    });
  }

  /** Placeholder assets in use (capture sidecars list them as `placeholderAssets`). */
  placeholderAssets(): string[] {
    const list = [this.custodian, this.duster, ...this.tools.values()].filter(
      (a): a is LoadedAsset => a !== null && a.placeholder,
    );
    return list.map((a) => a.file);
  }

  dispose(): void {
    this.material.dispose();
    for (const g of this.custodian.levels) g.dispose();
    for (const g of this.duster?.levels ?? []) g.dispose();
    for (const t of this.tools.values()) if (t !== this.duster) for (const g of t.levels) g.dispose();
  }
}
