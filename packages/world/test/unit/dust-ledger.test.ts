// WorldDustLedger: contract vectors, determinism, order independence (V2), thresholds and the Inspector's Stamp,
// reachability (V3), over-collection (V4), two-view convergence (V5), the port result and the pooled hot path.
import { describe, expect, test } from "vitest";
import {
  CHUNK_MIX_VECTORS,
  DustClass,
  FNV1A_32_FOOBAR,
  LEDGER_BYTES,
  LEDGER_HASH_VECTORS,
  LEDGER_REMOVAL_VECTORS,
  PLOT_THRESHOLD_VECTORS,
  PlotState,
  type PlotId,
} from "@moon-cleanup/shared";
import {
  computePlotAreasM2,
  DUST_CREDIT_SHIFT,
  fnv1a32,
  latticePitchMm,
  LEDGER_SHIFT_ACTOR_SLOT,
  ledgerRemovalUnits,
  LoggedStroke,
  mixPlotHash,
  openedThresholdUnits,
  PlotAttributeTables,
  polishedThresholdUnits,
  remainingFraction255,
  type WorldDustLedger,
} from "../../src/index";
import {
  applyAll,
  fullDigest,
  makeLedger,
  mixedAttributes,
  permutation,
  seededStrokes,
  SEED,
  Sink,
  SITE_PLOT,
  standardGrid,
  strokeAt,
  TOOLS,
  uniformAttributes,
  type Stroke,
} from "../support/dust";

function pattern(name: "zeros" | "ramp" | "corners"): Uint8Array {
  const b = new Uint8Array(LEDGER_BYTES);
  if (name === "ramp") for (let k = 0; k < b.length; k++) b[k] = k & 0xff;
  if (name === "corners") {
    b[0] = 208;
    b[1023] = 80;
  }
  return b;
}

/**
 * Boustrophedon lanes over the whole frame of `site` (plus a margin), `strokeMm` long strokes, one pass. `phaseMm`
 * shifts every lane across the lane direction (where the lanes sit against the lattice and the texels).
 */
function lanePass(
  site: number,
  widthCm: number,
  depth16: number,
  laneMm: number,
  strokeMm: number,
  actor = 0,
  jitter = 0,
  phaseMm = 0,
): Stroke[] {
  const out: Stroke[] = [];
  const edge = 14_000;
  let row = 0;
  for (let v = -edge + phaseMm; v <= edge; v += laneMm, row++) {
    const vv = v + (jitter === 0 ? 0 : ((row * 37) % (2 * jitter + 1)) - jitter);
    for (let u = -edge; u < edge; u += strokeMm) {
      const a = row % 2 === 0 ? u : -u;
      const b = row % 2 === 0 ? u + strokeMm : -(u + strokeMm);
      out.push(strokeAt(site, a, vv, b, vv, widthCm, depth16, actor));
    }
  }
  return out;
}

describe("contract vectors (shared/world/vectors)", () => {
  test("per-texel removal", () => {
    for (const v of LEDGER_REMOVAL_VECTORS)
      expect(ledgerRemovalUnits(v.depth16, v.coverageMm2), v.name).toBe(v.removalUnits);
  });

  test("Opened / Polished integer thresholds", () => {
    for (const v of PLOT_THRESHOLD_VECTORS) {
      expect(16 * v.level * v.ownedTexels, v.name).toBe(v.initialUnits);
      expect(openedThresholdUnits(v.initialUnits), v.name).toBe(v.openedRemovedUnits);
      expect(polishedThresholdUnits(v.initialUnits), v.name).toBe(v.polishedRemainingUnits);
    }
  });

  test("ledger hash and chunk mix", () => {
    expect(fnv1a32(Uint8Array.from("foobar", (ch) => ch.charCodeAt(0)))).toBe(FNV1A_32_FOOBAR);
    for (const v of LEDGER_HASH_VECTORS) expect(fnv1a32(pattern(v.pattern)), v.name).toBe(v.hash);
    for (const v of CHUNK_MIX_VECTORS) expect(mixPlotHash(v.plotId, v.hash) >>> 0).toBe(v.mix);
  });

  test("lattice pitch (snapped down to a divisor of the 800 mm texel) and L0 byte", () => {
    // T1 .. T6: width / 8 = 19 (clamped to 25), 35, 56, 94, 125 and 175 (clamped to 100).
    expect(latticePitchMm(15)).toBe(25);
    expect(latticePitchMm(28)).toBe(32);
    expect(latticePitchMm(45)).toBe(50);
    expect(latticePitchMm(75)).toBe(80);
    expect(latticePitchMm(100)).toBe(100);
    expect(latticePitchMm(140)).toBe(100);
    expect(latticePitchMm(50)).toBe(50); // Detailing disc
    expect(latticePitchMm(1)).toBe(25);
    expect(latticePitchMm(1023)).toBe(100);
    const seen = new Set<number>();
    for (let widthCm = 1; widthCm <= 1023; widthCm++) {
      const p = latticePitchMm(widthCm);
      const raw = Math.min(100, Math.max(25, Math.floor((widthCm * 10 + 4) / 8)));
      expect(800 % p, `width ${widthCm}`).toBe(0);
      expect(p, `width ${widthCm}`).toBeLessThanOrEqual(raw);
      expect(p, `width ${widthCm}`).toBeGreaterThanOrEqual(25);
      seen.add(p);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([25, 32, 40, 50, 80, 100]);
    expect(remainingFraction255(38_320, 38_320)).toBe(255);
    expect(remainingFraction255(1, 38_320)).toBe(1);
    expect(remainingFraction255(0, 38_320)).toBe(0);
  });
});

describe("plot areas", () => {
  test("sum to the sphere and match the WDS statistics", () => {
    const grid = standardGrid();
    const areas = computePlotAreasM2(grid);
    let sum = 0;
    let min = Infinity;
    let max = 0;
    for (let p = 0; p < grid.count; p++) {
      sum += areas[p]!;
      min = Math.min(min, areas[p]!);
      max = Math.max(max, areas[p]!);
    }
    const sphere = 4 * Math.PI * 2000 * 2000;
    expect(Math.abs(sum - sphere) / sphere).toBeLessThan(2e-4);
    expect(sum / grid.count).toBeGreaterThan(300);
    expect(sum / grid.count).toBeLessThan(313);
    // Measured 2026-11-14: pentagons 271.8 m^2 (WDS 2.8: 272), hexagons 284.6 .. 370.1 m^2.
    expect(min).toBeGreaterThan(265);
    expect(min).toBeLessThan(280);
    expect(max).toBeLessThan(380);
    expect(areas[0]).toBe(min); // plot 0 is a pentagon
  });
});

describe("rasterisation", () => {
  test("a fresh ledger allocates nothing until a stroke removes dust", () => {
    const ledger = makeLedger();
    expect(ledger.ledgerCount).toBe(0);
    expect(ledger.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(ledger.frac[SITE_PLOT]).toBe(255);
    const sink = new Sink();
    ledger.applyStroke(strokeAt(SITE_PLOT, -1000, 0, 1000, 0, 15, 80), sink);
    expect(ledger.ledgerCount).toBe(1);
    expect(sink.plotCount).toBe(1);
    expect(sink.plotIds[0]).toBe(SITE_PLOT);
    expect(sink.removedUnits).toBeGreaterThan(0);
  });

  test("ownership: owned texels start at 16 x level, the rest hold 0, and the plots tile the ground", () => {
    const ledger = makeLedger({ attributes: mixedAttributes() });
    // Touch the site and each neighbour at its centre so every one of them gets a ledger.
    const plots = [SITE_PLOT, ...Array.from(standardGrid().neighbors(SITE_PLOT as PlotId))];
    expect(plots.length).toBe(7);
    for (const q of plots) applyAll(ledger, [strokeAt(q, -500, 0, 500, 0, 15, 80)]);
    for (const q of plots) {
      const slot = ledger.slotOf[q]!;
      if (ledger.state[q] === PlotState.Empty) continue;
      expect(slot).toBeGreaterThanOrEqual(0);
      const u0 = 16 * ledger.levelOf[q]!;
      expect(ledger.initial[slot]).toBe(u0 * ledger.owned[slot]!);
      // Owned texel area approximates the plot area (0.64 m^2 per texel).
      const area = mixedAttributes().areaM2(q as PlotId);
      expect(Math.abs(ledger.owned[slot]! * 0.64 - area) / area).toBeLessThan(0.03);
      // mgPerUnit = floor(mass / initialUnits) with mass = 0.062 kg x level x area.
      expect(ledger.mgPerUnit[slot]).toBe(Math.floor((62_000 * ledger.levelOf[q]! * area) / ledger.initial[slot]!));
      expect(ledger.mgPerUnit[slot]).toBeGreaterThan(2400);
      expect(ledger.mgPerUnit[slot]).toBeLessThan(2560);
      // Non-owned texels hold 0; owned texels hold at most 16 x level; the bytes sum to remainingUnits.
      let sum = 0;
      for (let ix = 0; ix < 1024; ix++) {
        const u = ledger.texels[slot * 1024 + ix]!;
        const ownedBit = (ledger.ownedMask[slot * 128 + (ix >> 3)]! >> (ix & 7)) & 1;
        if (ownedBit === 0) expect(u).toBe(0);
        else expect(u).toBeLessThanOrEqual(u0);
        sum += u;
      }
      expect(sum).toBe(ledger.remaining[slot]);
    }
  });

  test("a full-coverage pass removes depth16 units; flat ends tile a chain without double counting", () => {
    const one = makeLedger();
    const two = makeLedger();
    // One 3 m stroke against the same line cut into 3 chained segments, 1.6 m wide, well inside the plot.
    applyAll(one, [strokeAt(SITE_PLOT, -1500, 0, 1500, 0, 160, 32)]);
    applyAll(two, [
      strokeAt(SITE_PLOT, -1500, 0, -400, 0, 160, 32),
      strokeAt(SITE_PLOT, -400, 0, 700, 0, 160, 32),
      strokeAt(SITE_PLOT, 700, 0, 1500, 0, 160, 32),
    ]);
    const a = one.slotOf[SITE_PLOT]!;
    const b = two.slotOf[SITE_PLOT]!;
    const removedOne = one.initial[a]! - one.remaining[a]!;
    const removedTwo = two.initial[b]! - two.remaining[b]!;
    // Swept area 4.8 m^2 = 7.5 texels x 32 units = 240 units; rounding per texel moves it by a few units.
    expect(Math.abs(removedOne - 240)).toBeLessThanOrEqual(8);
    expect(Math.abs(removedTwo - removedOne)).toBeLessThanOrEqual(6);
    // A texel fully inside the stroke loses exactly depth16.
    const full = makeLedger();
    applyAll(full, [strokeAt(SITE_PLOT, -3000, 400, 3000, 400, 300, 48)]);
    const s = full.slotOf[SITE_PLOT]!;
    const ix = 16 * 32 + 16; // texel covering u, v in [0, 0.8) m
    expect(full.texels[s * 1024 + ix]).toBe(80 - 48);
  });

  test("Detailing disc: 0.5 m diameter, depth16 255 removes about 4.9 levels wherever it lands", () => {
    // Disc area 0.196 m^2 = 30.7 % of a texel: 255 x 0.307 = 78 units (WDS 4.4: 4.9 levels). The 50 mm lattice
    // counts about 78 points, a few more or fewer depending on where the disc sits, so one disc removes 74 .. 81
    // units (measured over a texel; 71 .. 83 with the unsnapped 63 mm pitch of dust model 1).
    let lo = Infinity;
    let hi = 0;
    const sink = new Sink();
    for (let du = 0; du < 800; du += 97) {
      for (let dv = 0; dv < 800; dv += 89) {
        const ledger = makeLedger({ strokeLog: false });
        ledger.applyStroke(strokeAt(SITE_PLOT, du, dv, du, dv, 50, 255), sink);
        lo = Math.min(lo, sink.removedUnits);
        hi = Math.max(hi, sink.removedUnits);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(72);
    expect(hi).toBeLessThanOrEqual(84);
  });

  test("records outside the wire ranges are counted and change nothing", () => {
    const ledger = makeLedger();
    const sink = new Sink();
    const good = strokeAt(SITE_PLOT, 0, 0, 500, 0, 15, 80);
    for (const bad of [
      { ...good, anchor: -1 as PlotId },
      { ...good, anchor: 163_842 as PlotId },
      { ...good, widthCm: 0 },
      { ...good, widthCm: 1024 },
      { ...good, depth16: 256 },
      { ...good, startUMm: 40_000 },
      { ...good, endVMm: 0.5 },
      { ...good, actorSlot: 64 },
      { ...good, endUMm: Number.NaN },
    ]) {
      ledger.applyStroke(bad, sink);
      expect(sink.removedUnits).toBe(0);
      expect(sink.plotCount).toBe(0);
    }
    expect(ledger.counters.opsRejected).toBe(9);
    expect(ledger.ledgerCount).toBe(0);
    expect(ledger.isEmptyPlot(-1 as PlotId)).toBe(true);
    expect(ledger.isEmptyPlot(SITE_PLOT as PlotId)).toBe(false);
  });

  test("the far-plot skip changes no byte", () => {
    const strokes = seededStrokes(400, SEED + 3);
    const a = makeLedger({ attributes: mixedAttributes() });
    const b = makeLedger({ attributes: mixedAttributes() });
    b.pruneFar = false;
    applyAll(a, strokes);
    applyAll(b, strokes);
    expect(fullDigest(a)).toBe(fullDigest(b));
    expect(a.worldHash()).toBe(b.worldHash());
  });

  test("pentagon and its neighbours: same rules, 5 neighbours", () => {
    const ledger = makeLedger();
    const strokes = seededStrokes(200, SEED + 5, 25_000, 6, 0);
    applyAll(ledger, strokes);
    expect(ledger.slotOf[0]).toBeGreaterThanOrEqual(0);
    const slot = ledger.slotOf[0]!;
    expect(standardGrid().isPentagon(0 as PlotId)).toBe(true);
    const area = uniformAttributes().areaM2(0 as PlotId);
    expect(Math.abs(ledger.owned[slot]! * 0.64 - area) / area).toBeLessThan(0.03);
    let sum = 0;
    for (let i = 0; i < 1024; i++) sum += ledger.texels[slot * 1024 + i]!;
    expect(sum).toBe(ledger.remaining[slot]);
  });
});

describe("determinism and order independence", () => {
  test("the same strokes give the same bytes, totals and hashes (two instances)", () => {
    const strokes = seededStrokes(600, SEED);
    const a = makeLedger({ attributes: mixedAttributes() });
    const b = makeLedger({ attributes: mixedAttributes() });
    applyAll(a, strokes);
    applyAll(b, strokes);
    expect(fullDigest(a)).toBe(fullDigest(b));
    expect(a.worldHash()).toBe(b.worldHash());
    for (let s = 0; s < a.slotHigh; s++) {
      const plot = a.plotOfSlot[s]!;
      if (plot < 0) continue;
      const t = b.slotOf[plot]!;
      expect(a.remaining[s]).toBe(b.remaining[t]);
      expect(a.version[s]).toBe(b.version[t]);
      expect(a.ledgerHash(plot)).toBe(b.ledgerHash(plot));
      // The cached hash equals a fresh FNV-1a over the texel bytes.
      expect(a.ledgerHash(plot)).toBe(fnv1a32(a.texels, s * 1024, 1024));
    }
  });

  test("V2: 200 random permutations of one op set give identical ledgers, states and Polished sets", () => {
    // Deep tools on a small area so several plots reach Polished inside the set.
    const strokes = [...seededStrokes(260, SEED + 1, 16_000), ...lanePass(SITE_PLOT, 560, 255, 4000, 3500, 1)];
    const ref = makeLedger({ attributes: mixedAttributes() });
    applyAll(ref, strokes);
    const want = fullDigest(ref);
    const wantHash = ref.worldHash();
    expect(ref.polishedTotal).toBeGreaterThan(0);
    const ledger = makeLedger({ attributes: mixedAttributes() });
    for (let k = 0; k < 200; k++) {
      ledger.reset();
      applyAll(ledger, strokes, permutation(strokes.length, SEED + 100 + k));
      expect(fullDigest(ledger), `permutation ${k}`).toBe(want);
      expect(ledger.worldHash()).toBe(wantHash);
      expect(ledger.polishedTotal).toBe(ref.polishedTotal);
    }
  });

  test("V5: a client's authoritative copy converges whatever the arrival interleaving", () => {
    // Server order: by tick. Client: own strokes (actor 0) arrive as echoes late and out of order with the others.
    const strokes = seededStrokes(500, SEED + 2);
    const server = makeLedger({ attributes: mixedAttributes() });
    applyAll(server, strokes);
    const client = makeLedger({ attributes: mixedAttributes() });
    const own = strokes.map((_, k) => k).filter((k) => strokes[k]!.actorSlot === 0);
    const others = strokes.map((_, k) => k).filter((k) => strokes[k]!.actorSlot !== 0);
    applyAll(client, strokes, [...others.reverse(), ...own]);
    expect(client.worldHash()).toBe(server.worldHash());
    expect(fullDigest(client)).toBe(fullDigest(server));
    const grid = standardGrid();
    for (const chunk of new Set(strokes.map((s) => grid.chunkOf(s.anchor)))) {
      expect(client.chunkHash(chunk)).toBe(server.chunkHash(chunk));
    }
  });
});

describe("thresholds and the Inspector's Stamp", () => {
  test("Grimy -> Opened at 0.1 % removed, -> Polished at 1 % left; events queued once", () => {
    const ledger = makeLedger();
    const sink = new Sink();
    // One thin stroke: touched, still Grimy (15 units of 38,000 is below ceil(initial / 1000)).
    ledger.applyStroke(strokeAt(SITE_PLOT, 0, 400, 300, 400, 15, 80), sink);
    const slot = ledger.slotOf[SITE_PLOT]!;
    const initial = ledger.initial[slot]!;
    expect(initial - ledger.remaining[slot]!).toBeLessThan(openedThresholdUnits(initial));
    expect(ledger.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(ledger.openedQueueCount).toBe(0);
    // Cross the Opened threshold.
    let guard = 0;
    const stateOf = (plot: number): number => ledger.state[plot]!;
    while (stateOf(SITE_PLOT) === PlotState.Grimy && guard++ < 50) {
      ledger.applyStroke(strokeAt(SITE_PLOT, -3000, 400 + guard * 200, 3000, 400 + guard * 200, 15, 80), sink);
      const removed = initial - ledger.remaining[slot]!;
      expect(stateOf(SITE_PLOT) === PlotState.Opened).toBe(removed >= openedThresholdUnits(initial));
    }
    expect(ledger.state[SITE_PLOT]).toBe(PlotState.Opened);
    expect(ledger.openedQueueCount).toBe(1);
    expect(ledger.openedPlotAt(0)).toBe(SITE_PLOT);
    expect(ledger.frac[SITE_PLOT]).toBeLessThanOrEqual(255);
    // Sweep to Polished: the state flips in the stroke that brings remaining to <= floor(initial / 100).
    const threshold = polishedThresholdUnits(initial);
    let paidUnits = 0;
    let polishedAtRemaining = -1;
    for (const s of lanePass(SITE_PLOT, 140, 160, 1200, 3500)) {
      const before = ledger.slotOf[SITE_PLOT]! >= 0 ? ledger.remaining[ledger.slotOf[SITE_PLOT]!]! : -1;
      ledger.applyStroke(s, sink);
      if (ledger.state[SITE_PLOT] === PlotState.Polished && polishedAtRemaining < 0) {
        const mine = sink.plotIds.indexOf(SITE_PLOT);
        expect(mine).toBeGreaterThanOrEqual(0);
        polishedAtRemaining = before;
        expect(before).toBeGreaterThan(threshold);
      }
      paidUnits += sink.removedUnits;
    }
    expect(ledger.state[SITE_PLOT]).toBe(PlotState.Polished);
    expect(ledger.slotOf[SITE_PLOT]).toBe(-1); // ledger freed
    expect(ledger.log!.count(SITE_PLOT)).toBe(0); // log freed
    expect(ledger.frac[SITE_PLOT]).toBe(0);
    expect(ledger.polishedQueueCount).toBeGreaterThanOrEqual(1);
    let listed = 0;
    for (let k = 0; k < ledger.polishedQueueCount; k++) if (ledger.polishedPlotAt(k) === SITE_PLOT) listed++;
    expect(listed).toBe(1);
    expect(paidUnits).toBeGreaterThan(0);
    // Strokes on a Polished plot remove nothing from it (the residual is never paid).
    ledger.applyStroke(strokeAt(SITE_PLOT, -500, 0, 500, 0, 100, 255), sink);
    expect(sink.plotIds.subarray(0, sink.plotCount).includes(SITE_PLOT)).toBe(false);
  });

  test("the residual at most 1 % is not paid: units paid = initial - remaining at the Polished stroke", () => {
    const ledger = makeLedger();
    const sink = new Sink();
    let paid = 0;
    let initial = 0;
    let lastRemaining = 0;
    for (const s of lanePass(SITE_PLOT, 100, 255, 900, 3500)) {
      ledger.applyStroke(s, sink);
      for (let k = 0; k < ledger.outN; k++) if (ledger.outPlots[k] === SITE_PLOT) paid += ledger.outRemoved[k]!;
      const slot = ledger.slotOf[SITE_PLOT]!;
      if (slot >= 0) {
        initial = ledger.initial[slot]!;
        lastRemaining = ledger.remaining[slot]!;
      }
      if (ledger.state[SITE_PLOT] === PlotState.Polished) break;
    }
    expect(ledger.state[SITE_PLOT]).toBe(PlotState.Polished);
    expect(paid).toBeGreaterThanOrEqual(initial - lastRemaining);
    expect(paid).toBeLessThanOrEqual(initial);
    expect(initial - paid).toBeLessThanOrEqual(polishedThresholdUnits(initial));
  });

  test("stamp credit: a player with at least half gets it, otherwise the shift; robots are the shift", () => {
    const creditOf = (plan: readonly (readonly [number, number])[]): number => {
      // plan: [actorSlot, share]; strokes are dealt out by a hash of their index so every actor works the whole plot.
      const ledger = makeLedger();
      const lanes = lanePass(SITE_PLOT, 100, 255, 900, 3500);
      const sink = new Sink();
      lanes.forEach((stroke, k) => {
        const roll = ((Math.imul(k + 1, 0x9e3779b1) >>> 0) % 1000) / 1000;
        let acc = 0;
        let actor = plan[plan.length - 1]![0];
        for (const [slot, share] of plan) {
          acc += share;
          if (roll < acc) {
            actor = slot;
            break;
          }
        }
        ledger.applyStroke({ ...stroke, actorSlot: actor }, sink);
      });
      expect(ledger.state[SITE_PLOT]).toBe(PlotState.Polished);
      for (let k = 0; k < ledger.polishedQueueCount; k++) {
        if (ledger.polishedPlotAt(k) === SITE_PLOT) return ledger.polishedCreditAt(k);
      }
      return -99;
    };
    expect(creditOf([[3, 1]])).toBe(3);
    expect(
      creditOf([
        [2, 0.7],
        [4, 0.3],
      ]),
    ).toBe(2);
    expect(
      creditOf([
        [2, 0.3],
        [4, 0.7],
      ]),
    ).toBe(4);
    expect(
      creditOf([
        [0, 0.34],
        [1, 0.33],
        [2, 0.33],
      ]),
    ).toBe(DUST_CREDIT_SHIFT);
    expect(creditOf([[20, 1]])).toBe(DUST_CREDIT_SHIFT); // a robot alone
    expect(
      creditOf([
        [20, 0.7],
        [1, 0.3],
      ]),
    ).toBe(DUST_CREDIT_SHIFT); // robots did most of it
    expect(
      creditOf([
        [33, 0.3],
        [5, 0.7],
      ]),
    ).toBe(5);
  });

  test("contributions are exact per player and fold every non-player slot into the shift bucket", () => {
    const ledger = makeLedger();
    const strokes = seededStrokes(300, SEED + 7, 9000, 8);
    const sink = new Sink();
    const mine = new Map<number, number>();
    for (const s of strokes) {
      ledger.applyStroke(s, sink);
      for (let k = 0; k < ledger.outN; k++) {
        if (ledger.outPlots[k] !== SITE_PLOT) continue;
        const bucket = s.actorSlot < 16 ? s.actorSlot : LEDGER_SHIFT_ACTOR_SLOT;
        mine.set(bucket, (mine.get(bucket) ?? 0) + ledger.outRemoved[k]!);
      }
    }
    const slot = ledger.slotOf[SITE_PLOT]!;
    expect(slot).toBeGreaterThanOrEqual(0);
    let sum = 0;
    for (const [bucket, units] of mine) {
      expect(ledger.contributionOf(SITE_PLOT, bucket)).toBe(units);
      sum += units;
    }
    expect(sum).toBe(ledger.initial[slot]! - ledger.remaining[slot]!);
    const actors = new Uint8Array(4);
    const units = new Uint32Array(4);
    const n = ledger.topContributions(SITE_PLOT, actors, units);
    expect(n).toBe(4);
    const sorted = [...mine.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, 4);
    expect(Array.from(actors.subarray(0, n))).toEqual(sorted.map((e) => e[0]));
    expect(Array.from(units.subarray(0, n))).toEqual(sorted.map((e) => e[1]));
  });

  test("Empty plots: no dust, no ledger, counted for the Shine Index", () => {
    const grid = standardGrid();
    const classes = new Uint8Array(grid.count);
    classes[SITE_PLOT] = DustClass.Empty;
    const ledger = makeLedger({ attributes: new PlotAttributeTables(classes, uniformAttributes().areas) });
    expect(ledger.isEmptyPlot(SITE_PLOT as PlotId)).toBe(true);
    expect(ledger.emptyTotal).toBe(1);
    expect(ledger.shinePlots).toBe(1);
    const sink = new Sink();
    // A stroke that ends on the pad still cleans the neighbour it overlaps.
    ledger.applyStroke(strokeAt(SITE_PLOT, 0, 0, 9000, 0, 340, 144), sink);
    expect(ledger.slotOf[SITE_PLOT]).toBe(-1);
    expect(ledger.state[SITE_PLOT]).toBe(PlotState.Empty);
    expect(sink.plotIds.subarray(0, sink.plotCount).includes(SITE_PLOT)).toBe(false);
  });
});

describe("V3 reachability and design depth", () => {
  // Hand tools T1 .. T6 over a Highland (5), Mare (8) and Crater Floor (13) plot in lanes at 0.75 coverage efficiency
  // (lane spacing = 0.75 x width) with +-5 cm jitter. Hard requirement: every tool reaches Polished. Pacing bar
  // (progression section 1.1 / world-and-dust 4.5b): passes follow the continuous rule (1 if L <= D, else
  // max(2, 0.75 L / D)), and the MIX-WEIGHTED measured passes per tool (Moon mix 55/35/10 and outpost mix 90/8/2) are
  // within +-20 % of the rule. Per-pair counts are diagnostic only (frame overshoot and the gaps and overlaps of
  // jittered lanes move single pairs by up to about +-15 %), so they are only sanity-bounded here. The lattice itself
  // leaves no residue: its pitch is snapped to a divisor of the texel edge (test near the end of this block).
  const COVERAGE = 0.75;
  const hand = TOOLS.slice(0, 6);
  const classes: readonly (readonly [string, DustClass, number])[] = [
    ["Highland", DustClass.Highland, 5],
    ["Mare", DustClass.Mare, 8],
    ["Crater Floor", DustClass.CraterFloor, 13],
  ];
  const MOON_MIX = [0.55, 0.35, 0.1] as const;
  const OUTPOST_MIX = [0.9, 0.08, 0.02] as const;
  const rulePasses = (level: number, depth16: number): number => {
    const depth = depth16 / 16;
    return level <= depth ? 1 : Math.max(2, (COVERAGE * level) / depth);
  };
  const strokesToPolish = (ledger: WorldDustLedger, pass: readonly Stroke[], maxPasses: number): number => {
    const sink = new Sink();
    let strokes = 0;
    for (let p = 0; p < maxPasses; p++) {
      for (const s of pass) {
        ledger.applyStroke(s, sink);
        strokes++;
        if (ledger.state[SITE_PLOT] === PlotState.Polished) return strokes;
      }
    }
    return -1;
  };
  /** Measured passes (strokes to Polished / strokes per pass) per class x tool, computed once. */
  let measured: { single: number[][]; passes: number[][] } | undefined;
  const measure = () => {
    if (measured) return measured;
    const grid = standardGrid();
    const single: number[][] = [];
    const passes: number[][] = [];
    for (const [, cls] of classes) {
      const attributes = new PlotAttributeTables(new Uint8Array(grid.count).fill(cls), uniformAttributes().areas);
      const rowSingle: number[] = [];
      const rowPasses: number[] = [];
      for (const [widthCm, depth16] of hand) {
        const lanes = lanePass(SITE_PLOT, widthCm, depth16, Math.round(widthCm * 10 * COVERAGE), 1000, 0, 50);
        // Geometric single pass: the same lanes with a depth that clears everything it covers.
        rowSingle.push(
          strokesToPolish(
            makeLedger({ attributes, strokeLog: false }),
            lanes.map((s) => ({ ...s, depth16: 255 })),
            1,
          ),
        );
        rowPasses.push(strokesToPolish(makeLedger({ attributes, strokeLog: false }), lanes, 6) / lanes.length);
      }
      single.push(rowSingle);
      passes.push(rowPasses);
    }
    measured = { single, passes };
    return measured;
  };
  classes.forEach(([name], ci) => {
    test(`${name}: every hand tool reaches Polished in a single geometric pass and under its depth`, () => {
      const m = measure();
      hand.forEach(([widthCm], ti) => {
        expect(m.single[ci]![ti]!, `${name} width ${widthCm} single pass`).toBeGreaterThan(0);
        const eff = m.passes[ci]![ti]!;
        expect(eff, `${name} width ${widthCm} reached Polished`).toBeGreaterThan(0);
        // Diagnostic sanity band: within a factor of two of the rule, never below one pass.
        const rule = rulePasses(classes[ci]![2], hand[ti]![1]);
        expect(
          eff,
          `${name} width ${widthCm}: ${eff.toFixed(2)} passes, rule ${rule.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(Math.min(rule, 1) * 0.5);
        expect(eff).toBeLessThanOrEqual(rule * 2);
      });
    });
  });

  for (const [mixName, mix] of [
    ["Moon mix", MOON_MIX],
    ["outpost mix", OUTPOST_MIX],
  ] as const) {
    test(`${mixName}: mix-weighted passes of every hand tool are within +-20 % of the section 1.1 rule`, () => {
      const m = measure();
      hand.forEach(([widthCm, depth16], ti) => {
        let rule = 0;
        let got = 0;
        classes.forEach(([, , level], ci) => {
          rule += mix[ci]! * rulePasses(level, depth16);
          got += mix[ci]! * m.passes[ci]![ti]!;
        });
        const label = `${mixName} width ${widthCm}: measured ${got.toFixed(3)} passes, rule ${rule.toFixed(3)}`;
        expect(got, label).toBeGreaterThanOrEqual(0.8 * rule);
        expect(got, label).toBeLessThanOrEqual(1.2 * rule);
      });
    });
  }

  test("floor-2 rule: Crater Floor at Depth 5 (T1) needs about two passes (measured range 1.75 to 2.18)", () => {
    const m = measure();
    const eff = m.passes[2]![0]!;
    expect(eff).toBeGreaterThanOrEqual(1.75);
    expect(eff).toBeLessThanOrEqual(2.18);
  });

  test("lanes one tool width apart (no overlap) also reach Polished with every hand tool", () => {
    const grid = standardGrid();
    for (const [, cls, level] of classes) {
      const attributes = new PlotAttributeTables(new Uint8Array(grid.count).fill(cls), uniformAttributes().areas);
      for (const [widthCm, depth16] of hand) {
        const lanes = lanePass(SITE_PLOT, widthCm, depth16, widthCm * 10, 1000, 0, 50);
        const design = Math.ceil((16 * level) / depth16);
        expect(strokesToPolish(makeLedger({ attributes, strokeLog: false }), lanes, design + 3)).toBeGreaterThan(0);
      }
    }
  });

  test("no lattice residue: exact-width lanes with Depth >= level Polish in one pass, at any lane phase", () => {
    // The unsnapped pitch (dust model 1) left 2.1 % (T3, 56 mm) and 3.2 % (T4, 94 mm) on a Mare plot here and needed
    // 1.5 to 1.6 passes: texels that happened to hold 14 x 14 instead of 15 x 15 lattice points collected 96 % of
    // their area. With the pitch snapped to a divisor of 800 mm every fully covered texel collects exactly A.
    const grid = standardGrid();
    for (const [name, cls, level] of classes) {
      const attributes = new PlotAttributeTables(new Uint8Array(grid.count).fill(cls), uniformAttributes().areas);
      for (const [widthCm, depth16] of hand) {
        if (16 * level > depth16) continue;
        for (const phaseMm of [0, 7, 13, 101, 333]) {
          const lanes = lanePass(SITE_PLOT, widthCm, depth16, widthCm * 10, 1000, 0, 0, phaseMm);
          const used = strokesToPolish(makeLedger({ attributes, strokeLog: false }), lanes, 1);
          expect(used, `${name} width ${widthCm} phase ${phaseMm} mm`).toBeGreaterThan(0);
        }
      }
    }
  });

  test("T1 Desk Duster crossing a texel removes 15 of 80 units (18.75 % cover)", () => {
    const ledger = makeLedger();
    applyAll(ledger, [strokeAt(SITE_PLOT, -4000, 400, 4000, 400, 15, 80)]);
    const s = ledger.slotOf[SITE_PLOT]!;
    expect(ledger.texels[s * 1024 + 16 * 32 + 16]).toBe(80 - 15);
  });
});

describe("V4 over-collection", () => {
  test("200 strokes re-scrubbing one line collect no more than 200 strokes on fresh lanes", () => {
    for (const [widthCm, depth16] of TOOLS.slice(0, 6)) {
      const scrub = makeLedger();
      const fresh = makeLedger();
      const sink = new Sink();
      let scrubMg = 0;
      let freshMg = 0;
      for (let k = 0; k < 200; k++) {
        scrub.applyStroke(strokeAt(SITE_PLOT, -1000, 300, 1000, 300, widthCm, depth16), sink);
        scrubMg += sink.milligrams;
        // Fresh lanes: 20 lanes of 10 strokes, one tool width apart.
        const lane = Math.floor(k / 10);
        const u = -8000 + (k % 10) * 1600;
        const v = -6000 + lane * widthCm * 10;
        fresh.applyStroke(strokeAt(SITE_PLOT, u, v, u + 1600, v, widthCm, depth16), sink);
        freshMg += sink.milligrams;
      }
      expect(scrubMg, `width ${widthCm}`).toBeLessThanOrEqual(freshMg);
      expect(scrubMg).toBeGreaterThan(0);
    }
  });
});

describe("port result", () => {
  test("milligrams = removed units x mgPerUnit per plot, plots sorted by contribution, grime share", () => {
    const ledger = makeLedger({ attributes: mixedAttributes() });
    const sink = new Sink();
    // Across the border between the site and a neighbour.
    const grid = standardGrid();
    const s = strokeAt(SITE_PLOT, 6000, 0, 9800, 0, 340, 144);
    ledger.applyStroke(s, sink);
    expect(sink.plotCount).toBeGreaterThanOrEqual(1);
    let mg = 0;
    let units = 0;
    let previous = Infinity;
    for (let k = 0; k < sink.plotCount; k++) {
      const plot = sink.plotIds[k]!;
      const slot = ledger.slotOf[plot]!;
      const removed = ledger.initial[slot]! - ledger.remaining[slot]!;
      expect(removed).toBeGreaterThan(0);
      expect(removed).toBeLessThanOrEqual(previous);
      previous = removed;
      mg += removed * ledger.mgPerUnit[slot]!;
      units += removed;
    }
    expect(sink.milligrams).toBe(mg);
    expect(sink.removedUnits).toBe(units);
    expect(sink.grime01).toBeGreaterThan(0.85);
    expect(sink.grime01).toBeLessThanOrEqual(1);
    expect(grid.chunkOf(s.anchor)).toBeGreaterThanOrEqual(0);
    // The same stroke again over ground that is partly clean now: less dust, lower share.
    for (let k = 0; k < 4; k++) ledger.applyStroke(s, sink);
    expect(sink.grime01).toBeLessThan(1);
    // Mass check: sweeping a Highland plot clean collects about its plot mass (0.31 kg/m^2 x area), minus <= 1 %.
    const solo = makeLedger({ strokeLog: false });
    let total = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const st of lanePass(SITE_PLOT, 100, 255, 900, 3500)) {
        solo.applyStroke(st, sink);
        for (let k = 0; k < solo.outN; k++) if (solo.outPlots[k] === SITE_PLOT) total += solo.outMg[k]!;
      }
    }
    const massMg = 0.31 * uniformAttributes().areaM2(SITE_PLOT as PlotId) * 1e6;
    expect(total / massMg).toBeGreaterThan(0.985);
    expect(total / massMg).toBeLessThanOrEqual(1.0);
  });
});

describe("stroke log", () => {
  test("every overlapped plot with a ledger keeps the record; ring holds the newest 256", () => {
    const ledger = makeLedger();
    const sink = new Sink();
    const rec = new LoggedStroke();
    for (let k = 0; k < 300; k++) {
      ledger.applyStroke(strokeAt(SITE_PLOT, -3000 + k, 0, 3000 + k, 0, 15, 16, 2, 5, k), sink);
    }
    const log = ledger.log!;
    expect(log.count(SITE_PLOT)).toBe(256);
    log.read(SITE_PLOT, 0, rec);
    expect(rec.startUMm).toBe(-3000 + 44);
    log.read(SITE_PLOT, 255, rec);
    expect(rec).toMatchObject({
      anchor: SITE_PLOT,
      startUMm: -2701,
      endUMm: 3299,
      widthCm: 15,
      depth16: 16,
      toolCode: 5,
      actorSlot: 2,
    });
    const stamp = log.stamp(SITE_PLOT);
    log.trim(SITE_PLOT, 64);
    expect(log.count(SITE_PLOT)).toBe(64);
    log.read(SITE_PLOT, 0, rec);
    expect(rec.startUMm).toBe(-3000 + 236);
    log.read(SITE_PLOT, 63, rec);
    expect(rec.startUMm).toBe(-2701);
    ledger.applyStroke(strokeAt(SITE_PLOT, 0, 0, 100, 0, 15, 16), sink);
    expect(log.count(SITE_PLOT)).toBe(65);
    expect(log.stamp(SITE_PLOT)).toBeGreaterThan(stamp);
  });

  test("RAM cap: the least recently written ring is evicted, nothing grows past the cap", () => {
    const ledger = makeLedger({ strokeLogMaxBytes: 4 * 256 * 16 });
    const log = ledger.log!;
    expect(log.maxSlots).toBe(4);
    const grid = standardGrid();
    const sites = [SITE_PLOT, ...Array.from(grid.neighbors(SITE_PLOT as PlotId))];
    const sink = new Sink();
    for (const site of sites) ledger.applyStroke(strokeAt(site, -200, 0, 200, 0, 15, 80), sink);
    expect(log.bytes()).toBe(4 * 256 * 16);
    expect(log.evictions).toBeGreaterThan(0);
    let rings = 0;
    for (const site of sites) if (log.count(site) > 0) rings++;
    expect(rings).toBe(4);
  });
});

describe("pooled hot path", () => {
  test("steady state: no pool growth, no buffer replaced, queues bounded", () => {
    const ledger: WorldDustLedger = makeLedger({ initialLedgerSlots: 64 });
    const strokes = seededStrokes(1500, SEED + 9, 30_000);
    const sink = new Sink();
    // Warm-up: touch every plot of the area once.
    for (const s of strokes) ledger.applyStroke(s, sink);
    ledger.clearDirtyPlots();
    ledger.clearOpenedQueue();
    ledger.clearPolishedQueue();
    const texels = ledger.texels;
    const mask = ledger.ownedMask;
    const contrib = ledger.contrib;
    const logBytes = ledger.log!.bytes();
    const growths = ledger.poolGrowths;
    for (let round = 0; round < 5; round++) for (const s of strokes) ledger.applyStroke(s, sink);
    expect(ledger.poolGrowths).toBe(growths);
    expect(ledger.texels).toBe(texels);
    expect(ledger.ownedMask).toBe(mask);
    expect(ledger.contrib).toBe(contrib);
    expect(ledger.log!.bytes()).toBe(logBytes);
    expect(ledger.dirtyPlotCount).toBeLessThanOrEqual(ledger.ledgerCount + ledger.polishedTotal);
    expect(ledger.counters.opsApplied).toBe(1500 * 6);
  });

  test("reserve sizes the pool up front; reset returns everything", () => {
    const ledger = makeLedger({ initialLedgerSlots: 4 });
    ledger.reserve(64);
    const growths = ledger.poolGrowths;
    applyAll(ledger, seededStrokes(300, SEED + 11));
    expect(ledger.poolGrowths).toBe(growths);
    expect(ledger.ledgerCount).toBeGreaterThan(4);
    expect(ledger.dirtyChunkCount).toBeGreaterThan(0);
    ledger.reset();
    expect(ledger.ledgerCount).toBe(0);
    expect(ledger.polishedTotal).toBe(0);
    expect(ledger.dirtyChunkCount).toBe(0);
    expect(ledger.dirtyPlotCount).toBe(0);
    expect(ledger.worldHash()).toBe(0);
    expect(ledger.frac[SITE_PLOT]).toBe(255);
  });
});
