// Loads the baked height cube of assets/terrain (manifest + CTMH v1 file) into the shared `HeightCube` of
// packages/world. Container: 32-byte header + deflate-raw payload of row-delta coded byte planes (format doc:
// tools/terrain-bake/src/cubemap/codec.ts). Runs once at load; the decode is on the calling thread.

import { HeightCube, padMasksFromManifest, type PadMask } from "@moon-cleanup/world";

export type Inflate = (payload: Uint8Array) => Promise<Uint8Array>;
export type FetchBytes = (url: string) => Promise<Uint8Array>;

export const inflateRaw: Inflate = async (payload) => {
  const stream = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const HEADER_BYTES = 32;

/** Decodes a CTMH v1 file into a `HeightCube`. */
export async function decodeHeightCubeFile(bytes: Uint8Array, inflate: Inflate = inflateRaw): Promise<HeightCube> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "CTMH" || view.getUint16(4, true) !== 1) throw new Error("not a CTMH v1 height cube");
  if (view.getUint16(10, true) !== 1) throw new Error("unsupported height cube codec");
  const n = view.getUint16(6, true);
  const raw = await inflate(bytes.subarray(HEADER_BYTES));
  const p = n + 2;
  const plane = p * p;
  if (raw.length !== 6 * plane * 2) {
    throw new Error(`height cube payload is ${String(raw.length)} bytes, expected ${String(6 * plane * 2)}`);
  }
  const data = new Uint16Array(6 * plane);
  for (let face = 0; face < 6; face++) {
    const dst = face * plane;
    const hi = face * plane * 2;
    const lo = hi + plane;
    for (let j = 0; j < p; j++) {
      const row = j * p;
      let ref = j === 0 ? 0 : data[dst + (j - 1) * p]!;
      for (let i = 0; i < p; i++) {
        ref = (ref + ((raw[hi + row + i]! << 8) | raw[lo + row + i]!)) & 0xffff;
        data[dst + row + i] = ref;
      }
    }
  }
  return new HeightCube(data.buffer, {
    faceSize: n,
    offsetM: view.getFloat64(16, true),
    scaleM: view.getFloat64(24, true),
  });
}

export interface TerrainAssetOptions {
  /** Directory URL of `manifest.json` and the baked files, with a trailing slash. */
  readonly baseUrl: string;
  /** 1024 = the shipped cube; 256 = the preview. */
  readonly cube?: 256 | 1024;
  readonly inflate?: Inflate;
  readonly fetchBytes?: FetchBytes;
}

export interface TerrainAsset {
  readonly cube: HeightCube;
  /** Moon radius R of the bake, metres. */
  readonly radiusM: number;
  /** Outpost pads (procedural detail fades to zero on them). */
  readonly pads: readonly PadMask[];
  readonly bakeHash: string;
  readonly file: string;
  readonly fetchMs: number;
  readonly decodeMs: number;
}

interface Manifest {
  readonly outputs?: Readonly<Record<string, { readonly file?: string }>>;
  readonly bakeHash?: string;
  readonly parameters?: {
    readonly radiusM?: number;
    readonly pads?: {
      readonly radiusM: number;
      readonly blendM: number;
      readonly sites: readonly { readonly dir: readonly number[] }[];
    };
  };
}

/** The baked horizon map (CTMW v1) as two RGBA8 planes sets: azimuths 0..3 and 4..7 per texel, face after face. */
export interface HorizonAsset {
  readonly faceSize: number;
  /** 6 x faceSize^2 x 4 bytes each. */
  readonly a: Uint8Array;
  readonly b: Uint8Array;
  readonly minAngleDeg: number;
  readonly maxAngleDeg: number;
  readonly file: string;
  readonly fetchMs: number;
  readonly decodeMs: number;
}

/** Decodes a CTMW v1 file (per face and azimuth a faceSize^2 uint8 plane, delta coded along rows) into RGBA order. */
export async function decodeHorizonFile(
  bytes: Uint8Array,
  inflate: Inflate = inflateRaw,
): Promise<Pick<HorizonAsset, "faceSize" | "a" | "b" | "minAngleDeg" | "maxAngleDeg">> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "CTMW" || view.getUint16(4, true) !== 1) throw new Error("not a CTMW v1 horizon map");
  const n = view.getUint16(6, true);
  if (view.getUint16(8, true) !== 8) throw new Error("horizon map must hold 8 azimuths");
  const raw = await inflate(bytes.subarray(HEADER_BYTES));
  const plane = n * n;
  if (raw.length !== 6 * 8 * plane) throw new Error(`horizon payload is ${String(raw.length)} bytes`);
  const a = new Uint8Array(6 * plane * 4);
  const b = new Uint8Array(6 * plane * 4);
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 8; k++) {
      const src = (face * 8 + k) * plane;
      const out = k < 4 ? a : b;
      const dst = face * plane * 4 + (k & 3);
      let rowStart = 0;
      for (let j = 0; j < n; j++) {
        // First texel of a row continues from the first texel of the row above; the rest from the left neighbour.
        let ref = (rowStart + raw[src + j * n]!) & 0xff;
        rowStart = ref;
        out[dst + j * n * 4] = ref;
        for (let i = 1; i < n; i++) {
          ref = (ref + raw[src + j * n + i]!) & 0xff;
          out[dst + (j * n + i) * 4] = ref;
        }
      }
    }
  }
  return { faceSize: n, a, b, minAngleDeg: view.getFloat32(16, true), maxAngleDeg: view.getFloat32(20, true) };
}

export async function loadHorizonAsset(options: Omit<TerrainAssetOptions, "cube">): Promise<HorizonAsset> {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  const t0 = now();
  const manifest = JSON.parse(
    new TextDecoder().decode(await fetchBytes(`${options.baseUrl}manifest.json`)),
  ) as Manifest;
  const file = manifest.outputs?.["horizon-map"]?.file;
  if (file === undefined) throw new Error("terrain manifest has no horizon-map");
  const bytes = await fetchBytes(`${options.baseUrl}${file}`);
  const t1 = now();
  const decoded = await decodeHorizonFile(bytes, options.inflate);
  return { ...decoded, file, fetchMs: t1 - t0, decodeMs: now() - t1 };
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

const now = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());

export async function loadTerrainAsset(options: TerrainAssetOptions): Promise<TerrainAsset> {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  const t0 = now();
  const manifest = JSON.parse(
    new TextDecoder().decode(await fetchBytes(`${options.baseUrl}manifest.json`)),
  ) as Manifest;
  const key = `height-cube-${String(options.cube ?? 1024)}`;
  const file = manifest.outputs?.[key]?.file;
  if (file === undefined) throw new Error(`terrain manifest has no ${key}`);
  const bytes = await fetchBytes(`${options.baseUrl}${file}`);
  const t1 = now();
  const cube = await decodeHeightCubeFile(bytes, options.inflate);
  const t2 = now();
  const pads = manifest.parameters?.pads;
  return {
    cube,
    radiusM: manifest.parameters?.radiusM ?? 2000,
    pads: pads === undefined ? [] : padMasksFromManifest(pads),
    bakeHash: manifest.bakeHash ?? "",
    file,
    fetchMs: t1 - t0,
    decodeMs: t2 - t1,
  };
}
