// Browser half of the height-twin readback check (M1-W2-T01, WDS section 3.5: TSL twin within +-2 cm of the JS ground
// function at 10,000 seeded points). Not part of the game bundle: open it through the dev server,
//   /src/terrain/verify/index.html?backend=webgpu|webgl2&n=10000&seed=1
// Seeded unit directions go to the GPU in an RGBA32F texture; a full-screen pass evaluates `heightAtDirection` per
// texel into an RGBA32F target; the target is read back and compared with `GroundHeight` on the same float32
// directions. The result is left in `window.__terrainVerify`.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TSL from "three/tsl";
import {
  DataTexture,
  FloatType,
  NearestFilter,
  NoColorSpace,
  NodeMaterial,
  QuadMesh,
  RGBAFormat,
  RenderTarget,
  Scene,
  type Object3D,
  WebGPURenderer,
} from "three/webgpu";
import { DEFAULT_HEIGHT_DETAIL, GroundHeight, type HeightDetailParams } from "@moon-cleanup/world";
import { loadTerrainAsset } from "../height-asset";
import { createHeightTexture, createHeightTwin } from "../height/height-twin";

const t = TSL as unknown as Record<string, (...args: any[]) => any>;
const { Fn, floor, ivec2, screenCoordinate, textureLoad, vec4 } = t as any;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<unknown> {
  const q = new URLSearchParams(location.search);
  const wantWebGL = q.get("backend") === "webgl2";
  const n = Number(q.get("n") ?? 10_000);
  const seed = Number(q.get("seed") ?? 1);
  const side = Math.ceil(Math.sqrt(n));
  const count = side * side;

  const renderer = new WebGPURenderer({ forceWebGL: wantWebGL, antialias: false });
  renderer.setSize(side, side, false);
  await renderer.init();
  const backend =
    (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend === true ? "webgpu" : "webgl2";

  const asset = await loadTerrainAsset({ baseUrl: q.get("terrainUrl") ?? "/assets/terrain/" });
  // `part` narrows the comparison (diagnosis): base = H_base only, craters / noise = H_base + that term, full = all.
  const part = q.get("part") ?? "full";
  const detail: HeightDetailParams | null =
    part === "base"
      ? null
      : part === "craters"
        ? { ...DEFAULT_HEIGHT_DETAIL, noise: [] }
        : part === "noise"
          ? { ...DEFAULT_HEIGHT_DETAIL, craterBands: [] }
          : DEFAULT_HEIGHT_DETAIL;
  const ground = new GroundHeight(asset.cube, { radiusM: asset.radiusM, pads: asset.pads, detail });
  const twin = createHeightTwin({
    cube: asset.cube,
    texture: createHeightTexture(asset.cube),
    radiusM: asset.radiusM,
    pads: asset.pads,
    detail,
  });

  // Uniform on the sphere; every 10th point is pulled next to Boreal (pads and the pilot area).
  const rnd = mulberry(seed);
  const dirs = new Float32Array(count * 4);
  for (let k = 0; k < count; k++) {
    let x: number;
    let y: number;
    let z: number;
    if (k % 10 === 9) {
      const theta = (rnd() * 950) / asset.radiusM;
      const phi = 2 * Math.PI * rnd();
      x = Math.sin(theta) * Math.cos(phi);
      y = Math.cos(theta);
      z = Math.sin(theta) * Math.sin(phi);
    } else {
      z = 2 * rnd() - 1;
      const phi = 2 * Math.PI * rnd();
      const s = Math.sqrt(1 - z * z);
      x = s * Math.cos(phi);
      y = s * Math.sin(phi);
    }
    dirs[k * 4] = x;
    dirs[k * 4 + 1] = y;
    dirs[k * 4 + 2] = z;
    dirs[k * 4 + 3] = k;
  }
  const dirTexture = new DataTexture(dirs, side, side, RGBAFormat, FloatType);
  dirTexture.colorSpace = NoColorSpace;
  dirTexture.magFilter = NearestFilter;
  dirTexture.minFilter = NearestFilter;
  dirTexture.generateMipmaps = false;
  dirTexture.needsUpdate = true;

  const material = new NodeMaterial();
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.fragmentNode = Fn(() => {
    const texel = textureLoad(dirTexture, ivec2(floor(screenCoordinate.xy))).toVar();
    return vec4(twin.heightAtDirection(texel.xyz), texel.w, 0, 1);
  })();

  const target = new RenderTarget(side, side, { type: FloatType, format: RGBAFormat, depthBuffer: false });
  target.texture.colorSpace = NoColorSpace;
  target.texture.magFilter = NearestFilter;
  target.texture.minFilter = NearestFilter;
  target.texture.generateMipmaps = false;
  const quad = new QuadMesh(material);
  renderer.setRenderTarget(target);
  const t0 = performance.now();
  quad.render(renderer);
  const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, side, side)) as Float32Array;
  const gpuMs = performance.now() - t0;
  renderer.setRenderTarget(null);

  // `&dump=1`: the generated fragment shader (diagnosis of a backend difference).
  let shader: string | null = null;
  if (q.get("dump") === "1") {
    try {
      const scene = new Scene();
      scene.add(quad as unknown as Object3D);
      const dbg = (renderer as any).debug;
      const got = await dbg.getShaderAsync(scene, (quad as any).camera, quad);
      shader = String(got.fragmentShader);
    } catch (e) {
      shader = "dump failed: " + String(e);
    }
  }

  const errors = new Float64Array(count);
  let seen = 0;
  let worst = { index: -1, errorM: 0, gpuM: 0, jsM: 0, dir: [0, 0, 0] };
  let over = 0;
  let sum2 = 0;
  const seenFlags = new Uint8Array(count);
  for (let pix = 0; pix < count; pix++) {
    const k = Math.round(pixels[pix * 4 + 1]!);
    if (!(k >= 0 && k < count) || seenFlags[k] === 1) continue;
    seenFlags[k] = 1;
    seen++;
    const x = dirs[k * 4]!;
    const y = dirs[k * 4 + 1]!;
    const z = dirs[k * 4 + 2]!;
    const js = ground.heightAtXYZ(x, y, z);
    const gpu = pixels[pix * 4]!;
    const e = Math.abs(gpu - js);
    errors[k] = e;
    sum2 += e * e;
    if (e > 0.02) over++;
    if (e > worst.errorM) worst = { index: k, errorM: e, gpuM: gpu, jsM: js, dir: [x, y, z] };
  }
  const sorted = Float64Array.from(errors).sort();
  const result = {
    backend,
    requestedBackend: wantWebGL ? "webgl2" : "webgpu",
    part,
    points: count,
    pointsReadBack: seen,
    toleranceM: 0.02,
    over2cm: over,
    maxErrorM: worst.errorM,
    p50ErrorM: sorted[Math.floor(count * 0.5)]!,
    p99ErrorM: sorted[Math.floor(count * 0.99)]!,
    rmsErrorM: Math.sqrt(sum2 / Math.max(1, seen)),
    worst,
    pass: seen === count && over === 0,
    renderAndReadbackMs: gpuMs,
    cube: asset.file,
    shader,
  };
  return result;
}

main().then(
  (r) => {
    (window as unknown as Record<string, unknown>)["__terrainVerify"] = r;
    document.getElementById("out")!.textContent = JSON.stringify(r, null, 2);
  },
  (e: unknown) => {
    const r = { error: String(e), stack: e instanceof Error ? e.stack : undefined, pass: false };
    (window as unknown as Record<string, unknown>)["__terrainVerify"] = r;
    document.getElementById("out")!.textContent = JSON.stringify(r, null, 2);
  },
);
