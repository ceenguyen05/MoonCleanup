import { describe, expect, it } from "vitest";
import { FRAME_BUF_BYTES, TOOL_TELEMETRY_OFFSET } from "./messages";
import { ToolAnimSnapshot, readToolTelemetry, writeToolTelemetry, type ToolTelemetrySource } from "./tool-telemetry";

const f = new Float64Array(1);
const b = new Uint8Array(f.buffer);

function source(over: Partial<ReturnType<ToolTelemetrySource["toolState"]>>): ToolTelemetrySource {
  const state = {
    toolCode: 1,
    wasActive: true,
    detailing: false,
    sweeping: true,
    inContact: true,
    headValid: true,
    headX: 1737400.125,
    headY: -2.5,
    headZ: 3.25,
    seqAtToolDown: 65530,
    detailCooldownMs: 0,
    ...over,
  };
  return { config: { stepMs: 50, tools: [{ periodMs: 450 }, { periodMs: 900 }] }, toolState: () => state };
}

describe("tool telemetry trailer", () => {
  it("round-trips phase (seq wrap), flags and the head position without allocating a new snapshot", () => {
    const u8 = new Uint8Array(FRAME_BUF_BYTES);
    const out = new ToolAnimSnapshot();
    // seq 4 - 65530 mod 65536 = 10 ticks * 50 ms = 500 ms of a 900 ms period
    writeToolTelemetry(u8, f, b, source({}), 0, 4);
    readToolTelemetry(u8, out, f, b);
    expect(out.valid && out.sweeping && out.inContact && out.headValid && !out.detailing).toBe(true);
    expect(out.toolCode).toBe(1);
    expect(out.periodMs).toBe(900);
    expect(out.phase01).toBeCloseTo(500 / 900, 4);
    expect(out.inputSeq).toBe(4);
    expect([out.headX, out.headY, out.headZ]).toEqual([1737400.125, -2.5, 3.25]);
    expect(out.serial).toBe(1);
  });

  it("reports nothing when the tool is idle, and invalidates on a buffer without telemetry", () => {
    const u8 = new Uint8Array(FRAME_BUF_BYTES);
    const out = new ToolAnimSnapshot();
    writeToolTelemetry(
      u8,
      f,
      b,
      source({ wasActive: false, sweeping: false, inContact: false, headValid: false }),
      0,
      9,
    );
    readToolTelemetry(u8, out, f, b);
    expect(out.valid).toBe(true);
    expect(out.sweeping || out.inContact || out.headValid || out.detailing).toBe(false);
    u8[TOOL_TELEMETRY_OFFSET] = 0;
    readToolTelemetry(u8, out, f, b);
    expect(out.valid).toBe(false);
    readToolTelemetry(new Uint8Array(16), out, f, b);
    expect(out.valid).toBe(false);
  });

  it("derives detailing phase from the disc cooldown", () => {
    const u8 = new Uint8Array(FRAME_BUF_BYTES);
    const out = new ToolAnimSnapshot();
    writeToolTelemetry(u8, f, b, source({ detailing: true, sweeping: false, detailCooldownMs: 225 }), 0, 1);
    readToolTelemetry(u8, out, f, b);
    expect(out.detailing && !out.sweeping).toBe(true);
    expect(out.phase01).toBeCloseTo(1 - 225 / 900, 4);
  });
});
