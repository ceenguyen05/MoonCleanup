import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CapacityNoticePayloadSchema,
  DUST_SNAPSHOT_SLICE_HEADER_BYTES,
  DustSnapshotSliceSchema,
  ErrorPayloadSchema,
  KickNoticePayloadSchema,
  KickPayloadSchema,
  PAYLOAD_SCHEMAS,
  PurchaseResultPayloadSchema,
  ReadyPayloadSchema,
  SIM_EVENTS_BATCH_MAX,
  SetShiftTypePayloadSchema,
  ShiftTypeChangedPayloadSchema,
  ShutdownNoticePayloadSchema,
  SimEventsPayloadSchema,
  VisibilityPayloadSchema,
  WIRE_EXCLUDED_SIM_EVENTS,
  WIRE_SIM_EVENT_NAMES,
  type WireSimEvent,
} from "./payloads";
import { FOREIGN_CLOSE_CODES, CloseCode, CLOSE_CODE_RANGE, SDK_RECONNECT_CLOSE_CODES } from "./close-codes";
import {
  DEFAULT_SIM_TICK_HZ,
  DEFAULT_SNAPSHOT_HZ,
  INBOUND_MAX_BYTES,
  INPUT_RATE_LIMIT_FACTORS,
  OUTBOUND_MAX_BYTES,
  RATE_LIMITS,
  SUPPORTED_RATE_PAIRS,
  VIOLATION_LIMIT,
} from "./limits";
import { SHIFT_STATE_SCHEMA_FIELDS } from "./shift-state-schema";
import { ShiftStateSchema, type ShiftState } from "../sim/shift-state";
import { DUST_MESSAGE_SLICE_MAX_BYTES } from "../world";
import { SIM_EVENT_NAMES } from "../events";
import { MESSAGE_CATALOG } from "./messages";
import { Channel, Direction } from "./channels";

const REQ = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00";
const PLAYER = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b01";

describe("client -> server control payloads", () => {
  it("parse valid and reject invalid", () => {
    expect(ReadyPayloadSchema.parse({})).toEqual({});
    expect(VisibilityPayloadSchema.parse({ hidden: true })).toEqual({ hidden: true });
    expect(VisibilityPayloadSchema.safeParse({ hidden: "yes" }).success).toBe(false);
    expect(SetShiftTypePayloadSchema.parse({ shiftType: "private" })).toEqual({ shiftType: "private" });
    expect(SetShiftTypePayloadSchema.safeParse({ shiftType: "open" }).success).toBe(false);
    expect(KickPayloadSchema.parse({ playerId: PLAYER, reasonCode: "griefing" })).toEqual({
      playerId: PLAYER,
      reasonCode: "griefing",
    });
    expect(KickPayloadSchema.safeParse({ playerId: "x", reasonCode: "griefing" }).success).toBe(false);
    expect(KickPayloadSchema.safeParse({ playerId: PLAYER, reasonCode: "rude" }).success).toBe(false);
  });

  it("every active client -> server control entry has a schema that rejects non-objects", () => {
    for (const [name, def] of Object.entries(MESSAGE_CATALOG)) {
      if (def.channel !== Channel.Control || def.direction !== Direction.ClientToServer || def.status !== "active")
        continue;
      const schema = PAYLOAD_SCHEMAS[name as keyof typeof PAYLOAD_SCHEMAS];
      expect(schema, name).toBeDefined();
      expect(schema.safeParse(null).success, name).toBe(false);
      expect(schema.safeParse("x").success, name).toBe(false);
    }
  });
});

describe("server -> client control payloads", () => {
  it("purchase_result is a discriminated union on ok", () => {
    expect(PurchaseResultPayloadSchema.parse({ requestId: REQ, ok: true, walletAfter: 10 })).toBeDefined();
    expect(PurchaseResultPayloadSchema.parse({ requestId: REQ, ok: false, code: "insufficient_funds" })).toBeDefined();
    expect(PurchaseResultPayloadSchema.safeParse({ requestId: REQ, ok: false, code: "nope" }).success).toBe(false);
    expect(PurchaseResultPayloadSchema.safeParse({ requestId: REQ, ok: true }).success).toBe(false);
  });

  it("error, shutdown, kick, shift type and capacity notices", () => {
    expect(ErrorPayloadSchema.parse({ code: "RATE_LIMITED", ref: "purchase" })).toBeDefined();
    expect(ErrorPayloadSchema.safeParse({ code: "OOPS" }).success).toBe(false);
    expect(ShutdownNoticePayloadSchema.parse({ reason: "deploy", secondsUntilClose: 5 })).toBeDefined();
    expect(ShutdownNoticePayloadSchema.safeParse({ reason: "deploy", secondsUntilClose: -1 }).success).toBe(false);
    expect(
      KickNoticePayloadSchema.parse({ by: "holder", reasonCode: "other", until: "2026-11-14T00:00:00.000Z" }),
    ).toBeDefined();
    expect(ShiftTypeChangedPayloadSchema.parse({ shiftType: "solo" })).toEqual({ shiftType: "solo" });
    expect(CapacityNoticePayloadSchema.parse({ reason: "at_capacity" })).toBeDefined();
    expect(CapacityNoticePayloadSchema.safeParse({ reason: "full" }).success).toBe(false);
  });
});

describe("sim_events", () => {
  it("carries every sim event except the excluded ones", () => {
    expect(WIRE_EXCLUDED_SIM_EVENTS).toEqual(["dust.collected"]);
    expect(WIRE_SIM_EVENT_NAMES).toHaveLength(SIM_EVENT_NAMES.length - 1);
    expect(WIRE_SIM_EVENT_NAMES).not.toContain("dust.collected");
    expect(WIRE_SIM_EVENT_NAMES).toContain("plot.polished");
  });

  it("validates the envelope", () => {
    const ok = { events: [{ name: "plot.polished", payload: { tick: 4, plotId: 12 } }] };
    expect(SimEventsPayloadSchema.parse(ok).events).toHaveLength(1);
    expect(SimEventsPayloadSchema.safeParse({ events: [] }).success).toBe(false);
    expect(
      SimEventsPayloadSchema.safeParse({ events: [{ name: "dust.collected", payload: { tick: 1 } }] }).success,
    ).toBe(false);
    expect(SimEventsPayloadSchema.safeParse({ events: [{ name: "plot.polished", payload: {} }] }).success).toBe(false);
    const many = Array.from({ length: SIM_EVENTS_BATCH_MAX + 1 }, () => ({
      name: "plot.polished",
      payload: { tick: 1 },
    }));
    expect(SimEventsPayloadSchema.safeParse({ events: many }).success).toBe(false);
    expectTypeOf<WireSimEvent["name"]>().not.toExtend<"dust.collected">();
  });
});

describe("DUST_SNAPSHOT slice", () => {
  it("is bounded by the 4,096 byte message limit", () => {
    expect(DUST_SNAPSHOT_SLICE_HEADER_BYTES).toBe(9);
    const max = DUST_MESSAGE_SLICE_MAX_BYTES - DUST_SNAPSHOT_SLICE_HEADER_BYTES;
    const slice = { sliceIndex: 0, sliceCount: 2, snapshotVersion: 7, data: new Uint8Array(max) };
    expect(DustSnapshotSliceSchema.safeParse(slice).success).toBe(true);
    expect(DustSnapshotSliceSchema.safeParse({ ...slice, data: new Uint8Array(max + 1) }).success).toBe(false);
    expect(DustSnapshotSliceSchema.safeParse({ ...slice, sliceIndex: 2 }).success).toBe(false);
    expect(DustSnapshotSliceSchema.safeParse({ ...slice, sliceCount: 0 }).success).toBe(false);
  });
});

describe("close codes against Colyseus 0.18", () => {
  it("records the foreign codes verified in node_modules and keeps ours clear of them", () => {
    expect(FOREIGN_CLOSE_CODES).toEqual({
      NORMAL_CLOSURE: 1000,
      GOING_AWAY: 1001,
      NO_STATUS_RECEIVED: 1005,
      ABNORMAL_CLOSURE: 1006,
      CONSENTED: 4000,
      SERVER_SHUTDOWN: 4001,
      WITH_ERROR: 4002,
      FAILED_TO_RECONNECT: 4003,
      MAY_TRY_RECONNECT: 4010,
    });
    for (const code of Object.values(FOREIGN_CLOSE_CODES)) {
      expect(code < CLOSE_CODE_RANGE.min || code > CLOSE_CODE_RANGE.max).toBe(true);
    }
    for (const code of Object.values(CloseCode)) {
      expect(SDK_RECONNECT_CLOSE_CODES as readonly number[]).not.toContain(code);
    }
    expect(SDK_RECONNECT_CLOSE_CODES).toEqual([1005, 1006, 1001, 4010]);
  });
});

describe("limits", () => {
  it("matches netcode sections 1, 4 and 11", () => {
    expect([DEFAULT_SIM_TICK_HZ, DEFAULT_SNAPSHOT_HZ]).toEqual([20, 10]);
    for (const [tick, snapshot] of SUPPORTED_RATE_PAIRS) expect(tick % snapshot).toBe(0);
    expect(INPUT_RATE_LIMIT_FACTORS.refill * DEFAULT_SIM_TICK_HZ).toBe(30);
    expect(INPUT_RATE_LIMIT_FACTORS.burst * DEFAULT_SIM_TICK_HZ).toBe(40);
    expect(INBOUND_MAX_BYTES).toBe(2048);
    expect(OUTBOUND_MAX_BYTES).toBe(4096);
    expect(RATE_LIMITS.control).toEqual({ perSecond: 10, burst: 20 });
    expect(RATE_LIMITS.purchase.perSecond).toBe(5);
    expect(VIOLATION_LIMIT).toEqual({ count: 50, windowS: 10 });
  });
});

describe("ShiftState Schema table", () => {
  it("lists exactly the ShiftState fields once each, in declaration order", () => {
    const names = SHIFT_STATE_SCHEMA_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(Object.keys(ShiftStateSchema.shape).sort());
    expect(names[0]).toBe("contractId");
    expectTypeOf<(typeof names)[number]>().toExtend<keyof ShiftState>();
  });

  it("uses the netcode 4.4 Schema types for the scalar fields", () => {
    const type = (name: string) => SHIFT_STATE_SCHEMA_FIELDS.find((f) => f.name === name)?.type;
    expect(type("protocolVersion")).toBe("uint16");
    expect(type("simTickHz")).toBe("uint8");
    expect(type("walletLumens")).toBe("float64");
    expect(type("shinePolished")).toBe("uint32");
    expect(type("visitedOutposts")).toBe("uint8");
    expect(type("nearParcelsCollected")).toBe("uint8");
  });

  it("v1.1 appends nearParcelsCollected last, leaving earlier field indexes unchanged", () => {
    const names = SHIFT_STATE_SCHEMA_FIELDS.map((f) => f.name);
    expect(names.indexOf("fulfilled")).toBe(16);
    expect(names.at(-1)).toBe("nearParcelsCollected");
    expect(names).toHaveLength(18);
  });

  it("nearParcelsCollected parses as an optional u8 bitmask", () => {
    const f = ShiftStateSchema.shape.nearParcelsCollected;
    expect(f.parse(undefined)).toBeUndefined();
    expect(f.parse(0b10_1011)).toBe(0b10_1011);
    expect(f.parse(0xff)).toBe(0xff);
    expect(f.safeParse(256).success).toBe(false);
    expect(f.safeParse(-1).success).toBe(false);
    expect(f.safeParse(1.5).success).toBe(false);
    expectTypeOf<ShiftState["nearParcelsCollected"]>().toEqualTypeOf<number | undefined>();
  });
});
