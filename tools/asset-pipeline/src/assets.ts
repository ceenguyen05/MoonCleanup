// Asset list: one entry per source script. Adding an asset = one Blender script + one row here.
export interface AssetSource {
  /** Logical id; also the output file stem and the node-name prefix (`<id>_LOD<n>`). */
  readonly id: string;
  /** Budget class (budgets/budgets.ts). */
  readonly class: string;
  /** Repo-relative Blender source script. */
  readonly script: string;
  /** art-direction 13.4 placeholder tag. */
  readonly placeholder: boolean;
  readonly replaceBy?: string;
  /** Crown Lamp level used for the night-near turntable (candela, art-direction 2.2). */
  readonly turntableLampCandela: number;
  /** Measure Brightside palette shares on the turntable (hardware only). */
  readonly measurePalette: boolean;
}

export const ASSETS: readonly AssetSource[] = [
  {
    id: "rock_boulder_a",
    class: "rock",
    script: "assets/models/rocks/rock_boulder_a.py",
    placeholder: true,
    replaceBy: "M1-W7 (rocks final, art-direction 13.5)",
    turntableLampCandela: 6000,
    measurePalette: false,
  },
  {
    id: "boreal_hab_module",
    class: "outpostModule",
    script: "assets/models/outpost/boreal_hab_module.py",
    placeholder: true,
    replaceBy: "M1-W6 (Boreal outpost kit, art-direction 13.5)",
    turntableLampCandela: 22000,
    measurePalette: true,
  },
  {
    id: "custodian_blockout",
    class: "custodianBlockout",
    script: "assets/models/characters/blockout/custodian_blockout.py",
    placeholder: true,
    replaceBy: "M1-W4-T07 (production custodian suit, art-direction 13.5)",
    turntableLampCandela: 6000,
    measurePalette: false,
  },
  {
    id: "desk_duster_v0",
    class: "handTool",
    script: "assets/models/tools/blockout/desk_duster_v0.py",
    placeholder: true,
    replaceBy: "M1-W4-T07 (production T1-T4 hand tools, art-direction 13.5)",
    turntableLampCandela: 6000,
    measurePalette: false,
  },
];
