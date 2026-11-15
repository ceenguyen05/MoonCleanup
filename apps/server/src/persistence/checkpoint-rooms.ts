// SIGTERM checkpoint of every live room (M1-W5-T01, netcode.md 9.3 drain sequence): before the rooms are closed, every
// room writes its dirty dust chunks IN PARALLEL under one drain deadline, so a slow or hung database for one Contract
// never delays the others and the 25 s shutdown budget (app/shutdown.ts) is never the thing that stops a write.
// Rooms that miss the deadline are reported, not waited for: their `onDispose` checkpoint (which runs after this) retries
// once more, and an unwritten chunk is simply lost progress since the previous 30 s checkpoint, never a corrupt save.

/** A room as the drain sees it: an id and one awaited checkpoint. Rejects when the write did not succeed. */
export interface CheckpointableRoom {
  readonly roomId: string;
  checkpoint(): Promise<void>;
}

export interface RoomCheckpointReport {
  readonly rooms: number;
  readonly saved: number;
  readonly failed: number;
  /** Rooms whose write was still running when the deadline passed. */
  readonly timedOut: number;
  readonly ms: number;
}

/** Drain deadline of the SIGTERM checkpoint (the shutdown budget is 25 s; the room disposal and pool close follow). */
export const SHUTDOWN_CHECKPOINT_DEADLINE_MS = 10_000;

export async function checkpointRooms(
  rooms: readonly CheckpointableRoom[],
  options: { readonly deadlineMs?: number; readonly now?: () => number } = {},
): Promise<RoomCheckpointReport> {
  const deadlineMs = options.deadlineMs ?? SHUTDOWN_CHECKPOINT_DEADLINE_MS;
  const now = options.now ?? (() => performance.now());
  const start = now();
  const state = rooms.map(() => "pending" as "pending" | "saved" | "failed");
  const runs = rooms.map(async (room, i) => {
    try {
      await room.checkpoint();
      state[i] = "saved";
    } catch {
      state[i] = "failed";
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
    timer.unref?.();
  });
  try {
    await Promise.race([Promise.all(runs), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return {
    rooms: rooms.length,
    saved: state.filter((s) => s === "saved").length,
    failed: state.filter((s) => s === "failed").length,
    timedOut: state.filter((s) => s === "pending").length,
    ms: Math.round(now() - start),
  };
}
