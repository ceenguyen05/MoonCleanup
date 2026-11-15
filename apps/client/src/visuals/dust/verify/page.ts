// Browser half of the dust replay check (M1-W3-T02). Not part of the game bundle: open it through the dev server,
//   /src/visuals/dust/verify/index.html?backend=webgpu|webgl2&preset=low|medium|high&frames=1800&pace=flat|raf&gpu=1
// It runs the seeded scenario, executes every batch on the GPU (`DustReplayPass`) and on the CPU reference
// (`CpuAtlas`), reads the atlas back and compares every byte. Tolerance (lead ruling 2026-11-14): R, G and B exact,
// A (berm lip) within 1 per texel. The result is left in `window.__dustVerify`.
// `gpu=1` adds GPU timestamp queries (GPU ms per frame with work) when the backend supports them.
import { WebGPURenderer } from "three/webgpu";
import { CpuAtlas } from "../replay-batch";
import { DustReplayPass } from "../replay-pass";
import type { DUST_TILE_PRESETS } from "../tile-atlas";
import { DustScenario } from "./scenario";

interface Stats {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function stats(list: ArrayLike<number>): Stats {
  const s = Float64Array.from(list).sort();
  const q = (p: number): number => (s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * p))]!);
  let sum = 0;
  for (const v of s) sum += v;
  return { n: s.length, mean: s.length === 0 ? 0 : sum / s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
}

interface Comparison {
  diff: number;
  rgbDiff: number;
  aDiff: number;
  aOver1: number;
  maxDelta: number;
  first: number[][];
}

const heap = (): number =>
  (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? Number.NaN;

let controlSink = 0;
/** A fixed piece of CPU work (about 0.1 ms): when it stalls too, the stall is the machine and not the dust pass. */
function controlWork(): number {
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 20_000; i++) acc += Math.sqrt(i);
  controlSink = acc;
  return performance.now() - t0;
}

async function main(): Promise<unknown> {
  const q = new URLSearchParams(location.search);
  const wantWebGL = q.get("backend") === "webgl2";
  const presetName = (q.get("preset") ?? "medium") as keyof typeof DUST_TILE_PRESETS;
  const frames = Number(q.get("frames") ?? 1800);
  const pace = q.get("pace") ?? "flat";
  const wantGpu = q.get("gpu") === "1";

  const renderer = new WebGPURenderer({ forceWebGL: wantWebGL, antialias: false, trackTimestamp: wantGpu });
  renderer.setSize(64, 64);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const isWebGL = (renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend === true;
  const timed = renderer as unknown as { resolveTimestampsAsync(type: string): Promise<unknown> };

  const s = new DustScenario({
    preset: presetName,
    frames,
    resyncFrame: Math.floor(frames / 3),
    moveFrame: Math.floor(frames / 2),
    rebuildAllFrame: Math.floor((frames * 2) / 3),
  });
  const cpu = new CpuAtlas(s.atlas.layout);
  const pass = new DustReplayPass(s.atlas.layout, s.batch);
  const prepared = q.get("prep") !== "0";
  if (prepared) pass.prepare(renderer);

  const total = frames + 600;
  const skip = 12;
  const frameMs = new Float32Array(total);
  const flushMs = new Float32Array(total);
  const controlMs = new Float32Array(total);
  const heapDelta = new Float32Array(total);
  const strokeN = new Int16Array(total);
  const kind = new Uint8Array(total); // 0 idle, 1 strokes, 2 finishes a rebuild
  const gpuStrokeMs: number[] = [];
  const gpuRebuildMs: number[] = [];
  let largest = 0;
  for (let f = 0; f < total; f++) {
    s.step();
    kind[f] = s.batch.residN > 0 ? 2 : s.batch.empty ? 0 : 1;
    strokeN[f] = s.batch.strokeN;
    if (s.batch.strokeN > largest) largest = s.batch.strokeN;
    const h0 = heap();
    const t0 = performance.now();
    pass.flush(renderer);
    flushMs[f] = performance.now() - t0;
    heapDelta[f] = heap() - h0;
    frameMs[f] = s.frameMs;
    controlMs[f] = controlWork();
    if (wantGpu && kind[f] !== 0) {
      const d = await timed.resolveTimestampsAsync("render");
      const ms = typeof d === "number" ? d : ((renderer.info.render as { timestamp?: number }).timestamp ?? 0);
      if (ms > 0 && f >= skip) (kind[f] === 2 ? gpuRebuildMs : gpuStrokeMs).push(ms);
    }
    cpu.execute(s.batch);
    if (pace === "raf") await new Promise((r) => requestAnimationFrame(r));
    else if (f % 32 === 31) await new Promise((r) => setTimeout(r, 0));
  }

  const pick = (source: Float32Array, want: (f: number) => boolean): number[] => {
    const out: number[] = [];
    for (let f = skip; f < total; f++) if (want(f)) out.push(source[f]!);
    return out;
  };
  const totals = new Float32Array(total);
  for (let f = 0; f < total; f++) totals[f] = frameMs[f]! + flushMs[f]!;
  // The six slowest render calls, with what else was true in that frame (tail diagnosis).
  const order = Array.from({ length: total - skip }, (_, i) => i + skip).sort((a, b) => flushMs[b]! - flushMs[a]!);
  const controlP50 = stats(pick(controlMs, () => true)).p50;
  const flushOutliers = order.slice(0, 6).map((f) => ({
    frame: f,
    flushMs: Number(flushMs[f]!.toFixed(3)),
    frameMs: Number(frameMs[f]!.toFixed(3)),
    controlMs: Number(controlMs[f]!.toFixed(3)),
    kind: kind[f],
    strokeN: strokeN[f],
    heapDeltaB: Math.round(heapDelta[f]!),
  }));
  let flushOver1 = 0;
  let flushOver1WithGc = 0;
  let flushOver1WithSlowControl = 0;
  let controlOver1 = 0;
  for (let f = skip; f < total; f++) {
    if (controlMs[f]! > 1) controlOver1++;
    if (kind[f] === 0 || flushMs[f]! <= 1) continue;
    flushOver1++;
    if (heapDelta[f]! < 0) flushOver1WithGc++;
    if (controlMs[f]! > 3 * controlP50) flushOver1WithSlowControl++;
  }

  const w = cpu.width;
  const h = cpu.height;
  const read = await renderer.readRenderTargetPixelsAsync(pass.target, 0, 0, w, h);
  const gpu = new Uint8Array(read.buffer, read.byteOffset, read.byteLength);
  const stride = gpu.length / h;
  // The WebGL2 backend stores a render target bottom-up, so its read-back rows come in reverse order.
  const compare = (reverse: boolean): Comparison => {
    let rgbDiff = 0;
    let aDiff = 0;
    let aOver1 = 0;
    let maxDelta = 0;
    const first: number[][] = [];
    for (let y = 0; y < h; y++) {
      const gy = reverse ? h - 1 - y : y;
      for (let x = 0; x < w * 4; x++) {
        const a = cpu.data[y * w * 4 + x]!;
        const b = gpu[gy * stride + x]!;
        if (a === b) continue;
        const d = Math.abs(a - b);
        if ((x & 3) === 3) {
          aDiff++;
          if (d > 1) aOver1++;
        } else rgbDiff++;
        if (d > maxDelta) maxDelta = d;
        if (first.length < 8) first.push([x >> 2, y, x & 3, a, b]);
      }
    }
    return { diff: rgbDiff + aDiff, rgbDiff, aDiff, aOver1, maxDelta, first };
  };
  const expected = compare(isWebGL);
  const other = compare(!isWebGL);
  let residentBytes = 0;
  let texelsWithStrokeWork = 0;
  for (let p = 0; p < s.atlas.slotOfPlot.length; p++) {
    if (s.atlas.slotOfPlot[p]! >= 0) residentBytes += 4 * s.atlas.layout.slotPx ** 2;
  }
  for (let i = 0; i < cpu.data.length; i += 4) {
    if (cpu.data[i + 1]! > 0 && cpu.data[i + 1]! < 255) texelsWithStrokeWork++;
  }

  // Heap growth of the render call itself (three allocates inside `render()`); needs --enable-precise-memory-info.
  const flushHeapBytesPerPass: number[] = [];
  const controlHeapBytesPerPass: number[] = [];
  if (!wantGpu) {
    for (let k = 0; k < 10; k++) {
      const withFlush = k % 2 === 1;
      const h0 = heap();
      for (let i = 0; i < 200; i++) {
        s.batch.reset();
        s.batch.pushStroke(s.atlas.layout, 0, -500, 0, 500, 0, 15, 80, 8);
        if (withFlush) pass.flush(renderer);
      }
      (withFlush ? flushHeapBytesPerPass : controlHeapBytesPerPass).push((heap() - h0) / 200);
    }
  }

  let adapter: unknown;
  if (isWebGL) {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    adapter = { renderer: gl && ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : "unknown" };
  } else {
    const gpuApi = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: unknown } | null> } }).gpu;
    const info = ((await gpuApi?.requestAdapter())?.info ?? {}) as Record<string, unknown>;
    adapter = {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    };
  }

  return {
    backend: isWebGL ? "webgl2" : "webgpu",
    preset: presetName,
    atlas: [w, h],
    frames: total,
    pace,
    prepared,
    gpuTimestamps: wantGpu,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    adapter,
    userAgent: navigator.userAgent,
    strokes: s.strokes,
    tileStrokeDraws: s.atlas.tileStrokeDraws,
    rebuilds: s.atlas.rebuilds,
    tilesResident: s.atlas.tilesResident,
    zeroEvents: s.zeroEvents,
    polished: s.polished,
    liveOverflows: s.atlas.liveOverflows,
    backlog: s.atlas.rebuildBacklog,
    passes: pass.passes,
    largestBatch: largest,
    bytesCompared: cpu.data.length,
    residentBytes,
    texelsWithStrokeWork,
    // Tolerance: R, G, B exact; A within 1 per texel.
    withinTolerance: expected.rgbDiff === 0 && expected.aOver1 === 0,
    bytesDiffering: expected.diff,
    rgbBytesDiffering: expected.rgbDiff,
    aTexelsDiffering: expected.aDiff,
    aTexelsOver1: expected.aOver1,
    maxDelta: expected.maxDelta,
    firstMismatches: expected.first,
    bytesDifferingOtherRowOrder: other.diff,
    atlasFrameMs: stats(pick(frameMs, () => true)),
    flushStrokeMs: stats(pick(flushMs, (f) => kind[f] === 1)),
    flushRebuildMs: stats(pick(flushMs, (f) => kind[f] === 2)),
    totalMs: stats(pick(totals, () => true)),
    totalWorkMs: stats(pick(totals, (f) => kind[f] !== 0)),
    controlMs: stats(pick(controlMs, () => true)),
    controlOver1ms: controlOver1,
    flushOver1ms: flushOver1,
    flushOver1msWithHeapDrop: flushOver1WithGc,
    flushOver1msWithSlowControl: flushOver1WithSlowControl,
    flushOutliers,
    gpuStrokeMs: stats(gpuStrokeMs),
    gpuRebuildMs: stats(gpuRebuildMs),
    flushHeapBytesPerPass,
    controlHeapBytesPerPass,
    controlSink,
  };
}

const out = document.getElementById("out");
const sink = window as unknown as { __dustVerify: unknown };
main().then(
  (result) => {
    sink.__dustVerify = result;
    if (out) out.textContent = JSON.stringify(result, null, 1);
  },
  (error: unknown) => {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    sink.__dustVerify = { error: message };
    if (out) out.textContent = message;
  },
);
