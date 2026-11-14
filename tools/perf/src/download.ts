// Download size: gzipped bytes of a built `dist/` folder (budgets section 5). Gzip level 9 approximates what the CDN
// sends (Brotli would be smaller), so the figure is an upper bound.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { DownloadSizes } from "./schema";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

export async function measureDist(distDir: string): Promise<DownloadSizes> {
  let jsGzipBytes = 0;
  let totalGzipBytes = 0;
  let files = 0;
  for await (const file of walk(distDir)) {
    const gz = gzipSync(await readFile(file), { level: 9 }).length;
    totalGzipBytes += gz;
    files += 1;
    if (/\.(m?js)$/.test(file)) jsGzipBytes += gz;
  }
  return { jsGzipBytes, totalGzipBytes, files };
}
