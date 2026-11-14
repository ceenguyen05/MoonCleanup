import type { FrameInfo, ModuleContext, ServiceTypes, UiState } from "@moon-cleanup/shared";
import { INITIAL_UI_STATE, QUALITY_PRESETS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../app/event-bus";
import { AudioModule } from "./module";
import { FakeEnv } from "./fake-audio";
import { Ducker } from "./ducking";

function makeStore(initial: UiState = INITIAL_UI_STATE as unknown as UiState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispatch: () => undefined,
    set(next: UiState) {
      state = next;
      for (const l of listeners) l();
    },
  };
}

function boot() {
  const env = new FakeEnv();
  const bus = createEventBus({
    onListenerError: (n, e) => {
      throw new Error(`${n}: ${String(e)}`);
    },
  });
  const store = makeStore();
  const services = {
    has: (k: string) => k === "uiStore" || k === "eventBus",
    get: (k: string) => (k === "uiStore" ? store : bus),
    register: () => undefined,
  };
  const mod = new AudioModule({ env });
  mod.init({ services, events: bus } as unknown as ModuleContext<ServiceTypes>);
  const frame = (t: number, dt = 1 / 60): FrameInfo =>
    ({ dt, time: t, alpha: 0, simTick: 0, quality: QUALITY_PRESETS.medium }) as unknown as FrameInfo;
  return { env, bus, store, mod, frame };
}

describe("AudioModule", () => {
  it("creates no context until a user gesture, then resumes it and starts the beds", async () => {
    const { env, mod } = boot();
    expect(env.contexts).toBe(0);
    expect(mod.diagnostics.started).toBe(false);
    env.gesture();
    await Promise.resolve();
    expect(env.contexts).toBe(1);
    expect(env.ctx.resumeCalls).toBe(1);
    expect(mod.running).toBe(true);
    expect(env.ctx.sources.length).toBeGreaterThanOrEqual(2); // suit bed + breathing
    expect(env.gestureListeners.size).toBe(0); // listeners removed once running
    env.gesture();
    expect(env.contexts).toBe(1);
  });

  it("plays cues from bus events and ignores events before the context exists", async () => {
    const { env, bus, mod } = boot();
    bus.emit("cell.full", { tick: 1 as never, actorSlot: 0, toolId: "t", cellCapGrams: 1, pourPointBearingDeg: null });
    expect(env.ctx.sources).toHaveLength(0);
    env.gesture();
    await Promise.resolve();
    const before = env.ctx.sources.length;
    bus.emit("cell.full", { tick: 2 as never, actorSlot: 0, toolId: "t", cellCapGrams: 1, pourPointBearingDeg: null });
    expect(env.ctx.sources.length).toBe(before + 1);
    expect(mod.diagnostics.voices).toBeGreaterThan(0);
  });

  it("fades and suspends when the tab hides, resumes without a click when it returns", async () => {
    const { env, mod } = boot();
    env.gesture();
    await Promise.resolve();
    env.setHidden(true);
    env.flush(1000);
    await Promise.resolve();
    expect(env.ctx.suspendCalls).toBe(1);
    expect(mod.suspendedByVisibility).toBe(true);
    env.setHidden(false);
    await Promise.resolve();
    expect(env.ctx.resumeCalls).toBeGreaterThanOrEqual(2);
    expect(mod.suspendedByVisibility).toBe(false);
  });

  it("re-arms the gesture listener when the browser interrupts the context", async () => {
    const { env } = boot();
    env.gesture();
    await Promise.resolve();
    env.ctx.state = "interrupted";
    env.ctx.onstatechange?.();
    expect(env.gestureListeners.size).toBe(1);
  });

  it("follows the UI store: volumes, panel muffle, hold music", async () => {
    const { env, store, mod } = boot();
    env.gesture();
    await Promise.resolve();
    const s = store.getState();
    store.set({ ...s, settings: { ...s.settings, volume: { ...s.settings.volume, master: 0.25 } } });
    const masterGain = env.ctx.gains[0];
    expect(masterGain?.gain.value).toBe(0.25);
    const cutoffs = (): number[] => env.ctx.filters.map((f) => f.frequency.value);
    mod.play("assay.ka_ching", { big: false });
    const base = cutoffs();
    store.set({ ...store.getState(), menus: { ...s.menus, open: "requisitions_desk" } });
    expect(cutoffs().some((c, i) => c !== base[i])).toBe(true);
  });

  it("update is cheap and rate-limited, and does nothing before the context exists", async () => {
    const { env, mod, frame } = boot();
    mod.update(frame(0)); // no throw before unlock
    env.gesture();
    await Promise.resolve();
    for (let i = 0; i < 600; i++) mod.update(frame(i / 60));
    expect(mod.diagnostics.nodes).toBeLessThan(150);
  });

  it("renders the pad in slices and starts music once it is ready", async () => {
    const { env, mod, frame } = boot();
    env.gesture();
    await Promise.resolve();
    expect(mod.diagnostics.musicSet).toBeNull();
    let t = 0;
    for (let i = 0; i < 4000 && mod.diagnostics.musicSet === null; i++) mod.update(frame((t += 1 / 30), 1 / 30));
    expect(mod.diagnostics.musicSet).toBe("day");
  });

  it("disposes everything and closes the context", async () => {
    const { env, mod } = boot();
    env.gesture();
    await Promise.resolve();
    mod.dispose();
    expect(env.ctx.closed).toBe(true);
    expect(env.gestureListeners.size).toBe(0);
    expect(env.visibilityListeners.size).toBe(0);
  });

  it("prewarm renders buffers between frames, one per scheduled step", async () => {
    const { env, mod } = boot();
    env.gesture();
    await Promise.resolve();
    const before = env.ctx.buffers.length;
    env.flush(8);
    expect(env.ctx.buffers.length).toBeGreaterThan(before);
    expect(mod.diagnostics.bufferBytes).toBeGreaterThan(0);
  });
});

describe("Ducker", () => {
  it("sums reasons, applies timed and flag ducks and only writes on change", () => {
    const writes: string[] = [];
    const d = new Ducker((bus, db) => void writes.push(`${bus}:${db}`));
    d.apply(0);
    writes.length = 0;
    d.pulse("dot", 0, 1);
    d.setFlag("panel", true);
    d.apply(0.5);
    expect(writes).toContain("music:-6");
    expect(writes).toContain("world:-9"); // dot -3 plus panel -6
    expect(writes).toContain("tools:-6");
    writes.length = 0;
    d.apply(0.6);
    expect(writes).toHaveLength(0);
    d.apply(2);
    expect(writes).toContain("music:0");
    expect(writes).toContain("world:-6");
  });
});
