// Solo prediction against the authoritative MoonRoomSim (the worker's sim) with the worker's input-queue rules.
// Proves the predictor models walking AND sweeping exactly when the worker consumes one input per tick, and shows
// that a starved tick (the worker repeats the last input without consuming a seq) is what produces the decimetre
// corrections seen in the browser smoke; the pump's one-input prefill keeps the queue fed.
import {
  INPUT_BUTTON_MASK,
  STANDARD_GRID_PARAMS,
  type ContractId,
  type RequestId,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { MoonRoomSim, createRoomDustLedger, toolCodeOf, type SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { describe, expect, it } from "vitest";
import { FLAT_GROUND, InputPump, InputState, SoloPredictor } from "./index";

const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: FLAT_GROUND };

function newSim(walletLm?: number): MoonRoomSim {
  const sim = new MoonRoomSim({
    data,
    world,
    ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
    contractId: "00000000-0000-4000-8000-0000000000ab" as ContractId,
    shiftType: "private",
    tickHz: 20,
    snapshotHz: 10,
    ...(walletLm === undefined ? {} : { walletLm }),
  });
  sim.addActor(0, { playerId: "p" as never, displayName: "P", role: "holder" });
  sim.onEvent(() => undefined);
  return sim;
}

/** Runs `ticks` worker ticks; `starveAt` ticks get no new input (worker repeats the last one, seq not consumed). */
function run(buttons: number, ticks: number, starveAt: ReadonlySet<number> = new Set()): number[] {
  const sim = newSim();
  const clock = { nowMs: 0 };
  const p = new SoloPredictor(sim.config, FLAT_GROUND, () => clock.nowMs);
  p.setTool(sim.toolState(0).toolCode);
  p.reconcile(sim.avatar(0), 0);
  const corrections: number[] = [];
  const queue: SimInputCommand[] = [];
  let last: SimInputCommand | null = null;
  let seq = 0;
  for (let t = 0; t < ticks; t++) {
    if (!starveAt.has(t)) {
      seq++;
      const cmd: SimInputCommand = {
        seq,
        moveX: 40,
        moveY: 127,
        yaw: (t * 300) & 0xffff,
        pitch: -30,
        buttons,
        toolParam: 200,
      };
      p.predict(cmd);
      queue.push(cmd);
    }
    const next = queue.shift();
    if (next !== undefined) last = next;
    if (last !== null) sim.applyInput(0, last);
    sim.step(sim.config.dt);
    clock.nowMs += 50;
    if (last !== null) {
      p.reconcile(sim.avatar(0), last.seq);
      corrections.push(p.stats.lastCorrectionM);
    }
  }
  return corrections;
}

describe("Solo prediction vs the worker's MoonRoomSim", () => {
  it("walking and walking + sweeping predict exactly (the tool's sweep speed is modelled)", () => {
    const walk = run(0, 120);
    const sweep = run(INPUT_BUTTON_MASK.toolPrimary, 120);
    expect(Math.max(...walk)).toBeLessThan(1e-9);
    expect(Math.max(...sweep)).toBeLessThan(1e-9);
  });

  it("Holster gating: a bought tool replaces the carried one at once; prediction follows the equipped tool", () => {
    // Detailing input (primary + secondary): the Desk Duster details (detailingSpeedMult), the Squeegee does not, so
    // the predicted walk speed depends on which tool is in the single Holster slot.
    const buttons = INPUT_BUTTON_MASK.toolPrimary | INPUT_BUTTON_MASK.toolSecondary;
    const sim = newSim(500);
    const cfg = sim.config;
    const duster = toolCodeOf(cfg, "tool.desk_duster");
    const squeegee = toolCodeOf(cfg, "tool.crescent_squeegee");
    expect(cfg.toolFeel.detailingSpeedMult).not.toBe(1);
    expect(sim.toolState(0).toolCode).toBe(duster);
    const clock = { nowMs: 0 };
    const p = new SoloPredictor(cfg, FLAT_GROUND, () => clock.nowMs);
    p.setTool(sim.toolState(0).toolCode);
    p.reconcile(sim.avatar(0), 0);
    const BUY = 40;
    const corrections: number[] = [];
    for (let t = 0; t < 120; t++) {
      const cmd: SimInputCommand = { seq: t + 1, moveX: 0, moveY: 127, yaw: 0, pitch: -30, buttons, toolParam: 200 };
      p.predict(cmd);
      if (t === BUY) {
        sim.applyIntent(0, {
          kind: "purchase",
          requestId: "00000000-0000-4000-8000-0000000000f1" as RequestId,
          itemId: "tool.crescent_squeegee",
        });
        // Auto-equip: no select_tool needed, and with one slot a select_tool for slot 1 is a no-op.
        expect(sim.toolState(0).toolCode).toBe(squeegee);
        sim.applyIntent(0, { kind: "select_tool", slot: 1 });
        expect(sim.toolState(0).toolCode).toBe(squeegee);
      }
      sim.applyInput(0, cmd);
      sim.step(cfg.dt);
      clock.nowMs += 50;
      p.reconcile(sim.avatar(0), cmd.seq);
      corrections.push(p.stats.lastCorrectionM);
      // What GameplayModule does on each shift state: the predictor takes the authoritative equipped tool.
      p.setTool(sim.toolState(0).toolCode);
    }
    // Exact before the purchase and after the tool change lands; only the purchase tick (predicted with the old tool
    // before the authoritative switch arrived) is corrected.
    // The equip starts the sim's holster swap timer (no work for holsterSwapTicks), which the predictor does not model
    // (net/predictor.ts header): a few centimetre corrections inside that window, exact again once it ends.
    const settle = BUY + cfg.holsterSwapTicks + 1;
    expect(Math.max(...corrections.slice(0, BUY))).toBeLessThan(1e-9);
    expect(corrections[BUY]!).toBeGreaterThan(1e-6);
    expect(Math.max(...corrections.slice(BUY, settle))).toBeLessThan(0.1);
    expect(Math.max(...corrections.slice(settle))).toBeLessThan(1e-9);
  });

  it("a starved worker tick (no queued input) is the decimetre correction seen in the smoke", () => {
    const c = run(INPUT_BUTTON_MASK.toolPrimary, 120, new Set([40, 80]));
    expect(Math.max(...c)).toBeGreaterThan(0.03);
  });

  it("the pump prefills one input when a sink appears, so a frame of jitter never starves the worker", () => {
    const pump = new InputPump(new InputState(), 20);
    let sent = 0;
    pump.setSink({ sendInput: () => sent++ });
    pump.update({ dt: 1 / 60, nowMs: 0 });
    expect(sent).toBe(2);
    for (let f = 1; f <= 60; f++) pump.update({ dt: 1 / 60, nowMs: f * 16.7 });
    expect(sent).toBeGreaterThanOrEqual(22); // 2 + one per tick (20 per second)
    expect(sent).toBeLessThanOrEqual(23);
  });
});

describe("pump vs the worker's real input queue under 60 fps frame jitter", () => {
  /** Render frames at about 60 fps (+-4 ms, a 40 ms hitch every 2 s) vs worker ticks at 50 ms (+-3 ms timer jitter). */
  async function starvedTicks(
    prefill: boolean,
    phaseMs: number,
  ): Promise<{ substituted: number; doubleStepped: number; consumed: number }> {
    const { InputQueue } = await import("../sim-host/input-queue");
    const q = new InputQueue();
    const pump = new InputPump(new InputState(), 20);
    let drop = prefill ? 0 : 1; // without: the prefill input never reaches the queue (no slack)
    pump.setSink({
      sendInput: (c) => {
        if (drop > 0) drop--;
        else q.push({ ...c });
      },
    });
    let s = 12345;
    const r = (): number => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    const out = { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
    let renderT = 0;
    let nextTick = 50 + phaseMs; // the worker clock starts at an arbitrary offset from the render clock
    const endMs = 60_000;
    const c0 = { ...q.counters };
    while (renderT < endMs) {
      const dt = (renderT % 2000 < 17 ? 40 : 16.7) + (r() * 8 - 4);
      renderT += dt;
      while (nextTick + (r() * 6 - 3) <= renderT) {
        q.nextForTick(out);
        nextTick += 50;
      }
      pump.update({ dt: dt / 1000, nowMs: renderT });
    }
    return {
      substituted: q.counters.substituted - c0.substituted,
      doubleStepped: q.counters.doubleStepped - c0.doubleStepped,
      consumed: q.counters.consumed - c0.consumed,
    };
  }

  it("at 60 fps with jitter and hitches the worker is never starved, for any clock phase", async () => {
    let sub = 0;
    let doubled = 0;
    let consumed = 0;
    for (let phase = 0; phase < 50; phase += 5) {
      const r = await starvedTicks(true, phase);
      sub += r.substituted;
      doubled += r.doubleStepped;
      consumed += r.consumed;
    }
    // Every worker tick (1200 per phase, minus the first) consumed a fresh input: nothing substituted or doubled.
    expect(sub).toBe(0);
    expect(doubled).toBe(0);
    expect(consumed).toBeGreaterThanOrEqual(10 * 1199);
  });
});
