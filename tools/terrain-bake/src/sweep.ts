// Vertical-exaggeration sweep (world-and-dust-simulation 3.3): bake the 1024 cube for each E_high candidate and print the
// slope acceptance numbers. Usage: tsx src/sweep.ts [eHigh ...] (default 3 2.5 2).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_PARAMS, composeGameField } from "./cubemap/bake.js";
import { loadLdemFiles } from "./lola/ldem.js";
import { LDEM_16 } from "./lola/sources.js";
import { bakeLevel } from "./pipeline.js";

const raw = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "terrain", "raw");
const ldem = loadLdemFiles(resolve(raw, LDEM_16.imgFile), resolve(raw, LDEM_16.lblFile), LDEM_16);
const args = process.argv.slice(2).map(Number).filter(Number.isFinite);
for (const eHigh of args.length > 0 ? args : [3, 2.5, 2]) {
  const params = { ...DEFAULT_PARAMS, eHigh };
  const { field } = composeGameField(ldem, params);
  const t = performance.now();
  const level = bakeLevel(field, 1024, params);
  console.log(
    JSON.stringify({
      eHigh,
      seconds: Math.round(performance.now() - t) / 1000,
      slope: level.slope,
      relax: level.relax,
      heightRangeM: [level.quant.minM, level.quant.maxM],
    }),
  );
}
