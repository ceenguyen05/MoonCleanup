import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventMap, RoomHost, RoomSimEvent } from "@moon-cleanup/shared";
import { createEventBus } from "./event-bus";
import { createRoomHostService } from "./solo-host";
import { AudioBridge } from "./audio-bridge";

function host() {
  const listeners = new Set<(e: RoomSimEvent) => void>();
  const readouts = {
    vehicleMotion: null as null | {
      tick: number;
      vehicleId: number;
      kindId: string;
      speed01: number;
      load01: number;
      workIntensity01: number;
    },
  };
  const value = {
    kind: "local",
    state: "running",
    readouts,
    onEvent: (fn: (e: RoomSimEvent) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } as unknown as RoomHost;
  return {
    value,
    readouts,
    listeners,
    emit: (e: RoomSimEvent) => {
      for (const fn of listeners) fn(e);
    },
  };
}

describe("audio host bridge", () => {
  it("boot installs the host bridge and its frame pump before audio prepare/start (old boot never forwards host events)", () => {
    const source = readFileSync(new URL("./boot.ts", import.meta.url), "utf8");
    expect(source.indexOf("audioBridge.follow(roomHost)")).toBeGreaterThan(0);
    expect(source.indexOf("audioBridge.follow(roomHost)")).toBeLessThan(source.indexOf("audio?.prepare()"));
    expect(source).toContain("audioBridge.pump(frame.time * 1000)");
  });

  it("forwards real host notifications once, detaches old hosts and removes listeners on dispose", () => {
    const bus = createEventBus({
      onListenerError: (_, e) => {
        throw e;
      },
    });
    const service = createRoomHostService();
    const a = host();
    const b = host();
    const seen: unknown[] = [];
    bus.on("cell.full", (p) => seen.push(p));
    const bridge = new AudioBridge(bus, () => 0);
    bridge.follow(service);
    service.publish(a.value);
    const event = { name: "cell.full", payload: { tick: 1, actorSlot: 0 } } as RoomSimEvent;
    a.emit(event);
    expect(seen).toEqual([event.payload]);
    service.publish(b.value);
    a.emit(event);
    b.emit(event);
    expect(seen).toHaveLength(2);
    expect(a.listeners.size).toBe(0);
    bridge.dispose();
    expect(b.listeners.size).toBe(0);
    service.publish(a.value);
    expect(a.listeners.size).toBe(0);
  });

  it("seeds an already-seated host, emits speed/load/work <=10Hz, a final zero, and closes on host switch", () => {
    const bus = createEventBus({
      onListenerError: (_, e) => {
        throw e;
      },
    });
    const service = createRoomHostService();
    const a = host();
    const motions: EventMap["vehicle.motion"][] = [];
    const seats: string[] = [];
    bus.on("vehicle.motion", (p) => motions.push({ ...p }));
    bus.on("vehicle.entered", () => seats.push("enter"));
    bus.on("vehicle.exited", () => seats.push("exit"));
    service.publish(a.value);
    const bridge = new AudioBridge(bus, () => 0);
    bridge.follow(service);
    a.readouts.vehicleMotion = {
      tick: 8,
      vehicleId: 19,
      kindId: "vehicle.trundle",
      speed01: 0.5,
      load01: 0.75,
      workIntensity01: 0.5,
    };
    bridge.pump(0);
    bridge.pump(50);
    bridge.pump(100);
    expect(seats).toEqual(["enter"]);
    expect(motions).toHaveLength(2);
    expect(motions[0]).toMatchObject({ vehicleId: 19, actorSlot: 0, speed01: 0.5, load01: 0.75, workIntensity01: 0.5 });
    a.readouts.vehicleMotion.speed01 = a.readouts.vehicleMotion.workIntensity01 = 0;
    bridge.pump(200);
    bridge.pump(300);
    expect(motions).toHaveLength(3);
    expect(motions[2]).toMatchObject({ speed01: 0, load01: 0, workIntensity01: 0 });
    a.readouts.vehicleMotion.speed01 = 0.4;
    bridge.pump(400);
    service.publish(null);
    expect(motions.at(-1)).toMatchObject({ speed01: 0, workIntensity01: 0 });
    expect(seats).toEqual(["enter", "exit"]);
    bridge.dispose();
    expect(seats).toHaveLength(2);
  });

  it("a stale readout cannot undo an enter or resurrect a seat after the exit notification", () => {
    const bus = createEventBus({
      onListenerError: (_, e) => {
        throw e;
      },
    });
    const service = createRoomHostService();
    const a = host();
    service.publish(a.value);
    const seats: string[] = [];
    bus.on("vehicle.entered", () => seats.push("enter"));
    bus.on("vehicle.exited", () => seats.push("exit"));
    const bridge = new AudioBridge(bus, () => 0);
    bridge.follow(service);
    a.emit({
      name: "vehicle.entered",
      payload: { tick: 10, actorSlot: 0, vehicleId: 19, kindId: "vehicle.trundle", seat: 0 },
    } as RoomSimEvent);
    bridge.pump(0); // old null before the first seated sample
    expect(seats).toEqual(["enter"]);
    a.readouts.vehicleMotion = {
      tick: 10,
      vehicleId: 19,
      kindId: "vehicle.trundle",
      speed01: 0.5,
      load01: 0,
      workIntensity01: 0.5,
    };
    bridge.pump(100);
    a.emit({
      name: "vehicle.exited",
      payload: { tick: 11, actorSlot: 0, vehicleId: 19, kindId: "vehicle.trundle" },
    } as RoomSimEvent);
    bridge.pump(200); // exit event arrived before the replacement readout
    expect(seats).toEqual(["enter", "exit"]);
    bridge.dispose();
  });
});
