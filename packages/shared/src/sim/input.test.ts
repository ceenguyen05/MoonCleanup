import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CONTROL_INTENT_KINDS,
  ControlIntentSchema,
  INPUT_BUTTONS,
  INPUT_BUTTON_BIT,
  INPUT_BUTTON_MASK,
  INPUT_BUTTON_MEANING,
  INPUT_SEQUENCING,
  INPUT_WIRE,
  InputMessageSchema,
  PurchasePayloadSchema,
  SelectToolPayloadSchema,
  SimInputCommandSchema,
  type ControlIntent,
  type IntentResult,
  type SimInputCommand,
} from "./input";
import { INPUT_GOLDEN_VECTORS } from "../protocol/vectors";

const input: SimInputCommand = { seq: 1, moveX: 0, moveY: 127, yaw: 100, pitch: -5, buttons: 0, toolParam: 10 };
const REQUEST = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00";

describe("input buttons", () => {
  it("are 16 logical buttons with distinct consecutive bits, first 13 are the netcode names", () => {
    expect(INPUT_BUTTONS).toHaveLength(16);
    INPUT_BUTTONS.forEach((name, i) => {
      expect(INPUT_BUTTON_BIT[name]).toBe(i);
      expect(INPUT_BUTTON_MASK[name]).toBe(1 << i);
    });
    expect(INPUT_BUTTONS.slice(0, 13)).toEqual([
      "jump",
      "hopPack",
      "lope",
      "toolPrimary",
      "toolSecondary",
      "interact",
      "descend",
      "boost",
      "ballast",
      "lampCycle",
      "holsterNext",
      "holsterPrev",
      "seatSwitch",
    ]);
    expect(INPUT_BUTTONS).toContain("laneLock");
  });

  it("have a documented meaning in at least one context", () => {
    for (const name of INPUT_BUTTONS) {
      const m = INPUT_BUTTON_MEANING[name];
      expect(
        [m.onFoot, m.driver, m.passenger, m.build].some((v) => v !== null),
        name,
      ).toBe(true);
    }
    expect(INPUT_BUTTON_MEANING.laneLock.onFoot).toMatch(/Lane Lock/);
  });
});

describe("SimInputCommandSchema", () => {
  it("round-trips a valid input and the golden vector payloads", () => {
    expect(SimInputCommandSchema.parse(input)).toEqual(input);
    for (const vector of INPUT_GOLDEN_VECTORS) {
      expect(InputMessageSchema.parse(vector.payload)).toEqual(vector.payload);
    }
  });

  it("rejects out-of-range and non-integer fields", () => {
    for (const bad of [
      { ...input, seq: 65536 },
      { ...input, seq: -1 },
      { ...input, moveX: 128 },
      { ...input, moveX: -128 },
      { ...input, moveY: 0.5 },
      { ...input, yaw: 65536 },
      { ...input, pitch: 128 },
      { ...input, buttons: 65536 },
      { ...input, toolParam: 256 },
      { ...input, moveX: Number.NaN },
    ]) {
      expect(SimInputCommandSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("allows one or two inputs per message and no more", () => {
    expect(InputMessageSchema.safeParse({ inputs: [] }).success).toBe(false);
    expect(InputMessageSchema.safeParse({ inputs: [input, input] }).success).toBe(true);
    expect(InputMessageSchema.safeParse({ inputs: [input, input, input] }).success).toBe(false);
  });
});

describe("input wire layout and sequencing", () => {
  it("is 10 bytes per input with contiguous fields", () => {
    const fields = Object.values(INPUT_WIRE.fields);
    let offset = 0;
    for (const field of fields) {
      expect(field.offset).toBe(offset);
      offset += field.bytes;
    }
    expect(offset).toBe(INPUT_WIRE.bytesPerInput);
  });

  it("golden vectors have the length 2 + 10n", () => {
    for (const vector of INPUT_GOLDEN_VECTORS) {
      expect(vector.bytes).toHaveLength(
        INPUT_WIRE.headerBytes + INPUT_WIRE.bytesPerInput * vector.payload.inputs.length,
      );
      expect(vector.bytes[0]).toBe(INPUT_WIRE.typeId);
      expect(vector.bytes[1]).toBe(vector.payload.inputs.length);
    }
  });

  it("holds the netcode 5.1 constants", () => {
    expect(INPUT_SEQUENCING).toEqual({
      seqModulus: 65536,
      lateWindow: 1024,
      bufferAhead: 16,
      backlogDoubleStep: 4,
      maxSubstitutions: 3,
      clientRing: 64,
    });
  });
});

describe("control intents", () => {
  it("parse purchase and select_tool and reject junk", () => {
    const purchase = { kind: "purchase", requestId: REQUEST, itemId: "tool.lane_broom" } as const;
    expect(ControlIntentSchema.parse(purchase)).toEqual(purchase);
    expect(ControlIntentSchema.parse({ kind: "select_tool", slot: 5 })).toEqual({ kind: "select_tool", slot: 5 });
    expect(ControlIntentSchema.safeParse({ kind: "select_tool", slot: 6 }).success).toBe(false);
    expect(
      ControlIntentSchema.safeParse({ kind: "purchase", requestId: "nope", itemId: "tool.lane_broom" }).success,
    ).toBe(false);
    expect(ControlIntentSchema.safeParse({ kind: "purchase", requestId: REQUEST, itemId: "Tool Lane" }).success).toBe(
      false,
    );
    expect(
      ControlIntentSchema.safeParse({ kind: "purchase", requestId: REQUEST, itemId: "tool.x", quantity: 2 }).success,
    ).toBe(false);
    expect(ControlIntentSchema.safeParse({ kind: "teleport" }).success).toBe(false);
    expect(
      PurchasePayloadSchema.safeParse({ requestId: REQUEST, itemId: "node.broad_strokes", quantity: 1 }).success,
    ).toBe(true);
    expect(SelectToolPayloadSchema.safeParse({ slot: 0 }).success).toBe(true);
    expect(CONTROL_INTENT_KINDS).toEqual(["purchase", "select_tool"]);
  });

  it("have compatible static types", () => {
    const parsed = ControlIntentSchema.parse({ kind: "select_tool", slot: 1 });
    expectTypeOf(parsed.kind).toEqualTypeOf<"purchase" | "select_tool">();
    expectTypeOf<ControlIntent["kind"]>().toEqualTypeOf<"purchase" | "select_tool">();
    expectTypeOf<IntentResult>().toExtend<{ ok: boolean } | null>();
  });
});
