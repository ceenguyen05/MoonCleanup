// Loads and decodes the baked terrain of assets/terrain for bench v1 (M0-W3-T07): manifest -> height cube (256 or 1024) and
// horizon map, inflated with `DecompressionStream("deflate-raw")`. Everything happens once at start-up on the main thread
// (JS decode is fine for the spike; the production loader streams and decodes in a worker). Timings are recorded so the
// bench report can quote them; `verify` hashes the inflated payload against the manifest's `rawSha256` (Web Crypto).

import { decodeHeightCube, decodeHorizonMap, type HeightCube, type HorizonCube, type Inflate } from "./terrain-cube";

export interface TerrainLoadOptions {
  /** Directory URL of the baked files and `manifest.json`, with a trailing slash. */
  readonly baseUrl: string;
  readonly cube: 256 | 1024;
  /** Also fetch and decode the horizon map (7 MB). */
  readonly horizon: boolean;
  /** Compare the inflated payload hashes with the manifest. */
  readonly verify: boolean;
  readonly inflate?: Inflate;
  readonly fetchBytes?: (url: string) => Promise<Uint8Array>;
}

export interface TerrainLoadReport {
  readonly baseUrl: string;
  readonly cubeFaceSize: number;
  readonly cubeFile: string;
  readonly cubeBytes: number;
  readonly horizonFile: string | null;
  readonly horizonBytes: number;
  readonly fetchMs: number;
  readonly decodeMs: number;
  /** null when not requested; otherwise whether every checked payload matched the manifest. */
  readonly rawHashesMatch: boolean | null;
  readonly bakeHash: string;
}

export interface LoadedTerrain {
  readonly height: HeightCube;
  readonly horizon: HorizonCube | null;
  readonly report: TerrainLoadReport;
}

interface ManifestOutput {
  readonly file?: string;
  readonly rawSha256?: string;
}
interface Manifest {
  readonly outputs?: Record<string, ManifestOutput>;
  readonly bakeHash?: string;
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const now = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());

export async function loadBakedTerrain(options: TerrainLoadOptions): Promise<LoadedTerrain> {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  const t0 = now();
  const manifest = JSON.parse(
    new TextDecoder().decode(await fetchBytes(`${options.baseUrl}manifest.json`)),
  ) as Manifest;
  const outputs = manifest.outputs ?? {};
  const cubeOut = outputs[`height-cube-${String(options.cube)}`];
  const horizonOut = options.horizon ? outputs["horizon-map"] : undefined;
  if (cubeOut?.file === undefined) throw new Error(`manifest has no height-cube-${String(options.cube)}`);
  if (options.horizon && horizonOut?.file === undefined) throw new Error("manifest has no horizon-map");

  const [cubeBytes, horizonBytes] = await Promise.all([
    fetchBytes(`${options.baseUrl}${cubeOut.file}`),
    horizonOut?.file === undefined ? Promise.resolve(null) : fetchBytes(`${options.baseUrl}${horizonOut.file}`),
  ]);
  const t1 = now();

  const height = await decodeHeightCube(cubeBytes, options.inflate);
  const horizon = horizonBytes === null ? null : await decodeHorizonMap(horizonBytes, options.inflate);
  const t2 = now();

  let rawHashesMatch: boolean | null = null;
  if (options.verify) {
    rawHashesMatch = (await sha256Hex(height.raw)) === cubeOut.rawSha256;
    if (horizon !== null && horizonOut !== undefined) {
      rawHashesMatch = rawHashesMatch && (await sha256Hex(horizon.raw)) === horizonOut.rawSha256;
    }
  }
  return {
    height: height.value,
    horizon: horizon === null ? null : horizon.value,
    report: {
      baseUrl: options.baseUrl,
      cubeFaceSize: height.value.faceSize,
      cubeFile: cubeOut.file,
      cubeBytes: cubeBytes.length,
      horizonFile: horizonOut?.file ?? null,
      horizonBytes: horizonBytes?.length ?? 0,
      fetchMs: t1 - t0,
      decodeMs: t2 - t1,
      rawHashesMatch,
      bakeHash: manifest.bakeHash ?? "",
    },
  };
}
