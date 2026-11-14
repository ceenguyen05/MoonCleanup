import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EVENT_NAMES,
  SAVE_EVENT_NAMES,
  type ContractId,
  type EventBus,
  type EventMap,
  type SaveEventMap,
  type SaveEventName,
  type SoloCheckpointSummary,
  type Unsubscribe,
} from "../index";

const CONTRACT = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00" as ContractId;
const summary = (generation: number, originKind: "room" | "solo"): SoloCheckpointSummary => ({
  generation,
  parentGeneration: generation - 1,
  originKind,
  savedAt: "2026-11-13T12:00:00.000Z",
  simTick: 100,
  playtimeS: 60,
  shinePolished: 3,
  walletLumens: 40,
  saveFormatVersion: 1,
  gameDataVersion: "1",
});

describe("events/save v1", () => {
  it("lists exactly the keys of SaveEventMap and puts them in the catalog", () => {
    expectTypeOf<(typeof SAVE_EVENT_NAMES)[number]>().toEqualTypeOf<SaveEventName>();
    expect(new Set(SAVE_EVENT_NAMES).size).toBe(SAVE_EVENT_NAMES.length);
    for (const name of SAVE_EVENT_NAMES) {
      expect(name.startsWith("save.")).toBe(true);
      expect(EVENT_NAMES).toContain(name);
    }
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    expectTypeOf<EventMap["save.synced"]>().toEqualTypeOf<SaveEventMap["save.synced"]>();
    for (const name of ["save.checkpointed", "save.synced", "save.conflict", "save.restored"] as const) {
      expect(SAVE_EVENT_NAMES).toContain(name);
    }
  });

  it("types payloads on the bus", () => {
    const seen: string[] = [];
    const bus: Pick<EventBus, "emit" | "on"> = {
      emit: (name) => void seen.push(name),
      on: (): Unsubscribe => () => {},
    };
    bus.emit("save.checkpointed", {
      contractId: CONTRACT,
      atMs: 1,
      generation: 2,
      parentGeneration: 1,
      simTick: 40,
      reason: "timer",
      bytes: 1000,
    });
    bus.emit("save.conflict", { contractId: CONTRACT, atMs: 2, local: summary(5, "solo"), server: summary(5, "room") });
    bus.emit("save.restored", { contractId: CONTRACT, atMs: 3, generation: 6, source: "backup" });
    bus.emit("save.upload_failed", {
      contractId: CONTRACT,
      atMs: 4,
      generation: 6,
      kind: "rejected",
      reason: "bad_crc",
      retryAtMs: null,
    });
    // @ts-expect-error -- source outside SAVE_RESTORE_SOURCES
    bus.emit("save.restored", { contractId: CONTRACT, atMs: 3, generation: 6, source: "cloud" });
    // @ts-expect-error -- save events need atMs
    bus.emit("save.synced", { contractId: CONTRACT, generation: 1, flags: [] });
    expect(seen).toEqual([
      "save.checkpointed",
      "save.conflict",
      "save.restored",
      "save.upload_failed",
      "save.restored",
      "save.synced",
    ]);
  });
});
