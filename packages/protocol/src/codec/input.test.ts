import { INPUT_GOLDEN_VECTORS, INPUT_WIRE, type SimInputCommand } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { INPUT_MAX_BYTES, InputBatch, decodeInput, encodeInput } from "./input";
import { ALLOC_BUDGET_BYTES, allocatedBytes, randInt, rng } from "./test-util";

function randomInput(r: () => number): SimInputCommand {
  return {
    seq: randInt(r, 0, 65535),
    moveX: randInt(r, -127, 127),
    moveY: randInt(r, -127, 127),
    yaw: randInt(r, 0, 65535),
    pitch: randInt(r, -127, 127),
    buttons: randInt(r, 0, 65535),
    toolParam: randInt(r, 0, 255),
  };
}

describe("INPUT codec", () => {
  it("matches every shared golden vector both ways", () => {
    const out = new Uint8Array(INPUT_MAX_BYTES);
    const batch = new InputBatch();
    for (const v of INPUT_GOLDEN_VECTORS) {
      const [a, b] = v.payload.inputs;
      const n = encodeInput(out, a!, b);
      expect([...out.subarray(0, n)]).toEqual(v.bytes);
      expect(decodeInput(Uint8Array.from(v.bytes), batch)).toBe(true);
      expect(batch.count).toBe(v.payload.inputs.length);
      v.payload.inputs.forEach((input, i) => expect({ ...batch.inputs[i as 0 | 1] }).toEqual(input));
    }
  });

  it("round-trips 5,000 random messages", () => {
    const r = rng(5);
    const out = new Uint8Array(INPUT_MAX_BYTES);
    const batch = new InputBatch();
    for (let i = 0; i < 5000; i++) {
      const a = randomInput(r);
      const b = r() < 0.5 ? randomInput(r) : undefined;
      const n = encodeInput(out, a, b);
      expect(n).toBe(INPUT_WIRE.headerBytes + (b ? 2 : 1) * INPUT_WIRE.bytesPerInput);
      expect(decodeInput(out.subarray(0, n), batch)).toBe(true);
      expect({ ...batch.inputs[0] }).toEqual(a);
      if (b) expect({ ...batch.inputs[1] }).toEqual(b);
    }
  });

  it("rejects every wrong length, id, count and the excluded -128 values without throwing", () => {
    const r = rng(6);
    const batch = new InputBatch();
    const good = new Uint8Array(INPUT_MAX_BYTES);
    const n = encodeInput(good, randomInput(r), randomInput(r));
    for (let len = 0; len < 40; len++) {
      const m = new Uint8Array(len).fill(1);
      if (len > 0) m.set(good.subarray(0, Math.min(len, n)));
      expect(decodeInput(m, batch)).toBe(len === n);
    }
    const bad = good.slice(0, n);
    bad[0] = 0x02;
    expect(decodeInput(bad, batch)).toBe(false);
    for (const count of [0, 3, 255]) {
      const m = good.slice(0, n);
      m[1] = count;
      expect(decodeInput(m, batch)).toBe(false);
      expect(batch.count).toBe(0);
    }
    for (const at of [4, 5, 8]) {
      const m = good.slice(0, n);
      m[at] = 0x80;
      expect(decodeInput(m, batch)).toBe(false);
    }
    for (let i = 0; i < 20_000; i++) {
      const g = new Uint8Array(randInt(r, 0, 30));
      for (let k = 0; k < g.length; k++) g[k] = randInt(r, 0, 255);
      decodeInput(g, batch);
    }
  });

  it("allocates nothing per message (encode and decode, also through an offset view)", () => {
    const r = rng(8);
    const a = randomInput(r);
    const b = randomInput(r);
    const out = new Uint8Array(INPUT_MAX_BYTES + 8);
    const batch = new InputBatch();
    expect(allocatedBytes(() => encodeInput(out, a, b, 3))).toBeLessThan(ALLOC_BUDGET_BYTES);
    const view = out.subarray(3, 3 + INPUT_MAX_BYTES);
    expect(allocatedBytes(() => decodeInput(view, batch))).toBeLessThan(ALLOC_BUDGET_BYTES);
  });
});
