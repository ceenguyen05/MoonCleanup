import { describe, expect, expectTypeOf, it } from "vitest";
import {
  LOCAL_CHECKPOINT_REASONS,
  LocalCheckpointMetaSchema,
  ROOM_HOST_CLOSE_REASONS,
  ROOM_HOST_KINDS,
  ROOM_HOST_STATES,
  SERVICE_KEYS,
  type ContractId,
  type ControlIntent,
  type LocalCheckpointMeta,
  type LocalRoomHost,
  type RemoteRoomHost,
  type RoomHost,
  type RoomHostFrame,
  type RoomHostService,
  type RoomHostState,
  type RoomSimEvent,
  type ServiceTypes,
  type ShiftStateView,
  type SimInputCommand,
  type Tick,
  type Unsubscribe,
} from "../index";

const CONTRACT = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00";

describe("client/room-host v1", () => {
  it("lists kinds, states and reasons from ADR-0031 in a stable order", () => {
    expect(ROOM_HOST_KINDS).toEqual(["local", "remote"]);
    expect(ROOM_HOST_STATES).toEqual(["booting", "loading", "running", "paused", "suspended", "closed", "failed"]);
    expect(ROOM_HOST_CLOSE_REASONS).toEqual([
      "clock_out",
      "open_to_friends",
      "return_to_solo",
      "conflict_resolved",
      "error",
    ]);
    expect(LOCAL_CHECKPOINT_REASONS).toEqual(["timer", "hidden", "pause", "clock_out", "handoff"]);
  });

  it("narrows RoomHost by kind and keeps the variants apart", () => {
    const describeHost = (host: RoomHost): string => {
      if (host.kind === "local") {
        expectTypeOf(host).toEqualTypeOf<LocalRoomHost>();
        return `local g${host.generation}`;
      }
      expectTypeOf(host).toEqualTypeOf<RemoteRoomHost>();
      return `remote ${host.roomId}`;
    };
    expectTypeOf(describeHost).parameter(0).toEqualTypeOf<RoomHost>();
    expectTypeOf<LocalRoomHost>().not.toExtend<RemoteRoomHost>();
    expectTypeOf<RemoteRoomHost["rttMs"]>().toEqualTypeOf<number | null>();
    expectTypeOf<LocalRoomHost["checkpoint"]>().returns.toEqualTypeOf<Promise<LocalCheckpointMeta>>();
    expectTypeOf<RoomHost["sendInput"]>().parameter(0).toEqualTypeOf<SimInputCommand>();
    expectTypeOf<RoomHost["sendIntent"]>().parameter(0).toEqualTypeOf<ControlIntent>();
    expectTypeOf<RoomHost["onStateChange"]>().returns.toEqualTypeOf<Unsubscribe>();
    expectTypeOf<ShiftStateView["tick"]>().toEqualTypeOf<Tick>();
    expectTypeOf<RoomSimEvent["name"]>().toBeString();
    // @ts-expect-error -- a remote host has no local checkpoint
    const bad: RemoteRoomHost["checkpoint"] = undefined;
    expect(bad).toBeUndefined();
  });

  it("is implementable by a plain object (a fake local host)", async () => {
    const states: RoomHostState[] = [];
    const listeners = new Set<(s: RoomHostState) => void>();
    let state: RoomHostState = "booting";
    const emit = (s: RoomHostState): void => {
      state = s;
      for (const l of listeners) l(s);
    };
    const checkpoint: LocalRoomHost["checkpoint"] = (reason) =>
      Promise.resolve({
        contractId: CONTRACT as ContractId,
        generation: reason === "handoff" ? 4 : 3,
        parentGeneration: 2,
        simTick: 100,
        savedAtMs: 1,
        bytes: 10,
      });
    const host: LocalRoomHost = {
      kind: "local",
      contractId: CONTRACT as ContractId,
      simTickHz: 20,
      get state() {
        return state;
      },
      generation: 3,
      sendInput() {},
      sendIntent() {},
      onFrame: () => () => {},
      onShiftState: () => () => {},
      onEvent: () => () => {},
      onStateChange(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      checkpoint,
      pause: () => emit("paused"),
      suspend: () => {
        emit("suspended");
        return checkpoint("handoff");
      },
      resume: () => emit("running"),
      close: () => Promise.resolve(),
    };
    host.onStateChange((s) => states.push(s));
    host.pause();
    const meta = await host.suspend();
    host.resume();
    expect(states).toEqual(["paused", "suspended", "running"]);
    expect(meta.generation).toBe(4);
    expect(host.state).toBe("running");
  });

  it("releases a pooled frame", () => {
    let released = 0;
    const frame: RoomHostFrame = {
      tick: 5,
      ackInputSeq: 9,
      bytes: new ArrayBuffer(8),
      byteLength: 6,
      release() {
        released += 1;
      },
    };
    frame.release();
    expect(released).toBe(1);
    expectTypeOf(frame.bytes).toEqualTypeOf<ArrayBuffer>();
  });

  it("registers the roomHost service as a stable facade", () => {
    expect(SERVICE_KEYS).toContain("roomHost");
    expectTypeOf<ServiceTypes["roomHost"]>().toEqualTypeOf<RoomHostService>();
    expectTypeOf<RoomHostService["current"]>().toEqualTypeOf<RoomHost | null>();
  });

  it("parses and round-trips LocalCheckpointMeta", () => {
    const meta = {
      contractId: CONTRACT,
      generation: 7,
      parentGeneration: 6,
      simTick: 12_000,
      savedAtMs: 1_763_000_000_000,
      bytes: 250_000,
    };
    const parsed = LocalCheckpointMetaSchema.parse(meta);
    expect(parsed).toEqual(meta);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(meta);
    expectTypeOf(parsed).toExtend<LocalCheckpointMeta>();
    expect(LocalCheckpointMetaSchema.safeParse({ ...meta, generation: 0 }).success).toBe(false);
    expect(LocalCheckpointMetaSchema.safeParse({ ...meta, contractId: "nope" }).success).toBe(false);
    expect(LocalCheckpointMetaSchema.safeParse({ ...meta, bytes: 0 }).success).toBe(false);
  });
});
