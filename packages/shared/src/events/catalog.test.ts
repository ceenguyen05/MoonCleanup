import { describe, expect, expectTypeOf, it } from "vitest";
import { QUALITY_PRESETS } from "../render";
import {
  EVENT_NAMES,
  NET_CONNECTION_STATES,
  QUALITY_CHANGE_SOURCES,
  type EventBus,
  type EventMap,
  type EventName,
  type NetConnectionState,
  type NetStatusEvent,
  type Unsubscribe,
} from "./catalog";

/** Minimal in-test bus, only to prove the interface is implementable and type-safe. */
function testBus(): EventBus & { count(name: EventName): number } {
  const listeners = new Map<string, Set<(payload: never) => void>>();
  return {
    emit(name, payload) {
      for (const listener of listeners.get(name) ?? []) (listener as (p: typeof payload) => void)(payload);
    },
    on(name, listener): Unsubscribe {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener as (payload: never) => void);
      return () => set.delete(listener as (payload: never) => void);
    },
    count(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}

describe("event catalog v1", () => {
  it("lists exactly the keys of EventMap", () => {
    expectTypeOf<(typeof EVENT_NAMES)[number]>().toEqualTypeOf<EventName>();
    expect(EVENT_NAMES.slice(0, 3)).toEqual(["net.status", "render.backendSelected", "quality.changed"]);
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("uses the net states of the M0 card in start order", () => {
    expect(NET_CONNECTION_STATES).toEqual(["asleep", "waking", "connecting", "connected", "lost"]);
    expectTypeOf<NetConnectionState>().toEqualTypeOf<"asleep" | "waking" | "connecting" | "connected" | "lost">();
    expect(QUALITY_CHANGE_SOURCES).toEqual(["detect", "user", "url"]);
  });

  it("delivers typed payloads and unsubscribes", () => {
    const bus = testBus();
    const seen: NetStatusEvent[] = [];
    const off = bus.on("net.status", (event) => {
      expectTypeOf(event).toEqualTypeOf<NetStatusEvent>();
      seen.push(event);
    });
    const status: NetStatusEvent = { state: "waking", previous: "asleep", closeCode: null, rttMs: null };
    bus.emit("net.status", status);
    bus.emit("quality.changed", { settings: QUALITY_PRESETS.high, previous: null, source: "detect" });
    off();
    bus.emit("net.status", { ...status, state: "connecting", previous: "waking" });
    expect(seen).toEqual([status]);
    expect(bus.count("net.status")).toBe(0);
  });

  it("rejects wrong names and payloads at compile time", () => {
    const bus = testBus();
    // @ts-expect-error -- unknown event name
    bus.emit("net.unknown", {});
    // @ts-expect-error -- payload of another event
    bus.emit("net.status", { backend: "webgpu", tier: "A", forced: false });
    // @ts-expect-error -- state outside NET_CONNECTION_STATES
    bus.emit("net.status", { state: "online", previous: null, closeCode: null, rttMs: null });
    expectTypeOf<EventMap["render.backendSelected"]["backend"]>().toEqualTypeOf<
      "webgpu" | "webgpu-compat" | "webgl2"
    >();
  });
});
