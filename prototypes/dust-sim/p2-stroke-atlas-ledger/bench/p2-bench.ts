// P2 micro-benchmarks: time and heap allocation per hot call, on plain Node (vitest runs numeric code 10 to 20 times
// slower). Allocation = v8 total_allocated_bytes delta over N calls after warm-up, as packages/world/bench does.
// Run from the repo root (Node 26):
//   node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs prototypes/dust-sim/p2-stroke-atlas-ledger/bench/p2-bench.ts
import { getHeapStatistics } from "node:v8";
import { createGrid } from "../grid";
import { P2Client } from "../src/core/client";
import { DustView } from "../src/core/dust-view";
import { InterestScratch, InterestSet } from "../src/core/interest";
import { P2Server, type StrokeLike } from "../src/core/server";
import { buildTables, type GridLike } from "../src/core/tables";
import { TILE_PRESETS, TileAtlasRef } from "../src/core/tiles";
import { IDENTITY_CODEC, dirOf } from "../src/core/util";
import { seededStrokes, SITE_PLOT } from "../test/support";

const allocated = (): number => getHeapStatistics().total_allocated_bytes;
const rows: { name: string; ns: number; bytes: number; note: string }[] = [];

function bench(name: string, n: number, warm: number, fn: (i: number) => void, note = ""): void {
  for (let i = 0; i < warm; i++) fn(i);
  const a0 = allocated();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn(i);
  const t1 = performance.now();
  const a1 = allocated();
  rows.push({ name, ns: ((t1 - t0) * 1e6) / n, bytes: (a1 - a0) / n, note });
}

// Is the clock itself allocation-free? (It is called by the server once per tick section.)
{
  let acc = 0;
  bench("performance.now()", 1_000_000, 10_000, () => {
    acc += performance.now();
  });
  if (acc < 0) console.log(acc);
}

const g0 = performance.now();
const grid = createGrid();
const g1 = performance.now();
const t = buildTables(grid as unknown as GridLike, 20261114);
const g2 = performance.now();
console.log(`grid build ${(g1 - g0).toFixed(0)} ms, tables ${(g2 - g1).toFixed(1)} ms`);

// Warm-up: let TurboFan settle on applyStroke before any series is measured (baseline code boxes doubles).
{
  const warmView = new DustView(t);
  const warm = seededStrokes(t, 2000, 9);
  for (let r = 0; r < 60; r++) {
    for (const s of warm) {
      warmView.applyStroke(s.anchor, s.startUMm, s.startVMm, s.endUMm, s.endVMm, s.widthCm, s.depth16, s.actorSlot);
    }
  }
}

// ---- ledger rasterisation by tool class (fresh world per series so texels are not already 0) ----
function strokeSeries(name: string, widthCm: number, depth16: number, lenMm: number, n: number): void {
  const view = new DustView(t);
  const lanes = 24_000 / Math.max(150, widthCm * 10);
  let pts = 0;
  bench(
    name,
    n,
    200_000,
    (i) => {
      const lane = ((i % lanes) | 0) * Math.max(150, widthCm * 10) - 12_000;
      const u = ((i * 131) % 20_000) - 10_000;
      view.applyStroke(SITE_PLOT, u, lane, u + lenMm, lane, widthCm, depth16, i & 7);
    },
    "",
  );
  pts = view.latticePoints / (n + 200_000);
  rows[rows.length - 1]!.note = `${pts.toFixed(0)} lattice points/stroke, ${view.ledgerCount} ledgers`;
}
strokeSeries("applyStroke Desk Duster 15 cm x 0.15 m", 15, 80, 150, 1_000_000);
strokeSeries("applyStroke bot 60 cm x 0.30 m (S4)", 60, 16, 300, 1_000_000);
strokeSeries("applyStroke Bristle Broom 120 cm x 0.15 m", 120, 32, 150, 1_000_000);
strokeSeries("applyStroke Bulldust 300 cm x 2 m", 300, 48, 2000, 300_000);
strokeSeries("applyStroke robot lane 200 cm x 0.6 m", 200, 48, 600, 500_000);
strokeSeries("applyStroke max 1023 cm x 4 m", 1023, 64, 4000, 40_000);

// ---- mixed seeded strokes over ~20 plots ----
{
  const strokes = seededStrokes(t, 4000, 5);
  const view = new DustView(t);
  bench("applyStroke seeded mix (every tool)", 400_000, 40_000, (i) => {
    const s = strokes[i % strokes.length]!;
    view.applyStroke(s.anchor, s.startUMm, s.startVMm, s.endUMm, s.endVMm, s.widthCm, s.depth16, s.actorSlot);
  });
}

// ---- hashes and interest ----
{
  const view = new DustView(t);
  view.applyStroke(SITE_PLOT, -2000, 0, 2000, 0, 200, 32, 0);
  const slot = view.slotOf[SITE_PLOT]!;
  let x = 0;
  bench("ledgerHash (1,024 bytes, forced dirty)", 1_000_000, 20_000, (i) => {
    view.applyStroke(SITE_PLOT, -100, (i % 50) * 100, 100, (i % 50) * 100, 15, 1, 0);
    x ^= view.ledgerHash(slot);
  });
  const set = new InterestSet(t, new InterestScratch(t.count), 140, 160);
  const d = new Float64Array(3);
  bench(
    "InterestSet.scan (140 m, moving 1.5 m per scan)",
    300_000,
    5000,
    (i) => {
      dirOf(t, SITE_PLOT, (i % 8000) * 1500 - 6_000_000 > 30_000 ? 0 : ((i % 20) - 10) * 1500, 0, d);
      set.scan(d);
    },
    `${set.n} member plots`,
  );
  rows[rows.length - 1]!.note = `${set.n} member plots`;
  if (x === 12345) console.log(x);
}

// ---- whole server tick: 16 clustered bots (S4 shape), server side and client side ----
function serverSeries(cadence: "frame" | "tick"): void {
  const clock = 0;
  const s = new P2Server(t, {
    simTickHz: 20,
    cadence,
    residencyM: 120,
    dustCellCapacityG: 0,
    codec: IDENTITY_CODEC,
    now: () => clock,
  });
  const n = 16;
  for (let i = 0; i < n; i++) s.join(i, null);
  // Pre-built stroke objects (the harness allocates its own records; that is not P2's allocation).
  const steps = 4000;
  const pre: StrokeLike[][] = [];
  for (let b = 0; b < n; b++) {
    const list: StrokeLike[] = [];
    for (let k = 0; k < steps; k++) {
      const lane = ((Math.floor(k / 200) + b * 7) % 160) * 500 - 40_000;
      const along = (k % 200) * 150 - 15_000;
      const dir = Math.floor(k / 200) % 2 === 0 ? 1 : -1;
      const u0 = dir * along;
      const u1 = dir * (along + 150);
      const cu = Math.max(-12_000, Math.min(12_000, u1));
      void cu;
      list.push({
        anchor: SITE_PLOT,
        startUMm: Math.max(-30_000, Math.min(30_000, u0)),
        startVMm: Math.max(-30_000, Math.min(30_000, lane)),
        endUMm: Math.max(-30_000, Math.min(30_000, u1)),
        endVMm: Math.max(-30_000, Math.min(30_000, lane)),
        widthCm: 60,
        depth16: 16,
        toolCode: 1,
        tick: k + 1,
        actorSlot: b,
        inputSeq: (k + 1) & 0xffff,
      });
    }
    pre.push(list);
  }
  let tick = 0;
  const one = (): void => {
    const k = tick % steps;
    for (let b = 0; b < n; b++) s.submit(b, pre[b]![k]!);
    s.advance(1);
    tick++;
  };
  for (let i = 0; i < 2000; i++) one();
  const a0 = allocated();
  const t0 = performance.now();
  const N = 30_000;
  for (let i = 0; i < N; i++) one();
  const t1 = performance.now();
  const a1 = allocated();
  rows.push({
    name: `server + 16 clients tick, 16 strokes/tick (${cadence})`,
    ns: ((t1 - t0) * 1e6) / N,
    bytes: (a1 - a0) / N,
    note: `${((a1 - a0) / (N * n)).toFixed(1)} B per submitted stroke; hash ${s.clientHash(3) === s.serverHash() ? "match" : "MISMATCH"}; ${(
      s.linkOf(0)!.bytes /
      ((N + 2000) / 20)
    ).toFixed(0)} B/s per client`,
  });
}
serverSeries("frame");
serverSeries("tick");

// ---- client frame decode alone ----
{
  const scratch = new InterestScratch(t.count);
  const c = new P2Client(0, t, scratch, 140, 160, 2, IDENTITY_CODEC);
  const d = new Float64Array(3);
  dirOf(t, SITE_PLOT, 0, 0, d);
  c.scan(d);
  // One header followed by 15 continuations, re-decoded many times (strokes keep landing on the same lane).
  const buf = new Uint8Array(3 + 2 + 17 + 15 * 4);
  buf[0] = 1;
  buf[1] = 16;
  buf[3] = 1;
  buf[4] = 0;
  let o = 5;
  const w0 = SITE_PLOT | (1 << 18);
  buf[o] = w0 & 0xff;
  buf[o + 1] = (w0 >>> 8) & 0xff;
  buf[o + 2] = w0 >>> 16;
  buf[o + 7] = 150;
  buf[o + 11] = 60;
  buf[o + 13] = 16;
  o += 17;
  for (let k = 0; k < 15; k++) {
    const packed = 0 | (150 << 6);
    buf[o] = packed & 0xff;
    buf[o + 1] = (packed >>> 8) & 0xff;
    buf[o + 2] = (packed >>> 16) & 0xff;
    buf[o + 3] = packed >>> 24;
    o += 4;
  }
  bench("client onFrame: 16 strokes decoded + applied", 300_000, 5000, () => c.onFrame(buf, buf.length), "per frame");
}

// ---- CPU reference tile atlas ----
{
  const scratch = new InterestScratch(t.count);
  const c = new P2Client(0, t, scratch, 140, 160, 2, IDENTITY_CODEC);
  const d = new Float64Array(3);
  dirOf(t, SITE_PLOT, 0, 0, d);
  c.scan(d);
  for (const quality of ["medium", "high"] as const) {
    const tiles = new TileAtlasRef(t, c.view, c.log, c.set, { ...TILE_PRESETS[quality], now: () => 0 });
    c.tiles = tiles;
    let k = 0;
    bench(
      `tile frame (${quality}): 2 strokes replayed (CPU reference)`,
      300_000,
      60_000,
      () => {
        for (let j = 0; j < 2; j++) {
          const lane = ((k / 100) | 0) % 40;
          const u = (k % 100) * 150 - 7500;
          k++;
          c.view.applyStroke(SITE_PLOT, u, lane * 500 - 10_000, u + 150, lane * 500 - 10_000, 60, 16, 0);
          tiles.onStroke(SITE_PLOT, u, lane * 500 - 10_000, u + 150, lane * 500 - 10_000, 60, 16);
        }
        tiles.frame(d);
      },
      "",
    );
    rows[rows.length - 1]!.note =
      `${tiles.px}^2 tiles, ${tiles.tilesResident} resident, ${tiles.rebuilds} rebuilds, ${tiles.ledgerZeroClears} zero clears`;
  }
}

console.log("| call | ns/call | B/call | note |");
console.log("| --- | ---: | ---: | --- |");
for (const r of rows) console.log(`| ${r.name} | ${r.ns.toFixed(0)} | ${r.bytes.toFixed(2)} | ${r.note} |`);
