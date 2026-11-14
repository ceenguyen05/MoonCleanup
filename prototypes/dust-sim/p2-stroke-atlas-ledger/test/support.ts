// Shared test helpers: seeded RNG, the real GP(128,0) tables, a seeded stroke generator around a site.
// No Node imports: the determinism cases also run in the browser lane.
import { createGrid } from "../grid";
import { DustView } from "../src/core/dust-view";
import type { P2Options, StrokeLike } from "../src/core/server";
import { buildTables, type GridLike, type PlotTables } from "../src/core/tables";
import { IDENTITY_CODEC, dirOf, xform } from "../src/core/util";

export const SEED = 20261114;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let tablesCache: PlotTables | null = null;
export function realTables(): PlotTables {
  tablesCache ??= buildTables(createGrid() as unknown as GridLike, SEED);
  return tablesCache;
}

export const TEST_OPTIONS: P2Options = {
  simTickHz: 20,
  cadence: "frame",
  residencyM: 120,
  dustCellCapacityG: 0,
  codec: IDENTITY_CODEC,
  now: () => 0,
};

/** Tool table of the vectors: T1 .. T6 hand tools, Detailing, Charge, vehicle intakes, robot lanes (width cm, depth16). */
export const TOOLS: readonly (readonly [number, number])[] = [
  [15, 80],
  [60, 16],
  [120, 32],
  [90, 48],
  [200, 80],
  [45, 208],
  [50, 255],
  [150, 255],
  [300, 48],
  [450, 96],
  [1023, 64],
  [80, 16],
  [140, 32],
];

export const SITE_PLOT = 71_234;

/** The plot nearest to plot-local (u, v) of `from` (greedy walk). */
export function plotNear(t: PlotTables, from: number, u: number, v: number): number {
  const d = new Float64Array(3);
  dirOf(t, from, u, v, d);
  let home = from;
  for (;;) {
    let best = d[0]! * t.centers[home * 3]! + d[1]! * t.centers[home * 3 + 1]! + d[2]! * t.centers[home * 3 + 2]!;
    let next = home;
    for (let k = 0; k < 6; k++) {
      const q = t.neighbors[home * 6 + k]!;
      if (q < 0) continue;
      const dq = d[0]! * t.centers[q * 3]! + d[1]! * t.centers[q * 3 + 1]! + d[2]! * t.centers[q * 3 + 2]!;
      if (dq > best || (dq === best && q < next)) {
        best = dq;
        next = q;
      }
    }
    if (next === home) return home;
    home = next;
  }
}

/**
 * `n` seeded strokes within `spreadMm` of the site plot (about 20 plots at 40 m), canonical form: anchored on the
 * plot under the end point, every tool of TOOLS, 2 % discs.
 */
export function seededStrokes(t: PlotTables, n: number, seed: number, spreadMm = 40_000, actors = 6): StrokeLike[] {
  const rng = mulberry32(seed);
  const out: StrokeLike[] = [];
  const xy = new Int32Array(2);
  for (let i = 0; i < n; i++) {
    const tool = TOOLS[Math.floor(rng() * TOOLS.length)]!;
    const cu = Math.round((rng() * 2 - 1) * spreadMm * 0.7);
    const cv = Math.round((rng() * 2 - 1) * spreadMm * 0.7);
    const len = rng() < 0.02 ? 0 : rng() * 3800;
    const ang = rng() * 2 - 1;
    const bng = Math.sqrt(1 - ang * ang) * (rng() < 0.5 ? -1 : 1);
    const su = Math.max(-32000, Math.min(32000, Math.round(cu - (ang * len) / 2)));
    const sv = Math.max(-32000, Math.min(32000, Math.round(cv - (bng * len) / 2)));
    const eu = Math.max(-32000, Math.min(32000, Math.round(cu + (ang * len) / 2)));
    const ev = Math.max(-32000, Math.min(32000, Math.round(cv + (bng * len) / 2)));
    const anchor = plotNear(t, SITE_PLOT, eu, ev);
    xform(t, SITE_PLOT, su, sv, anchor, xy);
    const startUMm = xy[0]!;
    const startVMm = xy[1]!;
    xform(t, SITE_PLOT, eu, ev, anchor, xy);
    out.push({
      anchor,
      startUMm,
      startVMm,
      endUMm: len === 0 ? startUMm : xy[0]!,
      endVMm: len === 0 ? startVMm : xy[1]!,
      widthCm: tool[0],
      depth16: tool[1],
      toolCode: i % 13,
      tick: i + 1,
      actorSlot: i % actors,
      inputSeq: (i + 1) & 0xffff,
    });
  }
  return out;
}

export function applyAll(view: DustView, strokes: readonly StrokeLike[], order?: readonly number[]): void {
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[order ? order[k]! : k]!;
    view.applyStroke(s.anchor, s.startUMm, s.startVMm, s.endUMm, s.endVMm, s.widthCm, s.depth16, s.actorSlot);
  }
}

/** FNV-1a 32 over (plot id, state, 1,024 texel bytes) of every ledger in PlotId order plus the Polished plots. */
export function fullDigest(view: DustView): number {
  let h = 0x811c9dc5;
  const mix = (b: number): void => {
    h = Math.imul(h ^ (b & 0xff), 0x01000193);
  };
  for (let p = 0; p < view.t.count; p++) {
    const slot = view.slotOf[p]!;
    if (slot < 0 && view.state[p] !== 2) continue;
    mix(p);
    mix(p >>> 8);
    mix(p >>> 16);
    mix(view.state[p]!);
    if (slot >= 0) for (let i = 0; i < 1024; i++) mix(view.texels[slot * 1024 + i]!);
  }
  return h >>> 0;
}

export function freshView(): DustView {
  return new DustView(realTables());
}
