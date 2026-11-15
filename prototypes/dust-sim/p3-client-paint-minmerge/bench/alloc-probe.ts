// Allocation per call of each hot-path entry point in isolation (steady state, tiles exist). Run (Node 26):
//   cd tools/bots && node --expose-gc --import tsx ../../prototypes/dust-sim/p3-client-paint-minmerge/bench/alloc-probe.ts
import type { PlotId, StrokeRecord } from "../../../../packages/shared/src/index";
import { createStrokeSource, DEFAULT_STROKE_SOURCE } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { createGrid } from "../grid";
import { ByteWriter } from "../src/core/bytes";
import { P3Client } from "../src/core/client";
import { GeomCache, Vec3, localToDir } from "../src/core/geom";
import { P3Server } from "../src/core/server";

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error("run with --expose-gc");
const grid = createGrid();
const geom = new GeomCache(grid);
const SITE = grid.plotAt({ x: 0.9046, y: 0.1392, z: -0.4028 } as never);
const N = 6;
const TICKS = 16_000;
const server = new P3Server({ geom, simTickHz: 20, flushTicks: 2, l0Ticks: 10, streamBytesPerFlush: 800 });
const c0 = grid.centerDirection(SITE as PlotId);
const clients: P3Client[] = [];
const strokes: StrokeRecord[] = [];
const poses = new Float64Array(TICKS * N * 3);
const d = new Vec3();
for (let i = 0; i < N; i++) {
  clients.push(new P3Client(geom));
  server.join(i, c0.x, c0.y, c0.z);
  server.outOf(i).reset();
}
{
  const srcs = clients.map((_, i) =>
    createStrokeSource(grid, { ...DEFAULT_STROKE_SOURCE, seed: 11, botIndex: i, clusterPlot: SITE, actorSlot: i }),
  );
  for (let t = 0; t < TICKS; t++) {
    for (let i = 0; i < N; i++) {
      const s = (srcs[i] as (t: number) => StrokeRecord)(t + 1);
      strokes.push(s);
      localToDir(geom.get(s.anchor), s.endUMm, s.endVMm, 2000, d);
      poses.set([d.x, d.y, d.z], (t * N + i) * 3);
    }
  }
}
const up = new ByteWriter(4096);
const acc = { pose: 0, paint: 0, encode: 0, merge: 0, step: 0, apply: 0 };
const measure = process.argv.includes("--split");
let h = 0;
const mark = (): void => {
  if (measure) h = process.memoryUsage().heapUsed;
};
const take = (k: keyof typeof acc): void => {
  if (measure) acc[k] += Math.max(0, process.memoryUsage().heapUsed - h);
};

function tick(t: number): void {
  mark();
  for (let i = 0; i < N; i++) {
    const o = (t * N + i) * 3;
    server.setPoseFrom(i, poses, o);
  }
  take("pose");
  mark();
  for (let i = 0; i < N; i++) (clients[i] as P3Client).paint(strokes[t * N + i] as StrokeRecord);
  take("paint");
  if ((server.tick + 1) % 2 === 0) {
    for (let i = 0; i < N; i++) {
      mark();
      up.reset();
      const len = (clients[i] as P3Client).encodeUpload(up);
      take("encode");
      mark();
      if (len > 0) server.receive(i, up.buf, 0, len);
      take("merge");
    }
  }
  mark();
  server.step();
  take("step");
  mark();
  for (let i = 0; i < N; i++) {
    const w = server.outOf(i);
    if (w.pos > 0) (clients[i] as P3Client).receive(w.buf, 0, w.pos);
    w.reset();
  }
  take("apply");
}

const WARM = 10_000;
for (let t = 0; t < WARM; t++) tick(t);
let bestBytes = Infinity;
for (let r = 0; r < 3; r++) {
  for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] = 0;
  gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let t = WARM + r * 2000; t < WARM + (r + 1) * 2000; t++) tick(t);
  const used = Math.max(0, process.memoryUsage().heapUsed - h0) / 2000;
  bestBytes = Math.min(bestBytes, used);
  const parts = (Object.keys(acc) as (keyof typeof acc)[]).map((k) => `${k} ${(acc[k] / 2000).toFixed(1)}`).join(", ");
  console.log(
    `rep ${r}: ${used.toFixed(1)} B per tick (${N} clients, 10 Hz flush)${measure ? `; split: ${parts}` : ""}`,
  );
}
console.log(`best: ${bestBytes.toFixed(1)} B per tick; server tiles ${server.tileCount}`);
