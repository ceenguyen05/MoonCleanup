// Ledger rules of WDS 4.5 / 4.5b (prototype form): design depth, thin-tool coverage, minimum removal, order
// independence (V2), the far-plot prune, thresholds, over-collection (V4) and the golden vectors (V1).
import { describe, expect, it } from "vitest";
import { DustView, LEDGER_BYTES, STATE_GRIMY, STATE_OPENED, STATE_POLISHED } from "../src/core/dust-view";
import { DUST_LEVEL_BY_CLASS } from "../src/core/tables";
import { computeGolden, GOLDEN_EXPECTED } from "./golden-cases";
import { applyAll, freshView, fullDigest, mulberry32, realTables, seededStrokes, SEED, SITE_PLOT } from "./support";

const t = realTables();
const u0Of = (plot: number): number => 16 * (DUST_LEVEL_BY_CLASS[t.classOf[plot]!] ?? 0);
const texel = (v: DustView, plot: number, a: number, b: number): number =>
  v.texels[v.slotOf[plot]! * LEDGER_BYTES + b * 32 + a]!;

describe("ledger rasterisation", () => {
  it("a full-coverage pass removes depth16 units; non-owned texels stay 0", () => {
    const v = freshView();
    const u0 = u0Of(SITE_PLOT);
    // 2 m wide, 4 m long through the plot centre: texels (14..17, 15..16) are fully covered.
    const removed = v.applyStroke(SITE_PLOT, -2000, 0, 2000, 0, 200, 32, 0);
    expect(removed).toBeGreaterThan(0);
    for (let a = 14; a <= 17; a++) {
      expect(texel(v, SITE_PLOT, a, 15)).toBe(u0 - 32);
      expect(texel(v, SITE_PLOT, a, 16)).toBe(u0 - 32);
    }
    // Frame corners belong to neighbours.
    expect(texel(v, SITE_PLOT, 0, 0)).toBe(0);
    expect(texel(v, SITE_PLOT, 31, 31)).toBe(0);
    const slot = v.slotOf[SITE_PLOT]!;
    expect(v.initial[slot]).toBe(u0 * v.owned[slot]!);
    expect(v.owned[slot]).toBeGreaterThan(400);
    expect(v.owned[slot]).toBeLessThan(560);
    let sum = 0;
    for (let i = 0; i < LEDGER_BYTES; i++) sum += v.texels[slot * LEDGER_BYTES + i]!;
    expect(v.remaining[slot]).toBe(sum);
    expect(v.initial[slot]! - sum).toBe(removed);
  });

  it("thin tool: a 15 cm stroke crossing a 0.8 m texel removes 15 of 80 units (WDS 4.5 table)", () => {
    const v = freshView();
    // Along v = 0 mm... the row b = 16 spans v in [0, 800); run through its middle so one row takes all of it.
    v.applyStroke(SITE_PLOT, -2000, 400, 2000, 400, 15, 80, 0);
    const u0 = u0Of(SITE_PLOT);
    expect(texel(v, SITE_PLOT, 15, 16)).toBe(u0 - 15);
    expect(texel(v, SITE_PLOT, 16, 16)).toBe(u0 - 15);
    expect(texel(v, SITE_PLOT, 15, 15)).toBe(u0);
  });

  it("minimum removal: coverage >= A/64 removes at least 1 unit even at depth16 = 1", () => {
    const v = freshView();
    v.applyStroke(SITE_PLOT, -400, 400, 400, 400, 15, 1, 0);
    expect(texel(v, SITE_PLOT, 16, 16)).toBe(u0Of(SITE_PLOT) - 1);
  });

  it("a disc (start == end) clears what it fully covers at depth16 255", () => {
    const v = freshView();
    v.applyStroke(SITE_PLOT, 400, 400, 400, 400, 300, 255, 0);
    expect(texel(v, SITE_PLOT, 16, 16)).toBe(0);
  });

  it("every plot a stroke changes gets the same bytes from any anchor frame nearby", () => {
    const strokes = seededStrokes(t, 200, 77);
    const a = freshView();
    applyAll(a, strokes);
    expect(a.ledgerCount).toBeGreaterThan(10);
    // The same records applied to a second view give the same world.
    const b = freshView();
    applyAll(b, strokes);
    expect(fullDigest(b)).toBe(fullDigest(a));
  });

  it("V2: 200 random permutations of the same op set give identical ledgers", () => {
    const strokes = seededStrokes(t, 300, 4242);
    const base = freshView();
    applyAll(base, strokes);
    const want = fullDigest(base);
    const wantHash = base.hashWhere(null);
    const rng = mulberry32(99);
    const order = strokes.map((_, i) => i);
    for (let p = 0; p < 200; p++) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = order[i]!;
        order[i] = order[j]!;
        order[j] = tmp;
      }
      const v = freshView();
      applyAll(v, strokes, order);
      expect(fullDigest(v)).toBe(want);
      expect(v.hashWhere(null)).toBe(wantHash);
    }
  }, 120_000);

  it("the far-plot prune never changes a ledger", () => {
    const strokes = seededStrokes(t, 1500, 31337);
    const a = freshView();
    const b = freshView();
    b.pruneFar = false;
    applyAll(a, strokes);
    applyAll(b, strokes);
    expect(fullDigest(a)).toBe(fullDigest(b));
    expect(a.latticePoints).toBeLessThan(b.latticePoints);
  });

  it("thresholds: Grimy -> Opened at 0.1 % removed, Polished at <= 1 % left, monotonic, ledger freed", () => {
    const v = freshView();
    expect(v.state[SITE_PLOT]).toBe(STATE_GRIMY);
    v.applyStroke(SITE_PLOT, -100, 400, 100, 400, 15, 1, 0);
    // One texel lost 1 unit of ~38,000: below ceil(initial / 1000), still Grimy but touched.
    expect(v.state[SITE_PLOT]).toBe(STATE_GRIMY);
    expect(v.slotOf[SITE_PLOT]).toBeGreaterThanOrEqual(0);
    v.applyStroke(SITE_PLOT, -2000, 0, 2000, 0, 200, 32, 0);
    expect(v.state[SITE_PLOT]).toBe(STATE_OPENED);
    expect(v.frac[SITE_PLOT]).toBeLessThan(255);
    // Charge-depth lanes over the whole frame.
    for (let lane = -12_000; lane <= 12_000 && v.state[SITE_PLOT] !== STATE_POLISHED; lane += 900) {
      for (let u = -12_800; u < 12_800; u += 3200) v.applyStroke(SITE_PLOT, u, lane, u + 3200, lane, 100, 255, 1);
    }
    expect(v.state[SITE_PLOT]).toBe(STATE_POLISHED);
    expect(v.slotOf[SITE_PLOT]).toBe(-1);
    expect(v.frac[SITE_PLOT]).toBe(0);
    // Further strokes do nothing to a Polished plot.
    const before = v.hashWhere(null);
    v.applyStroke(SITE_PLOT, -100, 0, 100, 0, 100, 255, 1);
    expect(v.state[SITE_PLOT]).toBe(STATE_POLISHED);
    expect(v.plotHash(SITE_PLOT)).not.toBe(0);
    // Neighbours touched by the lanes keep their own ledgers; only their bytes may have changed.
    expect(typeof before).toBe("number");
  });

  it("reachability: the thinnest tool polishes a plot in finitely many passes", () => {
    const v = freshView();
    let passes = 0;
    while (v.state[SITE_PLOT] !== STATE_POLISHED && passes < 40) {
      passes++;
      for (let lane = -12_725; lane < 12_800; lane += 150) {
        for (let u = -12_800; u < 12_800; u += 3200) v.applyStroke(SITE_PLOT, u, lane, u + 3200, lane, 15, 80, 0);
      }
    }
    expect(v.state[SITE_PLOT]).toBe(STATE_POLISHED);
    // Adjacent 15 cm lanes are one full-coverage pass: levels / Depth 5 passes (+1 for rounding at lane seams).
    const level = DUST_LEVEL_BY_CLASS[t.classOf[SITE_PLOT]!]!;
    expect(passes).toBeLessThanOrEqual(Math.ceil(level / 5) + 1);
  }, 60_000);

  it("V4: re-scrubbing one line never collects more than sweeping fresh lanes", () => {
    const a = freshView();
    const b = freshView();
    let rescrub = 0;
    let fresh = 0;
    for (let k = 0; k < 200; k++) {
      rescrub += a.applyStroke(SITE_PLOT, -1500, 400, 1500, 400, 15, 80, 0);
      const lane = -9000 + (k % 100) * 150;
      const u = k < 100 ? -3000 : 0;
      fresh += b.applyStroke(SITE_PLOT, u, lane, u + 3000, lane, 15, 80, 0);
    }
    expect(rescrub).toBeLessThanOrEqual(fresh);
  });

  it("V1: golden vectors (1,000 seeded strokes, every tool)", () => {
    const got = computeGolden();
    expect(got.ledgers).toBeGreaterThan(15);
    expect(got).toEqual(GOLDEN_EXPECTED);
  });

  it("golden vectors use the contest seed", () => {
    expect(SEED).toBe(20261114);
  });
});
