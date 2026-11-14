// Node benchmark of the packages/world hot calls (M1-W1-T01 acceptance: point->plot and height sample costs, no
// allocations in hot calls). Not part of the test suites; run from the repo root with Node 26:
//   node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs packages/world/bench/world-bench.ts
// Allocation check: v8 `total_allocated_bytes` delta over N calls after warm-up (TurboFan-optimised code), i.e. the
// real per-call heap allocation including anything escape analysis could not remove.
import { readFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
import { STANDARD_GRID_PARAMS, type PlotId } from "@moon-cleanup/shared";
import { createPlotGrid, goldenPoints, GroundHeight, HeightCube, padMasksFromManifest } from "../src/index";

const fixtureDir = new URL("../../../assets/terrain/fixtures/", import.meta.url);

function allocated(): number {
  return getHeapStatistics().total_allocated_bytes;
}

interface Row {
  name: string;
  nsPerCall: number;
  bytesPerCall: number;
}
const rows: Row[] = [];
// The harness must not allocate itself: closures return small integers (Smis, never boxed) and the sink is a typed
// array. A double returned through the megamorphic `fn(k)` call would be boxed (16 B) and be charged to the call.
const sink = new Int32Array(1);

function bench(name: string, calls: number, fn: (k: number) => number): void {
  for (let w = 0; w < 3; w++) for (let k = 0; k < calls; k++) sink[0] = (sink[0] ?? 0) ^ fn(k); // warm-up / optimise
  const a0 = allocated();
  const t0 = performance.now();
  for (let k = 0; k < calls; k++) sink[0] = (sink[0] ?? 0) ^ fn(k);
  const t1 = performance.now();
  const a1 = allocated();
  rows.push({ name, nsPerCall: ((t1 - t0) * 1e6) / calls, bytesPerCall: (a1 - a0) / calls });
}

// ---- grid build ----
const builds: number[] = [];
let grid = createPlotGrid(STANDARD_GRID_PARAMS);
for (let r = 0; r < 3; r++) {
  const t0 = performance.now();
  grid = createPlotGrid(STANDARD_GRID_PARAMS);
  builds.push(performance.now() - t0);
}

// ---- point -> plot ----
const N = 200_000;
const pts = goldenPoints(N, 0xbe9c4);
class ScratchDir {
  x = 0.5;
  y = 0.5;
  z = 0.5;
}
const dir = new ScratchDir();
const setDir = (k: number): void => {
  dir.x = pts[k * 3] ?? 0;
  dir.y = pts[k * 3 + 1] ?? 0;
  dir.z = pts[k * 3 + 2] ?? 0;
};
bench("harness baseline (empty call)", N, (k) => k);
bench("harness: write scratch direction only", N, (k) => {
  setDir(k);
  return k;
});
bench("plotAt full path (random points)", N, (k) => {
  setDir(k);
  return grid.plotAt(dir);
});

// moving point (avatar / tool head): 5 cm steps along a great-circle-ish path, hint = previous answer
const path = new Float64Array(N * 3);
{
  let x = 0.6;
  const y = 0.6;
  let z = 0.52;
  for (let k = 0; k < N; k++) {
    x += 2.5e-5;
    z -= 1.0e-5;
    const l = Math.hypot(x, y, z);
    path[k * 3] = x / l;
    path[k * 3 + 1] = y / l;
    path[k * 3 + 2] = z / l;
  }
}
let hint = 0 as PlotId;
bench("plotAt hinted (moving point, 5 cm steps)", N, (k) => {
  dir.x = path[k * 3] ?? 0;
  dir.y = path[k * 3 + 1] ?? 0;
  dir.z = path[k * 3 + 2] ?? 0;
  hint = grid.plotAt(dir, hint);
  return hint;
});

const local = { u: 0, v: 0 };
bench("toPlotLocal", N, (k) => {
  setDir(k);
  const id = (k * 7919) % grid.count;
  grid.toPlotLocal(grid.plotAt(dir) as PlotId, dir, local);
  return local.u + id;
});
bench("fromPlotLocal", N, (k) => {
  grid.fromPlotLocal(((k * 7919) % grid.count) as PlotId, (k % 25_600) - 12_800, 3000, dir);
  return (dir.x * 1e6) | 0;
});
bench("neighbors (view)", N, (k) => {
  const v = grid.neighbors(((k * 7919) % grid.count) as PlotId);
  return v[0] ?? 0;
});
bench("chunkOf + localIndexOf", N, (k) => {
  const id = ((k * 7919) % grid.count) as PlotId;
  return grid.chunkOf(id) + grid.localIndexOf(id);
});
bench("frame (cache hits, 1024 hot plots)", N, (k) => (grid.frame((k & 1023) as PlotId).east.x > 0 ? 1 : 0));

// ---- height ----
const fixtureMeta = JSON.parse(readFileSync(new URL("height-cube-fixture-64.json", fixtureDir), "utf8")) as {
  faceSize: number;
  offsetM: number;
  scaleM: number;
};
const fixtureBytes = readFileSync(new URL("height-cube-fixture-64.bin", fixtureDir));
const fixtureCube = new HeightCube(
  fixtureBytes.buffer.slice(fixtureBytes.byteOffset, fixtureBytes.byteOffset + fixtureBytes.byteLength),
  fixtureMeta,
);
// Shipped-size cube (1024^2 per face, 12.6 MB) with synthetic texels: same memory footprint / cache behaviour.
const big = 1026 * 1026 * 6;
const bigData = new Uint16Array(big);
for (let k = 0; k < big; k++) bigData[k] = (Math.imul(k, 2654435761) >>> 16) & 0xffff;
const bigCube = new HeightCube(bigData.buffer, { faceSize: 1024, offsetM: -48, scaleM: 0.0016 });
bench("H_base fixture 64^2 (random points)", N, (k) => {
  setDir(k);
  return (fixtureCube.sample(dir) * 1000) | 0;
});
bench("H_base 1024^2 (random points, cache-cold)", N, (k) => {
  setDir(k);
  return (bigCube.sample(dir) * 1000) | 0;
});
bench("H_base 1024^2 (moving point)", N, (k) => {
  dir.x = path[k * 3] ?? 0;
  dir.y = path[k * 3 + 1] ?? 0;
  dir.z = path[k * 3 + 2] ?? 0;
  return (bigCube.sample(dir) * 1000) | 0;
});
const pads = padMasksFromManifest({
  radiusM: 60,
  blendM: 20,
  sites: [{ dir: [0, 1, 0] }, { dir: [0, -1, 0] }, { dir: [0, 0, -1] }, { dir: [0, 0, 1] }],
});
const ground = new GroundHeight(bigCube, { radiusM: 2000, pads });
bench("H = H_base + H_detail 1024^2 (random points, 4 pads)", N, (k) => {
  setDir(k);
  return (ground.heightAt(dir) * 1000) | 0;
});
bench("H = H_base + H_detail 1024^2 (moving point)", N, (k) => {
  dir.x = path[k * 3] ?? 0;
  dir.y = path[k * 3 + 1] ?? 0;
  dir.z = path[k * 3 + 2] ?? 0;
  return (ground.heightAt(dir) * 1000) | 0;
});

// Caller-loop form: the loop lives in one optimised function that calls the API directly (how the sim / terrain code
// calls it); a double returned by an API call is then usually inlined instead of boxed at the closure boundary.
const sinkF = new Float64Array(1);
function benchLoop(name: string, calls: number, loop: (n: number) => void): void {
  for (let w = 0; w < 3; w++) loop(calls);
  const a0 = allocated();
  const t0 = performance.now();
  loop(calls);
  const t1 = performance.now();
  const a1 = allocated();
  rows.push({ name, nsPerCall: ((t1 - t0) * 1e6) / calls, bytesPerCall: (a1 - a0) / calls });
}
benchLoop("caller loop: H_base 1024^2 sample(dir), random points", N, (n) => {
  let acc = 0;
  for (let k = 0; k < n; k++) {
    dir.x = pts[k * 3]!;
    dir.y = pts[k * 3 + 1]!;
    dir.z = pts[k * 3 + 2]!;
    acc += bigCube.sample(dir);
  }
  sinkF[0] = acc;
});
benchLoop("caller loop: H_base + H_detail heightAt(dir), random points", N, (n) => {
  let acc = 0;
  for (let k = 0; k < n; k++) {
    dir.x = pts[k * 3]!;
    dir.y = pts[k * 3 + 1]!;
    dir.z = pts[k * 3 + 2]!;
    acc += ground.heightAt(dir);
  }
  sinkF[0] = acc;
});
benchLoop("caller loop: plotAt(dir) full path", N, (n) => {
  let acc = 0;
  for (let k = 0; k < n; k++) {
    dir.x = pts[k * 3]!;
    dir.y = pts[k * 3 + 1]!;
    dir.z = pts[k * 3 + 2]!;
    acc += grid.plotAt(dir);
  }
  sinkF[0] = acc;
});

console.log(`node ${process.version}, grid build GP(128,0): ${builds.map((b) => b.toFixed(0)).join(" / ")} ms`);
console.log("| call | ns/call | bytes allocated/call |");
console.log("| --- | ---: | ---: |");
for (const r of rows) console.log(`| ${r.name} | ${r.nsPerCall.toFixed(0)} | ${r.bytesPerCall.toFixed(3)} |`);
console.log("sink", sink[0]);
