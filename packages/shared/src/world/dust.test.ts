import { describe, expect, expectTypeOf, it } from "vitest";
import type { PlotId } from "../ids";
import {
  DUST_ACK_GRAMS_MAX,
  DUST_CLASS_TERRAIN_ID,
  DUST_MODEL_VERSION,
  DUST_REQUEST_MAX_PLOTS,
  DUST_WIRE,
  DustAckPayloadSchema,
  DustCheckPayloadSchema,
  DustClass,
  DustClassSchema,
  DustInterestPayloadSchema,
  DustLedgerPayloadSchema,
  DustLogPayloadSchema,
  DustPlotsPayloadSchema,
  DustRequestPayloadSchema,
  DustSnapshotPayloadSchema,
  DustStrokesPayloadSchema,
  FNV1A_32_OFFSET_BASIS,
  FNV1A_32_PRIME,
  LEDGER_BYTES,
  LEDGER_CONTRIBUTION_BYTES,
  LEDGER_EDGE_TEXELS,
  LEDGER_FRAME_EDGE_MM,
  LEDGER_HEADER_FIXED_BYTES,
  LEDGER_LATTICE_PITCH_MAX_MM,
  LEDGER_LATTICE_PITCH_MIN_MM,
  LEDGER_MAX_CONTRIBUTIONS,
  LEDGER_MAX_DUST_LEVEL,
  LEDGER_MIN_COVERAGE_MM2,
  LEDGER_MIN_REMOVAL_UNITS,
  LEDGER_TEXEL_AREA_MM2,
  LEDGER_TEXEL_SIZE_MM,
  LEDGER_UNIT_MAX,
  LEDGER_UNITS_PER_LEVEL,
  LedgerHeaderSchema,
  OPENED_THRESHOLD_DIVISOR,
  POLISHED_THRESHOLD_DIVISOR,
  PLOT_STATE_BITS,
  PlotState,
  PlotStateSchema,
  RobotPlotIntentSchema,
  type DustCheckPayload,
  type DustLedgerPayload,
  type DustPlotDelta,
  type DustRequestPayload,
  type RobotPlotIntent,
} from "./dust";
import { PLOT_FRAME_EDGE_M } from "./plot-grid";
import {
  CHUNK_MIX_VECTORS,
  FNV1A_32_FOOBAR,
  LEDGER_HASH_VECTORS,
  LEDGER_REMOVAL_VECTORS,
  PLOT_THRESHOLD_VECTORS,
} from "./vectors";

// ---- Test-only reference arithmetic (the real implementation lives in packages/world) -----------------------------

function removal(depth16: number, coverageMm2: number): number {
  let r = Math.floor((depth16 * coverageMm2 + LEDGER_TEXEL_AREA_MM2 / 2) / LEDGER_TEXEL_AREA_MM2);
  if (coverageMm2 >= LEDGER_MIN_COVERAGE_MM2) r = Math.max(r, LEDGER_MIN_REMOVAL_UNITS);
  return r;
}

function fnv1a32(bytes: Uint8Array): number {
  let h = FNV1A_32_OFFSET_BASIS;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, FNV1A_32_PRIME) >>> 0;
  }
  return h >>> 0;
}

function ledgerOf(pattern: "zeros" | "ramp" | "corners"): Uint8Array {
  const t = new Uint8Array(LEDGER_BYTES);
  if (pattern === "ramp") for (let i = 0; i < t.length; i += 1) t[i] = i & 0xff;
  if (pattern === "corners") {
    t[0] = 208;
    t[LEDGER_BYTES - 1] = 80;
  }
  return t;
}

function mix(plotId: number, hash: number): number {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, plotId, true);
  view.setUint32(4, hash, true);
  return fnv1a32(bytes);
}

// ---- Tests --------------------------------------------------------------------------------------------------------

describe("plot states and classes", () => {
  it("has the 2-bit state codes of WDS section 4.2", () => {
    expect(PlotState).toEqual({ Grimy: 0, Opened: 1, Polished: 2, Empty: 3 });
    expect(PLOT_STATE_BITS).toBe(2);
    for (const code of Object.values(PlotState)) expect(code).toBeLessThan(1 << PLOT_STATE_BITS);
    expect(PlotStateSchema.safeParse(4).success).toBe(false);
    expect(PlotStateSchema.safeParse(-1).success).toBe(false);
  });

  it("has four dust classes that fit a uint8 and map to game-data terrain ids", () => {
    expect(DustClass).toEqual({ Highland: 0, Mare: 1, CraterFloor: 2, Empty: 3 });
    expect(DustClassSchema.safeParse(4).success).toBe(false);
    expect(DUST_CLASS_TERRAIN_ID[DustClass.Highland]).toBe("terrain.highland");
    expect(DUST_CLASS_TERRAIN_ID[DustClass.CraterFloor]).toBe("terrain.crater_floor");
  });

  it("DUST_MODEL_VERSION is 2", () => {
    expect(DUST_MODEL_VERSION).toBe(2);
  });
});

describe("ledger dimensions and units (WDS section 4.4/4.5, ADR-0026)", () => {
  it("is 32 x 32 x 8 bit = 1 KiB with 0.8 m texels covering the 25.6 m frame", () => {
    expect(LEDGER_EDGE_TEXELS).toBe(32);
    expect(LEDGER_BYTES).toBe(1024);
    expect(LEDGER_TEXEL_SIZE_MM).toBe(800);
    expect(LEDGER_TEXEL_AREA_MM2).toBe(640_000);
    expect(LEDGER_FRAME_EDGE_MM).toBe(PLOT_FRAME_EDGE_M * 1000);
  });

  it("counts texel units in 1/16 level; the class levels 5, 8, 13 give 80, 128, 208 and fit a u8", () => {
    expect(LEDGER_UNITS_PER_LEVEL).toBe(16);
    expect([5, 8, 13].map((level) => level * LEDGER_UNITS_PER_LEVEL)).toEqual([80, 128, 208]);
    expect(LEDGER_MAX_DUST_LEVEL * LEDGER_UNITS_PER_LEVEL).toBeLessThanOrEqual(LEDGER_UNIT_MAX);
    expect((LEDGER_MAX_DUST_LEVEL + 1) * LEDGER_UNITS_PER_LEVEL).toBeGreaterThan(LEDGER_UNIT_MAX);
    expect(LEDGER_UNIT_MAX).toBe(255);
  });

  it("has the minimum coverage A/64, lattice pitch clamp", () => {
    expect(LEDGER_MIN_COVERAGE_MM2).toBe(10_000);
    expect(LEDGER_LATTICE_PITCH_MIN_MM).toBe(25);
    expect(LEDGER_LATTICE_PITCH_MAX_MM).toBe(100);
  });

  it("serialised ledger header size matches the WDS field list", () => {
    expect(LEDGER_HEADER_FIXED_BYTES).toBe(23);
    expect(LEDGER_CONTRIBUTION_BYTES).toBe(5);
    expect(LEDGER_MAX_CONTRIBUTIONS).toBe(4);
  });
});

describe("integer thresholds (WDS section 4.2) and golden vectors", () => {
  it.each(PLOT_THRESHOLD_VECTORS.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const initial = v.level * LEDGER_UNITS_PER_LEVEL * v.ownedTexels;
    expect(initial).toBe(v.initialUnits);
    expect(Math.ceil(initial / OPENED_THRESHOLD_DIVISOR)).toBe(v.openedRemovedUnits);
    expect(Math.floor(initial / POLISHED_THRESHOLD_DIVISOR)).toBe(v.polishedRemainingUnits);
  });

  it("Opened is reached strictly before Polished", () => {
    for (const v of PLOT_THRESHOLD_VECTORS) {
      expect(v.openedRemovedUnits).toBeLessThan(v.initialUnits - v.polishedRemainingUnits);
    }
  });
});

describe("per-texel removal vectors (WDS section 4.5 step 4)", () => {
  it.each(LEDGER_REMOVAL_VECTORS.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    expect(removal(v.depth16, v.coverageMm2)).toBe(v.removalUnits);
  });

  it("is state-independent, so saturating subtraction commutes (order independence)", () => {
    const ops = LEDGER_REMOVAL_VECTORS.map((v) => removal(v.depth16, v.coverageMm2));
    const apply = (order: readonly number[]): number => order.reduce((u, r) => Math.max(0, u - r), 208);
    const forward = apply(ops);
    expect(apply([...ops].reverse())).toBe(forward);
    expect(apply([...ops].sort((a, b) => a - b))).toBe(forward);
  });
});

describe("ledger and chunk hash vectors", () => {
  it("FNV-1a 32 reproduces the published check value", () => {
    expect(fnv1a32(Uint8Array.from("foobar", (ch) => ch.charCodeAt(0)))).toBe(FNV1A_32_FOOBAR);
    expect(fnv1a32(new Uint8Array(0))).toBe(FNV1A_32_OFFSET_BASIS);
  });

  it.each(LEDGER_HASH_VECTORS.map((v) => [v.name, v] as const))("ledger %s", (_name, v) => {
    expect(fnv1a32(ledgerOf(v.pattern))).toBe(v.hash);
  });

  it.each(CHUNK_MIX_VECTORS.map((v) => [`${v.plotId}`, v] as const))("chunk mix for plot %s", (_name, v) => {
    expect(mix(v.plotId, v.hash)).toBe(v.mix);
  });

  it("the chunk hash is an XOR, so it is order independent and self-inverse", () => {
    const terms = CHUNK_MIX_VECTORS.map((v) => v.mix);
    const xor = (list: readonly number[]): number => list.reduce((a, b) => (a ^ b) >>> 0, 0);
    expect(xor(terms)).toBe(xor([...terms].reverse()));
    expect(xor([...terms, ...terms])).toBe(0);
  });
});

const PLOT = 41_207;
const STROKE_HEADER = {
  anchor: PLOT,
  startUMm: 0,
  startVMm: 0,
  endUMm: 120,
  endVMm: -30,
  widthCm: 15,
  depth16: 80,
  toolCode: 1,
  tick: 100,
  actorSlot: 1,
  inputSeq: 7,
};
const CHAIN = { header: STROKE_HEADER, continuations: [{ actorSlot: 1, dxMm: 100, dyMm: 5 }] };
const LEDGER_HEADER = {
  version: 3,
  remainingUnits: 38_000,
  initialUnits: 38_320,
  ownedTexels: 479,
  mgPerUnit: 2480,
  hash: 521_235_909,
  contributions: [{ actorSlot: 0, units: 320 }],
};

describe("ledger header schema", () => {
  it("round-trips and bounds contributions and units", () => {
    expect(LedgerHeaderSchema.parse(JSON.parse(JSON.stringify(LEDGER_HEADER)))).toEqual(LEDGER_HEADER);
    const bad: unknown[] = [
      { ...LEDGER_HEADER, remainingUnits: 38_321 },
      { ...LEDGER_HEADER, ownedTexels: 1025 },
      { ...LEDGER_HEADER, hash: 2 ** 32 },
      { ...LEDGER_HEADER, contributions: Array.from({ length: 5 }, () => ({ actorSlot: 0, units: 1 })) },
      { ...LEDGER_HEADER, contributions: [{ actorSlot: 64, units: 1 }] },
    ];
    for (const value of bad) expect(LedgerHeaderSchema.safeParse(value).success).toBe(false);
  });
});

describe("dust message payloads (WDS section 5.1)", () => {
  it("dust.strokes round-trips chains", () => {
    const payload = DustStrokesPayloadSchema.parse({ chains: [CHAIN] });
    expect(DustStrokesPayloadSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it("robot.plot round-trips and bounds the lane mask and widths", () => {
    const intent = {
      robotId: 12,
      plotId: PLOT,
      startTick: 5_000,
      widthCm: 80,
      depth16: 80,
      speedCmPerS: 150,
      laneMask: [0xffff_ffff, 0x0000_00ff] as [number, number],
    };
    const parsed = RobotPlotIntentSchema.parse(intent);
    expect(RobotPlotIntentSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(RobotPlotIntentSchema.safeParse({ ...intent, laneMask: [0, 2 ** 32] }).success).toBe(false);
    expect(RobotPlotIntentSchema.safeParse({ ...intent, widthCm: 0 }).success).toBe(false);
    expect(RobotPlotIntentSchema.safeParse({ ...intent, speedCmPerS: 1024 }).success).toBe(false);
    expect(DUST_WIRE.robotLaneMaskBits).toBe(64);
  });

  it("dust.ack is u24 grams", () => {
    expect(DustAckPayloadSchema.parse({ grams: DUST_ACK_GRAMS_MAX })).toEqual({ grams: 16_777_215 });
    expect(DustAckPayloadSchema.safeParse({ grams: DUST_ACK_GRAMS_MAX + 1 }).success).toBe(false);
    expect(DustAckPayloadSchema.safeParse({ grams: -1 }).success).toBe(false);
  });

  it("dust.plots deltas are 18 + 2 + 8 (+4 spare) = 32 bits", () => {
    expect(DUST_WIRE.plotIdBits + DUST_WIRE.plotStateBits + 8 + 4).toBe(DUST_WIRE.plotDeltaBits);
    const payload = DustPlotsPayloadSchema.parse({
      deltas: [
        { plotId: 163_841, state: PlotState.Empty, remainingFrac: 0 },
        { plotId: 0, state: PlotState.Opened, remainingFrac: 254 },
      ],
    });
    expect(DustPlotsPayloadSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
    expect(DustPlotsPayloadSchema.safeParse({ deltas: [{ plotId: 1, state: 4, remainingFrac: 0 }] }).success).toBe(
      false,
    );
    expect(DustPlotsPayloadSchema.safeParse({ deltas: [{ plotId: 1, state: 1, remainingFrac: 256 }] }).success).toBe(
      false,
    );
  });

  it("dust.ledger and dust.log round-trip", () => {
    const ledger = DustLedgerPayloadSchema.parse({ plotId: PLOT, header: LEDGER_HEADER, texels: ledgerOf("ramp") });
    expect(DustLedgerPayloadSchema.parse(ledger)).toEqual(ledger);
    expect(DustLedgerPayloadSchema.safeParse({ ...ledger, texels: new Uint8Array(1023) }).success).toBe(false);
    const log = DustLogPayloadSchema.parse({ plotId: PLOT, chains: [CHAIN] });
    expect(DustLogPayloadSchema.parse(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it("dust.snapshot round-trips (blocking part of WDS section 5.4)", () => {
    const snapshot = DustSnapshotPayloadSchema.parse({
      plotCount: 163_842,
      plotStates: new Uint8Array(Math.ceil(163_842 / 4)),
      openedRemaining: Uint8Array.from([200, 190]),
      ledgers: [{ plotId: PLOT, header: LEDGER_HEADER, texels: ledgerOf("zeros") }],
      logs: [{ plotId: PLOT, chains: [CHAIN] }],
    });
    expect(snapshot.plotStates.length).toBe(40_961);
    expect(DustSnapshotPayloadSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("dust.check has a chunk mode and a detail mode", () => {
    const chunks = DustCheckPayloadSchema.parse({ mode: "chunks", chunks: [{ chunkId: 640, xorHash: 0xdead_beef }] });
    const detail = DustCheckPayloadSchema.parse({
      mode: "detail",
      chunkId: 41,
      plots: [{ plotId: PLOT, ledgerVersion: 3, hash: 5 }],
    });
    for (const value of [chunks, detail])
      expect(DustCheckPayloadSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
    expect(DustCheckPayloadSchema.safeParse({ mode: "chunks", chunks: [{ chunkId: 641, xorHash: 0 }] }).success).toBe(
      false,
    );
    expect(DustCheckPayloadSchema.safeParse({ mode: "other" }).success).toBe(false);
  });

  it("dust.request is up to 8 plots or one chunk", () => {
    expect(DustRequestPayloadSchema.parse({ kind: "chunk", chunkId: 0 })).toEqual({ kind: "chunk", chunkId: 0 });
    const eight = { kind: "plots", plotIds: Array.from({ length: DUST_REQUEST_MAX_PLOTS }, (_, i) => i) };
    expect(DustRequestPayloadSchema.safeParse(eight).success).toBe(true);
    expect(DustRequestPayloadSchema.safeParse({ kind: "plots", plotIds: [...eight.plotIds, 8] }).success).toBe(false);
    expect(DustRequestPayloadSchema.safeParse({ kind: "plots", plotIds: [] }).success).toBe(false);
    expect(DustRequestPayloadSchema.safeParse({ kind: "chunk", chunkId: 641 }).success).toBe(false);
  });

  it("dust_interest clamps the residency radius to 60..220 m", () => {
    expect(DustInterestPayloadSchema.safeParse({ residencyRadiusM: 60 }).success).toBe(true);
    expect(DustInterestPayloadSchema.safeParse({ residencyRadiusM: 220 }).success).toBe(true);
    expect(DustInterestPayloadSchema.safeParse({ residencyRadiusM: 59 }).success).toBe(false);
    expect(DustInterestPayloadSchema.safeParse({ residencyRadiusM: 221 }).success).toBe(false);
  });
});

describe("types", () => {
  it("branded plot ids survive parsing", () => {
    expectTypeOf<RobotPlotIntent["plotId"]>().toEqualTypeOf<PlotId>();
    expectTypeOf<DustPlotDelta["plotId"]>().toEqualTypeOf<PlotId>();
    expectTypeOf<DustLedgerPayload["plotId"]>().toEqualTypeOf<PlotId>();
    expectTypeOf<ReturnType<typeof RobotPlotIntentSchema.parse>>().toExtend<RobotPlotIntent>();
    expectTypeOf<ReturnType<typeof DustRequestPayloadSchema.parse>>().toExtend<DustRequestPayload>();
    expectTypeOf<ReturnType<typeof DustCheckPayloadSchema.parse>>().toExtend<DustCheckPayload>();
  });
});
