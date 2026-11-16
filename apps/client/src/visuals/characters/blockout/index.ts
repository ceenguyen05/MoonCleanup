// Blockout custodian + Desk Duster v0 (M1-W3-T07). Public barrel.
//
//   const cast = await BlockoutCast.load();            // cold: manifest + 2 GLBs (lazy GLTF loader chunk)
//   const me = cast.spawn(0);                           // player slot P01
//   roots.world.add(me.object);                         // caller sets me.object position + tangent frame
//   me.input.vx = ...; me.input.vz = ...; me.update(dt); // per frame, no allocation
//   me.nameTagAnchor / me.handAnchor / me.lampAnchor    // UI name tag, tool contact, Crown Lamp light
//
// Placeholder (art-direction 13.4): replaced by the production suit and tools in M1-W4-T07.

import { BlockoutCustodian } from "./custodian";
import { createCustodianMaterial, type CustodianMaterial } from "./material";
import { loadBlockoutAssets, type LoadedAsset } from "./assets";

export { BlockoutCustodian, CUSTODIAN_LOD_DISTANCES, DUSTER_LOD_DISTANCES, type CustodianInput } from "./custodian";
export { createCustodianMaterial, createShading, type CustodianMaterial, type CustodianShading } from "./material";
export { CustodianMotion, DEFAULT_MOTION_TUNING, MOON_G, type MotionTuning } from "./motion";
export { PART, PLAYER_COLORS, SLOT, SLOTS, playerSlot, srgbHexToLinear } from "./palette";
export {
  BLOCKOUT_BASE_URL,
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

  constructor(
    readonly custodian: LoadedAsset,
    readonly duster: LoadedAsset | null,
  ) {
    this.material = createCustodianMaterial();
    for (const [key, name] of PIVOTS) {
      const s = custodian.sockets.get(name);
      if (s === undefined) throw new Error(`${custodian.id}: ${name} missing`);
      this.material.pivots[key].copy(s.position);
    }
  }

  static async load(base?: string): Promise<BlockoutCast> {
    const { custodian, duster } = await loadBlockoutAssets(base);
    return new BlockoutCast(custodian, duster);
  }

  spawn(player = 0): BlockoutCustodian {
    return new BlockoutCustodian({
      custodian: this.custodian,
      duster: this.duster,
      material: this.material,
      player,
    });
  }

  /** Placeholder assets in use (capture sidecars list them as `placeholderAssets`). */
  placeholderAssets(): string[] {
    const list = [this.custodian, this.duster].filter((a): a is LoadedAsset => a !== null && a.placeholder);
    return list.map((a) => a.file);
  }

  dispose(): void {
    this.material.dispose();
    for (const g of this.custodian.levels) g.dispose();
    for (const g of this.duster?.levels ?? []) g.dispose();
  }
}
