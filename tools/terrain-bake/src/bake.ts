// CLI: `pnpm --filter @moon-cleanup/terrain-bake bake` (tsx src/bake.ts). Raw LDEM files must be in assets/terrain/raw/
// (git-ignored); download commands are in the package README.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TERRAIN_BAKE_HASH } from "@moon-cleanup/world";

import { runBake } from "./pipeline.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const terrain = resolve(repoRoot, "assets", "terrain");
const reportPreview = resolve(repoRoot, "docs", "agent-reports", "M0-W2-T05-terrain-dust-engineer-previews");

const withPreviews = process.argv.includes("--previews");
const summary = runBake({
  rawDir: resolve(terrain, "raw"),
  outDir: terrain,
  statsDir: resolve(terrain, "cache"),
  ...(withPreviews ? { previewDir: reportPreview } : {}),
});

console.log(
  JSON.stringify(
    {
      timings: summary.timings,
      peakRssMiB: summary.peakRssMiB,
      sizes: summary.sizes,
      bakeHash: summary.manifest.bakeHash,
    },
    null,
    2,
  ),
);
if (summary.manifest.bakeHash !== TERRAIN_BAKE_HASH) {
  console.warn(
    `bakeHash changed: update TERRAIN_BAKE_HASH in packages/world/src/height/bake-hash.ts to ${summary.manifest.bakeHash} (bake-hash.test.ts fails until you do).`,
  );
}
console.log(
  JSON.stringify(
    {
      slope1024: summary.slope1024,
      slope256: summary.slope256,
      accuracy: summary.accuracy,
      seam: summary.seam,
      horizon: summary.horizonStats,
      pads: summary.pads,
      relax: summary.relax,
      heightRangeM: summary.heightRangeM,
      lowBandRangeM: summary.lowBandRangeM,
    },
    null,
    2,
  ),
);
