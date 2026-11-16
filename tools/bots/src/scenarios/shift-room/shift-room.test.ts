import { describe, expect, it } from "vitest";
import { InputBatch, decodeInput } from "@moon-cleanup/protocol";
import { PROFILES } from "../../../../netsim/src";
import { parseServerLog } from "../../reports/report";
import { BUTTON_TOOL_PRIMARY, ShiftBotCore, botPlayerId, botToken, createShiftBotMetrics, desyncCount } from "./shift-bot";
import { summarizeShift } from "./shift-room";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function collect(core: ShiftBotCore, ticks: number): Uint8Array[] {
  const bodies: Uint8Array[] = [];
  for (let i = 0; i < ticks; i++) core.tick((b) => bodies.push(b.slice()));
  return bodies;
}

describe("ShiftBotCore input wiring", () => {
  it("emits real INPUT bodies that the server codec accepts, seq strictly increasing, both walk and clean buttons", () => {
    const core = new ShiftBotCore(0, 1, 20);
    const bodies = collect(core, 600);
    expect(bodies.length).toBe(600);
    const batch = new InputBatch();
    let last = 0;
    let sawClean = false;
    let sawWalk = false;
    for (const body of bodies) {
      const msg = new Uint8Array(body.length + 1);
      msg[0] = 0x01;
      msg.set(body, 1);
      expect(decodeInput(msg, batch)).toBe(true);
      for (let i = 0; i < batch.count; i++) {
        const rec = batch.inputs[i as 0 | 1];
        expect(rec.seq).toBe(last + 1);
        last = rec.seq;
        if ((rec.buttons & BUTTON_TOOL_PRIMARY) !== 0) sawClean = true;
        else sawWalk = true;
      }
    }
    expect(sawClean && sawWalk).toBe(true);
    expect(core.metrics.inputsSent).toBe(last);
  });

  it("is reproducible per seed and differs per bot index", () => {
    const run = (index: number, seed: number) => collect(new ShiftBotCore(index, seed, 20), 200).map((b) => b.join(","));
    expect(run(2, 7)).toEqual(run(2, 7));
    expect(run(2, 7)).not.toEqual(run(3, 7));
  });

  it("counts an undecodable FRAME as a desync", () => {
    const core = new ShiftBotCore(0, 1, 20);
    core.onFrame(new Uint8Array([1, 2, 3]), 1000);
    expect(core.metrics.frameDecodeFailures).toBe(1);
    expect(core.metrics.bytes.frame).toBe(3);
    expect(desyncCount(core.metrics)).toBe(1);
  });

  it("uses stable test-only identities", () => {
    expect(botPlayerId(0)).toMatch(ID);
    expect(botPlayerId(5)).not.toBe(botPlayerId(4));
    expect(botToken(1)).toBe(`tok-${botPlayerId(1)}`);
  });
});

describe("shift-room report wiring", () => {
  it("merges harness spike-loop lines with bot desync counters", () => {
    const m1 = createShiftBotMetrics();
    const m2 = createShiftBotMetrics();
    m1.positionJumps = 2;
    m2.tickRegressions = 1;
    m2.distanceM = 100;
    const log = [
      JSON.stringify({ kind: "shift-ready", port: 1 }),
      JSON.stringify({ kind: "spike-loop", tick: { n: 10, p50: 0.1, p95: 0.2, max: 0.5 }, overruns: 0, counters: { inputsLate: 3 } }),
      JSON.stringify({ kind: "spike-loop", tick: { n: 20, p50: 0.11, p95: 0.25, max: 0.9 }, overruns: 1, counters: { inputsLate: 4 }, heapUsedMB: 50, rssMB: 100 }),
      "not json",
    ].join("\n");
    const extras = summarizeShift([m1, m2], log);
    expect(extras.desync.total).toBe(3);
    expect(extras.desync.distanceMPerBot).toBe(50);
    expect(extras.serverTickRing).toEqual({ n: 20, p50: 0.11, p95: 0.25, max: 0.9 });
    expect(extras.serverOverruns).toBe(1);
    expect(parseServerLog(log).counters).toEqual({ inputsLate: 4 });
  });

  it("netsim exposes the clean, typical, bad and coldstart profiles the scenario forwards", () => {
    for (const p of ["clean", "typical", "bad", "coldstart"] as const) expect(PROFILES[p].name).toBe(p);
    expect(PROFILES.typical).toMatchObject({ latencyMs: 120, jitterMs: 30, loss: 0.01 });
  });
});
