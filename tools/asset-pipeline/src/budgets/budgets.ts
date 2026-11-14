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
};
