// Hot-path costs and allocation of P3 on the real GP(128,0) grid. Run (repo root, Node 26):
//   cd tools/bots && node --expose-gc --import tsx ../../prototypes/dust-sim/p3-client-paint-minmerge/bench/p3-bench.ts
import { performance } from "node:perf_hooks";
import type { PlotId, StrokeRecord } from "../../../../packages/shared/src/index";
import { createStrokeSource, DEFAULT_STROKE_SOURCE } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { createGrid } from "../grid";
import { ByteWriter } from "../src/core/bytes";
import { P3Client } from "../src/core/client";
import { GeomCache, Vec3, localToDir } from "../src/core/geom";
import { P3Server } from "../src/core/server";

const gc = (globalThis as { gc?: () => void }).gc;
const grid = createGrid();
const SITE = grid.plotAt({ x: 0.9046, y: 0.1392, z: -0.4028 } as never);

function best(label: string, reps: number, n: number, fn: (i: number) => void, unit = "us"): void {
  let bestMs = Infinity;
  let bytes = Infinity;
  for (let r = 0; r < reps; r++) {
    gc?.();
    const h0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn(i);
    const dt = performance.now() - t0;
    const h1 = process.memoryUsage().heapUsed;
    bestMs = Math.min(bestMs, dt);
    bytes = Math.min(bytes, Math.max(0, h1 - h0) / n);
  }
  const per = unit === "us" ? `${((bestMs * 1000) / n).toFixed(3)} us` : `${(bestMs / n).toFixed(4)} ms`;
  console.log(`${label.padEnd(60)} ${per.padStart(12)}  ${bytes.toFixed(2).padStart(8)} B/call`);
}

// 1. Ownership mask build (first touch of a plot: 252 point-to-plot queries + 4,096 x 7 dot products).
{
  let p = 5000;
  const cache = new GeomCache(grid);
  best("geom build (first touch of a plot)", 3, 300, () => cache.get(p++), "ms");
}

const geom = new GeomCache(grid);
const mk = (flushTicks: number): P3Server =>
  new P3Server({ geom, simTickHz: 20, flushTicks, l0Ticks: 10, streamBytesPerFlush: 800 });

// 2. Client paint per tool (tiles already exist).
for (const tool of [
  { name: "Desk Duster 60 cm, 0.15 m", widthCm: 60, depth16: 16, toolCode: 1, speed: 3 },
  { name: "Bristle Broom 120 cm, 0.075 m", widthCm: 120, depth16: 32, toolCode: 2, speed: 1.5 },
  { name: "Bulldust 300 cm, 1 m", widthCm: 300, depth16: 48, toolCode: 9, speed: 20 },
  { name: "largest legal record 1023 cm, 3.95 m", widthCm: 1023, depth16: 255, toolCode: 9, speed: 79 },
]) {
  const src = createStrokeSource(grid, {
    ...DEFAULT_STROKE_SOURCE,
    seed: 7,
    botIndex: 0,
    clusterPlot: SITE,
    actorSlot: 0,
    widthCm: tool.widthCm,
    depth16: tool.depth16,
    toolCode: tool.toolCode,
    speedMps: tool.speed,
  });
  const strokes: StrokeRecord[] = [];
  for (let t = 1; t <= 3400; t++) strokes.push(src(t));
  // Warm pass creates every tile and ownership mask; the measured passes repaint the same ground (still removing
  // dust for the lighter tools), so the allocation column is the steady state.
  const c = new P3Client(geom);
  for (let k = 0; k < 3400; k++) c.paint(strokes[k] as StrokeRecord);
  best(`client paint: ${tool.name}`, 3, 3000, (i) => c.paint(strokes[400 + i] as StrokeRecord));
}

// 3. Whole tick with 1, 6 and 16 clients (paint + upload + merge + flush + apply), 10 Hz flush.
for (const n of [1, 6, 16]) {
  const server = mk(2);
  const clients: P3Client[] = [];
  const slots: number[] = [];
  const srcs: ((t: number) => StrokeRecord)[] = [];
  const c0 = grid.centerDirection(SITE as PlotId);
  for (let i = 0; i < n; i++) {
    clients.push(new P3Client(geom));
    slots.push(server.join(i, c0.x, c0.y, c0.z));
    server.outOf(slots[i] as number).reset();
    srcs.push(
      createStrokeSource(grid, { ...DEFAULT_STROKE_SOURCE, seed: 11, botIndex: i, clusterPlot: SITE, actorSlot: i }),
    );
  }
  const up = new ByteWriter(4096);
  const d = new Vec3();
  // Strokes are generated ahead so the harness stroke source (which allocates) is not part of the measurement.
  const WARM = 6000;
  const MEASURED = 5 * 2000;
  const pre: StrokeRecord[] = [];
  // Server-side poses likewise (in the game they come from the sim's typed arrays, not from the stroke): converting
  // the stroke end point inside the measured loop cost 48 B of boxed doubles per client per tick.
  const prePose = new Float64Array((WARM + MEASURED) * n * 3);
  for (let k = 1; k <= WARM + MEASURED; k++) {
    for (let i = 0; i < n; i++) {
      const s = (srcs[i] as (t: number) => StrokeRecord)(k);
      localToDir(geom.get(s.anchor), s.endUMm, s.endVMm, 2000, d);
      prePose.set([d.x, d.y, d.z], pre.length * 3);
      pre.push(s);
    }
  }
  let t = 0;
  const tick = (): void => {
    for (let i = 0; i < n; i++) {
      const s = pre[t * n + i] as StrokeRecord;
      server.setPoseFrom(slots[i] as number, prePose, (t * n + i) * 3);
      (clients[i] as P3Client).paint(s);
    }
    if ((server.tick + 1) % 2 === 0) {
      for (let i = 0; i < n; i++) {
        up.reset();
        const len = (clients[i] as P3Client).encodeUpload(up);
        if (len > 0) server.receive(slots[i] as number, up.buf, 0, len);
      }
    }
    server.step();
    for (let i = 0; i < n; i++) {
      const w = server.outOf(slots[i] as number);
      if (w.pos > 0) (clients[i] as P3Client).receive(w.buf, 0, w.pos);
      w.reset();
    }
    t++;
  };
  for (let k = 0; k < WARM; k++) tick(); // warm: tiles and geoms of the first lanes exist, lists have grown
  best(`whole tick, ${n} clients (paint+upload+merge+flush+apply)`, 5, 2000, tick);
}

// 4. Server side alone: one 10 Hz upload merged, then two steps including one flush to 16 clients.
{
  const server = mk(2);
  const c0 = grid.centerDirection(SITE as PlotId);
  const slot = server.join(0, c0.x, c0.y, c0.z);
  for (let i = 1; i < 16; i++) server.join(i, c0.x, c0.y, c0.z);
  for (let i = 0; i < 16; i++) server.outOf(i).reset();
  const client = new P3Client(geom);
  const src = createStrokeSource(grid, {
    ...DEFAULT_STROKE_SOURCE,
    seed: 3,
    botIndex: 0,
    clusterPlot: SITE,
    actorSlot: 0,
  });
  const msgs: Uint8Array[] = [];
  const up = new ByteWriter(4096);
  const d = new Vec3();
  const poses: number[] = [];
  for (let t = 1; t <= 12_000; t++) {
    const s = src(t);
    client.paint(s);
    if (t % 2 === 0) {
      up.reset();
      const len = client.encodeUpload(up);
      localToDir(geom.get(s.anchor), s.endUMm, s.endVMm, 2000, d);
      poses.push(d.x, d.y, d.z);
      msgs.push(up.buf.slice(0, len));
    }
  }
  let k = 0;
  const one = (): void => {
    server.setPose(slot, poses[k * 3] as number, poses[k * 3 + 1] as number, poses[k * 3 + 2] as number);
    const m = msgs[k++] as Uint8Array;
    if (m.length > 0) server.receive(slot, m, 0, m.length);
    server.step();
    server.step();
    for (let i = 0; i < 16; i++) server.outOf(i).reset();
  };
  for (let w = 0; w < 3000; w++) one();
  best("server: setPose + receive(one upload) + 2 steps (1 flush x16)", 3, 1000, one);
  console.log(`  rejects reach/rate/malformed: ${server.rejects.join(" / ")}; merged texels ${server.texelsMerged}`);
}
console.log(`gc exposed: ${gc ? "yes" : "no (allocation column is not meaningful)"}`);
