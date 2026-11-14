import { describe, expect, expectTypeOf, it } from "vitest";
import type { PlotId } from "../ids";
import {
  PLOT_FRAME_HALF_MM,
  PLOT_LOCAL_MM_MAX,
  PLOT_LOCAL_MM_MIN,
  STROKE_ACTOR_SLOT_BITS,
  STROKE_ACTOR_SLOT_MAX,
  STROKE_CHAIN_REANCHOR_MM,
  STROKE_DELTA_BITS,
  STROKE_DELTA_MM_MAX,
  STROKE_DELTA_MM_MIN,
  STROKE_MAX_SEGMENT_MM,
  STROKE_REJECT_REASONS,
  STROKE_TOOL_CODE_MAX,
  STROKE_WIDTH_CM_MAX,
  STROKE_WIRE_BITS,
  StrokeChainSchema,
  StrokeContinuationSchema,
  StrokeRecordSchema,
  type StrokeChain,
  type StrokeRecord,
} from "./stroke";

const record = {
  anchor: 41_207,
  startUMm: -1200,
  startVMm: 350,
  endUMm: -950,
  endVMm: 410,
  widthCm: 15,
  depth16: 80,
  toolCode: 1,
  tick: 72_000,
  actorSlot: 2,
  inputSeq: 4_321,
};

describe("stroke ranges", () => {
  it("plot-local coordinates are int16 millimetres covering the 25.6 m frame plus spill", () => {
    expect(PLOT_LOCAL_MM_MIN).toBe(-32_768);
    expect(PLOT_LOCAL_MM_MAX).toBe(32_767);
    expect(PLOT_FRAME_HALF_MM).toBe(12_800);
    expect(PLOT_LOCAL_MM_MAX).toBeGreaterThan(PLOT_FRAME_HALF_MM * 2);
  });

  it("width 10 bits in cm (10.23 m), tool 6 bits, actor slot 6 bits", () => {
    expect(STROKE_WIDTH_CM_MAX).toBe(1023);
    expect(STROKE_TOOL_CODE_MAX).toBe(63);
    expect(STROKE_ACTOR_SLOT_BITS).toBe(6);
    expect(STROKE_ACTOR_SLOT_MAX).toBe(63);
  });

  it("a 13-bit signed delta covers the 4 m segment limit and the wire records are 17 B and 4 B", () => {
    expect(STROKE_DELTA_BITS).toBe(13);
    expect(STROKE_DELTA_MM_MIN).toBe(-4096);
    expect(STROKE_DELTA_MM_MAX).toBe(4095);
    expect(STROKE_DELTA_MM_MAX).toBeGreaterThanOrEqual(STROKE_MAX_SEGMENT_MM);
    expect(STROKE_WIRE_BITS.header).toBe(18 + 4 * 16 + 10 + 8 + 6 + 6 + 8 + 16);
    expect(STROKE_WIRE_BITS.header / 8).toBe(17);
    expect(STROKE_WIRE_BITS.continuation).toBe(6 + 13 + 13);
    expect(STROKE_WIRE_BITS.continuation / 8).toBe(4);
    expect(STROKE_CHAIN_REANCHOR_MM).toBe(30_000);
  });

  it("lists the 8 server validation checks", () => {
    expect(STROKE_REJECT_REASONS).toHaveLength(8);
    expect(new Set(STROKE_REJECT_REASONS).size).toBe(8);
  });
});

describe("StrokeRecordSchema", () => {
  it("round-trips through JSON", () => {
    const parsed = StrokeRecordSchema.parse(record);
    expect(parsed).toEqual(record);
    expect(StrokeRecordSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(StrokeRecordSchema.parse(parsed)).toEqual(parsed);
  });

  it("accepts the boundary values and the disc form (start equals end)", () => {
    const edge = {
      ...record,
      anchor: 163_841,
      startUMm: PLOT_LOCAL_MM_MIN,
      endUMm: PLOT_LOCAL_MM_MAX,
      widthCm: 1023,
      depth16: 255,
      toolCode: 63,
      tick: 0xffff_ffff,
      actorSlot: 63,
      inputSeq: 0xffff,
    };
    expect(StrokeRecordSchema.safeParse(edge).success).toBe(true);
    const disc = { ...record, endUMm: record.startUMm, endVMm: record.startVMm, widthCm: 50, depth16: 255 };
    expect(StrokeRecordSchema.safeParse(disc).success).toBe(true);
  });

  it("rejects out-of-range and non-integer fields", () => {
    const bad: unknown[] = [
      { ...record, anchor: -1 },
      { ...record, anchor: 1 << 18 },
      { ...record, startUMm: PLOT_LOCAL_MM_MAX + 1 },
      { ...record, endVMm: PLOT_LOCAL_MM_MIN - 1 },
      { ...record, endVMm: 1.5 },
      { ...record, widthCm: 0 },
      { ...record, widthCm: 1024 },
      { ...record, depth16: 256 },
      { ...record, toolCode: 64 },
      { ...record, tick: -1 },
      { ...record, actorSlot: 64 },
      { ...record, inputSeq: 65_536 },
      {},
    ];
    for (const value of bad) expect(StrokeRecordSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });
});

describe("StrokeChainSchema", () => {
  const chain = {
    header: record,
    continuations: [
      { actorSlot: 2, dxMm: 100, dyMm: -40 },
      { actorSlot: 2, dxMm: STROKE_DELTA_MM_MIN, dyMm: STROKE_DELTA_MM_MAX },
    ],
  };

  it("round-trips", () => {
    const parsed = StrokeChainSchema.parse(chain);
    expect(StrokeChainSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects a continuation from another actor and out-of-range deltas", () => {
    expect(StrokeChainSchema.safeParse({ ...chain, continuations: [{ actorSlot: 3, dxMm: 0, dyMm: 0 }] }).success).toBe(
      false,
    );
    expect(StrokeContinuationSchema.safeParse({ actorSlot: 2, dxMm: 4096, dyMm: 0 }).success).toBe(false);
    expect(StrokeContinuationSchema.safeParse({ actorSlot: 2, dxMm: 0, dyMm: -4097 }).success).toBe(false);
  });
});

describe("types", () => {
  it("interfaces match the parsed schema output both ways", () => {
    expectTypeOf<ReturnType<typeof StrokeRecordSchema.parse>>().toExtend<StrokeRecord>();
    expectTypeOf<StrokeRecord>().toExtend<ReturnType<typeof StrokeRecordSchema.parse>>();
    expectTypeOf<ReturnType<typeof StrokeChainSchema.parse>>().toExtend<StrokeChain>();
    expectTypeOf<StrokeRecord["anchor"]>().toEqualTypeOf<PlotId>();
  });
});
