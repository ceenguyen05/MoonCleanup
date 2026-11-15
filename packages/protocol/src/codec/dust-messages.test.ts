import {
  CHUNK_COUNT,
  DUST_MESSAGE_SLICE_MAX_BYTES,
  DUST_SNAPSHOT_SLICE_HEADER_BYTES,
  LEDGER_BYTES,
  LEDGER_MAX_CONTRIBUTIONS,
  PlotState,
  type PlotId,
} from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import {
  DUST_CHECK_MAX_CHUNKS,
  DUST_LOG_ID,
  DUST_LOG_MAX_CONTINUATIONS,
  DUST_SNAPSHOT_MAX_LEDGERS,
  DUST_SNAPSHOT_MAX_LOGS,
  DUST_SNAPSHOT_MAX_RAW_BYTES,
  DUST_SNAPSHOT_MAX_SLICES,
  LEDGER_RAW_MAX_BYTES,
  LEDGER_WIRE_ACTOR_SLOT_MAX,
  SnapshotAssembler,
  countOpened,
} from "./dust-messages";
import {
  decodeDustCheck,
  decodeDustLedger,
  decodeDustLog,
  decodeDustRequest,
  decodeSnapshotRaw,
  decodeSnapshotStream,
  encodeDustCheck,
  encodeDustLedger,
  encodeDustLog,
  encodeDustRequest,
  encodeSnapshotRaw,
  snapshotSliceCount,
  writeSnapshotSlice,
  type Deflate,
  type Inflate,
  type LedgerRawInput,
} from "./dust-messages";
import { PLOT_ID_BITS } from "./dust-wire";
import { StrokeChainBuffer } from "./frame-state";
import { randInt, rng } from "./test-util";
import {
  DUST_CHECK_CHUNKS_VECTOR,
  DUST_CHECK_DETAIL_VECTOR,
  DUST_LOG_VECTOR,
  DUST_REQUEST_CHUNK_VECTOR,
  DUST_REQUEST_PLOTS_VECTOR,
  DUST_SNAPSHOT_SLICE_VECTOR,
} from "../vectors/dust-vectors";

const PLOTS = 163_842;
const identityDeflate: Deflate = (raw) => raw.slice();
const identityInflate: Inflate = (data, max) => (data.length > max ? null : data.slice());

/** Independent reference packer: LSB-first bit stream built with BigInt (shares no code with BitWriter). */
function refPack(fields: readonly (readonly [number, number])[]): number[] {
  let acc = 0n;
  let at = 0n;
  for (const [value, bits] of fields) {
    acc |= (BigInt(value) & ((1n << BigInt(bits)) - 1n)) << at;
    at += BigInt(bits);
  }
  const out: number[] = [];
  for (let i = 0n; i < (at + 7n) / 8n; i++) out.push(Number((acc >> (8n * i)) & 0xffn));
  return out;
}

function randomLedger(r: () => number): LedgerRawInput {
  const texels = new Uint8Array(LEDGER_BYTES);
  for (let i = 0; i < texels.length; i++) texels[i] = randInt(r, 0, 255);
  const initial = randInt(r, 1000, 100_000);
  return {
    header: {
      version: randInt(r, 0, 0xffffffff),
      remainingUnits: randInt(r, 0, initial),
      initialUnits: initial,
      ownedTexels: randInt(r, 0, 1024),
      mgPerUnit: randInt(r, 0, 0xffffffff),
      hash: randInt(r, 0, 0xffffffff),
      contributions: Array.from({ length: randInt(r, 0, 4) }, () => ({
        actorSlot: randInt(r, 0, 15),
        units: randInt(r, 0, 0xffffffff),
      })),
    },
    texels,
  };
}

/** Exactly `chains` chains, each with 4 continuations (the largest typical log). */
function randomChainsFull(r: () => number, chains: number, refTick: number): StrokeChainBuffer {
  const b = new StrokeChainBuffer(chains, 64);
  for (let c = 0; c < chains; c++) {
    b.addChain(
      randInt(r, 0, PLOTS - 1),
      randInt(r, -32768, 32767),
      randInt(r, -32768, 32767),
      randInt(r, -32768, 32767),
      randInt(r, -32768, 32767),
      randInt(r, 1, 1023),
      randInt(r, 0, 255),
      randInt(r, 0, 63),
      randInt(r, 0, 15),
      refTick - randInt(r, 0, 255),
      randInt(r, 0, 65535),
    );
    for (let k = 0; k < 4; k++) b.addContinuation(randInt(r, -4096, 4095), randInt(r, -4096, 4095));
  }
  return b;
}

function randomChains(r: () => number, maxChains: number, refTick: number): StrokeChainBuffer {
  const b = new StrokeChainBuffer(maxChains, 64);
  for (let c = randInt(r, 0, maxChains); c > 0; c--) {
    b.addChain(
      randInt(r, 0, PLOTS - 1),
      randInt(r, -32768, 32767),
      randInt(r, -32768, 32767),
      randInt(r, -32768, 32767),
      randInt(r, -32768, 32767),
      randInt(r, 1, 1023),
      randInt(r, 0, 255),
      randInt(r, 0, 63),
      randInt(r, 0, 15),
      refTick - randInt(r, 0, 255),
      randInt(r, 0, 65535),
    );
    for (let k = randInt(r, 0, 4); k > 0; k--) b.addContinuation(randInt(r, -4096, 4095), randInt(r, -4096, 4095));
  }
  return b;
}

function sameChains(a: StrokeChainBuffer, b: StrokeChainBuffer): void {
  expect(a.chainCount).toBe(b.chainCount);
  expect(a.continuationCount).toBe(b.continuationCount);
  for (let i = 0; i < a.chainCount; i++) {
    for (const k of [
      "anchor",
      "startUMm",
      "endVMm",
      "widthCm",
      "depth16",
      "toolCode",
      "actorSlot",
      "tick",
      "inputSeq",
      "contCount",
    ] as const) {
      expect(a[k][i]).toBe(b[k][i]);
    }
  }
  for (let i = 0; i < a.continuationCount; i++) {
    expect(a.contDxMm[i]).toBe(b.contDxMm[i]);
    expect(a.contDyMm[i]).toBe(b.contDyMm[i]);
  }
}

describe("dust message golden vectors", () => {
  const out = new Uint8Array(512);

  it("DUST_REQUEST", () => {
    let n = encodeDustRequest({ kind: "plots", plotIds: [1, 163841] as PlotId[] }, out);
    expect([...out.subarray(0, n)]).toEqual(DUST_REQUEST_PLOTS_VECTOR.bytes);
    expect(
      refPack([
        [3, 8],
        [0, 1],
        [2, 4],
        [1, 18],
        [163841, 18],
      ]),
    ).toEqual(DUST_REQUEST_PLOTS_VECTOR.bytes);
    expect(decodeDustRequest(Uint8Array.from(DUST_REQUEST_PLOTS_VECTOR.bytes), PLOTS)).toEqual({
      kind: "plots",
      plotIds: [1, 163841],
    });
    n = encodeDustRequest({ kind: "chunk", chunkId: 640 }, out);
    expect([...out.subarray(0, n)]).toEqual(DUST_REQUEST_CHUNK_VECTOR.bytes);
    expect(
      refPack([
        [3, 8],
        [1, 1],
        [640, 10],
      ]),
    ).toEqual(DUST_REQUEST_CHUNK_VECTOR.bytes);
    expect(decodeDustRequest(Uint8Array.from(DUST_REQUEST_CHUNK_VECTOR.bytes), PLOTS)).toEqual({
      kind: "chunk",
      chunkId: 640,
    });
  });

  it("DUST_CHECK", () => {
    let n = encodeDustCheck(
      {
        mode: "chunks",
        chunks: [
          { chunkId: 5, xorHash: 0xdeadbeef },
          { chunkId: 640, xorHash: 1 },
        ],
      },
      out,
    );
    expect([...out.subarray(0, n)]).toEqual(DUST_CHECK_CHUNKS_VECTOR.bytes);
    expect(
      refPack([
        [0x24, 8],
        [0, 1],
        [2, 8],
        [5, 10],
        [0xdeadbeef, 32],
        [640, 10],
        [1, 32],
      ]),
    ).toEqual(DUST_CHECK_CHUNKS_VECTOR.bytes);
    expect(decodeDustCheck(Uint8Array.from(DUST_CHECK_CHUNKS_VECTOR.bytes), PLOTS)).toEqual({
      mode: "chunks",
      chunks: [
        { chunkId: 5, xorHash: 0xdeadbeef },
        { chunkId: 640, xorHash: 1 },
      ],
    });
    n = encodeDustCheck(
      {
        mode: "detail",
        chunkId: 3,
        plots: [{ plotId: 77 as PlotId, ledgerVersion: 0x01020304, hash: 0xa0b0c0d0 }],
      },
      out,
    );
    expect([...out.subarray(0, n)]).toEqual(DUST_CHECK_DETAIL_VECTOR.bytes);
    expect(
      refPack([
        [0x24, 8],
        [1, 1],
        [3, 10],
        [1, 9],
        [77, 18],
        [0x01020304, 32],
        [0xa0b0c0d0, 32],
      ]),
    ).toEqual(DUST_CHECK_DETAIL_VECTOR.bytes);
    expect(decodeDustCheck(Uint8Array.from(DUST_CHECK_DETAIL_VECTOR.bytes), PLOTS)).toEqual({
      mode: "detail",
      chunkId: 3,
      plots: [{ plotId: 77, ledgerVersion: 0x01020304, hash: 0xa0b0c0d0 }],
    });
  });

  it("DUST_SNAPSHOT slice", () => {
    const n = writeSnapshotSlice(Uint8Array.from([9, 8, 7]), 0, 0x0a0b0c0d, out);
    expect([...out.subarray(0, n)]).toEqual(DUST_SNAPSHOT_SLICE_VECTOR.bytes);
    const asm = new SnapshotAssembler();
    expect(asm.add(Uint8Array.from(DUST_SNAPSHOT_SLICE_VECTOR.bytes))).toBe("complete");
    expect([...asm.take()!]).toEqual([9, 8, 7]);
    expect(asm.version).toBe(0x0a0b0c0d);
  });

  it("DUST_LOG (stroke chain bytes)", () => {
    const b = new StrokeChainBuffer(2, 4);
    b.addChain(10, 1, -2, 3, -4, 20, 80, 1, 2, 98, 0x1234);
    b.addContinuation(5, -5);
    const n = encodeDustLog(0x0102, 100, b, out);
    expect([...out.subarray(0, n)]).toEqual(DUST_LOG_VECTOR.bytes);
    const log = decodeDustLog(Uint8Array.from(DUST_LOG_VECTOR.bytes), PLOTS)!;
    expect(log.plotId).toBe(0x0102);
    expect(log.refTick).toBe(100);
    sameChains(log.chains, b);
    expect(log.chains.tick[0]).toBe(98);
    expect(log.chains.contDyMm[0]).toBe(-5);
  });
});

describe("dust message round trips", () => {
  it("DUST_REQUEST and DUST_CHECK (random)", () => {
    const r = rng(11);
    const out = new Uint8Array(4096);
    for (let i = 0; i < 2000; i++) {
      const req =
        r() < 0.5
          ? ({
              kind: "plots",
              plotIds: Array.from({ length: randInt(r, 1, 8) }, () => randInt(r, 0, PLOTS - 1)) as PlotId[],
            } as const)
          : ({ kind: "chunk", chunkId: randInt(r, 0, CHUNK_COUNT - 1) } as const);
      const n = encodeDustRequest(req, out);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(34);
      expect(decodeDustRequest(out.slice(0, n), PLOTS)).toEqual(req);
    }
    for (let i = 0; i < 500; i++) {
      const check =
        r() < 0.5
          ? ({
              mode: "chunks",
              chunks: Array.from({ length: randInt(r, 0, 40) }, () => ({
                chunkId: randInt(r, 0, 640),
                xorHash: randInt(r, 0, 0xffffffff),
              })),
            } as const)
          : ({
              mode: "detail",
              chunkId: randInt(r, 0, 640),
              plots: Array.from({ length: randInt(r, 0, 256) }, () => ({
                plotId: randInt(r, 0, PLOTS - 1) as PlotId,
                ledgerVersion: randInt(r, 0, 0xffffffff),
                hash: randInt(r, 0, 0xffffffff),
              })),
            } as const);
      const n = encodeDustCheck(check, out);
      expect(n).toBeGreaterThan(0);
      expect(decodeDustCheck(out.slice(0, n), PLOTS)).toEqual(check);
    }
  });

  it("DUST_LEDGER and DUST_LOG (random)", () => {
    const r = rng(12);
    const out = new Uint8Array(8192);
    for (let i = 0; i < 50; i++) {
      const ledger = randomLedger(r);
      const plotId = randInt(r, 0, PLOTS - 1);
      const n = encodeDustLedger(plotId, ledger, identityDeflate, out);
      expect(n).toBeGreaterThan(0);
      const got = decodeDustLedger(out.slice(0, n), identityInflate, PLOTS)!;
      expect(got.plotId).toBe(plotId);
      expect(got.header).toEqual(ledger.header);
      expect([...got.texels]).toEqual([...ledger.texels]);
      const ref = 150_000 + i;
      const chains = randomChains(r, 40, ref);
      const m = encodeDustLog(plotId, ref, chains, out);
      expect(m).toBeGreaterThan(0);
      const log = decodeDustLog(out.slice(0, m), PLOTS)!;
      expect(log.plotId).toBe(plotId);
      sameChains(log.chains, chains);
    }
  });

  it("DUST_SNAPSHOT: slice, shuffle, reassemble, decode", () => {
    const r = rng(13);
    const plotCount = PLOTS;
    const states = new Uint8Array(Math.ceil(plotCount / 4));
    for (let i = 0; i < 300; i++) {
      const p = randInt(r, 0, plotCount - 1);
      states[p >>> 2] = (states[p >>> 2] ?? 0) | (PlotState.Opened << ((p & 3) * 2));
    }
    const opened = countOpened(states, plotCount);
    const openedRemaining = new Uint8Array(opened).map(() => randInt(r, 0, 255));
    const ledgers = Array.from({ length: 3 }, () => ({
      plotId: randInt(r, 0, plotCount - 1),
      ledger: randomLedger(r),
    }));
    const logs = Array.from({ length: 2 }, (_, i) => ({
      plotId: randInt(r, 0, plotCount - 1),
      refTick: 5000 + i,
      chains: randomChains(r, 6, 5000 + i),
    }));
    const raw = encodeSnapshotRaw({ plotCount, plotStates: states, openedRemaining, ledgers, logs })!;
    expect(raw).not.toBeNull();
    const count = snapshotSliceCount(raw.length);
    expect(count).toBeGreaterThan(1);
    const slices: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const buf = new Uint8Array(DUST_MESSAGE_SLICE_MAX_BYTES);
      const n = writeSnapshotSlice(raw, i, 7, buf);
      expect(n).toBeLessThanOrEqual(DUST_MESSAGE_SLICE_MAX_BYTES);
      slices.push(buf.slice(0, n));
    }
    slices.reverse();
    const asm = new SnapshotAssembler();
    let status = "pending";
    for (const s of slices) status = asm.add(s);
    expect(status).toBe("complete");
    const stream = asm.take()!;
    expect([...stream]).toEqual([...raw]);
    const snap = decodeSnapshotStream(stream, identityInflate, plotCount)!;
    expect(snap).not.toBeNull();
    expect([...snap.plotStates]).toEqual([...states]);
    expect([...snap.openedRemaining]).toEqual([...openedRemaining]);
    expect(snap.ledgers.length).toBe(3);
    expect(snap.ledgers[1]!.header).toEqual(ledgers[1]!.ledger.header);
    expect(snap.logs.length).toBe(2);
    sameChains(snap.logs[1]!.chains, logs[1]!.chains);
    expect(decodeSnapshotRaw(raw, plotCount - 1)).toBeNull();
  });

  it("the snapshot size cap sits above a full 1,024-ledger snapshot and the encoder refuses anything the decoder would", () => {
    const states = new Uint8Array(Math.ceil(PLOTS / 4));
    const ledger: LedgerRawInput = {
      header: {
        version: 1,
        remainingUnits: 10,
        initialUnits: 10,
        ownedTexels: 1024,
        mgPerUnit: 1,
        hash: 2,
        contributions: Array.from({ length: 4 }, (_, i) => ({ actorSlot: i, units: 1 })),
      },
      texels: new Uint8Array(LEDGER_BYTES).fill(7),
    };
    const ledgers = Array.from({ length: DUST_SNAPSHOT_MAX_LEDGERS }, (_, i) => ({ plotId: i, ledger }));
    const full = encodeSnapshotRaw({
      plotCount: PLOTS,
      plotStates: states,
      openedRemaining: new Uint8Array(0),
      ledgers,
      logs: [],
    });
    expect(full).not.toBeNull();
    // Above the old 1 MiB cap, within the new one, and accepted by an inflate that enforces the cap.
    expect(full!.length).toBeGreaterThan(1 << 20);
    expect(full!.length).toBeLessThanOrEqual(DUST_SNAPSHOT_MAX_RAW_BYTES);
    const decoded = decodeSnapshotStream(full!, identityInflate, PLOTS);
    expect(decoded?.ledgers.length).toBe(DUST_SNAPSHOT_MAX_LEDGERS);

    // Full ledgers plus a full set of long logs exceeds the cap: refused at encode, not silently dropped by the client.
    const r = rng(77);
    const logs = Array.from({ length: DUST_SNAPSHOT_MAX_LOGS }, (_, i) => ({
      plotId: i,
      refTick: 9000,
      chains: randomChainsFull(r, 255, 9000),
    }));
    const oversize = encodeSnapshotRaw({
      plotCount: PLOTS,
      plotStates: states,
      openedRemaining: new Uint8Array(0),
      ledgers,
      logs,
    });
    expect(oversize).toBeNull();
  });

  it("snapshot caps are mutually consistent: 1.5 MiB raw covers the worst ledger case, slices bound the wire size", () => {
    expect(DUST_SNAPSHOT_MAX_RAW_BYTES).toBe(1.5 * 1024 * 1024);
    // Worst legal ledger-only snapshot at the largest addressable grid: every plot Opened (1 remaining byte each),
    // 1,024 ledgers with the maximum contributions. Must fit with room to spare (the margin carries short logs).
    const maxPlots = 1 << PLOT_ID_BITS;
    const worst =
      4 + Math.ceil(maxPlots / 4) + maxPlots + 2 + 2 + DUST_SNAPSHOT_MAX_LEDGERS * (3 + LEDGER_RAW_MAX_BYTES);
    expect(worst).toBeLessThan(DUST_SNAPSHOT_MAX_RAW_BYTES);
    // The standard grid with every plot Opened and 1,024 full ledgers encodes (it is above the old 1 MiB cap).
    const opened = new Uint8Array(Math.ceil(PLOTS / 4)).fill(PlotState.Opened * 0x55);
    const ledger: LedgerRawInput = {
      header: {
        version: 1,
        remainingUnits: 1,
        initialUnits: 1,
        ownedTexels: 1024,
        mgPerUnit: 1,
        hash: 3,
        contributions: Array.from({ length: LEDGER_MAX_CONTRIBUTIONS }, (_, i) => ({ actorSlot: i, units: 1 })),
      },
      texels: new Uint8Array(LEDGER_BYTES).fill(1),
    };
    const raw = encodeSnapshotRaw({
      plotCount: PLOTS,
      plotStates: opened,
      openedRemaining: new Uint8Array(PLOTS).fill(5),
      ledgers: Array.from({ length: DUST_SNAPSHOT_MAX_LEDGERS }, (_, i) => ({ plotId: i, ledger })),
      logs: [],
    });
    expect(raw).not.toBeNull();
    expect(raw!.length).toBeGreaterThan(1 << 20);
    expect(raw!.length).toBeLessThan(DUST_SNAPSHOT_MAX_RAW_BYTES);
    // The deflated stream is at most DUST_SNAPSHOT_MAX_SLICES slices of DUST_MESSAGE_SLICE_MAX_BYTES (4,096 B each).
    const maxDeflated = DUST_SNAPSHOT_MAX_SLICES * (DUST_MESSAGE_SLICE_MAX_BYTES - DUST_SNAPSHOT_SLICE_HEADER_BYTES);
    expect(snapshotSliceCount(maxDeflated)).toBe(DUST_SNAPSHOT_MAX_SLICES);
    expect(snapshotSliceCount(maxDeflated + 1)).toBe(DUST_SNAPSHOT_MAX_SLICES + 1);
  });

  it("a newer snapshot version restarts an unfinished assembly; duplicates and bad slices are handled", () => {
    const big = new Uint8Array(9000).fill(3);
    const a = new Uint8Array(DUST_MESSAGE_SLICE_MAX_BYTES);
    const b = new Uint8Array(DUST_MESSAGE_SLICE_MAX_BYTES);
    const asm = new SnapshotAssembler();
    expect(asm.add(a.slice(0, writeSnapshotSlice(big, 0, 1, a)))).toBe("pending");
    expect(asm.add(a.slice(0, writeSnapshotSlice(big, 0, 1, a)))).toBe("pending");
    expect(asm.received).toBe(1);
    expect(asm.add(b.slice(0, writeSnapshotSlice(big, 1, 2, b)))).toBe("pending");
    expect(asm.version).toBe(2);
    expect(asm.received).toBe(1);
    expect(asm.add(new Uint8Array(5))).toBe("invalid");
    const bad = a.slice(0, writeSnapshotSlice(big, 0, 3, a));
    bad[1] = 9;
    expect(asm.add(bad)).toBe("invalid");
    expect(asm.take()).toBeNull();
  });
});

describe("dust message encoders never emit what the decoders reject (review S2)", () => {
  /** A log whose chains carry `total` continuations in all (255 per chain at most). */
  function heavyLog(total: number): StrokeChainBuffer {
    const b = new StrokeChainBuffer(32, total + 8);
    let left = total;
    while (left > 0 || b.chainCount === 0) {
      b.addChain(7, 0, 0, 10, 10, 30, 9, 1, 2, 1000, 5);
      const k = Math.min(255, left);
      for (let i = 0; i < k; i++) b.addContinuation(3, -3);
      left -= k;
    }
    return b;
  }

  it("DUST_LOG: exactly DUST_LOG_MAX_CONTINUATIONS round-trips; one more is refused by the encoder", () => {
    const out = new Uint8Array(64 * 1024);
    const atCap = heavyLog(DUST_LOG_MAX_CONTINUATIONS);
    const n = encodeDustLog(9, 1000, atCap, out);
    expect(n).toBeGreaterThan(0);
    sameChains(decodeDustLog(out.slice(0, n), PLOTS)!.chains, atCap);
    expect(encodeDustLog(9, 1000, heavyLog(DUST_LOG_MAX_CONTINUATIONS + 1), out)).toBe(0);
  });

  it("LEDGER RAW: actor slot 15 round-trips; slot 16, owned > 1,024 or remaining > initial are refused", () => {
    const r = rng(77);
    const out = new Uint8Array(8192);
    const base = randomLedger(r);
    const ok: LedgerRawInput = {
      ...base,
      header: { ...base.header, contributions: [{ actorSlot: LEDGER_WIRE_ACTOR_SLOT_MAX, units: 5 }] },
    };
    const n = encodeDustLedger(3, ok, identityDeflate, out);
    expect(n).toBeGreaterThan(0);
    expect(decodeDustLedger(out.slice(0, n), identityInflate, PLOTS)!.header).toEqual(ok.header);
    const bad: LedgerRawInput[] = [
      { ...base, header: { ...base.header, contributions: [{ actorSlot: 16, units: 5 }] } },
      { ...base, header: { ...base.header, ownedTexels: LEDGER_BYTES + 1 } },
      { ...base, header: { ...base.header, remainingUnits: base.header.initialUnits + 1 } },
    ];
    for (const l of bad) {
      expect(encodeDustLedger(3, l, identityDeflate, out)).toBe(0);
      const snap = encodeSnapshotRaw({
        plotCount: PLOTS,
        plotStates: new Uint8Array(Math.ceil(PLOTS / 4)),
        openedRemaining: new Uint8Array(0),
        ledgers: [{ plotId: 3, ledger: l }],
        logs: [],
      });
      expect(snap).toBeNull();
    }
    // A snapshot whose log is over the continuation cap is refused as a whole (never a snapshot the client voids).
    expect(
      encodeSnapshotRaw({
        plotCount: PLOTS,
        plotStates: new Uint8Array(Math.ceil(PLOTS / 4)),
        openedRemaining: new Uint8Array(0),
        ledgers: [],
        logs: [{ plotId: 4, refTick: 1000, chains: heavyLog(DUST_LOG_MAX_CONTINUATIONS + 1) }],
      }),
    ).toBeNull();
  });
});

describe("dust message hardening", () => {
  function everyTruncationAndCorruption(valid: Uint8Array, decode: (m: Uint8Array) => unknown, seed: number): void {
    expect(decode(valid)).not.toBeNull();
    for (let n = 0; n < valid.length; n++) expect(decode(valid.subarray(0, n))).toBeNull();
    const longer = new Uint8Array(valid.length + 1);
    longer.set(valid);
    expect(decode(longer)).toBeNull();
    const r = rng(seed);
    for (let i = 0; i < 5000; i++) {
      const m = valid.slice();
      for (let k = randInt(r, 1, 3); k > 0; k--) m[randInt(r, 0, m.length - 1)] = randInt(r, 0, 255);
      decode(m); // must not throw; the result may be valid or null
    }
    for (let i = 0; i < 2000; i++) {
      const g = new Uint8Array(randInt(r, 0, 200));
      for (let k = 0; k < g.length; k++) g[k] = randInt(r, 0, 255);
      if (g.length > 0) g[0] = valid[0] ?? 0;
      decode(g);
    }
  }

  it("DUST_REQUEST / DUST_CHECK / DUST_LOG never throw and reject every truncation", () => {
    everyTruncationAndCorruption(
      Uint8Array.from(DUST_REQUEST_PLOTS_VECTOR.bytes),
      (m) => decodeDustRequest(m, PLOTS),
      1,
    );
    everyTruncationAndCorruption(
      Uint8Array.from(DUST_REQUEST_CHUNK_VECTOR.bytes),
      (m) => decodeDustRequest(m, PLOTS),
      2,
    );
    everyTruncationAndCorruption(Uint8Array.from(DUST_CHECK_CHUNKS_VECTOR.bytes), (m) => decodeDustCheck(m, PLOTS), 3);
    everyTruncationAndCorruption(Uint8Array.from(DUST_CHECK_DETAIL_VECTOR.bytes), (m) => decodeDustCheck(m, PLOTS), 4);
    everyTruncationAndCorruption(Uint8Array.from(DUST_LOG_VECTOR.bytes), (m) => decodeDustLog(m, PLOTS), 5);
  });

  it("DUST_LEDGER rejects truncated, corrupt and hostile inflate output", () => {
    const r = rng(14);
    const out = new Uint8Array(4096);
    const n = encodeDustLedger(5, randomLedger(r), identityDeflate, out);
    const valid = out.slice(0, n);
    expect(decodeDustLedger(valid, identityInflate, PLOTS)).not.toBeNull();
    for (let len = 0; len < n; len++) {
      expect(decodeDustLedger(valid.subarray(0, len), identityInflate, PLOTS)).toBeNull();
    }
    expect(decodeDustLedger(valid, () => null, PLOTS)).toBeNull();
    expect(decodeDustLedger(valid, () => new Uint8Array(10_000_000), PLOTS)).toBeNull();
    expect(decodeDustLedger(valid, identityInflate, 5)).toBeNull();
    for (let i = 0; i < 3000; i++) {
      const m = valid.slice();
      m[randInt(r, 0, m.length - 1)] = randInt(r, 0, 255);
      decodeDustLedger(m, identityInflate, PLOTS);
    }
  });

  it("snapshot decode caps hostile counts without allocating from them", () => {
    const raw = new Uint8Array(4 + 1 + 2 + 2);
    raw[0] = 4; // plotCount 4
    raw[5] = 0xff; // ledgerCount 0xffff
    raw[6] = 0xff;
    expect(decodeSnapshotRaw(raw, 4)).toBeNull();
    expect(
      encodeSnapshotRaw({
        plotCount: 4,
        plotStates: new Uint8Array(1),
        openedRemaining: new Uint8Array(3),
        ledgers: [],
        logs: [],
      }),
    ).toBeNull();
    const log = new Uint8Array(10); // a log entry claiming 256 chains in a few bytes
    log[0] = DUST_LOG_ID;
    log[9] = 0x01;
    expect(decodeDustLog(log, PLOTS)).toBeNull();
    const chunks = Array.from({ length: DUST_CHECK_MAX_CHUNKS + 1 }, () => ({ chunkId: 1, xorHash: 1 }));
    expect(encodeDustCheck({ mode: "chunks", chunks }, new Uint8Array(4096))).toBe(0);
  });
});
