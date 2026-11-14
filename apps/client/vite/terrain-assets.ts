// Vite plugin (M0-W3-T06, from the M0-W3-T07 follow-up): serves the baked terrain of `<repo>/assets/terrain` at
// `/assets/terrain/` in dev and preview, and copies it into the build as `assets/terrain/*`. Only the manifest and the
// content-hashed payloads it lists are exposed (never `raw/`, `cache/` or `fixtures/`; the raw LOLA tile must not
// reach `dist`). Cee approved shipping all listed terrain files (256 and 1024 cubes, horizon map) in `dist`.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Connect, Plugin } from "vite";

const URL_PREFIX = "/assets/terrain/";
const PAYLOAD = /^(height-cube-(256|1024)|horizon-map)\.[0-9a-f]+\.bin$/;

interface TerrainManifest {
  readonly outputs?: Readonly<Record<string, { readonly file?: string }>>;
}

/** File names under `assets/terrain` that may be served: `manifest.json` plus the payloads the manifest lists. */
export function listTerrainFiles(dir: string): string[] {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TerrainManifest;
  const names = Object.values(manifest.outputs ?? {}).flatMap((output) =>
    output.file !== undefined && PAYLOAD.test(output.file) ? [output.file] : [],
  );
  return ["manifest.json", ...names];
}

export function terrainAssets(repoRoot: string): Plugin {
  const dir = resolve(repoRoot, "assets/terrain");
  const serve = (middlewares: Connect.Server): void => {
    middlewares.use((req, res, next) => {
      const url = (req.url ?? "").split("?")[0] ?? "";
      if (!url.startsWith(URL_PREFIX)) return next();
      const name = decodeURIComponent(url.slice(URL_PREFIX.length));
      if (!listTerrainFiles(dir).includes(name)) return next();
      res.setHeader("Content-Type", name.endsWith(".json") ? "application/json" : "application/octet-stream");
      res.setHeader("Cache-Control", name.endsWith(".bin") ? "public, max-age=31536000, immutable" : "no-cache");
      res.end(readFileSync(join(dir, name)));
    });
  };
  return {
    name: "mc-terrain-assets",
    configureServer(server) {
      serve(server.middlewares);
    },
    configurePreviewServer(server) {
      serve(server.middlewares);
    },
    generateBundle() {
      for (const name of listTerrainFiles(dir)) {
        this.emitFile({ type: "asset", fileName: `assets/terrain/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}
