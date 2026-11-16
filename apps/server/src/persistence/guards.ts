// Duck-type guards so the composition root lights up durable rooms the moment packages/db's repository implements
// the ports (no change here needed), and stays on the process-memory store until then.

import type { RoomSaveRepository, UsageRepository } from "./ports";

const hasFns = (value: unknown, names: readonly string[]): boolean =>
  typeof value === "object" &&
  value !== null &&
  names.every((n) => typeof (value as Record<string, unknown>)[n] === "function");

export function isRoomSaveRepository(value: unknown): value is RoomSaveRepository {
  return hasFns(value, [
    "acquireLease",
    "renewLease",
    "releaseLease",
    "loadRoomSave",
    "commitRoomCheckpoint",
    "archiveRoomSave",
  ]);
}

export function isUsageRepository(value: unknown): value is UsageRepository {
  return hasFns(value, ["addEgress", "monthEgress"]);
}
