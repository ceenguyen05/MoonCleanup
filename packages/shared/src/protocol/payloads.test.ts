import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { MESSAGE_CATALOG } from "./messages";
import {
  BUILD_ID_MAX_LENGTH,
  BuildIdSchema,
  CLOSE_REASON_MAX_BYTES,
  HelloPayloadSchema,
  JoinOptionsSchema,
  PING_INTERVAL_MS,
  PING_MAX_PER_SECOND,
  PING_WIRE_BYTES,
  PingPayloadSchema,
  PONG_WIRE_BYTES,
  PongPayloadSchema,
  ProtocolMismatchInfoSchema,
  ProtocolVersionSchema,
  type HelloPayload,
  type JoinOptions,
  type PingPayload,
  type PongPayload,
  type ProtocolMismatchInfo,
} from "./payloads";
import { PING_GOLDEN_VECTORS, PONG_GOLDEN_VECTORS, type GoldenVector } from "./vectors";

/** parse -> JSON text -> parse must give the same value (what msgpack / JSON transport does to a payload). */
function roundTrip<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const first = schema.parse(value);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  expect(second).toEqual(first);
  return second;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("BuildIdSchema and ProtocolVersionSchema", () => {
  it("accepts commit SHAs, `dev` and version strings", () => {
    for (const ok of [SHA, "dev", "v0.1.0", "0.1.0+build.7", "a".repeat(BUILD_ID_MAX_LENGTH)]) {
      expect(BuildIdSchema.parse(ok)).toBe(ok);
    }
  });

  it("rejects empty, too long and non-ASCII or whitespace build ids", () => {
    for (const bad of ["", "a".repeat(BUILD_ID_MAX_LENGTH + 1), "has space", "line\nbreak", "café", '"quote"', 7]) {
      expect(BuildIdSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it("accepts u16 protocol versions only", () => {
    for (const ok of [0, 1, 0xffff]) expect(ProtocolVersionSchema.parse(ok)).toBe(ok);
    for (const bad of [-1, 0x10000, 1.5, Number.NaN, "0", null]) {
      expect(ProtocolVersionSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe("JoinOptions", () => {
  it("round-trips", () => {
    const value: JoinOptions = { protocolVersion: 0, clientBuild: SHA };
    expect(roundTrip(JoinOptionsSchema, value)).toEqual(value);
  });

  it("strips unknown keys so later versions can add fields", () => {
    expect(JoinOptionsSchema.parse({ protocolVersion: 0, clientBuild: "dev", ticket: "later" })).toEqual({
      protocolVersion: 0,
      clientBuild: "dev",
    });
  });

  it("rejects missing or malformed fields", () => {
    for (const bad of [
      {},
      { protocolVersion: 0 },
      { clientBuild: "dev" },
      { protocolVersion: "0", clientBuild: "dev" },
      { protocolVersion: -1, clientBuild: "dev" },
      { protocolVersion: 0, clientBuild: "" },
      null,
      "join",
    ]) {
      expect(JoinOptionsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("has the inferred type", () => {
    expectTypeOf<JoinOptions>().toEqualTypeOf<{ protocolVersion: number; clientBuild: string }>();
  });
});

describe("ProtocolMismatchInfo", () => {
  it("round-trips", () => {
    const value: ProtocolMismatchInfo = { serverProtocol: 3, serverBuild: SHA };
    expect(roundTrip(ProtocolMismatchInfoSchema, value)).toEqual(value);
  });

  it("always fits into a WebSocket close reason", () => {
    const largest: ProtocolMismatchInfo = { serverProtocol: 0xffff, serverBuild: "a".repeat(BUILD_ID_MAX_LENGTH) };
    const text = JSON.stringify(ProtocolMismatchInfoSchema.parse(largest));
    // BuildIdSchema allows ASCII only, so the character count is the UTF-8 byte count.
    expect(text.length).toBe(105);
    expect(text.length).toBeLessThanOrEqual(CLOSE_REASON_MAX_BYTES);
  });

  it("rejects malformed values", () => {
    for (const bad of [{}, { serverProtocol: 1 }, { serverProtocol: 1.5, serverBuild: "dev" }]) {
      expect(ProtocolMismatchInfoSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("HELLO payload", () => {
  it("round-trips at the free-tier rates and at the spike rates", () => {
    const freeTier: HelloPayload = { serverProtocol: 0, serverBuild: SHA, simTickHz: 20, snapshotHz: 10 };
    expect(roundTrip(HelloPayloadSchema, freeTier)).toEqual(freeTier);
    // The M0 spike also runs 30 / 15 and 30 / 20, so the schema must not require snapshotHz to divide simTickHz.
    for (const [simTickHz, snapshotHz] of [
      [30, 15],
      [30, 20],
      [20, 20],
    ] as const) {
      const value: HelloPayload = { serverProtocol: 0, serverBuild: "dev", simTickHz, snapshotHz };
      expect(roundTrip(HelloPayloadSchema, value)).toEqual(value);
    }
  });

  it("rejects rates outside 1-255 and non-integers", () => {
    const base = { serverProtocol: 0, serverBuild: "dev", simTickHz: 20, snapshotHz: 10 };
    for (const bad of [
      { ...base, simTickHz: 0 },
      { ...base, simTickHz: 256 },
      { ...base, snapshotHz: 0 },
      { ...base, snapshotHz: 12.5 },
      { ...base, serverBuild: "" },
      { ...base, serverProtocol: -1 },
      { serverProtocol: 0, serverBuild: "dev", simTickHz: 20 },
    ]) {
      expect(HelloPayloadSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("has the inferred type", () => {
    expectTypeOf<HelloPayload>().toEqualTypeOf<{
      serverProtocol: number;
      serverBuild: string;
      simTickHz: number;
      snapshotHz: number;
    }>();
  });
});

describe("PING and PONG payloads", () => {
  it("round-trip", () => {
    const ping: PingPayload = { clientTimeMs: 123_456 };
    const pong: PongPayload = { clientTimeMs: 123_456, serverTick: 42 };
    expect(roundTrip(PingPayloadSchema, ping)).toEqual(ping);
    expect(roundTrip(PongPayloadSchema, pong)).toEqual(pong);
  });

  it("accept the u32 bounds and reject everything outside", () => {
    expect(PingPayloadSchema.parse({ clientTimeMs: 0 })).toEqual({ clientTimeMs: 0 });
    expect(PingPayloadSchema.parse({ clientTimeMs: 0xffff_ffff })).toEqual({ clientTimeMs: 0xffff_ffff });
    for (const bad of [-1, 0x1_0000_0000, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(PingPayloadSchema.safeParse({ clientTimeMs: bad }).success, String(bad)).toBe(false);
      expect(PongPayloadSchema.safeParse({ clientTimeMs: 0, serverTick: bad }).success, String(bad)).toBe(false);
    }
    expect(PongPayloadSchema.safeParse({ clientTimeMs: 0 }).success).toBe(false);
  });

  it("have the wire sizes and rates of netcode sections 4.1, 4.2 and 11", () => {
    expect(PING_WIRE_BYTES).toBe(5);
    expect(PONG_WIRE_BYTES).toBe(9);
    expect(PING_INTERVAL_MS).toBe(2000);
    expect(PING_MAX_PER_SECOND).toBe(2);
    // One PING every 2 s must stay inside the server's rate limit.
    expect(1000 / PING_INTERVAL_MS).toBeLessThanOrEqual(PING_MAX_PER_SECOND);
  });

  it("have the inferred types", () => {
    expectTypeOf<PingPayload>().toEqualTypeOf<{ clientTimeMs: number }>();
    expectTypeOf<PongPayload>().toEqualTypeOf<{ clientTimeMs: number; serverTick: number }>();
  });
});

describe("golden vectors", () => {
  /** Reference read of the documented layout: type id in byte 0, then little-endian u32 fields. */
  function readU32Fields(vector: GoldenVector<unknown>): { id: number | undefined; fields: number[] } {
    const view = new DataView(Uint8Array.from(vector.bytes).buffer);
    const fields: number[] = [];
    for (let offset = 1; offset + 4 <= view.byteLength; offset += 4) fields.push(view.getUint32(offset, true));
    return { id: vector.bytes[0], fields };
  }

  function expectByteValues(vector: GoldenVector<unknown>): void {
    for (const byte of vector.bytes) {
      expect(Number.isInteger(byte)).toBe(true);
      expect(byte).toBeGreaterThanOrEqual(0);
      expect(byte).toBeLessThanOrEqual(0xff);
    }
  }

  it("PING vectors match the catalog id, the wire size and the little-endian layout", () => {
    expect(PING_GOLDEN_VECTORS.length).toBeGreaterThanOrEqual(3);
    for (const vector of PING_GOLDEN_VECTORS) {
      expectByteValues(vector);
      expect(vector.bytes).toHaveLength(PING_WIRE_BYTES);
      expect(PingPayloadSchema.parse(vector.payload)).toEqual(vector.payload);
      expect(readU32Fields(vector)).toEqual({ id: MESSAGE_CATALOG.PING.id, fields: [vector.payload.clientTimeMs] });
    }
  });

  it("PONG vectors match the catalog id, the wire size and the little-endian layout", () => {
    expect(PONG_GOLDEN_VECTORS.length).toBeGreaterThanOrEqual(3);
    for (const vector of PONG_GOLDEN_VECTORS) {
      expectByteValues(vector);
      expect(vector.bytes).toHaveLength(PONG_WIRE_BYTES);
      expect(PongPayloadSchema.parse(vector.payload)).toEqual(vector.payload);
      expect(readU32Fields(vector)).toEqual({
        id: MESSAGE_CATALOG.PONG.id,
        fields: [vector.payload.clientTimeMs, vector.payload.serverTick],
      });
    }
  });
});
