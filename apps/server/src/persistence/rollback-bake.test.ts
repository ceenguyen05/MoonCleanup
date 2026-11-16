// Review N5: a header codec this build cannot read (rollback) must not skip the bake check. A build that stamps saves
// refuses such a Contract (the bake hash inside the newer header is unknown, and the next checkpoint would overwrite it);
// a build without a bake hash keeps the N3 behaviour (dust loads, header state reset, logged).
import { describe, expect, it, vi } from "vitest";
import { DurableShiftDustStore } from "./durable-dust-store";
import { MemoryRoomSaveRepository } from "./memory-room-repository";

const C = "0190aaaa-0000-7000-8000-000000000002";
const BAKE = "aa".repeat(32);

function repoWithUnreadableHeader(): MemoryRoomSaveRepository {
  const repo = new MemoryRoomSaveRepository();
  repo.loadRoomSave = () =>
    Promise.resolve({
      generation: 4,
      simTick: 9,
      chunks: [{ chunkId: 1, payload: new Uint8Array(8).fill(1) }],
      bakeHash: null,
      state: null,
      ignoredHeaderCodec: "room-v9",
    });
  return repo;
}

describe("unknown header codec and the bake check", () => {
  it("a stamping build refuses the Contract (save_corrupt), returns the lease and writes nothing", async () => {
    const repo = repoWithUnreadableHeader();
    const error = vi.fn();
    const a = new DurableShiftDustStore({
      repo,
      instance: "a",
      bakeHash: BAKE,
      logger: { warn: vi.fn(), error, info: vi.fn() },
    });
    await expect(a.load(C)).rejects.toMatchObject({ reason: "save_corrupt" });
    expect(repo.leaseHolder(C)).toBeNull();
    expect(repo.commits).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it("a build without a bake hash still loads the dust and logs the reset", async () => {
    const repo = repoWithUnreadableHeader();
    const warn = vi.fn();
    const a = new DurableShiftDustStore({ repo, instance: "a", logger: { warn, error: vi.fn(), info: vi.fn() } });
    expect((await a.load(C)).length).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ codec: "room-v9" }),
      expect.stringContaining("not readable"),
    );
    a.dispose();
  });
});
