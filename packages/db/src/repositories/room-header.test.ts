import { describe, expect, it } from "vitest";
import {
  decodeRoomHeaderV0,
  decodeRoomHeaderV1,
  decodeRoomHeaderV2,
  decodeRoomHeaderV3,
  encodeRoomHeaderV2,
  encodeRoomHeaderV3,
  ROOM_HEADER_V2_MAX_BYTES,
  ROOM_HEADER_V3_MAX_BYTES,
} from "./room-header.ts";
import { ROOM_SIM_META_MAX_BYTES, ROOM_WALLET_MAX_LM } from "./room-types.ts";

const BAKE = "0f".repeat(31) + "a1";

describe("room header blob codecs", () => {
  it("round-trips v2 with every field combination", () => {
    for (const bake of [undefined, BAKE]) {
      for (const state of [
        undefined,
        { walletLm: 0 },
        { walletLm: 1234.5678 },
        { walletLm: 0, nearParcelsMask: 0 },
        { walletLm: 90, nearParcelsMask: 0b1011_0001 },
        { walletLm: ROOM_WALLET_MAX_LM, nearParcelsMask: 0xff },
      ]) {
        const blob = encodeRoomHeaderV2(bake, state);
        expect(blob.byteLength).toBeLessThanOrEqual(ROOM_HEADER_V2_MAX_BYTES);
        expect(decodeRoomHeaderV2(blob)).toEqual({ bakeHash: bake ?? null, state: state ?? null });
      }
    }
  });

  it("reads a room-v1 header (no parcel mask: the state has no nearParcelsMask) and refuses v2-only flags in it", () => {
    const v1 = encodeRoomHeaderV2(BAKE, { walletLm: 77 }); // no mask: the bytes are exactly the v1 layout
    expect(decodeRoomHeaderV1(v1)).toEqual({ bakeHash: BAKE, state: { walletLm: 77 } });
    expect(decodeRoomHeaderV1(encodeRoomHeaderV2(undefined, { walletLm: 1, nearParcelsMask: 3 }))).toBeNull();
  });

  it("rejects malformed bytes instead of guessing", () => {
    for (const decode of [decodeRoomHeaderV1, decodeRoomHeaderV2]) {
      expect(decode(new Uint8Array(0))).toBeNull();
      expect(decode(Uint8Array.of(8))).toBeNull(); // unknown flag
      expect(decode(Uint8Array.of(1, 2, 3))).toBeNull(); // length does not match flags
      const nan = new Uint8Array(9);
      nan[0] = 2;
      new DataView(nan.buffer).setFloat64(1, Number.NaN, true);
      expect(decode(nan)).toBeNull();
      const huge = new Uint8Array(9);
      huge[0] = 2;
      new DataView(huge.buffer).setFloat64(1, ROOM_WALLET_MAX_LM * 2, true); // review N4: upper bound
      expect(decode(huge)).toBeNull();
    }
    expect(decodeRoomHeaderV2(Uint8Array.of(4, 1))).toBeNull(); // mask without the wallet
  });

  it("still reads the room-v0 header", () => {
    expect(decodeRoomHeaderV0(new Uint8Array(0))).toEqual({ bakeHash: null, state: null });
    expect(decodeRoomHeaderV0(new Uint8Array(32).fill(0xab))).toEqual({ bakeHash: "ab".repeat(32), state: null });
    expect(decodeRoomHeaderV0(new Uint8Array(5))).toBeNull();
  });

  it("refuses a bad bake hash, wallet or mask at encode time", () => {
    expect(() => encodeRoomHeaderV2("XYZ", undefined)).toThrow(RangeError);
    expect(() => encodeRoomHeaderV2(undefined, { walletLm: -0.5 })).toThrow(RangeError);
    expect(() => encodeRoomHeaderV2(undefined, { walletLm: ROOM_WALLET_MAX_LM + 2 })).toThrow(RangeError);
    expect(() => encodeRoomHeaderV2(undefined, { walletLm: 1, nearParcelsMask: 256 })).toThrow(RangeError);
    expect(() => encodeRoomHeaderV2(undefined, { walletLm: 1, nearParcelsMask: 1.5 })).toThrow(RangeError);
  });

  it("round-trips v3 with the sim META section, reads v2 bytes, and keeps v2 free of the section (review N1)", () => {
    const meta = { version: 1, bytes: Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff) };
    for (const bake of [undefined, BAKE]) {
      const state = { walletLm: 420.5, nearParcelsMask: 0b101, simMeta: meta };
      const blob = encodeRoomHeaderV3(bake, state);
      expect(blob.byteLength).toBe((bake ? 33 : 1) + 8 + 1 + 4 + 300);
      const back = decodeRoomHeaderV3(blob);
      expect(back).toEqual({ bakeHash: bake ?? null, state });
      expect(back!.state!.simMeta!.bytes.buffer).not.toBe(blob.buffer); // a copy, not a view of the row buffer
      expect(decodeRoomHeaderV2(blob)).toBeNull(); // a v2 reader refuses the META flag
      // v3 without the section is the v2 layout, both ways.
      const plain = { walletLm: 3, nearParcelsMask: 1 };
      expect(encodeRoomHeaderV3(bake, plain)).toEqual(encodeRoomHeaderV2(bake, plain));
      expect(decodeRoomHeaderV3(encodeRoomHeaderV2(bake, plain))).toEqual({ bakeHash: bake ?? null, state: plain });
    }
    const max = {
      walletLm: 1,
      nearParcelsMask: 0,
      simMeta: { version: 0xffff, bytes: new Uint8Array(ROOM_SIM_META_MAX_BYTES) },
    };
    expect(encodeRoomHeaderV3(BAKE, max).byteLength).toBe(ROOM_HEADER_V3_MAX_BYTES);
    expect(() => encodeRoomHeaderV2(undefined, { walletLm: 1, nearParcelsMask: 0, simMeta: meta })).toThrow(RangeError);
  });

  it("refuses a malformed v3 META section", () => {
    const meta = { version: 2, bytes: Uint8Array.of(9, 8, 7) };
    expect(() => encodeRoomHeaderV3(undefined, { walletLm: 1, simMeta: meta })).toThrow(RangeError); // no mask
    expect(() =>
      encodeRoomHeaderV3(undefined, { walletLm: 1, nearParcelsMask: 0, simMeta: { version: 0, bytes: meta.bytes } }),
    ).toThrow(RangeError);
    expect(() =>
      encodeRoomHeaderV3(undefined, {
        walletLm: 1,
        nearParcelsMask: 0,
        simMeta: { version: 1, bytes: new Uint8Array(0) },
      }),
    ).toThrow(RangeError);
    expect(() =>
      encodeRoomHeaderV3(undefined, {
        walletLm: 1,
        nearParcelsMask: 0,
        simMeta: { version: 1, bytes: new Uint8Array(ROOM_SIM_META_MAX_BYTES + 1) },
      }),
    ).toThrow(RangeError);
    const good = encodeRoomHeaderV3(undefined, { walletLm: 1, nearParcelsMask: 0, simMeta: meta });
    expect(decodeRoomHeaderV3(good.subarray(0, good.byteLength - 1))).toBeNull(); // truncated section
    expect(decodeRoomHeaderV3(Uint8Array.of(...good, 0))).toBeNull(); // trailing byte
    const v0 = good.slice();
    v0[10] = 0; // version low byte
    v0[11] = 0;
    expect(decodeRoomHeaderV3(v0)).toBeNull();
    const noMask = Uint8Array.of(2 | 8, ...new Uint8Array(8), 1, 0, 1, 0, 5); // META flag without the mask flag
    expect(decodeRoomHeaderV3(noMask)).toBeNull();
    const zeroLen = good.slice(0, 14);
    zeroLen[12] = 0;
    zeroLen[13] = 0;
    expect(decodeRoomHeaderV3(zeroLen)).toBeNull();
  });
});
