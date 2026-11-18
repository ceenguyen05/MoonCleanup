// Dust replay tests (M1-W3-T02), CPU side. The GPU half is checked in a real browser by verify/run-verify.mjs, which
// compares the atlas read back from the GPU with the `CpuAtlas` reference tested here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CpuAtlas, DustReplayBatch, type AtlasLayout } from "./replay-batch";
import { DUST_TILE_PRESETS, type DustTileAtlas } from "./tile-atlas";
import { DustFlatLookup, FLAT_LOOKUP_MAX_PLOTS } from "./flat-lookup";
import { FRAME_EDGE_MM, FRAME_HALF_MM } from "./replay-batch";
import { Texture } from "three/webgpu";
import type { PlotId } from "@moon-cleanup/shared";
import { DustScenario, SCENARIO_SITE, type DustScenarioOptions } from "./verify/scenario";

const here = path.dirname(fileURLToPath(import.meta.url));
const t06 = path.resolve(here, "../../../../../prototypes/dust-sim/results/t06/gpu-rec");

/** Runs a scenario on the CPU reference; `drain` keeps stepping until no rebuild is waiting. */
function run(options: DustScenarioOptions, after?: (s: DustScenario) => void): { s: DustScenario; cpu: CpuAtlas } {
  const s = new DustScenario(options);
  const cpu = new CpuAtlas(s.atlas.layout);
  for (let f = 0; f < options.frames; f++) {
    s.step();
    cpu.execute(s.batch);
  }
  after?.(s);
  for (let guard = 0; guard < 200_000 && (s.atlas.rebuildBacklog > 0 || guard < 2); guard++) {
    s.step();
    cpu.execute(s.batch);
  }
  expect(s.atlas.rebuildBacklog).toBe(0);
  return { s, cpu };
}

/** A clock that advances `stepMs` per read: with a 1 ms budget every rebuild is cut into many frames. */
function slowClock(stepMs: number): () => number {
  let t = 0;
  return () => (t += stepMs);
}

/** Bytes of channel set `mask` (bit per channel) that differ between the tiles of the same plots in two atlases. */
function diffTiles(a: DustTileAtlas, ca: CpuAtlas, b: DustTileAtlas, cb: CpuAtlas, mask: number): [number, number] {
  const px = a.layout.slotPx;
  let diff = 0;
  let tiles = 0;
  for (let p = 0; p < a.slotOfPlot.length; p++) {
    const sa = a.slotOfPlot[p]!;
    const sb = b.slotOfPlot[p]!;
    expect(sa >= 0).toBe(sb >= 0);
    if (sa < 0) continue;
    tiles++;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const oa = ((a.slotY(sa) + y) * ca.width + a.slotX(sa) + x) * 4;
        const ob = ((b.slotY(sb) + y) * cb.width + b.slotX(sb) + x) * 4;
        for (let ch = 0; ch < 4; ch++) {
          if ((mask >> ch) & 1 && ca.data[oa + ch] !== cb.data[ob + ch]) diff++;
        }
      }
    }
  }
  return [diff, tiles];
}

describe("dust replay: CPU reference against the W1-T06 recordings", () => {
  // The six byte sets of the W1-T06 table. The `rebuild-*` sets are timing recordings (the log-replay draws of a
  // rebuild without its fill and residual), not byte sets, and are left out.
  const dirs = fs.existsSync(t06)
    ? fs.readdirSync(t06).filter((d) => !d.startsWith("rebuild-") && fs.existsSync(path.join(t06, d, "events.bin")))
    : [];
  it.skipIf(dirs.length === 0)(
    "reproduces the atlas bytes of the prototype CPU reference (tiles.ts)",
    () => {
      const EV = 16;
      let compared = 0;
      for (const dir of dirs) {
        const meta = JSON.parse(fs.readFileSync(path.join(t06, dir, "meta.json"), "utf8")) as {
          px: number;
          slots: number;
          finalSlots: number[];
        };
        const read = (name: string): Buffer => fs.readFileSync(path.join(t06, dir, name));
        const evBuf = read("events.bin");
        const ev = new Float32Array(evBuf.buffer, evBuf.byteOffset, evBuf.byteLength / 4);
        const uploads = read("uploads.bin");
        const fin = read("final.bin");
        const layout: AtlasLayout = { slotPx: meta.px, cols: 32, rows: Math.ceil(meta.slots / 32) };
        const px = meta.px;
        const cpu = new CpuAtlas(layout);
        const batch = new DustReplayBatch();
        const flush = (): void => {
          cpu.execute(batch);
          batch.reset();
        };
        for (let e = 0; e < ev.length / EV; e++) {
          const o = e * EV;
          const kind = ev[o + 1]!;
          const slot = ev[o + 2]!;
          if (kind === 0) {
            const push = (): number =>
              batch.pushStroke(
                layout,
                slot,
                ev[o + 3]!,
                ev[o + 4]!,
                ev[o + 5]!,
                ev[o + 6]!,
                ev[o + 7]!,
                ev[o + 8]!,
                ev[o + 9]!,
              );
            let r = push();
            if (r < 0) {
              flush();
              r = push();
            }
            expect(r).toBe(1);
            // The texel rectangle is the one the prototype recorded.
            const i = (batch.strokeN - 1) * 4;
            const ox = (slot % 32) * px;
            const oy = Math.floor(slot / 32) * px;
            expect(batch.strokeRect[i]).toBe(ox + ev[o + 10]!);
            expect(batch.strokeRect[i + 1]).toBe(oy + ev[o + 11]!);
            expect(batch.strokeRect[i + 2]).toBe(ox + ev[o + 12]! + 1);
            expect(batch.strokeRect[i + 3]).toBe(oy + ev[o + 13]! + 1);
          } else if (kind === 1) {
            if (!batch.pushClear(layout, slot, ev[o + 10]!, ev[o + 11]!, ev[o + 12]!, ev[o + 13]!)) {
              flush();
              batch.pushClear(layout, slot, ev[o + 10]!, ev[o + 11]!, ev[o + 12]!, ev[o + 13]!);
            }
          } else {
            flush();
            const src = ev[o + 14]! * px * px * 4;
            const ox = (slot % 32) * px;
            const oy = Math.floor(slot / 32) * px;
            for (let y = 0; y < px; y++) {
              for (let x = 0; x < px * 4; x++)
                cpu.data[((oy + y) * cpu.width + ox) * 4 + x] = uploads[src + y * px * 4 + x]!;
            }
          }
        }
        flush();
        let diff = 0;
        meta.finalSlots.forEach((slot, k) => {
          const ox = (slot % 32) * px;
          const oy = Math.floor(slot / 32) * px;
          for (let y = 0; y < px; y++) {
            for (let x = 0; x < px * 4; x++) {
              if (cpu.data[((oy + y) * cpu.width + ox) * 4 + x] !== fin[k * px * px * 4 + y * px * 4 + x]) diff++;
            }
          }
          compared += px * px * 4;
        });
        expect(diff, dir).toBe(0);
      }
      console.info(`[dust] T06 recordings: ${dirs.length} sets, ${compared} bytes compared, 0 differ`);
    },
    60_000,
  );
});

describe("dust tile atlas", () => {
  it("builds tiles for touched plots near the camera and replays strokes into them", () => {
    const { s, cpu } = run({ preset: "medium", frames: 360 });
    expect(s.strokes).toBeGreaterThan(150);
    expect(s.atlas.tilesResident).toBeGreaterThan(3);
    const slot = s.atlas.slotOfPlot[SCENARIO_SITE]!;
    expect(slot).toBeGreaterThanOrEqual(0);
    // The site tile shows cleaned texels (R below 255), unpolish (G) and a berm (A).
    const px = s.atlas.layout.slotPx;
    let cleaned = 0;
    let berm = 0;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const o = ((s.atlas.slotY(slot) + y) * cpu.width + s.atlas.slotX(slot) + x) * 4;
        if (cpu.data[o]! < 255) cleaned++;
        if (cpu.data[o + 3]! > 0) berm++;
        expect(cpu.data[o + 2]).toBe(255);
      }
    }
    expect(cleaned).toBeGreaterThan(20);
    expect(berm).toBeGreaterThan(20);
  });

  it("a rebuild cut into many frames ends in the same bytes as one done in a single frame", () => {
    const base: DustScenarioOptions = { preset: "medium", frames: 900, resyncFrame: 300, moveFrame: 500 };
    const whole = run({ ...base, budgetMs: Infinity }, (s) => s.atlas.rebuildAll());
    const sliced = run({ ...base, budgetMs: 1, now: slowClock(0.3) }, (s) => s.atlas.rebuildAll());
    expect(sliced.s.atlas.rebuilds).toBeGreaterThan(0);
    const [diff, tiles] = diffTiles(whole.s.atlas, whole.cpu, sliced.s.atlas, sliced.cpu, 0b1111);
    expect(tiles).toBeGreaterThan(5);
    expect(diff).toBe(0);
  });

  it("draws every stroke exactly once whether it arrives live, during a rebuild or from the logs", () => {
    // G (unpolish) and A (berm) are written by strokes only, so they count the draws; R also takes the residual.
    const base: DustScenarioOptions = { preset: "medium", frames: 240, scatter: false, resyncFrame: 100 };
    const live = run({ ...base, budgetMs: Infinity });
    const sliced = run({ ...base, budgetMs: 1, now: slowClock(0.4) });
    const fromLogs = run({ ...base, budgetMs: Infinity }, (s) => s.atlas.rebuildAll());
    const [d1, t1] = diffTiles(live.s.atlas, live.cpu, sliced.s.atlas, sliced.cpu, 0b1010);
    const [d2] = diffTiles(live.s.atlas, live.cpu, fromLogs.s.atlas, fromLogs.cpu, 0b1010);
    expect(t1).toBeGreaterThan(2);
    expect(d1).toBe(0);
    expect(d2).toBe(0);
  }, 60_000); // three full 240-frame scenarios: about 5 s alone, longer under parallel verify

  it("does not allocate per frame in steady state", () => {
    // Heap growth per frame over windows of 600 frames (100 stroke ticks and about 14 tile rebuilds each) after a
    // warm-up, against a control that runs the same scenario with the atlas switched off: the scenario and the ledger
    // allocate on their own (the grid's object-out projection calls), which is not this module's.
    const windows = (atlasOn: boolean): number[] => {
      const s = new DustScenario({ preset: "medium", frames: 1_000_000, scatter: false });
      if (!atlasOn) {
        const off = s.atlas as unknown as Record<string, unknown>;
        for (const name of ["onStroke", "frame", "onLedgerZero", "onPolished"]) off[name] = (): void => {};
      }
      for (let f = 0; f < 3000; f++) s.step();
      const out: number[] = [];
      for (let w = 0; w < 8; w++) {
        const h0 = process.memoryUsage().heapUsed;
        for (let f = 0; f < 600; f++) s.step();
        out.push((process.memoryUsage().heapUsed - h0) / 600);
      }
      if (atlasOn) expect(s.atlas.rebuilds).toBeGreaterThan(50);
      return out;
    };
    const control = windows(false);
    const full = windows(true);
    const show = (list: number[]): string => list.map((v) => v.toFixed(1)).join(" / ");
    console.info(`[dust] heap B per frame, 8 windows of 600: atlas on ${show(full)}; atlas off ${show(control)}`);
    const median = (list: number[]): number => [...list].sort((a, b) => a - b)[list.length >> 1]!;
    expect(median(full) - median(control)).toBeLessThan(64);
  });

  it("keeps the main-thread cost of a frame inside the millisecond budget", () => {
    for (const preset of ["medium", "high"] as const) {
      const s = new DustScenario({ preset, frames: 1800, resyncFrame: 600, moveFrame: 900, rebuildAllFrame: 1200 });
      const cpu = new CpuAtlas(s.atlas.layout);
      const ms = new Float64Array(2400 - 60);
      let busiest = 0;
      let heap0 = 0;
      for (let f = 0; f < 2400; f++) {
        if (f === 600) heap0 = process.memoryUsage().heapUsed;
        s.step();
        if (f >= 60) ms[f - 60] = s.frameMs;
        if (s.batch.strokeN > busiest) busiest = s.batch.strokeN;
        cpu.execute(s.batch);
      }
      // Informative only (no forced GC here): heap growth over 1,800 frames of strokes, rebuilds and CPU execution.
      const heapPerFrame = (process.memoryUsage().heapUsed - heap0) / 1800;
      ms.sort();
      const q = (p: number): number => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))]!;
      console.info(
        `[dust] ${preset} ${DUST_TILE_PRESETS[preset].slotPx}px: frame() ms p50 ${q(0.5).toFixed(4)} p99 ${q(0.99).toFixed(3)} ` +
          `max ${q(1).toFixed(3)}; strokes ${s.strokes}, rebuilds ${s.atlas.rebuilds}, tiles ${s.atlas.tilesResident}, ` +
          `largest batch ${busiest} instances, zero events ${s.zeroEvents}, polished ${s.polished}, ` +
          `live overflows ${s.atlas.liveOverflows}, heap ${heapPerFrame.toFixed(1)} B per frame`,
      );
      expect(s.atlas.rebuildBacklog).toBe(0);
      expect(s.atlas.liveOverflows).toBe(0);
      expect(q(0.5)).toBeLessThan(0.5);
      // Loose bound (shared machines stall for milliseconds); the report carries the measured p99 and max.
      expect(q(0.99)).toBeLessThan(5.0);
    }
  });
});

describe("dust flat lookup (world point -> tile texel)", () => {
  it("lands on the texel the exact plot projection gives, inside the owner's tile", () => {
    const s = new DustScenario({ preset: "medium", frames: 60 });
    const lookup = new DustFlatLookup(s.grid, s.atlas, new Texture(), SCENARIO_SITE);
    expect(lookup.plotCount).toBeGreaterThan(100);
    expect(lookup.plotCount).toBeLessThanOrEqual(FLAT_LOOKUP_MAX_PLOTS);
    const px = s.atlas.layout.slotPx;
    const ts = FRAME_EDGE_MM / px;
    const out = new Float64Array(3);
    const dir = { x: 0, y: 0, z: 1 };
    const loc = { u: 0, v: 0 };
    let worst = 0;
    let rnd = 12345;
    const next = (): number => (rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let k = 0; k < 4000; k++) {
      const x = (next() * 2 - 1) * 110;
      const z = (next() * 2 - 1) * 110;
      expect(lookup.locate(x, z, out)).toBe(true);
      const plot = out[0]!;
      // Exact: world point -> sphere direction -> the plot's gnomonic frame -> tile texel (world z = -v).
      s.grid.fromPlotLocal(SCENARIO_SITE as PlotId, x * 1000, -z * 1000, dir);
      s.grid.toPlotLocal(plot as PlotId, dir, loc);
      const ex = (loc.u + FRAME_HALF_MM) / ts;
      const ey = (loc.v + FRAME_HALF_MM) / ts;
      worst = Math.max(worst, Math.abs(out[1]! - ex), Math.abs(out[2]! - ey));
      // One texel of margin for the four neighbour taps.
      expect(ex).toBeGreaterThan(1);
      expect(ex).toBeLessThan(px - 1);
      expect(ey).toBeGreaterThan(1);
      expect(ey).toBeLessThan(px - 1);
      // The serving plot is the owner of the 1 m cell, so it is the owner or a direct neighbour of the point's plot.
      const owner = s.grid.plotAt(dir);
      if (owner !== plot) {
        let adjacent = false;
        for (let n = 0; n < 6; n++) if (s.grid.neighborTable[owner * 6 + n] === plot) adjacent = true;
        expect(adjacent).toBe(true);
      }
    }
    console.info(
      `[dust] flat lookup: ${lookup.plotCount} plots, worst texel error ${worst.toFixed(4)} over 4,000 points`,
    );
    expect(worst).toBeLessThan(0.05);
    expect(lookup.locate(500, 0, out)).toBe(false);
    // The patch frame is right-handed: +x (east) x +y (up) = +z must be south, i.e. world z grows toward -v.
    const d0 = new Float64Array(3);
    const d1 = new Float64Array(3);
    lookup.directionAt(0, 0, d0);
    lookup.directionAt(0, 10, d1);
    s.grid.toPlotLocal(SCENARIO_SITE as PlotId, { x: d1[0]!, y: d1[1]!, z: d1[2]! }, loc);
    expect(loc.v).toBeCloseTo(-10_000, -1);
    lookup.dispose();
  });

  it("recentres in budgeted slices and then serves the new site exactly like a fresh build", () => {
    const s = new DustScenario({ preset: "medium", frames: 1 });
    const lookup = new DustFlatLookup(s.grid, s.atlas, new Texture(), SCENARIO_SITE);
    const target = s.grid.neighborTable[SCENARIO_SITE * 6]!;
    const fresh = new DustFlatLookup(s.grid, s.atlas, new Texture(), target);
    lookup.beginRecentre(target);
    let clock = 0;
    let slices = 0;
    // A fake clock that advances 1 ms per call: every slice stops after about one row.
    while (!lookup.stepRecentre(0.5, () => clock++)) slices++;
    expect(slices).toBeGreaterThan(10);
    expect(lookup.sitePlot).toBe(SCENARIO_SITE); // still live until commit
    expect(lookup.commitRecentre()).toBe(true);
    expect(lookup.sitePlot).toBe(target);
    expect(lookup.plotCount).toBe(fresh.plotCount);
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    for (const [x, z] of [
      [0, 0],
      [40, -30],
      [-100, 90],
    ] as const) {
      expect(lookup.locate(x, z, a)).toBe(true);
      fresh.locate(x, z, b);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
    lookup.dispose();
    fresh.dispose();
  });
});
