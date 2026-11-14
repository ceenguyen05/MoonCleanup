// Asset manifest: maps logical asset ids to content-hashed files. It is the only unhashed file allowed
// beside shipped assets (`.github/workflows/asset-validation.yml`), and the budget checker reads it.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MANIFEST_FILE = "manifest.json";

/** Same pattern as the CI contract: `name.<8+ hex>.ext`. */
export const HASHED_NAME_PATTERN = /\.([0-9a-f]{8,})\.[A-Za-z0-9]+$/;

/** Hex digits of the SHA-256 digest that go into the file name. */
export const HASH_LENGTH = 12;

export interface ManifestAsset {
  /** Hashed file name, relative to the manifest. */
  readonly file: string;
  /** Budget class id (see budgets/budgets.ts). */
  readonly class: string;
  readonly bytes: number;
  /** Full SHA-256 of the file; the name carries its first HASH_LENGTH digits. */
  readonly sha256: string;
  /** Repo-relative source script that produced the asset. */
  readonly source: string;
  /** `ktx2` once the KTX2 step runs; `png` while the `ktx` CLI is missing. */
  readonly textureFormat: "png" | "ktx2" | "none";
  /** art-direction 13.4: placeholder tag plus the milestone by which it is replaced. */
  readonly placeholder?: boolean;
  readonly replaceBy?: string;
}

export interface AssetManifest {
  readonly schema: 1;
  readonly generator: string;
  readonly assets: Readonly<Record<string, ManifestAsset>>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashedFileName(id: string, sha256: string, extension: string): string {
  return `${id}.${sha256.slice(0, HASH_LENGTH)}.${extension}`;
}

export async function readManifest(directory: string): Promise<AssetManifest> {
  const text = await readFile(join(directory, MANIFEST_FILE), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isManifest(parsed)) {
    throw new Error(`${join(directory, MANIFEST_FILE)} is not a schema-1 asset manifest`);
  }
  return parsed;
}

export async function writeManifest(directory: string, manifest: AssetManifest): Promise<void> {
  const sorted: Record<string, ManifestAsset> = {};
  for (const id of Object.keys(manifest.assets).sort()) {
    const asset = manifest.assets[id];
    if (asset) sorted[id] = asset;
  }
  const text = JSON.stringify({ schema: manifest.schema, generator: manifest.generator, assets: sorted }, null, 2);
  await writeFile(join(directory, MANIFEST_FILE), `${text}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManifest(value: unknown): value is AssetManifest {
  if (!isRecord(value) || value["schema"] !== 1 || !isRecord(value["assets"])) return false;
  return Object.values(value["assets"]).every(
    (asset) =>
      isRecord(asset) &&
      typeof asset["file"] === "string" &&
      typeof asset["class"] === "string" &&
      typeof asset["bytes"] === "number" &&
      typeof asset["sha256"] === "string",
  );
}
