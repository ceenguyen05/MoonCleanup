import { describe, expect, expectTypeOf, it } from "vitest";
import { CLOSE_CODE_RANGE, CloseCode } from "./close-codes";

describe("close codes", () => {
  it("defines the two codes M0 uses", () => {
    expect(CloseCode.PROTOCOL_MISMATCH).toBe(4100);
    expect(CloseCode.ROOM_FULL).toBe(4105);
    expectTypeOf(CloseCode.PROTOCOL_MISMATCH).toEqualTypeOf<4100>();
    expectTypeOf(CloseCode.ROOM_FULL).toEqualTypeOf<4105>();
  });

  it("matches the netcode section 12 table", () => {
    expect(CloseCode).toEqual({
      PROTOCOL_MISMATCH: 4100,
      AUTH_INVALID: 4101,
      KICKED: 4102,
      BANNED: 4103,
      RATE_LIMITED: 4104,
      ROOM_FULL: 4105,
      DUPLICATE_SESSION: 4106,
      IDLE_TIMEOUT: 4107,
      CONTRACT_UNAVAILABLE: 4108,
    });
  });

  it("has unique integer codes inside 4100-4199", () => {
    const codes = Object.values(CloseCode);
    expect(CLOSE_CODE_RANGE).toEqual({ min: 4100, max: 4199 });
    for (const code of codes) {
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThanOrEqual(CLOSE_CODE_RANGE.min);
      expect(code).toBeLessThanOrEqual(CLOSE_CODE_RANGE.max);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("exposes the union type of all codes", () => {
    expectTypeOf<CloseCode>().toEqualTypeOf<4100 | 4101 | 4102 | 4103 | 4104 | 4105 | 4106 | 4107 | 4108>();
  });
});
