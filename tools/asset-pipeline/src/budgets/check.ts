// Budget checker: validates every asset in a manifest against its class budget, the 10 MiB per-file rule and
// the content-hash naming contract. Errors fail the run; warnings are reported and do not.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { type GlbStats, glbStats } from "../gltf/io.js";
import { HASHED_NAME_PATTERN, MANIFEST_FILE, type ManifestAsset, readManifest, sha256Hex } from "../manifest.js";
import { CLASS_BUDGETS, type ClassBudget, MAX_FILE_BYTES } from "./budgets.js";

export type FindingLevel = "error" | "warning";

export type FindingCode =
  | "MANIFEST_UNREADABLE"
  | "FILE_MISSING"
  | "NAME_NOT_HASHED"
  | "HASH_MISMATCH"
  | "BYTES_MISMATCH"
  | "FILE_TOO_LARGE"
  | "ASSET_BYTES_OVER_BUDGET"
  | "UNKNOWN_CLASS"
  | "UNLISTED_FILE"
  | "MESHOPT_MISSING"
  | "LOD_CHAIN_INCOMPLETE"
  | "PIECE_MISSING"
  | "TRIANGLES_OVER_BUDGET"
  | "TRIANGLES_BELOW_RANGE"
  | "TEXTURE_TOO_LARGE"
  | "TEXTURE_COUNT_OVER_BUDGET"
  | "TEXTURE_NOT_KTX2"
  | "MATERIALS_OVER_BUDGET";

export interface Finding {
  readonly level: FindingLevel;
  readonly code: FindingCode;
  readonly asset: string;
  readonly message: string;
}

export interface AssetReport {
  readonly id: string;
  readonly file: string;
  readonly bytes: number;
  readonly stats: GlbStats | null;
}

export interface CheckResult {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  readonly assets: readonly AssetReport[];
}

export interface CheckOptions {
  /** Hard per-file cap; defaults to the CI rule (10 MiB). */
  readonly maxFileBytes?: number;
  readonly budgets?: Readonly<Record<string, ClassBudget>>;
}

const IGNORED_FILES = new Set([MANIFEST_FILE, "README.md", ".gitkeep"]);

/** Pure budget comparison for one asset; exported for unit tests. */
export function checkStats(id: string, bytes: number, stats: GlbStats, budget: ClassBudget): Finding[] {
  const findings: Finding[] = [];
  const add = (level: FindingLevel, code: FindingCode, message: string): void => {
    findings.push({ level, code, asset: id, message });
  };
  if (bytes > budget.maxAssetBytes) {
    add("error", "ASSET_BYTES_OVER_BUDGET", `${bytes} bytes; the ${budget.label} cap is ${budget.maxAssetBytes}`);
  }
  if (!stats.extensionsUsed.includes("EXT_meshopt_compression")) {
    add("error", "MESHOPT_MISSING", "geometry is not meshopt-compressed (EXT_meshopt_compression absent)");
  }
  const required = budget.lodMaxTriangles.length;
  if (stats.lodTriangles.length < required || stats.lodTriangles.slice(0, required).some((count) => count === 0)) {
    add(
      "error",
      "LOD_CHAIN_INCOMPLETE",
      `found LOD triangle counts [${stats.lodTriangles.join(", ")}] (+${stats.unassignedTriangles} without a _LOD suffix); ` +
        `${budget.label} needs ${required} levels named <id>_LOD0..${required - 1}`,
    );
  }
  budget.lodMaxTriangles.forEach((max, lod) => {
    const count = stats.lodTriangles[lod] ?? 0;
    if (count > max) add("error", "TRIANGLES_OVER_BUDGET", `LOD${lod} has ${count} triangles; the budget is ${max}`);
  });
  for (const [piece, caps] of Object.entries(budget.pieces ?? {})) {
    const counts = stats.pieceLodTriangles[piece];
    if (counts === undefined || counts.length < caps.length || counts.slice(0, caps.length).some((n) => n === 0)) {
      add(
        "error",
        "PIECE_MISSING",
        `kit piece "${piece}" needs nodes ${piece}_LOD0..${caps.length - 1}; found [${(counts ?? []).join(", ")}]`,
      );
      continue;
    }
    caps.forEach((max, lod) => {
      const count = counts[lod] ?? 0;
      if (count > max) add("error", "TRIANGLES_OVER_BUDGET", `${piece} LOD${lod} has ${count} triangles; the budget is ${max}`);
    });
  }
  if (stats.unassignedTriangles > (budget.lodMaxTriangles[0] ?? 0)) {
    add(
      "error",
      "TRIANGLES_OVER_BUDGET",
      `${stats.unassignedTriangles} triangles outside the LOD chain exceed the LOD0 budget`,
    );
  }
  const lod0 = stats.lodTriangles[0] ?? 0;
  if (lod0 > 0 && lod0 < budget.lod0MinTriangles) {
    add(
      "warning",
      "TRIANGLES_BELOW_RANGE",
      `LOD0 has ${lod0} triangles; the expected range starts at ${budget.lod0MinTriangles}`,
    );
  }
  for (const texture of stats.textures) {
    if (Math.max(texture.width, texture.height) > budget.maxTextureSize) {
      add(
        "error",
        "TEXTURE_TOO_LARGE",
        `${texture.name} is ${texture.width}x${texture.height}; the budget is ${budget.maxTextureSize} px`,
      );
    }
    if (texture.mimeType !== "image/ktx2") {
      add(
        "warning",
        "TEXTURE_NOT_KTX2",
        `${texture.name} is ${texture.mimeType}, not KTX2 (ADR-0013); re-run assets:build with the ktx CLI (KTX_PATH or tools/.bin/ktx)`,
      );
    }
  }
  if (stats.textures.length > budget.maxTextures) {
    add("error", "TEXTURE_COUNT_OVER_BUDGET", `${stats.textures.length} textures; the budget is ${budget.maxTextures}`);
  }
  if (stats.materials > budget.maxMaterials) {
    add("error", "MATERIALS_OVER_BUDGET", `${stats.materials} materials; the budget is ${budget.maxMaterials}`);
  }
  return findings;
}

async function checkAsset(
  directory: string,
  id: string,
  asset: ManifestAsset,
  options: Required<CheckOptions>,
): Promise<{ findings: Finding[]; report: AssetReport }> {
  const findings: Finding[] = [];
  const add = (level: FindingLevel, code: FindingCode, message: string): void => {
    findings.push({ level, code, asset: id, message });
  };
  let bytes: Uint8Array;
  try {
    bytes = await readFile(join(directory, asset.file));
  } catch {
    add("error", "FILE_MISSING", `${asset.file} is listed in the manifest but does not exist`);
    return { findings, report: { id, file: asset.file, bytes: 0, stats: null } };
  }
  const digest = sha256Hex(bytes);
  const nameHash = HASHED_NAME_PATTERN.exec(asset.file)?.[1];
  if (nameHash === undefined) {
    add("error", "NAME_NOT_HASHED", `${asset.file} does not match name.<8+ hex>.ext`);
  } else if (!digest.startsWith(nameHash)) {
    add(
      "error",
      "HASH_MISMATCH",
      `${asset.file}: the name hash is not the SHA-256 prefix of the content (${digest.slice(0, nameHash.length)})`,
    );
  }
  if (digest !== asset.sha256) add("error", "HASH_MISMATCH", `${asset.file}: manifest sha256 does not match the file`);
  if (bytes.byteLength !== asset.bytes) {
    add("error", "BYTES_MISMATCH", `${asset.file}: manifest says ${asset.bytes} bytes, file has ${bytes.byteLength}`);
  }
  if (bytes.byteLength > options.maxFileBytes) {
    add(
      "error",
      "FILE_TOO_LARGE",
      `${asset.file} is ${bytes.byteLength} bytes; the per-file limit is ${options.maxFileBytes} (ADR-0017)`,
    );
  }
  const budget = options.budgets[asset.class];
  if (!budget) {
    add("error", "UNKNOWN_CLASS", `class "${asset.class}" has no budget entry`);
    return { findings, report: { id, file: asset.file, bytes: bytes.byteLength, stats: null } };
  }
  const stats = await glbStats(bytes);
  findings.push(...checkStats(id, bytes.byteLength, stats, budget));
  return { findings, report: { id, file: asset.file, bytes: bytes.byteLength, stats } };
}

/** Checks every asset listed in `<directory>/manifest.json` and flags files the manifest does not list. */
export async function checkDirectory(directory: string, options: CheckOptions = {}): Promise<CheckResult> {
  const resolved: Required<CheckOptions> = {
    maxFileBytes: options.maxFileBytes ?? MAX_FILE_BYTES,
    budgets: options.budgets ?? CLASS_BUDGETS,
  };
  const findings: Finding[] = [];
  const assets: AssetReport[] = [];
  let manifest;
  try {
    manifest = await readManifest(directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      findings: [{ level: "error", code: "MANIFEST_UNREADABLE", asset: "(manifest)", message }],
      assets,
    };
  }
  const listed = new Set<string>();
  for (const id of Object.keys(manifest.assets).sort()) {
    const asset = manifest.assets[id];
    if (!asset) continue;
    listed.add(asset.file);
    const result = await checkAsset(directory, id, asset, resolved);
    findings.push(...result.findings);
    assets.push(result.report);
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || IGNORED_FILES.has(entry.name) || listed.has(entry.name)) continue;
    findings.push({
      level: "error",
      code: "UNLISTED_FILE",
      asset: entry.name,
      message: `${entry.name} is not listed in ${MANIFEST_FILE}`,
    });
  }
  return { ok: findings.every((finding) => finding.level !== "error"), findings, assets };
}

export function formatResult(directory: string, result: CheckResult): string {
  const lines: string[] = [`assets:check ${directory}`];
  for (const asset of result.assets) {
    const stats = asset.stats;
    const detail = stats
      ? `LOD triangles [${stats.lodTriangles.join(", ")}], ${stats.textures.length} textures (max ${Math.max(0, ...stats.textures.map((t) => Math.max(t.width, t.height)))} px), ${stats.materials} material(s)`
      : "not inspected";
    lines.push(`  ${asset.id}: ${asset.file} ${asset.bytes} bytes; ${detail}`);
  }
  for (const finding of result.findings) {
    lines.push(`  ${finding.level.toUpperCase()} ${finding.code} ${finding.asset}: ${finding.message}`);
  }
  const errors = result.findings.filter((finding) => finding.level === "error").length;
  const warnings = result.findings.length - errors;
  lines.push(
    `${result.ok ? "PASS" : "FAIL"}: ${result.assets.length} asset(s), ${errors} error(s), ${warnings} warning(s)`,
  );
  return lines.join("\n");
}
