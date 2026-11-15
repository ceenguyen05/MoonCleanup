// Dust chunk payload codec and checkpoint restore: contract golden vectors, save / restore round trip (ledgers,
// states, contributions, stroke logs), continuing after a restore, untrusted input, the millisecond-sliced job and
// the payload size limit.
import { describe, expect, test } from "vitest";
import {
  DUST_CHUNK_GOLDEN_VECTORS,
  DUST_CHUNK_PAYLOAD_MAX_BYTES,
  DUST_CHUNK_PAYLOAD_VERSION,
  DUST_MODEL_VERSION,
  DustChunkPayloadSchema,
  LEDGER_BYTES,
  PlotState,
  SAVE_FORMAT_VERSION,
  SAVED_STROKE_LOG_MAX,
  type DustChunkPayload,
  type PlotId,
} from "@moon-cleanup/shared";
import {
  decodeDustChunkPayload,
  DUST_CHUNK_LAYOUT_MAX_BYTES,
  DustChunkEncoder,
  DustRestoreJob,
  encodeDustChunkPayload,
  encodeDustChunks,
  fnv1a32,
  LoggedStroke,
  mulberry32,
  restoreDustChunks,
  type WorldDustLedger,
} from "../../src/index";
import {
  applyAll,
  crc32,
  fullDigest,
  makeLedger,
  mixedAttributes,
  seededStrokes,
  SEED,
  Sink,
  SITE_PLOT,
  standardGrid,
  strokeAt,
} from "../support/dust";

const POLE = 640;

function pattern(name: "zeros" | "ramp" | "corners"): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(LEDGER_BYTES);
  if (name === "ramp") for (let k = 0; k < b.length; k++) b[k] = k & 0xff;
  if (name === "corners") {
    b[0] = 208;
    b[1023] = 80;
  }
  return b;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function unhex(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length / 2);
  for (let k = 0; k < out.length; k++) out[k] = parseInt(text.slice(k * 2, k * 2 + 2), 16);
  return out;
}

/** A played ledger: seeded strokes of every tool, plus one plot swept to Polished. */
function playedLedger(): WorldDustLedger {
  const ledger = makeLedger({ attributes: mixedAttributes() });
  applyAll(ledger, seededStrokes(700, SEED + 21));
  const sink = new Sink();
  for (let pass = 0; pass < 2 && ledger.state[SITE_PLOT] !== PlotState.Polished; pass++) {
    for (let v = -13_000; v <= 13_000; v += 900) {
      for (let u = -13_000; u < 13_000; u += 3500)
        ledger.applyStroke(strokeAt(SITE_PLOT, u, v, u + 3500, v, 100, 255, 1), sink);
    }
  }
  return ledger;
}

function expectSameDust(a: WorldDustLedger, b: WorldDustLedger): void {
  expect(fullDigest(b)).toBe(fullDigest(a));
  expect(b.worldHash()).toBe(a.worldHash());
  expect(b.ledgerCount).toBe(a.ledgerCount);
  expect(b.polishedTotal).toBe(a.polishedTotal);
  const rec1 = new LoggedStroke();
  const rec2 = new LoggedStroke();
  const actorsA = new Uint8Array(4);
  const unitsA = new Uint32Array(4);
  const actorsB = new Uint8Array(4);
  const unitsB = new Uint32Array(4);
  for (let s = 0; s < a.slotHigh; s++) {
    const plot = a.plotOfSlot[s]!;
    if (plot < 0) continue;
    const t = b.slotOf[plot]!;
    expect(t).toBeGreaterThanOrEqual(0);
    expect(b.remaining[t]).toBe(a.remaining[s]);
    expect(b.initial[t]).toBe(a.initial[s]);
    expect(b.owned[t]).toBe(a.owned[s]);
    expect(b.version[t]).toBe(a.version[s]);
    expect(b.mgPerUnit[t]).toBe(a.mgPerUnit[s]);
    expect(b.ledgerHash(plot)).toBe(a.ledgerHash(plot));
    expect(b.state[plot]).toBe(a.state[plot]);
    expect(b.frac[plot]).toBe(a.frac[plot]);
    // A save keeps the LEDGER_MAX_CONTRIBUTIONS (4) biggest removers exactly; smaller ones restart at 0.
    const kept = a.topContributions(plot, actorsA, unitsA);
    expect(b.topContributions(plot, actorsB, unitsB)).toBe(kept);
    expect(Array.from(actorsB.subarray(0, kept))).toEqual(Array.from(actorsA.subarray(0, kept)));
    expect(Array.from(unitsB.subarray(0, kept))).toEqual(Array.from(unitsA.subarray(0, kept)));
    for (let actor = 0; actor <= 16; actor++) {
      const top = actorsA.subarray(0, kept).includes(actor);
      expect(b.contributionOf(plot, actor)).toBe(top ? a.contributionOf(plot, actor) : 0);
    }
    // The saved log is the newest SAVED_STROKE_LOG_MAX strokes of the plot.
    const have = a.log!.count(plot);
    const keep = Math.min(have, SAVED_STROKE_LOG_MAX);
    expect(b.log!.count(plot)).toBe(keep);
    for (let k = 0; k < keep; k++) {
      a.log!.read(plot, have - keep + k, rec1);
      b.log!.read(plot, k, rec2);
      expect(rec2).toEqual(rec1);
    }
  }
}

describe("contract golden vectors (shared/save/dust-chunk-vectors)", () => {
  test("versions this codec was written against", () => {
    expect(DUST_CHUNK_PAYLOAD_VERSION).toBe(1);
    expect(DUST_MODEL_VERSION).toBe(2);
    expect(SAVE_FORMAT_VERSION).toBe(1);
  });

  for (const v of DUST_CHUNK_GOLDEN_VECTORS) {
    test(v.name, () => {
      const payload: DustChunkPayload = {
        payloadVersion: DUST_CHUNK_PAYLOAD_VERSION,
        chunkId: v.chunkId,
        bakeCheck: v.bakeCheck,
        states: v.states as PlotState[],
        plots: v.plots.map((p) => ({
          localIndex: p.localIndex,
          remainingFrac: p.remainingFrac,
          ledger: { ...p.ledger, contributions: p.ledger.contributions.map((c) => ({ ...c })) },
          texels: pattern(p.texelsPattern),
          strokeCount: p.strokeCount,
          strokeLog: unhex(p.strokeLogHex),
        })),
      };
      const bytes = encodeDustChunkPayload(payload);
      expect(bytes.length).toBe(v.length);
      expect(crc32(bytes)).toBe(v.crc32);
      if (v.bytesHex !== undefined) expect(hex(bytes)).toBe(v.bytesHex);
      const back = decodeDustChunkPayload(bytes, POLE);
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.payload).toEqual(payload);
        expect(DustChunkPayloadSchema.safeParse(back.payload).success).toBe(true);
        expect(hex(encodeDustChunkPayload(back.payload))).toBe(hex(bytes));
      }
    });
  }
});

describe("save / restore round trip", () => {
  test("ledgers, states, L0, contributions, hashes and stroke logs survive; a clean restore leaves nothing dirty", () => {
    const a = playedLedger();
    expect(a.ledgerCount).toBeGreaterThan(10);
    expect(a.polishedTotal).toBeGreaterThanOrEqual(1);
    expect(a.dirtyChunkCount).toBeGreaterThan(0);
    const chunks = encodeDustChunks(a, 0x5a, true);
    expect(chunks.length).toBe(a.dirtyChunkCount);
    for (const c of chunks) {
      expect(c.oversize).toBe(false);
      expect(c.strokesPerPlot).toBe(SAVED_STROKE_LOG_MAX);
      // The ledger-level encoder writes exactly the contract layout.
      const decoded = decodeDustChunkPayload(c.payload, POLE);
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(DustChunkPayloadSchema.safeParse(decoded.payload).success).toBe(true);
      expect(hex(encodeDustChunkPayload(decoded.payload))).toBe(hex(c.payload));
      expect(decoded.payload.bakeCheck).toBe(0x5a);
      for (const p of decoded.payload.plots) expect(p.ledger.hash).toBe(fnv1a32(p.texels));
    }
    const b = makeLedger({ attributes: mixedAttributes() });
    const result = restoreDustChunks(
      b,
      chunks.map((c) => c.payload),
      0x5a,
    );
    expect(result).toMatchObject({
      ok: true,
      chunksRestored: chunks.length,
      chunksRejected: 0,
      ledgersRestored: a.ledgerCount,
      polishedRestored: a.polishedTotal,
      texelsRepaired: 0,
      headerMismatches: 0,
      stateMismatches: 0,
      logsDropped: 0,
      recordsSkipped: 0,
    });
    expectSameDust(a, b);
    expect(b.dirtyChunkCount).toBe(0);
    expect(b.polishedQueueCount).toBe(0); // no stamp is replayed
    expect(b.openedQueueCount).toBe(0);
    for (const c of chunks) expect(b.chunkHash(c.chunkId)).toBe(a.chunkHash(c.chunkId));
    // Saving the restored ledger gives the same bytes (full save of every non-pristine chunk).
    const again = encodeDustChunks(b, 0x5a, false);
    expect(again.map((c) => c.chunkId)).toEqual(chunks.map((c) => c.chunkId));
    again.forEach((c, k) => expect(hex(c.payload)).toBe(hex(chunks[k]!.payload)));
  });

  test("a restored ledger continues exactly like the one that was saved", () => {
    const first = seededStrokes(500, SEED + 31);
    const second = seededStrokes(500, SEED + 32);
    const a = makeLedger({ attributes: mixedAttributes() });
    applyAll(a, first);
    const saved = encodeDustChunks(a, 7, true);
    const b = makeLedger({ attributes: mixedAttributes() });
    expect(
      restoreDustChunks(
        b,
        saved.map((c) => c.payload),
      ).ok,
    ).toBe(true);
    a.clearPolishedQueue();
    const sa = new Sink();
    const sb = new Sink();
    for (const s of second) {
      a.applyStroke(s, sa);
      b.applyStroke(s, sb);
      expect(sb.milligrams).toBe(sa.milligrams);
      expect(sb.removedUnits).toBe(sa.removedUnits);
      expect(sb.grime01).toBe(sa.grime01);
      expect(Array.from(sb.plotIds.subarray(0, sb.plotCount))).toEqual(
        Array.from(sa.plotIds.subarray(0, sa.plotCount)),
      );
    }
    expect(fullDigest(b)).toBe(fullDigest(a));
    expect(b.worldHash()).toBe(a.worldHash());
    // Stamps after the restore are credited the same way (contributions were restored).
    expect(b.polishedQueueCount).toBe(a.polishedQueueCount);
    for (let k = 0; k < a.polishedQueueCount; k++) {
      expect(b.polishedPlotAt(k)).toBe(a.polishedPlotAt(k));
      expect(b.polishedCreditAt(k)).toBe(a.polishedCreditAt(k));
    }
  });

  test("incremental checkpoints: only dirty chunks are written, and two saves restore to the latest state", () => {
    const a = makeLedger({ attributes: mixedAttributes() });
    applyAll(a, seededStrokes(300, SEED + 41));
    const store = new Map<number, Uint8Array>();
    for (const c of encodeDustChunks(a, 0, true)) {
      store.set(c.chunkId, c.payload);
      a.clearChunkDirty(c.chunkId);
    }
    expect(a.dirtyChunkCount).toBe(0);
    expect(encodeDustChunks(a, 0, true)).toEqual([]);
    // One more stroke far from the first area dirties only its own chunk.
    const far = 12_345;
    applyAll(a, [strokeAt(far, -1500, 0, 1500, 0, 75, 128)]);
    const second = encodeDustChunks(a, 0, true);
    expect(second.length).toBe(1);
    expect(second[0]!.chunkId).toBe(standardGrid().chunkOf(far as PlotId));
    for (const c of second) store.set(c.chunkId, c.payload);
    const b = makeLedger({ attributes: mixedAttributes() });
    expect(restoreDustChunks(b, [...store.values()]).ok).toBe(true);
    expectSameDust(a, b);
  });

  test("a chunk restore replaces what the ledger held for that chunk", () => {
    const a = makeLedger({ attributes: mixedAttributes() });
    applyAll(a, seededStrokes(200, SEED + 51));
    const saved = encodeDustChunks(a, 0, true).map((c) => c.payload);
    const b = makeLedger({ attributes: mixedAttributes() });
    applyAll(b, seededStrokes(400, SEED + 52)); // different play in the same chunks
    expect(restoreDustChunks(b, saved).ok).toBe(true);
    const grid = standardGrid();
    const chunks = new Set(encodeDustChunks(a, 0, false).map((c) => c.chunkId));
    for (let p = 0; p < grid.count; p++) {
      if (!chunks.has(grid.chunkOf(p as PlotId))) continue;
      expect(b.state[p]).toBe(a.state[p]);
      expect(b.frac[p]).toBe(a.frac[p]);
      expect(b.ledgerHash(p)).toBe(a.ledgerHash(p));
    }
  });

  test("stroke logs are saved as chains: consecutive strokes of one sweep cost 4 bytes each", () => {
    const ledger = makeLedger();
    const sink = new Sink();
    for (let k = 0; k < 40; k++)
      ledger.applyStroke(strokeAt(SITE_PLOT, -4000 + k * 200, 0, -3800 + k * 200, 0, 15, 80), sink);
    const encoder = new DustChunkEncoder();
    const bytes = encoder.encode(ledger, standardGrid().chunkOf(SITE_PLOT as PlotId), 0);
    const decoded = decodeDustChunkPayload(bytes, POLE);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const record = decoded.payload.plots.find((p) => p.localIndex === standardGrid().localIndexOf(SITE_PLOT as PlotId));
    expect(record?.strokeCount).toBe(32);
    expect(record?.strokeLog.length).toBe(18 + 31 * 4);
  });
});

describe("untrusted payloads", () => {
  test("structure errors are typed, never thrown, and leave the ledger untouched", () => {
    const a = playedLedger();
    const good = encodeDustChunks(a, 0, true)[0]!.payload;
    const cases: [string, Uint8Array, string][] = [];
    cases.push(["empty", new Uint8Array(0), "truncated"]);
    cases.push(["short", good.slice(0, 40), "truncated"]);
    cases.push(["cut inside a record", good.slice(0, good.length - 5), "truncated"]);
    const version = good.slice();
    version[0] = 2;
    cases.push(["future version", version, "unsupported_version"]);
    const chunk = good.slice();
    chunk[2] = 0xff;
    chunk[3] = 0xff;
    cases.push(["chunk id", chunk, "bad_chunk_id"]);
    const count = good.slice();
    count[5] = 0xff;
    count[6] = 0xff;
    cases.push(["touched count", count, "bad_count"]);
    const trailing = new Uint8Array(good.length + 3);
    trailing.set(good);
    cases.push(["trailing bytes", trailing, "trailing_bytes"]);
    cases.push(["oversize", new Uint8Array(DUST_CHUNK_LAYOUT_MAX_BYTES + 1), "oversize"]);
    for (const [name, bytes, code] of cases) {
      const b = makeLedger({ attributes: mixedAttributes() });
      const result = restoreDustChunks(b, [bytes]);
      expect(result.ok, name).toBe(false);
      expect(result.firstError?.code, name).toBe(code);
      expect(result.chunksRejected).toBe(1);
      expect(b.ledgerCount).toBe(0);
      expect(b.worldHash()).toBe(0);
      const decoded = decodeDustChunkPayload(bytes, POLE);
      expect(decoded.ok).toBe(false);
    }
    // A bake mismatch is rejected when the host passes the expected byte.
    const b = makeLedger({ attributes: mixedAttributes() });
    expect(restoreDustChunks(b, [good], 0x99).firstError?.code).toBe("bake_mismatch");
    // One bad payload does not stop the others.
    const all = encodeDustChunks(a, 0, true).map((c) => c.payload);
    const mixed = restoreDustChunks(b, [new Uint8Array(3), ...all]);
    expect(mixed.ok).toBe(false);
    expect(mixed.chunksRejected).toBe(1);
    expect(mixed.chunksRestored).toBe(all.length);
    expect(mixed.firstErrorIndex).toBe(0);
    expect(fullDigest(b)).toBe(fullDigest(a));
  });

  test("forged values are recomputed or clamped: totals, ownership, state and hash never come from the header", () => {
    const a = makeLedger();
    applyAll(a, [strokeAt(SITE_PLOT, -3000, 0, 3000, 0, 100, 48)]);
    const chunkId = standardGrid().chunkOf(SITE_PLOT as PlotId);
    const decoded = decodeDustChunkPayload(new DustChunkEncoder().encode(a, chunkId, 0), POLE);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const forged = decoded.payload; // decodeDustChunkPayload returns fresh copies
    const record = forged.plots[0]!;
    record.texels.fill(255); // more dust than the plot can hold, and dust on texels the plot does not own
    record.ledger.remainingUnits = 5; // "almost Polished"
    record.ledger.initialUnits = 1_000_000;
    record.ledger.ownedTexels = 1024;
    record.ledger.mgPerUnit = 4_000_000_000;
    record.ledger.contributions = [{ actorSlot: 3, units: 4_000_000_000 }];
    const b = makeLedger();
    const result = restoreDustChunks(b, [encodeDustChunkPayload(forged)]);
    expect(result.ok).toBe(true);
    expect(result.texelsRepaired).toBeGreaterThan(900);
    expect(result.headerMismatches).toBe(1);
    const slot = b.slotOf[SITE_PLOT]!;
    const fresh = a.slotOf[SITE_PLOT]!;
    expect(b.owned[slot]).toBe(a.owned[fresh]);
    expect(b.initial[slot]).toBe(a.initial[fresh]);
    expect(b.remaining[slot]).toBe(b.initial[slot]); // clamped back to a full plot
    expect(b.mgPerUnit[slot]).toBe(a.mgPerUnit[fresh]);
    expect(b.contributionOf(SITE_PLOT, 3)).toBe(0); // nothing was removed, so nobody can hold credit
    expect(b.state[SITE_PLOT]).toBe(PlotState.Grimy);
    expect(b.isChunkDirty(chunkId)).toBe(true); // repaired data is rewritten at the next save
  });

  test("random byte damage never throws and never leaves an inconsistent ledger", () => {
    const a = playedLedger();
    const payloads = encodeDustChunks(a, 0, true).map((c) => c.payload);
    const rnd = mulberry32(SEED + 61);
    const b = makeLedger({ attributes: mixedAttributes() });
    let rejected = 0;
    let repaired = 0;
    for (let round = 0; round < 300; round++) {
      const source = payloads[rnd() % payloads.length]!;
      const bytes = source.slice();
      const flips = 1 + (rnd() % 6);
      // Damage mostly the structure (first 100 bytes and record heads), sometimes anywhere.
      for (let f = 0; f < flips; f++) {
        const at = rnd() % 3 === 0 ? rnd() % bytes.length : rnd() % Math.min(bytes.length, 100);
        bytes[at] = rnd() & 0xff;
      }
      const cut = rnd() % 5 === 0 ? bytes.slice(0, rnd() % bytes.length) : bytes;
      b.reset();
      const result = restoreDustChunks(b, [cut]);
      if (!result.ok) rejected++;
      else if (result.texelsRepaired + result.headerMismatches + result.stateMismatches + result.logsDropped > 0)
        repaired++;
      // Invariants of whatever was accepted.
      let ledgers = 0;
      for (let s = 0; s < b.slotHigh; s++) {
        const plot = b.plotOfSlot[s]!;
        if (plot < 0) continue;
        ledgers++;
        let sum = 0;
        for (let i = 0; i < 1024; i++) sum += b.texels[s * 1024 + i]!;
        expect(sum).toBe(b.remaining[s]);
        expect(b.remaining[s]!).toBeLessThanOrEqual(b.initial[s]!);
        expect(b.initial[s]).toBe(16 * b.levelOf[plot]! * b.owned[s]!);
        expect(b.remaining[s]!).toBeGreaterThan(Math.floor(b.initial[s]! / 100));
        expect(b.state[plot] === PlotState.Grimy || b.state[plot] === PlotState.Opened).toBe(true);
      }
      expect(ledgers).toBe(b.ledgerCount);
      expect(b.polishedQueueCount).toBe(0);
    }
    expect(rejected).toBeGreaterThan(20);
    expect(repaired).toBeGreaterThan(20);
  });
});

describe("restore job with a millisecond budget", () => {
  test("slices end inside the budget, always make progress, and end in the same state as one run", () => {
    const a = playedLedger();
    const payloads = encodeDustChunks(a, 0, true).map((c) => c.payload);
    const whole = makeLedger({ attributes: mixedAttributes() });
    const wholeJob = new DustRestoreJob(whole, payloads);
    wholeJob.run();

    // A fake clock that advances 0.1 ms per step of work.
    const sliced = makeLedger({ attributes: mixedAttributes() });
    const job = new DustRestoreJob(sliced, payloads);
    const clock = (): number => job.units * 0.1;
    let slices = 0;
    let worst = 0;
    let fewest = Infinity;
    while (!job.done) {
      const before = job.units;
      const done = job.run(1.0, clock);
      const steps = job.units - before;
      worst = Math.max(worst, steps * 0.1);
      if (!done) fewest = Math.min(fewest, steps);
      slices++;
      expect(done).toBe(job.done);
      expect(steps).toBeGreaterThan(0);
      expect(slices).toBeLessThan(100_000);
    }
    // The job stops before the step that would cross the budget: no slice is longer than the budget.
    expect(worst).toBeLessThanOrEqual(1.0);
    // At 0.1 ms per step a slice holds up to 6 steps once the estimates have settled (0.5 ms done, twice the
    // estimate and the slack still fit) and a single step while its kind is still at the cold estimate. (Real steps
    // are 1 to 10 us; the next test has slices of 168 steps.)
    expect(fewest).toBeGreaterThanOrEqual(1);
    expect(slices).toBeLessThan(job.units);
    expect(job.slowestStepMs).toBeCloseTo(0.1, 9);
    // The step count does not depend on the slicing: prepare, then per chunk a scan and 4 reset steps (1 for the
    // pole chunk), then 8 steps per plot record.
    expect(job.units).toBe(wholeJob.units);
    let expected = 1;
    for (const p of payloads) {
      const decoded = decodeDustChunkPayload(p, POLE);
      if (!decoded.ok) throw new Error("payload");
      expected += 1 + Math.ceil(decoded.payload.states.length / 64) + 8 * decoded.payload.plots.length;
    }
    expect(job.units).toBe(expected);
    expect(job.result).toEqual(restoreDustChunks(makeLedger({ attributes: mixedAttributes() }), payloads));
    expect(fullDigest(sliced)).toBe(fullDigest(whole));
    expect(sliced.worldHash()).toBe(a.worldHash());
    // Same slots as the uninterrupted run, byte for byte (texels, masks, totals).
    expect(sliced.slotHigh).toBe(whole.slotHigh);
    expect(Array.from(sliced.plotOfSlot.subarray(0, sliced.slotHigh))).toEqual(
      Array.from(whole.plotOfSlot.subarray(0, whole.slotHigh)),
    );
    expect(sliced.texels.subarray(0, sliced.slotHigh * 1024)).toEqual(whole.texels.subarray(0, whole.slotHigh * 1024));
    expect(sliced.ownedMask.subarray(0, sliced.slotHigh * 128)).toEqual(
      whole.ownedMask.subarray(0, whole.slotHigh * 128),
    );
  });

  test("one step per slice at a zero budget; a single slow step does not shrink the slices that follow", () => {
    const a = playedLedger();
    const payloads = encodeDustChunks(a, 0, true).map((c) => c.payload);
    const one = makeLedger({ attributes: mixedAttributes() });
    const stepper = new DustRestoreJob(one, payloads);
    let calls = 0;
    while (!stepper.run(0, () => 0)) calls++;
    expect(calls + 1).toBe(stepper.units);
    expect(one.worldHash()).toBe(a.worldHash());

    // A larger moon (about 500 ledgers). The 40th step takes 50 ms (a preempted thread); every other step 0.01 ms.
    const big = makeLedger({ attributes: mixedAttributes() });
    applyAll(big, seededStrokes(1200, SEED + 51, 300_000));
    const bigPayloads = encodeDustChunks(big, 0, true).map((c) => c.payload);
    const b = makeLedger({ attributes: mixedAttributes() });
    const job = new DustRestoreJob(b, bigPayloads);
    const clock = (): number => job.units * 0.01 + (job.units >= 40 ? 50 : 0);
    const sizes: number[] = [];
    while (!job.done) {
      const before = job.units;
      job.run(2, clock);
      sizes.push(job.units - before);
    }
    expect(job.slowestStepMs).toBeCloseTo(50.01, 6);
    // The slow step ends its slice. Its step kind is then estimated at a quarter of the budget (not at 50 ms), so
    // the slices after it still hold many steps, and they return to full size (168 or 169 steps of 0.01 ms: the
    // budget less the slack and twice the estimate of one step) once the estimate has decayed.
    let done = 0;
    const slow = sizes.findIndex((n) => (done += n) >= 40);
    expect(done).toBe(40);
    expect(sizes.length).toBeGreaterThan(slow + 8);
    for (const n of sizes.slice(slow + 1, -1)) expect(n).toBeGreaterThan(50);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(168);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(169);
    expect(sizes.filter((n) => n >= 168).length).toBeGreaterThan(sizes.length / 2);
    expect(b.worldHash()).toBe(big.worldHash());
  });

  test("the pools are sized once, before anything is installed, and a repeated restore does not grow them", () => {
    const a = playedLedger();
    const payloads = encodeDustChunks(a, 0, true).map((c) => c.payload);
    expect(a.ledgerCount).toBeGreaterThan(8);
    const b = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 2 });
    const job = new DustRestoreJob(b, payloads, undefined, 40);
    job.run(0, () => 0); // the prepare step alone
    expect(job.units).toBe(1);
    expect(b.ledgerCount).toBe(0);
    expect(b.poolGrowths).toBe(1);
    expect(b.slotCapacity).toBe(a.ledgerCount + 40);
    const texels = b.texels;
    const logBytes = b.log!.bytes();
    expect(logBytes).toBe((a.ledgerCount + 40) * 256 * 16);
    job.run();
    expect(b.poolGrowths).toBe(1);
    expect(b.texels).toBe(texels);
    expect(b.log!.bytes()).toBe(logBytes);
    expect(b.worldHash()).toBe(a.worldHash());
    // The host's own headroom request is now a no-op.
    b.reserve(b.ledgerCount + 40);
    expect(b.poolGrowths).toBe(1);
    // Restoring the same chunks again replaces them: nothing more is needed.
    restoreDustChunks(b, payloads);
    new DustRestoreJob(b, payloads, undefined, 40).run();
    expect(b.poolGrowths).toBe(1);
    expect(b.slotCapacity).toBe(a.ledgerCount + 40);
    expect(b.log!.bytes()).toBe(logBytes);
    expect(b.worldHash()).toBe(a.worldHash());

    // Without an explicit headroom the job keeps the slots the host constructed the ledger with free (its play
    // headroom), so the host's reserve after the restore copies nothing; a log in use is not regrown by `reserve`.
    const d = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 16 });
    expect(d.initialSlots).toBe(16);
    restoreDustChunks(d, payloads);
    expect(d.poolGrowths).toBe(1);
    expect(d.slotCapacity).toBe(a.ledgerCount + 16);
    const dLog = d.log!.bytes();
    expect(dLog).toBe((a.ledgerCount + 16) * 256 * 16);
    d.reserve(d.ledgerCount + 16);
    expect(d.poolGrowths).toBe(1);
    expect(d.log!.ringsTouched).toBeLessThanOrEqual(64);
    const e = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 8 });
    applyAll(e, seededStrokes(1200, SEED + 51, 300_000));
    expect(e.log!.ringsTouched).toBeGreaterThan(64);
    const eLog = e.log!.bytes();
    e.reserve(e.slotCapacity + 100);
    expect(e.slotCapacity).toBeGreaterThanOrEqual(e.ledgerCount + 100);
    expect(e.log!.bytes()).toBe(eLog);

    // A forged header cannot reserve more than its bytes could hold: 256 claimed records in 7 + 64 bytes.
    const forged = new Uint8Array(7 + 64);
    forged[0] = DUST_CHUNK_PAYLOAD_VERSION;
    forged[2] = 9;
    forged[5] = 0;
    forged[6] = 1;
    const c = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 2 });
    const bad = restoreDustChunks(c, [forged]);
    expect(bad.ok).toBe(false);
    expect(c.slotCapacity).toBe(2);
  });

  test("a ledger installed in pieces equals one installed in a single call (hexagons, a pentagon, a pole)", () => {
    const grid = standardGrid();
    const whole = makeLedger({ attributes: mixedAttributes() });
    const pieces = makeLedger({ attributes: mixedAttributes() });
    const rnd = mulberry32(SEED + 31);
    const pentagons: number[] = [];
    for (let p = 0; p < grid.count; p++) if (grid.neighbors(p as PlotId).length === 5) pentagons.push(p);
    expect(pentagons.length).toBe(12);
    const poles = [grid.plotAtChunkLocal(POLE, 0), grid.plotAtChunkLocal(POLE, 1)];
    const plots = [...pentagons, ...poles, SITE_PLOT, SITE_PLOT + 1, 20_000, 99_999].filter(
      (p) => whole.levelOf[p]! > 0,
    );
    expect(plots.filter((p) => pentagons.includes(p)).length).toBeGreaterThan(6);
    for (const plot of plots) {
      const src = new Uint8Array(LEDGER_BYTES);
      for (let i = 0; i < src.length; i++) src[i] = rnd() % 230; // some above 16 x level, none trusted
      const repairedWhole = whole.installLedger(plot, src, 0, 7);
      expect(pieces.openLedger(plot)).toBe(true);
      // Row bands in a scrambled order: the mask does not depend on it.
      for (const from of [16, 0, 24, 8]) pieces.buildMaskRows(plot, from, from + 8);
      const repairedPieces = pieces.installLedger(plot, src, 0, 7);
      expect(repairedPieces).toBe(repairedWhole);
      const sw = whole.slotOf[plot]!;
      const sp = pieces.slotOf[plot]!;
      expect(pieces.owned[sp]).toBe(whole.owned[sw]);
      expect(pieces.initial[sp]).toBe(whole.initial[sw]);
      expect(pieces.remaining[sp]).toBe(whole.remaining[sw]);
      expect(pieces.mgPerUnit[sp]).toBe(whole.mgPerUnit[sw]);
      expect(pieces.version[sp]).toBe(7);
      expect(pieces.ledgerHash(plot)).toBe(whole.ledgerHash(plot));
      expect(pieces.ownedMask.slice(sp * 128, sp * 128 + 128)).toEqual(whole.ownedMask.slice(sw * 128, sw * 128 + 128));
      expect(pieces.texels.slice(sp * 1024, sp * 1024 + 1024)).toEqual(whole.texels.slice(sw * 1024, sw * 1024 + 1024));
    }
    // An opened ledger holds no dust until its texels are installed: a stroke over it removes nothing.
    const fresh = makeLedger();
    expect(fresh.openLedger(SITE_PLOT)).toBe(true);
    const sink = new Sink();
    fresh.applyStroke(strokeAt(SITE_PLOT, -500, 0, 500, 0, 100, 255), sink);
    expect(sink.removedUnits).toBe(0);
    expect(fresh.openLedger(-1)).toBe(false);
    expect(fresh.openLedger(grid.count)).toBe(false);
  });

  test("growing the pool keeps every ledger that is in use", () => {
    const small = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 1 });
    const roomy = makeLedger({ attributes: mixedAttributes(), initialLedgerSlots: 512 });
    const strokes = seededStrokes(400, SEED + 41);
    applyAll(small, strokes.slice(0, 200));
    applyAll(roomy, strokes.slice(0, 200));
    small.reserve(small.ledgerCount + 300);
    applyAll(small, strokes.slice(200));
    applyAll(roomy, strokes.slice(200));
    expect(small.poolGrowths).toBeGreaterThan(2);
    expect(roomy.poolGrowths).toBe(0);
    expect(fullDigest(small)).toBe(fullDigest(roomy));
    expect(small.worldHash()).toBe(roomy.worldHash());
    const rec = new LoggedStroke();
    const other = new LoggedStroke();
    for (let s = 0; s < small.slotHigh; s++) {
      const plot = small.plotOfSlot[s]!;
      if (plot < 0) continue;
      expect(small.log!.count(plot)).toBe(roomy.log!.count(plot));
      for (let k = 0; k < small.log!.count(plot); k++) {
        small.log!.read(plot, k, rec);
        roomy.log!.read(plot, k, other);
        expect(rec).toEqual(other);
      }
      for (let actor = 0; actor <= 16; actor++) {
        expect(small.contributionOf(plot, actor)).toBe(roomy.contributionOf(plot, actor));
      }
    }
  });
});

describe("payload size limit", () => {
  test("the contract limit is the layout maximum: a full chunk keeps every log, is not oversize and restores", () => {
    // shared/save v1.1 (M1-W0-T08): the upload limit equals the v1 layout maximum (was 262,144 B, below a full chunk).
    expect(DUST_CHUNK_LAYOUT_MAX_BYTES).toBe(421_959);
    expect(DUST_CHUNK_PAYLOAD_MAX_BYTES).toBe(DUST_CHUNK_LAYOUT_MAX_BYTES);

    // Every plot of one chunk touched, 32 unchained strokes each: well over the old limit (256 x 1,052 B alone is
    // 269,383 B), inside the new one.
    const grid = standardGrid();
    const ledger = makeLedger();
    const sink = new Sink();
    const chunkId = grid.chunkOf(SITE_PLOT as PlotId);
    for (let k = 0; k < 256; k++) {
      const plot = grid.plotAtChunkLocal(chunkId, k);
      for (let n = 0; n < 32; n++) {
        ledger.applyStroke(
          strokeAt(plot, -2000 + n * 90, -1500 + n * 90, -1400 + n * 90, -1500 + n * 90, 15, 16),
          sink,
        );
      }
    }
    const encoder = new DustChunkEncoder();
    const full = encoder.encode(ledger, chunkId, 0).slice();
    expect(encoder.lastOversize).toBe(false);
    expect(encoder.lastStrokesPerPlot).toBe(SAVED_STROKE_LOG_MAX);
    expect(full.length).toBeGreaterThan(256 * 1024);
    expect(full.length).toBeLessThanOrEqual(DUST_CHUNK_PAYLOAD_MAX_BYTES);
    const decoded = decodeDustChunkPayload(full, POLE);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(DustChunkPayloadSchema.safeParse(decoded.payload).success).toBe(true);

    const local = makeLedger();
    const result = restoreDustChunks(local, [full]);
    expect(result.ok).toBe(true);
    expect(result.ledgersRestored).toBe(256);
    expect(local.worldHash()).toBe(ledger.worldHash());
    const plot0 = grid.plotAtChunkLocal(chunkId, 0);
    expect(local.log!.count(plot0)).toBe(ledger.log!.count(plot0));
    expect(local.log!.count(plot0)).toBeGreaterThan(0);
  });

  test("a stroke log longer than one chain prefix per stroke is rejected (contract v1.1 bound)", () => {
    const v = DUST_CHUNK_GOLDEN_VECTORS[1]!;
    const payload: DustChunkPayload = {
      payloadVersion: DUST_CHUNK_PAYLOAD_VERSION,
      chunkId: v.chunkId,
      bakeCheck: v.bakeCheck,
      states: v.states as PlotState[],
      plots: v.plots.map((p) => ({
        localIndex: p.localIndex,
        remainingFrac: p.remainingFrac,
        ledger: { ...p.ledger, contributions: p.ledger.contributions.map((c) => ({ ...c })) },
        texels: pattern(p.texelsPattern),
        strokeCount: p.strokeCount,
        strokeLog: unhex(p.strokeLogHex),
      })),
    };
    const at = (strokeCount: number, logBytes: number): boolean => {
      const first = { ...payload.plots[0]!, strokeCount, strokeLog: new Uint8Array(logBytes) };
      const bytes = encodeDustChunkPayload({ ...payload, plots: [first, ...payload.plots.slice(1)] });
      return decodeDustChunkPayload(bytes, POLE).ok;
    };
    expect(at(2, 36)).toBe(true);
    expect(at(2, 37)).toBe(false);
    expect(at(0, 1)).toBe(false);
    expect(at(SAVED_STROKE_LOG_MAX, SAVED_STROKE_LOG_MAX * 18)).toBe(true);
  });
});
