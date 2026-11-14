import { readdirSync } from "node:fs";
import { join } from "node:path";
import { generateIndexMd, measureIntoSidecar } from "./run";

/** Usage: tsx src/measure/cli.ts <capture-dir>. Measures every PNG that has a sidecar, then regenerates index.md. */
const dir = process.argv[2];
if (!dir) {
  console.error("usage: measure <capture-dir>");
  process.exit(2);
}
for (const f of readdirSync(dir).filter((n) => n.endsWith(".png"))) measureIntoSidecar(join(dir, f));
generateIndexMd(dir);
console.log(`measured and indexed ${dir}`);
