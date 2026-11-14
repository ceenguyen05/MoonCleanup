import { describe, expect, expectTypeOf, it } from "vitest";
import type { EntityId, PlotId } from "../ids";
import type { Lumens, Tick } from "../units";
import { EVENT_NAMES, type EventBus, type EventMap, type EventName } from "./catalog";
import {
  DAY_PHASES,
  DOT_PRIORITIES,
  PARKED_EVENT_NAMES,
  PLOT_CREDITS,
  PRESENTATION_EVENT_NAMES,
  PURCHASE_REJECT_REASONS,
  SALE_SOURCES,
  SHINE_MILESTONE_PCTS,
  SIM_EVENT_NAMES,
  UNLOCK_KINDS,
  type PlotPolishedEvent,
  type PresentationEventMap,
  type SimEventBase,
  type SimEventMap,
} from "./gameplay";
import { SAVE_EVENT_NAMES } from "./save";

/** Event names the MVP card and game-feel section 7 require, spelled exactly as written there. */
const REQUIRED_SIM = [
  "dust.collected",
  "plot.opened",
  "plot.polished",
  "cargo.sold",
  "purchase.completed",
  "unlock.granted",
  "vehicle.entered",
  "achievement.unlocked",
  "review.reached",
] as const;

describe("gameplay event catalog v1", () => {
  it("contains every event the M1-W0-T03 card names", () => {
    for (const name of REQUIRED_SIM) expect(SIM_EVENT_NAMES).toContain(name);
  });

  it("lists exactly the keys of SimEventMap and PresentationEventMap, with no overlap", () => {
    expectTypeOf<(typeof SIM_EVENT_NAMES)[number]>().toEqualTypeOf<keyof SimEventMap>();
    expectTypeOf<(typeof PRESENTATION_EVENT_NAMES)[number]>().toEqualTypeOf<keyof PresentationEventMap>();
    expect(new Set(SIM_EVENT_NAMES).size).toBe(SIM_EVENT_NAMES.length);
    expect(new Set(PRESENTATION_EVENT_NAMES).size).toBe(PRESENTATION_EVENT_NAMES.length);
    for (const name of SIM_EVENT_NAMES) expect(PRESENTATION_EVENT_NAMES as readonly string[]).not.toContain(name);
  });

  it("puts every event into EVENT_NAMES exactly once", () => {
    expectTypeOf<(typeof EVENT_NAMES)[number]>().toEqualTypeOf<EventName>();
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    expect(EVENT_NAMES.length).toBe(
      3 + SIM_EVENT_NAMES.length + PRESENTATION_EVENT_NAMES.length + SAVE_EVENT_NAMES.length,
    );
  });

  it("names every event <domain>.<name> in lower snake case", () => {
    for (const name of EVENT_NAMES) expect(name).toMatch(/^[a-z]+\.[a-zA-Z][a-zA-Z_]*$/);
  });

  it("gives every sim event the tick field", () => {
    expectTypeOf<SimEventMap[keyof SimEventMap]>().toExtend<SimEventBase>();
    expectTypeOf<SimEventBase["tick"]>().toEqualTypeOf<Tick>();
  });

  it("marks review.reached as parked", () => {
    expect(PARKED_EVENT_NAMES).toEqual(["review.reached"]);
  });

  it("has the enum lists of the specification", () => {
    expect(SHINE_MILESTONE_PCTS).toEqual([1, 5, 10, 25, 50, 75, 100]);
    expect(SALE_SOURCES).toEqual(["assay_counter", "receiving_gate", "roost_uplink"]);
    expect(PLOT_CREDITS).toEqual(["player", "flock"]);
    expect(DAY_PHASES).toEqual(["day", "dusk", "night", "dawn"]);
    expect(DOT_PRIORITIES).toEqual(["action", "progress", "ambient"]);
    expect(UNLOCK_KINDS).toContain("vehicle");
    expect(PURCHASE_REJECT_REASONS).toContain("insufficient_funds");
  });

  it("types payloads through the bus", () => {
    const emitted: EventName[] = [];
    const bus: Pick<EventBus, "emit"> = { emit: (name) => void emitted.push(name) };
    const polished: PlotPolishedEvent = {
      tick: 120,
      plotId: 41_207 as PlotId,
      credit: "player",
      creditedSlot: 0,
      stampLm: 88 as Lumens,
      charged: false,
      polishedCount: 1,
    };
    bus.emit("plot.polished", polished);
    bus.emit("vehicle.entered", {
      tick: 130,
      actorSlot: 0,
      vehicleId: 7 as EntityId,
      kindId: "vehicle.trundle",
      seat: 0,
    });
    // @ts-expect-error -- credit outside PLOT_CREDITS
    bus.emit("plot.polished", { ...polished, credit: "robot" });
    // @ts-expect-error -- payload of another event
    bus.emit("cargo.sold", polished);
    expect(emitted).toEqual(["plot.polished", "vehicle.entered", "plot.polished", "cargo.sold"]);
    expectTypeOf<EventMap["cargo.sold"]["source"]>().toEqualTypeOf<
      "assay_counter" | "receiving_gate" | "roost_uplink"
    >();
  });
});
