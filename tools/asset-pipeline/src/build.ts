// assets:build - source script -> raw GLB (headless Blender) -> glTF-Transform (meshopt) -> content-hashed
// file + manifest.json -> budget check. Usage:
//   tsx src/build.ts [--out <dir>] [--only <id>] [--skip-source] [--turntables <dir>]
// --skip-source reuses the cached raw GLB (no Blender needed); --turntables renders the method-preview
// turntables (slow, CPU renderer) into <dir>.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { ASSETS, type AssetSource } from "./assets.js";
import { blenderVersion, runBlender } from "./blender/run.js";
import { checkDirectory, formatResult } from "./budgets/check.js";
import { glbStats, optimizeGlb } from "./gltf/io.js";
import {
  type AssetManifest,
  hashedFileName,
  MANIFEST_FILE,
  type ManifestAsset,
  readManifest,
  sha256Hex,
  writeManifest,
} from "./manifest.js";
import { BLENDER_SCRIPT_DIR, CACHE_DIR, PROOF_OUT_DIR, REPO_ROOT } from "./paths.js";
import { detectKtx, type EncodedTexture, type KtxStatus } from "./textures/ktx.js";

interface Options {
  readonly outDir: string;
  readonly only: string | null;
  readonly skipSource: boolean;
  readonly turntableDir: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  let outDir = PROOF_OUT_DIR;
  let only: string | null = null;
  let skipSource = false;
  let turntableDir: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--out" && next !== undefined) {
      outDir = resolve(next);
      i += 1;
    } else if (arg === "--only" && next !== undefined) {
      only = next;
      i += 1;
    } else if (arg === "--turntables" && next !== undefined) {
      turntableDir = resolve(next);
      i += 1;
    } else if (arg === "--skip-source") {
      skipSource = true;
    } else {
      throw new Error(`unknown argument: ${String(arg)}`);
    }
  }
  return { outDir, only, skipSource, turntableDir };
}

const log: string[] = [];
function say(line: string): void {
  log.push(line);
  console.log(line);
}

interface AssetTiming {
  readonly id: string;
  readonly blenderSeconds: number;
  readonly optimizeSeconds: number;
  readonly turntableSeconds: number;
  readonly rawBytes: number;
  readonly outputBytes: number;
}

async function buildAsset(
  asset: AssetSource,
  options: Options,
  ktx: KtxStatus,
): Promise<{ entry: ManifestAsset; timing: AssetTiming }> {
  const cache = join(CACHE_DIR, asset.id);
  await mkdir(cache, { recursive: true });
  const rawPath = join(cache, `${asset.id}.raw.glb`);
  const reportPath = join(cache, "report.json");
  let blenderSeconds = 0;
  if (options.skipSource) {
    if (!existsSync(rawPath)) throw new Error(`--skip-source: ${rawPath} is missing; run without the flag once`);
    say(`[${asset.id}] 1/4 source: reusing cached raw GLB (--skip-source)`);
  } else {
    say(`[${asset.id}] 1/4 source: blender --background --python ${asset.script}`);
    const run = runBlender(join(REPO_ROOT, asset.script), [
      "--out",
      rawPath,
      "--report",
      reportPath,
      "--texdir",
      cache,
    ]);
    for (const line of run.log) say(`    ${line}`);
    if (!run.ok || !existsSync(rawPath)) throw new Error(`Blender failed for ${asset.id}`);
    blenderSeconds = run.seconds;
    say(`[${asset.id}]     Blender wall time ${run.seconds.toFixed(1)} s`);
  }

  const optimizeStart = performance.now();
  const raw = await readFile(rawPath);
  let encoded: EncodedTexture[] = [];
  const optimized = await optimizeGlb(raw, ktx, (t) => {
    encoded = t;
  });
  const stats = await glbStats(optimized);
  const optimizeSeconds = (performance.now() - optimizeStart) / 1000;
  say(
    `[${asset.id}] 2/4 glTF-Transform: dedup, prune, weld, meshopt (reorder + quantize + EXT_meshopt_compression): ` +
      `${raw.byteLength} -> ${optimized.byteLength} bytes in ${optimizeSeconds.toFixed(2)} s; LOD triangles [${stats.lodTriangles.join(", ")}]`,
  );

  for (const t of encoded) {
    say(
      `[${asset.id}]     KTX2 ${t.codec} ${t.textureClass} ${t.name} ${t.width}x${t.height}: ${t.pngBytes} -> ${t.ktx2Bytes} bytes`,
    );
  }
  const sha256 = sha256Hex(optimized);
  const file = hashedFileName(asset.id, sha256, "glb");
  await mkdir(options.outDir, { recursive: true });
  for (const existing of await readdir(options.outDir)) {
    if (existing.startsWith(`${asset.id}.`) && existing.endsWith(".glb") && existing !== file) {
      await rm(join(options.outDir, existing));
      say(`[${asset.id}]     removed stale ${existing}`);
    }
  }
  await writeFile(join(options.outDir, file), optimized);
  say(`[${asset.id}] 3/4 hashed output: ${relative(REPO_ROOT, join(options.outDir, file)).replaceAll("\\", "/")}`);

  let turntableSeconds = 0;
  if (options.turntableDir) {
    await mkdir(options.turntableDir, { recursive: true });
    const args = [
      "--glb",
      rawPath,
      "--outdir",
      options.turntableDir,
      "--name",
      asset.id,
      "--lamp-cd",
      String(asset.turntableLampCandela),
    ];
    if (asset.measurePalette)
      args.push("--palette", join(options.turntableDir, `${asset.id}-palette.json`), "--scratch", cache);
    say(`[${asset.id}] 4/4 turntable (method preview, headless Blender): 8 views x noon + night-near at 1920x1080`);
    const run = runBlender(join(BLENDER_SCRIPT_DIR, "turntable.py"), args, 3 * 60 * 60 * 1000);
    for (const line of run.log) say(`    ${line}`);
    if (!run.ok) throw new Error(`turntable failed for ${asset.id}`);
    turntableSeconds = run.seconds;
  } else {
    say(`[${asset.id}] 4/4 turntable: skipped (pass --turntables <dir>)`);
  }

  const entry: ManifestAsset = {
    file,
    class: asset.class,
    bytes: optimized.byteLength,
    sha256,
    source: asset.script,
    textureFormat:
      stats.textures.length === 0 ? "none" : stats.textures.every((t) => t.mimeType === "image/ktx2") ? "ktx2" : "png",
    ...(asset.placeholder ? { placeholder: true } : {}),
    ...(asset.replaceBy === undefined ? {} : { replaceBy: asset.replaceBy }),
  };
  return {
    entry,
    timing: {
      id: asset.id,
      blenderSeconds,
      optimizeSeconds,
      turntableSeconds,
      rawBytes: raw.byteLength,
      outputBytes: optimized.byteLength,
    },
  };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const selected = ASSETS.filter((asset) => options.only === null || asset.id === options.only);
  if (selected.length === 0) throw new Error(`no asset matches --only ${String(options.only)}`);
  say(`assets:build -> ${options.outDir}`);
  if (!options.skipSource || options.turntableDir) {
    const version = blenderVersion();
    if (version === null) {
      throw new Error(
        "headless Blender not found (set BLENDER_PATH). The Node-only modelling path is not implemented.",
      );
    }
    say(`blender: ${version}`);
  }
  const ktx = detectKtx();
  say(`ktx: ${ktx.detail}`);

  const assets: Record<string, ManifestAsset> = {};
  if (options.only !== null && existsSync(join(options.outDir, MANIFEST_FILE))) {
    // --only rebuilds one asset and keeps the other manifest entries.
    Object.assign(assets, (await readManifest(options.outDir)).assets);
  }
  const timings: AssetTiming[] = [];
  for (const asset of selected) {
    const { entry, timing } = await buildAsset(asset, options, ktx);
    assets[asset.id] = entry;
    timings.push(timing);
  }
  const manifest: AssetManifest = { schema: 1, generator: "@moon-cleanup/asset-pipeline assets:build", assets };
  await writeManifest(options.outDir, manifest);
  say(
    `manifest: ${relative(REPO_ROOT, join(options.outDir, MANIFEST_FILE)).replaceAll("\\", "/")} (${Object.keys(assets).length} asset(s))`,
  );

  const result = await checkDirectory(options.outDir);
  say(formatResult(options.outDir, result));

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, "build-log.txt"), `${log.join("\n")}\n`, "utf8");
  await writeFile(join(CACHE_DIR, "throughput.json"), `${JSON.stringify(timings, null, 2)}\n`, "utf8");
  return result.ok ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  },
);
