// First-load size check (docs/architecture/performance-budgets.md section 5 and 8): fails when the gzip-compressed
// first-load group of a built client is over 20 MB. Usage: node size-check.mjs <dist-dir> [limit-bytes]
// First-load group = every file in <dist-dir> except source maps and anything under assets/deferred/ (streamed after
// the first session starts, performance-budgets.md section 5).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

const dir = process.argv[2];
const limit = Number(process.argv[3] ?? 20 * 1024 * 1024);
if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory() || !Number.isFinite(limit)) {
  console.error("usage: node size-check.mjs <dist-dir> [limit-bytes]; dist-dir must exist (run the build first)");
  process.exit(2);
}

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let total = 0;
for (const file of walk(dir)) {
  const rel = relative(dir, file).split(sep).join("/");
  if (rel.endsWith(".map") || rel.startsWith("assets/deferred/")) continue;
  total += gzipSync(readFileSync(file)).length;
}
const mb = (total / 1024 / 1024).toFixed(2);
console.log(`first-load group: ${mb} MB gzip (limit ${(limit / 1024 / 1024).toFixed(2)} MB)`);
if (total > limit) {
  console.error("::error::First-load group is over the budget (performance-budgets.md section 5)");
  process.exit(1);
}
