// Asset budgets per class. Triangle, texture and material numbers are art-direction section 9; the hard
// per-file cap mirrors `.github/workflows/asset-validation.yml` (10 MiB, ADR-0017).
// The per-asset byte caps are PROVISIONAL (proposed in the M0-W0-T06 report): the docs define download
// budgets per session (performance-budgets section 5), not per asset class yet.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface ClassBudget {
  readonly label: string;
  /** Max triangles per LOD index. Its length is the required LOD chain length. */
  readonly lodMaxTriangles: readonly number[];
  /** Advisory lower bound for LOD0 (a warning: far below it the asset is probably under-detailed). */
  readonly lod0MinTriangles: number;
  /** Largest allowed texture edge in pixels. */
  readonly maxTextureSize: number;
  readonly maxTextures: number;
  readonly maxMaterials: number;
  /** Provisional cap for the whole compressed file. */
  readonly maxAssetBytes: number;
  /**
   * Kits only: required pieces (node-name prefix `<piece>_LOD<n>`) and each piece's own per-LOD triangle caps.
   * `lodMaxTriangles` then caps the kit total.
   */
  readonly pieces?: Readonly<Record<string, readonly number[]>>;
}

export const CLASS_BUDGETS: Readonly<Record<string, ClassBudget>> = {
  // Rocks: 1-3k -> 300 -> 60 triangles, 1024 px per size class, instanced (one material).
  rock: {
    label: "Rock (rock kit)",
    lodMaxTriangles: [3000, 300, 60],
    lod0MinTriangles: 1000,
    maxTextureSize: 1024,
    maxTextures: 3,
    maxMaterials: 1,
    maxAssetBytes: 3 * 1024 * 1024,
  },
  // Outpost module: 20-40k triangles per module, 2 shared 2048 px trim sheets + a 2048 px decal atlas.
  // LOD1/LOD2 caps are half and a quarter of LOD0 (the vehicle rule of section 9 applied to modules).
  outpostModule: {
    label: "Outpost module (hard surface)",
    lodMaxTriangles: [40000, 20000, 10000],
    lod0MinTriangles: 20000,
    maxTextureSize: 2048,
    maxTextures: 9,
    maxMaterials: 3,
    maxAssetBytes: 4 * 1024 * 1024,
  },
  // Outpost Boreal hero hardware kit (M1-W5-T03): Assay Counter, Receiving Gate, Dump Plate, Flood Mast in one GLB
  // sharing one trim-sheet material and texture set. Counter / Gate use the section 9 machine row (6-15k -> 1/2 -> 1/4);
  // the plate and the mast are props (<= 6k). The total stays well inside the 250k-per-outpost budget even with
  // four Gates, four Plates and four masts instanced (15k + 4 x 27k = 123k at LOD0).
  outpostHeroKit: {
    label: "Outpost hero hardware kit",
    lodMaxTriangles: [42000, 21000, 10500],
    lod0MinTriangles: 8000,
    maxTextureSize: 2048,
    maxTextures: 4,
    maxMaterials: 1,
    maxAssetBytes: 2 * 1024 * 1024,
    pieces: {
      assay_counter: [15000, 7500, 3750],
      receiving_gate: [15000, 7500, 3750],
      dump_plate: [6000, 3000, 1500],
      flood_mast: [6000, 3000, 1500],
    },
  },
  // Blockout custodian (M1-W3-T07, art-direction 13.4): <= 6k triangles at LOD0 (task card), then down to the
  // section 9 far LOD (600). No textures: material slots ride in COLOR_0 (one material, one draw per LOD).
  custodianBlockout: {
    label: "Custodian blockout (placeholder)",
    lodMaxTriangles: [6000, 3500, 2000, 600],
    lod0MinTriangles: 3000,
    maxTextureSize: 512,
    maxTextures: 0,
    maxMaterials: 1,
    maxAssetBytes: 512 * 1024,
  },
  // Production custodian (M1-W4-T07, section 9): 18k -> 8k -> 3k -> 600 triangles, <= 3 materials (one used), the
  // 512 px numeral glyph atlas (KTX2 UASTC) as its only texture; slot colours ride in COLOR_0. Skin <= 64 bones
  // (checked by the client asset test, the GLB stats here do not count joints).
  custodian: {
    label: "Custodian suit (production)",
    lodMaxTriangles: [18000, 8000, 3000, 600],
    lod0MinTriangles: 8000,
    maxTextureSize: 2048,
    maxTextures: 3,
    maxMaterials: 3,
    maxAssetBytes: 1536 * 1024,
  },
  // Hand tool (section 9): 1.5-4k -> 800 -> 200 triangles, shared 2048 px tool atlas, one material.
  handTool: {
    label: "Hand tool",
    lodMaxTriangles: [4000, 800, 200],
    lod0MinTriangles: 1500,
    maxTextureSize: 2048,
    maxTextures: 3,
    maxMaterials: 1,
    maxAssetBytes: 1024 * 1024,
  },
  // Trundle (M1-W7-T02, section 9 vehicle row 8k -> 1/2 -> 1/4): four meshes (chassis, lamps, drum, wheels) sharing one
  // vertex-colour material (linear albedo x AO in COLOR_0), no textures; the on-vehicle draw count is 4.
  vehicle: {
    label: "Vehicle (Trundle)",
    lodMaxTriangles: [8000, 4000, 2000],
    lod0MinTriangles: 2000,
    maxTextureSize: 2048,
    maxTextures: 0,
    maxMaterials: 1,
    maxAssetBytes: 512 * 1024,
    pieces: {
      chassis: [5000, 2500, 1250],
      lamps: [600, 300, 150],
      drum: [2500, 1250, 625],
      wheels: [1500, 750, 375],
    },
  },
};
