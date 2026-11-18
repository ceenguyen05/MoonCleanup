// Initial partial cover (DUST_INIT_REVISION 1, Landing Apron 20 % at level 2): allocation, mass, thresholds, the
// Inspector's Stamp, restore / snapshot clamping, reset and determinism (M1 apron cover).
import { describe, expect, test } from "vitest";
import { LEDGER_BYTES, PlotState, type PlotId } from "@moon-cleanup/shared";
import {
  DUST_INIT_REVISION,
  DustChunkEncoder,
  restoreDustChunks,
  type DustCoverSpec,
  type WorldDustLedger,
} from "../../src/index";
import { makeLedger, Sink, SITE_PLOT, standardGrid, strokeAt } from "../support/dust";

const APRON = 2;
const PERMILLE = 200;
const COVER: readonly DustCoverSpec[] = [{ plots: [SITE_PLOT], level: APRON, permille: PERMILLE }];

function covered(): WorldDustLedger {
  return makeLedger({ initialCover: COVER });
}

/** The full Grimy ledger of a level-2 plot without cover (reference for mass and per-unit values). */
function fullApronLevel(): WorldDustLedger {
  return makeLedger({ dustLevelOf: (p) => (p === SITE_PLOT ? APRON : -1) });
}

/**
 * Gives `plot` its untouched ledger through the snapshot entry: every texel 255, so every legal texel is clamped to
 * its initial value (the clamp is part of what is under test). Returns the slot.
 */
function touch(ledger: WorldDustLedger, plot = SITE_PLOT): number {
  const bytes = new Uint8Array(LEDGER_BYTES).fill(255);
  ledger.installLedger(plot, bytes, 0, 0);
  ledger.refreshPlot(plot);
  return ledger.slotOf[plot]!;
}

function texelsOf(ledger: WorldDustLedger, slot: number): number[] {
  return Array.from(ledger.texels.subarray(slot * LEDGER_BYTES, (slot + 1) * LEDGER_BYTES));
}

function ownedBit(ledger: WorldDustLedger, slot: number, ix: number): number {
  return (ledger.ownedMask[slot * 128 + (ix >> 3)]! >> (ix & 7)) & 1;
}

/** Frame mm (u, v) of the centre of the first dusty texel of the cover plot. */
function dustyCentre(): { u: number; v: number } {
  const ref = covered();
  const rs = touch(ref);
  for (let ix = 0; ix < LEDGER_BYTES; ix++) {
    if (ref.texels[rs * LEDGER_BYTES + ix] === 0) continue;
    return { u: (ix & 31) * 800 + 400 - 12_800, v: (ix >> 5) * 800 + 400 - 12_800 };
  }
  throw new Error("no dusty texel");
}

/** Sweeps the whole frame of `plot` with a wide, deep tool (3.4 m pieces) until it is Polished; returns the mg. */
function sweepAll(ledger: WorldDustLedger, plot: number, actor = 0): number {
  const sink = new Sink();
  let mg = 0;
  for (let pass = 0; pass < 12 && ledger.state[plot] !== PlotState.Polished; pass++) {
    for (let v = -13_600; v <= 13_600; v += 800) {
      for (let u = -13_600; u < 13_600; u += 3_400) {
        ledger.applyStroke(strokeAt(plot, u, v, Math.min(u + 3_400, 13_600), v, 140, 255, actor), sink);
        mg += sink.milligrams;
      }
    }
  }
  return mg;
}

describe("initial partial cover (DUST_INIT_REVISION 1)", () => {
  test("revision constant", () => {
    expect(DUST_INIT_REVISION).toBe(1);
  });

  test("cover plots take the cover level; others keep the class level", () => {
    const led = covered();
    expect(led.levelOf[SITE_PLOT]).toBe(APRON);
    expect(led.hasPartialCover(SITE_PLOT)).toBe(true);
    const other = standardGrid().neighbors(SITE_PLOT as PlotId)[0]!;
    expect(led.levelOf[other]).toBe(5);
    expect(led.hasPartialCover(other)).toBe(false);
    expect(led.isCoverTexel(other, 0)).toBe(true);
    expect(led.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(led.frac[SITE_PLOT]).toBe(255);
  });

  test("allocation: round(owned x 20 %) owned texels at 16 x level, the rest blank; mass per unit of a full plot", () => {
    const led = covered();
    const slot = touch(led);
    const owned = led.owned[slot]!;
    let dusty = 0;
    for (let ix = 0; ix < LEDGER_BYTES; ix++) {
      const u = led.texels[slot * LEDGER_BYTES + ix]!;
      expect(u === 0 || u === 16 * APRON).toBe(true);
      expect(u > 0).toBe(ownedBit(led, slot, ix) === 1 && led.isCoverTexel(SITE_PLOT, ix));
      if (u > 0) dusty++;
    }
    expect(dusty).toBe(Math.floor((owned * PERMILLE + 500) / 1000));
    expect(led.coverTexelCount(SITE_PLOT)).toBe(dusty);
    expect(led.initial[slot]).toBe(16 * APRON * dusty);
    expect(led.remaining[slot]).toBe(led.initial[slot]);
    expect(led.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(led.frac[SITE_PLOT]).toBe(255);

    // Same areal density as a fully covered plot of the same level: mgPerUnit equal, total mass about 20 %.
    const full = fullApronLevel();
    const fslot = touch(full);
    expect(full.owned[fslot]).toBe(owned);
    expect(led.mgPerUnit[slot]).toBe(full.mgPerUnit[fslot]);
    const ratio = (led.initial[slot]! * led.mgPerUnit[slot]!) / (full.initial[fslot]! * full.mgPerUnit[fslot]!);
    expect(Math.abs(ratio - 0.2)).toBeLessThan(0.002);
  });

  test("the cover is deterministic, patchy and independent of the spec order", () => {
    const a = covered();
    const b = makeLedger({ initialCover: [{ plots: [SITE_PLOT + 7, SITE_PLOT], level: APRON, permille: PERMILLE }] });
    const sa = touch(a);
    const sb = touch(b);
    expect(texelsOf(a, sa)).toEqual(texelsOf(b, sb));
    // Patchy, not salt-and-pepper: most dusty texels have a dusty 4-neighbour.
    const t = texelsOf(a, sa);
    let dusty = 0;
    let joined = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (t[y * 32 + x] === 0) continue;
        dusty++;
        const n =
          (x > 0 && t[y * 32 + x - 1]! > 0) ||
          (x < 31 && t[y * 32 + x + 1]! > 0) ||
          (y > 0 && t[(y - 1) * 32 + x]! > 0) ||
          (y < 31 && t[(y + 1) * 32 + x]! > 0);
        if (n) joined++;
      }
    }
    expect(joined / dusty).toBeGreaterThan(0.8);
  });

  test("blank texels are never removal: a stroke over blank ground allocates nothing and credits nobody", () => {
    const ref = covered();
    const rs = touch(ref);
    // An owned blank texel whose 4 neighbours are owned and blank: a 0.5 m disc at its centre reaches no dust.
    let blank = -1;
    for (let ix = 33; ix < LEDGER_BYTES - 33 && blank < 0; ix++) {
      const x = ix & 31;
      if (x < 1 || x > 30) continue;
      const ring = [ix, ix - 1, ix + 1, ix - 32, ix + 32];
      if (ring.every((k) => ownedBit(ref, rs, k) === 1 && !ref.isCoverTexel(SITE_PLOT, k))) blank = ix;
    }
    expect(blank).toBeGreaterThanOrEqual(0);
    const led = covered();
    const sink = new Sink();
    const u = (blank & 31) * 800 + 400 - 12_800;
    const v = (blank >> 5) * 800 + 400 - 12_800;
    led.applyStroke(strokeAt(SITE_PLOT, u, v, u, v, 50, 255, 3), sink);
    expect(sink.removedUnits).toBe(0);
    expect(sink.milligrams).toBe(0);
    expect(led.slotOf[SITE_PLOT]).toBe(-1);
    expect(led.contributionOf(SITE_PLOT, 3)).toBe(0);
    expect(led.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(led.openedQueueCount).toBe(0);
    expect(led.polishedQueueCount).toBe(0);
  });

  test("cleaning the cover polishes the plot once and credits the player who cleaned it", () => {
    const led = covered();
    expect(sweepAll(led, SITE_PLOT, 2)).toBeGreaterThan(0);
    expect(led.state[SITE_PLOT]).toBe(PlotState.Polished);
    let stamps = 0;
    for (let k = 0; k < led.polishedQueueCount; k++) {
      if (led.polishedPlotAt(k) !== SITE_PLOT) continue;
      stamps++;
      expect(led.polishedCreditAt(k)).toBe(2);
    }
    expect(stamps).toBe(1);
  });

  test("a stroke on the cover pays exactly removed units x the full plot's mg per unit", () => {
    const led = covered();
    const full = fullApronLevel();
    const a = new Sink();
    const b = new Sink();
    const c = dustyCentre();
    const s = strokeAt(SITE_PLOT, c.u - 1600, c.v, c.u + 1600, c.v, 140, 255, 1);
    led.applyStroke(s, a);
    full.applyStroke(s, b);
    const slot = led.slotOf[SITE_PLOT]!;
    expect(a.removedUnits).toBeLessThan(b.removedUnits);
    let mine = 0;
    for (let k = 0; k < led.outN; k++) if (led.outPlots[k] === SITE_PLOT) mine = led.outMg[k]!;
    let removedHere = 0;
    for (let k = 0; k < led.outN; k++) if (led.outPlots[k] === SITE_PLOT) removedHere = led.outRemoved[k]!;
    expect(mine).toBe(removedHere * led.mgPerUnit[slot]!);
    expect(led.contributionOf(SITE_PLOT, 1)).toBe(removedHere);
  });

  test("restore / snapshot clamps a legacy full-dust ledger to the cover; a save round trip is exact", () => {
    const led = covered();
    const legacy = new Uint8Array(LEDGER_BYTES).fill(80); // level-5 full dust written by a pre-cover build
    const repaired = led.installLedger(SITE_PLOT, legacy, 0, 3);
    const slot = led.slotOf[SITE_PLOT]!;
    // every texel had to change: blank / unowned ones to 0, covered ones down to 16 x 2
    expect(repaired).toBe(LEDGER_BYTES);
    expect(led.remaining[slot]).toBe(led.initial[slot]);
    led.refreshPlot(SITE_PLOT);
    expect(led.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(led.polishedQueueCount).toBe(0);
    led.addContribution(SITE_PLOT, 1, 1000); // stored credit never exceeds removed units (none removed)
    expect(led.contributionOf(SITE_PLOT, 1)).toBe(0);

    const src = covered();
    const sink = new Sink();
    const c = dustyCentre();
    src.applyStroke(strokeAt(SITE_PLOT, c.u - 3000, c.v, c.u, c.v, 140, 255, 1), sink);
    src.applyStroke(strokeAt(SITE_PLOT, c.u, c.v, c.u + 3000, c.v, 140, 255, 1), sink);
    expect(src.slotOf[SITE_PLOT]).toBeGreaterThanOrEqual(0);
    const chunk = standardGrid().chunkOf(SITE_PLOT as PlotId);
    const bytes = new DustChunkEncoder().encode(src, chunk, 7).slice();
    const dst = covered();
    const r = restoreDustChunks(dst, [bytes], 7);
    expect(r.ok).toBe(true);
    expect(r.texelsRepaired).toBe(0);
    expect(r.headerMismatches).toBe(0);
    expect(r.stateMismatches).toBe(0);
    expect(dst.worldHash()).toBe(src.worldHash());
    expect(dst.contributionOf(SITE_PLOT, 1)).toBe(src.contributionOf(SITE_PLOT, 1));
  });

  test("reset and resetPlot return to the same untouched cover", () => {
    const led = covered();
    const first = texelsOf(led, touch(led));
    sweepAll(led, SITE_PLOT);
    led.reset();
    expect(led.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(led.frac[SITE_PLOT]).toBe(255);
    expect(texelsOf(led, touch(led))).toEqual(first);
    led.resetPlot(SITE_PLOT);
    expect(led.slotOf[SITE_PLOT]).toBe(-1);
    expect(texelsOf(led, touch(led))).toEqual(first);
  });

  test("invalid cover specs are refused", () => {
    expect(() => makeLedger({ initialCover: [{ plots: [SITE_PLOT], level: 1.5, permille: 200 }] })).toThrow(RangeError);
    expect(() => makeLedger({ initialCover: [{ plots: [SITE_PLOT], level: 0, permille: 200 }] })).toThrow(RangeError);
    expect(() => makeLedger({ initialCover: [{ plots: [SITE_PLOT], level: 2, permille: 0 }] })).toThrow(RangeError);
    expect(() => makeLedger({ initialCover: [{ plots: [SITE_PLOT], level: 2, permille: 1001 }] })).toThrow(RangeError);
    expect(() => makeLedger({ initialCover: [{ plots: [-1], level: 2, permille: 200 }] })).toThrow(RangeError);
  });

  test("a full (1000 per mille) cover is the uniform world at that level", () => {
    const a = makeLedger({ initialCover: [{ plots: [SITE_PLOT], level: APRON, permille: 1000 }] });
    const b = fullApronLevel();
    expect(a.hasPartialCover(SITE_PLOT)).toBe(false);
    const sa = touch(a);
    const sb = touch(b);
    expect(a.initial[sa]).toBe(b.initial[sb]);
    expect(a.ledgerHash(SITE_PLOT)).toBe(b.ledgerHash(SITE_PLOT));
  });
});
