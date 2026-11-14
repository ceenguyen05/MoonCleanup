import { AUDIO_EVENT_CUES, type AudioCueId, type EventMap } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../app/event-bus";
import { BIG_SALE_LM, EventRouter, SWEEP_IDLE_S, type AudioActions } from "./event-router";
import type { CuePlayParams, LoopHandle, PlayOptions } from "./player";

interface Call {
  readonly id: AudioCueId;
  readonly params: CuePlayParams;
  readonly opts: PlayOptions | undefined;
}

function harness(mySlot = 0) {
  const plays: Call[] = [];
  const loops: Call[] = [];
  const updates: Call[] = [];
  const stops: LoopHandle[] = [];
  const log: string[] = [];
  const alive = new Set<number>();
  let n = 0;
  let nowS = 10;
  const actions: AudioActions = {
    play: (id, params, opts) => {
      plays.push({ id, params: { ...params }, opts });
      return true;
    },
    startLoop: (id, params, opts) => {
      loops.push({ id, params: { ...params }, opts });
      const h = { index: n++, gen: 1 };
      alive.add(h.index);
      return h;
    },
    updateLoop: (_h, id, params, opts) => void updates.push({ id, params: { ...params }, opts }),
    stopLoop: (h) => {
      stops.push(h);
      alive.delete(h.index);
    },
    isAlive: (h) => alive.has(h.index),
    setAirborne: (a) => void log.push(`air:${String(a)}`),
    setMusicPhase: (p) => void log.push(`phase:${p}`),
    musicActivity: () => void log.push("activity"),
    musicMelody: (on) => void log.push(`melody:${String(on)}`),
    duckPulse: (r) => void log.push(`duck:${r}`),
    setDuckFlag: (r, on) => void log.push(`flag:${r}:${String(on)}`),
    mySlot: () => mySlot,
    nowS: () => nowS,
  };
  const router = new EventRouter(actions);
  const bus = createEventBus({
    onListenerError: (name, e) => {
      throw new Error(`${name}: ${String(e)}`);
    },
  });
  router.attach(bus);
  return { router, bus, plays, loops, updates, stops, log, setNow: (t: number) => (nowS = t) };
}

const base = { tick: 1 as never };
const ids = (c: Call[]): string[] => c.map((x) => x.id);

describe("event router", () => {
  it("handles exactly the events of AUDIO_EVENT_CUES", () => {
    const { router } = harness();
    expect([...router.handledEvents()].sort()).toEqual(Object.keys(AUDIO_EVENT_CUES).sort());
  });

  it("every cue the table lists for an event is reachable from that event's handler", () => {
    const h = harness();
    const slot = 0;
    const emit = <K extends keyof EventMap>(n: K, p: EventMap[K]): void => h.bus.emit(n, p);
    emit("tool.stroke_contact", {
      ...base,
      actorSlot: slot,
      toolId: "t",
      plotId: "p" as never,
      grams: 1,
      grime01: 1,
      speedMps: 2,
      dry: false,
    });
    emit("dust.collected", { ...base, actorSlot: slot, grams: 1, plotIds: [], cellGrams: 50, cellCapGrams: 100 });
    emit("cell.near_full", { ...base, actorSlot: slot, toolId: "t", cellGrams: 90, cellCapGrams: 100 });
    emit("cell.full", { ...base, actorSlot: slot, toolId: "t", cellCapGrams: 100, pourPointBearingDeg: null });
    emit("lane.locked", { ...base, actorSlot: slot, toolId: "t", headingDeg: 0 });
    emit("lane.unlocked", { ...base, actorSlot: slot, toolId: "t" });
    emit("plot.opened", { ...base, plotId: "p" as never, creditedSlot: 0 });
    emit("plot.polished", {
      ...base,
      plotId: "p" as never,
      credit: "player",
      creditedSlot: 0,
      stampLm: 1 as never,
      charged: false,
      polishedCount: 1,
    });
    emit("shine.milestone", { ...base, pct: 100, polishedCount: 1, totalPlots: 1 });
    emit("shine.milestone", { ...base, pct: 25, polishedCount: 1, totalPlots: 1 });
    emit("cargo.puck_formed", { ...base, actorSlot: slot, puckId: "x" as never });
    emit("cargo.stack_banded", { ...base, actorSlot: slot, stackId: "x" as never, pucks: 4 });
    emit("cargo.picked_up", { ...base, actorSlot: slot, cargoId: "x" as never });
    emit("cargo.thrown", { ...base, actorSlot: slot, cargoId: "x" as never });
    emit("cargo.pour_started", { ...base, actorSlot: slot, pourSlot: 1 });
    emit("cargo.sold", {
      ...base,
      source: "assay_counter",
      actorSlot: slot,
      materialId: "m",
      kg: 1,
      lm: 5 as never,
      walletLm: 5 as never,
    });
    emit("cargo.sold", {
      ...base,
      source: "receiving_gate",
      actorSlot: slot,
      materialId: "m",
      kg: 1,
      lm: 5 as never,
      walletLm: 5 as never,
    });
    emit("railshot.fired", { ...base, gateId: "g" as never, kg: 1, originPlotId: "p" as never });
    emit("purchase.completed", {
      ...base,
      actorSlot: slot,
      itemId: "i",
      level: 1,
      priceLm: 1 as never,
      walletLm: 1 as never,
    });
    emit("purchase.rejected", { ...base, actorSlot: slot, itemId: "i", reason: "insufficient_funds" });
    emit("unlock.granted", { ...base, kind: "tool", unlockId: "u", viaItemId: null });
    emit("robot.deployed", { ...base, robotId: "r" as never, kindId: "robot.sandpiper", roostId: null });
    emit("robot.state_changed", {
      ...base,
      robotId: "r" as never,
      kindId: "k",
      state: "roost_brimming",
      previous: "a",
      alert: true,
    });
    emit("robot.state_changed", {
      ...base,
      robotId: "r" as never,
      kindId: "k",
      state: "patch_picked_clean",
      previous: "a",
      alert: false,
    });
    emit("vehicle.entered", { ...base, actorSlot: slot, vehicleId: "v" as never, kindId: "vehicle.trundle", seat: 0 });
    emit("vehicle.exited", { ...base, actorSlot: slot, vehicleId: "v" as never, kindId: "vehicle.trundle" });
    emit("avatar.jumped", { ...base, actorSlot: slot });
    emit("avatar.landed", { ...base, actorSlot: slot, impactMps: 3, onClean: true });
    emit("collectible.found", {
      ...base,
      actorSlot: slot,
      kind: "stray_cargo",
      id: "c",
      lm: 1 as never,
      walletLm: 1 as never,
    });
    emit("onboarding.step_completed", { ...base, stepId: "s", index: 0, total: 1 });
    emit("achievement.unlocked", { ...base, achievementId: "a", actorSlot: 0 });
    emit("daynight.changed", { ...base, phase: "night", sunElevationDeg: -5, secondsToTerminator: 100 });
    emit("dot.message", { textId: "dot.hello", params: {}, priority: "action", keep: false });

    const played = new Set([...ids(h.plays), ...ids(h.loops)]);
    for (const cues of Object.values(AUDIO_EVENT_CUES)) {
      for (const cue of cues) {
        // The day/bridge/night music beds are started by the music director through setMusicPhase, not played as cues.
        if (cue === "music.day" || cue === "music.bridge" || cue === "music.night") continue;
        expect(played.has(cue), `cue ${cue} never played`).toBe(true);
      }
    }
    expect(h.log).toContain("phase:night");
  });

  it("maps payload details: sale size, own vs others, streaks and Railshot timing", () => {
    const h = harness(0);
    h.bus.emit("cargo.sold", {
      ...base,
      source: "assay_counter",
      actorSlot: 0,
      materialId: "m",
      kg: 1,
      lm: (BIG_SALE_LM + 1) as never,
      walletLm: 1 as never,
    });
    expect(h.plays.find((p) => p.id === "assay.ka_ching")?.params).toMatchObject({ big: true });
    h.bus.emit("purchase.rejected", { ...base, actorSlot: 3, itemId: "i", reason: "insufficient_funds" });
    expect(ids(h.plays)).not.toContain("ui.reject"); // another player's rejection is silent
    h.bus.emit("plot.polished", {
      ...base,
      plotId: "p" as never,
      credit: "player",
      creditedSlot: 0,
      stampLm: 1 as never,
      charged: true,
      polishedCount: 1,
    });
    h.setNow(20);
    h.bus.emit("plot.polished", {
      ...base,
      plotId: "p" as never,
      credit: "player",
      creditedSlot: 0,
      stampLm: 1 as never,
      charged: false,
      polishedCount: 2,
    });
    const stamps = h.plays.filter((p) => p.id === "plot.stamp");
    expect(stamps[0]?.params).toMatchObject({ streak: 1, charged: true, own: true });
    expect(stamps[1]?.params).toMatchObject({ streak: 2, own: true });
    h.bus.emit("railshot.fired", { ...base, gateId: "g" as never, kg: 1, originPlotId: "p" as never });
    expect(h.plays.find((p) => p.id === "railshot.thoom")?.opts?.delayS).toBe(2);
    expect(h.plays.find((p) => p.id === "railshot.away")?.opts?.delayS).toBeGreaterThan(2);
  });

  it("drives the sweep loop from stroke events and stops it when strokes stop", () => {
    const h = harness(0);
    const stroke = (slot: number): void =>
      h.bus.emit("tool.stroke_contact", {
        ...base,
        actorSlot: slot,
        toolId: "t",
        plotId: "p" as never,
        grams: 1,
        grime01: 0.5,
        speedMps: 2,
        dry: false,
      });
    stroke(0);
    stroke(0);
    stroke(0);
    expect(h.loops.filter((l) => l.id === "tool.sweep")).toHaveLength(1);
    expect(h.updates.filter((u) => u.id === "tool.sweep")).toHaveLength(2);
    expect(h.log).toContain("activity");
    h.setNow(10 + SWEEP_IDLE_S + 0.05);
    h.router.tick(10 + SWEEP_IDLE_S + 0.05, 0.03);
    expect(h.stops).toHaveLength(1);
    // others' tools are demoted, quieter, and capped at four individual loops
    for (let s = 1; s <= 6; s++) stroke(s);
    const others = h.loops.filter((l) => l.id === "tool.sweep" && l.opts?.other === true);
    expect(others).toHaveLength(4);
  });

  it("jump mutes the world and landing restores it", () => {
    const h = harness(0);
    h.bus.emit("avatar.jumped", { ...base, actorSlot: 0 });
    h.bus.emit("avatar.landed", { ...base, actorSlot: 0, impactMps: 12, onClean: false });
    expect(h.log).toEqual(["air:true", "air:false"]);
    expect(h.plays.find((p) => p.id === "avatar.land")?.params).toMatchObject({ impact01: 1, surface: "grime" });
  });

  it("DOT lines play the bloop then a chirp whose syllable count is stable per text", () => {
    const h = harness();
    h.bus.emit("dot.message", { textId: "dot.welcome", params: {}, priority: "progress", keep: false });
    h.bus.emit("dot.message", { textId: "dot.welcome", params: {}, priority: "progress", keep: false });
    const chirps = h.plays.filter((p) => p.id === "dot.chirp");
    expect(chirps[0]?.params).toEqual(chirps[1]?.params);
    expect(h.log.filter((l) => l === "duck:dot")).toHaveLength(2);
    expect(ids(h.plays).slice(0, 2)).toEqual(["dot.bloop", "dot.chirp"]);
  });

  it("detach stops all listening", () => {
    const h = harness();
    h.router.detach();
    h.bus.emit("cell.full", { ...base, actorSlot: 0, toolId: "t", cellCapGrams: 1, pourPointBearingDeg: null });
    expect(h.plays).toHaveLength(0);
  });
});
