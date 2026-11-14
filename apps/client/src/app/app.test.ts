import { describe, expect, it, vi } from "vitest";
import type { NetStatusEvent } from "@moon-cleanup/shared";
import { ClientConfigError, readClientConfig } from "./config";
import { createEventBus } from "./event-bus";
import { createServiceRegistry } from "./service-registry";
import type { ClientServices } from "./services";
import { createUiStore } from "./ui-store";

const status = (state: NetStatusEvent["state"]): NetStatusEvent => ({
  state,
  previous: null,
  closeCode: null,
  rttMs: null,
});

describe("event bus", () => {
  it("delivers synchronously in subscription order and unsubscribes", () => {
    const bus = createEventBus({ onListenerError: () => undefined });
    const seen: string[] = [];
    bus.on("net.status", (e) => seen.push(`a:${e.state}`));
    const off = bus.on("net.status", (e) => seen.push(`b:${e.state}`));
    bus.emit("net.status", status("waking"));
    off();
    off();
    bus.emit("net.status", status("connected"));
    expect(seen).toEqual(["a:waking", "b:waking", "a:connected"]);
  });

  it("reports a throwing listener and still calls the rest", () => {
    const errors: [string, unknown][] = [];
    const bus = createEventBus({ onListenerError: (name, error) => errors.push([name, error]) });
    const boom = new Error("boom");
    const after = vi.fn();
    bus.on("net.status", () => {
      throw boom;
    });
    bus.on("net.status", after);
    bus.emit("net.status", status("lost"));
    expect(errors).toEqual([["net.status", boom]]);
    expect(after).toHaveBeenCalledOnce();
  });

  it("tolerates subscribing during dispatch", () => {
    const bus = createEventBus({ onListenerError: () => undefined });
    const late = vi.fn();
    bus.on("net.status", () => {
      bus.on("net.status", late);
    });
    bus.emit("net.status", status("waking"));
    expect(late).not.toHaveBeenCalled();
    bus.emit("net.status", status("waking"));
    expect(late).toHaveBeenCalledOnce();
  });
});

describe("service registry", () => {
  it("throws with the key for duplicates and missing services", () => {
    const registry = createServiceRegistry<ClientServices>();
    const store = createUiStore();
    registry.register("uiStore", store);
    expect(registry.get("uiStore")).toBe(store);
    expect(registry.has("uiStore")).toBe(true);
    expect(registry.has("renderer")).toBe(false);
    expect(() => registry.register("uiStore", store)).toThrow(/uiStore.*already/);
    expect(() => registry.get("renderer")).toThrow(/renderer.*not registered/);
  });
});

describe("ui store", () => {
  it("applies queued actions on flush, at most 15 Hz, replacing the snapshot only on change", () => {
    const store = createUiStore(15);
    const listener = vi.fn();
    store.subscribe(listener);
    const initial = store.getState();
    store.dispatch({ type: "session.set", patch: { conn: "waking" } });
    expect(store.getState()).toBe(initial);
    expect(store.flush(1000)).toBe(true);
    expect(store.getState().session.conn).toBe("waking");
    expect(listener).toHaveBeenCalledTimes(1);

    store.dispatch({ type: "session.set", patch: { conn: "connected", rttMs: 12 } });
    expect(store.flush(1030)).toBe(false); // 30 ms later: inside the 66.7 ms window, stays queued
    expect(store.getState().session.conn).toBe("waking");
    expect(store.flush(1070)).toBe(true);
    expect(store.getState().session).toEqual({ conn: "connected", rttMs: 12, closeCode: null });

    const before = store.getState();
    store.dispatch({ type: "session.set", patch: { conn: "connected" } });
    expect(store.flush(2000)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("client config", () => {
  it("uses local defaults and reads URL flags", () => {
    const config = readClientConfig({}, "");
    expect(config).toMatchObject({
      httpUrl: "http://localhost:2567",
      wsUrl: "ws://localhost:2567",
      buildVersion: "dev",
      envLabel: "local",
      wakeAtBoot: false,
      showOverlay: true,
    });
    expect(readClientConfig({}, "?capture=1").showOverlay).toBe(false);
    expect(readClientConfig({}, "?capture=1&hud=1").showOverlay).toBe(true);
    expect(readClientConfig({}, "?hud=0").showOverlay).toBe(false);
    expect(readClientConfig({}, "?wake=1").wakeAtBoot).toBe(true);
  });

  it("rejects bad URLs with the variable name and no value", () => {
    expect(() => readClientConfig({ VITE_SERVER_HTTP_URL: "nope" }, "")).toThrow(ClientConfigError);
    expect(() => readClientConfig({ VITE_SERVER_WS_URL: "http://x.test" }, "")).toThrow(
      /VITE_SERVER_WS_URL must use ws:/,
    );
  });
});
