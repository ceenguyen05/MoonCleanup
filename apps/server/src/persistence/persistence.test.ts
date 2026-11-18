// Durability layer tests (M1-W5-T01): lease CAS, renewal, lease loss, strict restore, outage backoff, persisted egress.
// Fake timers drive both the "database clock" and the link clock (Date), so no test sleeps.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TERRAIN_BAKE_HASH } from "@moon-cleanup/world";
import { BandwidthCounter } from "../ops/bandwidth";
import { DurableShiftDustStore, LEASE_RENEW_INTERVAL_MS } from "./durable-dust-store";
import { MemoryRoomSaveRepository } from "./memory-room-repository";
import { checkpointRooms } from "./checkpoint-rooms";
import { ContractUnavailableError, RoomSaveCorruptError } from "./ports";
import { StorageLink } from "./storage-link";
import { UsagePersister, dayKeyUtc } from "./usage-persister";

const C = "0190aaaa-0000-7000-8000-000000000001";
const payload = (n: number): Uint8Array => new Uint8Array(64).fill(n);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function store(repo: MemoryRoomSaveRepository, instance: string): DurableShiftDustStore {
  return new DurableShiftDustStore({ repo, instance });
}

describe("lease", () => {
  it("is exclusive across instances and frees on release", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    const b = store(repo, "b");
    await a.ensureLease(C);
    await expect(b.ensureLease(C)).rejects.toMatchObject({ reason: "busy" });
    expect(a.holdsLease(C)).toBe(true);
    await a.release(C);
    await b.ensureLease(C);
    expect(repo.leaseHolder(C)?.instance).toBe("b");
    a.dispose();
    b.dispose();
  });

  it("is taken over by another instance once it expired without renewal", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    await a.ensureLease(C);
    a.dispose(); // crashed instance: no renewal
    vi.setSystemTime(Date.now() + 36_000);
    const b = store(repo, "b");
    await b.ensureLease(C);
    expect(repo.leaseHolder(C)?.instance).toBe("b");
    b.dispose();
  });

  it("is renewed every 10 s while the room lives", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    await a.ensureLease(C);
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS * 6); // 60 s: far past one 35 s expiry
    expect(repo.leaseHolder(C)?.instance).toBe("a");
    expect(a.holdsLease(C)).toBe(true);
    a.dispose();
  });

  it("a renewal that finds another owner stops writes and fires the 4108 listener", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    await a.ensureLease(C);
    const lost = vi.fn();
    a.onLeaseLost(C, lost);
    // Simulate the database clock jumping (a long stall): the lease expired and b took it.
    repo.offline = true;
    vi.setSystemTime(Date.now() + 40_000);
    repo.offline = false;
    await store(repo, "b").ensureLease(C);
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(a.holdsLease(C)).toBe(false);
    await expect(a.save(C, [{ chunkId: 1, payload: payload(1) }], 5)).rejects.toMatchObject({ reason: "lease_lost" });
    expect(repo.commits).toBe(0);
    a.dispose();
  });

  it("a checkpoint that finds the lease gone reports lease_lost and writes nothing", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    await a.ensureLease(C);
    const lost = vi.fn();
    a.onLeaseLost(C, lost);
    // b takes the lease behind a's back (a's renewal has not run yet).
    vi.setSystemTime(Date.now() + 36_000);
    await store(repo, "b").ensureLease(C);
    await expect(a.save(C, [{ chunkId: 2, payload: payload(2) }], 9)).rejects.toBeInstanceOf(ContractUnavailableError);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(repo.commits).toBe(0);
    a.dispose();
  });

  it("unreachable renewals are not a loss: the room keeps its lease when the database returns", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    await a.ensureLease(C);
    const lost = vi.fn();
    a.onLeaseLost(C, lost);
    repo.offline = true;
    await vi.advanceTimersByTimeAsync(20_000);
    repo.offline = false;
    await vi.advanceTimersByTimeAsync(40_000); // backoff elapses, renewal succeeds (nobody took the lease)
    expect(lost).not.toHaveBeenCalled();
    expect(a.holdsLease(C)).toBe(true);
    a.dispose();
  });
});

describe("restore and save", () => {
  it("round-trips chunks through a new store (room restart)", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    expect(await a.load(C)).toEqual([]);
    await a.save(
      C,
      [
        { chunkId: 7, payload: payload(7) },
        { chunkId: 3, payload: payload(3) },
      ],
      100,
    );
    await a.save(C, [{ chunkId: 7, payload: payload(9) }], 200);
    await a.release(C);
    const b = store(repo, "b");
    const chunks = await b.load(C);
    expect(chunks.map((c) => c.chunkId)).toEqual([3, 7]);
    expect(Array.from(chunks[1]!.payload)).toEqual(Array.from(payload(9)));
    a.dispose();
    b.dispose();
  });

  it("round-trips the room state (wallet) through the header, also on a header-only checkpoint", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    await a.load(C);
    expect(await a.loadState(C)).toBeNull(); // never saved
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 10, { walletLm: 50 });
    await a.save(C, [], 20, { walletLm: 75.5 }); // wallet changed, no dirty chunk
    await a.release(C);
    const b = store(repo, "b");
    expect((await b.load(C)).map((c) => c.chunkId)).toEqual([1]);
    expect(await b.loadState(C)).toEqual({ walletLm: 75.5 });
    expect(await b.loadState(C)).toBeNull(); // one-shot
    a.dispose();
    b.dispose();
  });

  it("strict: an unreachable database refuses the room (storage_down) and returns the lease", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    expect(a.strict).toBe(true);
    await a.load(C);
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 1);
    await a.release(C);
    const b = store(repo, "b");
    const original = repo.loadRoomSave.bind(repo);
    repo.loadRoomSave = () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNRESET" }));
    await expect(b.load(C)).rejects.toMatchObject({ reason: "storage_down" });
    // The link is down after that failure, so the release is skipped and the lease simply expires (35 s) on its own.
    expect(b.link.isDown).toBe(true);
    repo.loadRoomSave = original;
    vi.setSystemTime(Date.now() + 31_000); // past the link backoff
    expect((await b.load(C)).length).toBe(1);
    a.dispose();
    b.dispose();
  });

  it("a corrupt save refuses the room as save_corrupt", async () => {
    const repo = new MemoryRoomSaveRepository();
    repo.loadRoomSave = () => Promise.reject(new ContractUnavailableError("save_corrupt"));
    const a = store(repo, "a");
    await expect(a.load(C)).rejects.toMatchObject({ reason: "save_corrupt" });
    expect(repo.leaseHolder(C)).toBeNull();
    a.dispose();
  });

  it("a failed save rejects (the room keeps its chunks dirty) and the next one succeeds", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    await a.load(C);
    repo.offline = true;
    await expect(a.save(C, [{ chunkId: 1, payload: payload(1) }], 1)).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(a.link.isDown).toBe(true);
    repo.offline = false;
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 2);
    expect(a.link.isDown).toBe(false);
    expect(repo.commits).toBe(1);
    a.dispose();
  });

  it("new rooms are refused without touching the database while the link backs off", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = store(repo, "a");
    repo.offline = true;
    await expect(a.ensureLease(C)).rejects.toMatchObject({ reason: "storage_down" });
    const spy = vi.spyOn(repo, "acquireLease");
    await expect(a.ensureLease(C)).rejects.toMatchObject({ reason: "storage_down" });
    expect(spy).not.toHaveBeenCalled(); // inside the 1 s backoff
    repo.offline = false;
    vi.setSystemTime(Date.now() + 1_100);
    await a.ensureLease(C);
    a.dispose();
  });
});

describe("corrupt saves and the bake hash", () => {
  const BAKE_A = "aa".repeat(32);
  const BAKE_B = "bb".repeat(32);

  it("maps RoomSaveCorruptError to save_corrupt without counting a database outage", async () => {
    const repo = new MemoryRoomSaveRepository();
    repo.loadRoomSave = () => Promise.reject(new RoomSaveCorruptError("chunk 5 has no valid version"));
    const a = store(repo, "a");
    await expect(a.load(C)).rejects.toMatchObject({ reason: "save_corrupt" });
    expect(a.link.isDown).toBe(false); // the database answered
    expect(repo.leaseHolder(C)).toBeNull(); // the lease went back
    a.dispose();
  });

  it("writes the bake hash with every checkpoint and loads a save of the same bake", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = new DurableShiftDustStore({ repo, instance: "a", bakeHash: BAKE_A });
    await a.load(C);
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 10);
    expect((await repo.loadRoomSave(C))!.bakeHash).toBe(BAKE_A);
    await a.release(C);
    const b = new DurableShiftDustStore({ repo, instance: "b", bakeHash: BAKE_A });
    expect((await b.load(C)).length).toBe(1);
    a.dispose();
    b.dispose();
  });

  it("archives a save written for another bake (kept recoverable) and starts a fresh room, lease kept", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = new DurableShiftDustStore({ repo, instance: "a", bakeHash: BAKE_A });
    await a.load(C);
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 10, { walletLm: 77, nearParcelsMask: 3 });
    await a.release(C);
    const warn = vi.fn();
    const other = new DurableShiftDustStore({
      repo,
      instance: "b",
      bakeHash: BAKE_B,
      logger: { warn, error: vi.fn(), info: vi.fn() },
    });
    expect(await other.load(C)).toEqual([]); // fresh room: no chunks
    expect(await other.loadState(C)).toBeNull(); // and no old wallet/parcels/gear
    expect(other.counters.archives).toBe(1);
    expect(await other.takeArchived(C)).toBe(true); // the room's HELLO flag (saveArchived), one-shot
    expect(await other.takeArchived(C)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ contractId: C }), expect.stringContaining("archived"));
    // The old world is archived verbatim, never deleted.
    expect(repo.archives).toHaveLength(1);
    expect(repo.archives[0]).toMatchObject({ contractId: C, reason: "bake_mismatch", bakeHash: BAKE_A, generation: 1 });
    expect(repo.archives[0]!.state).toEqual({ walletLm: 77, nearParcelsMask: 3 });
    expect([...repo.archives[0]!.chunks.keys()]).toEqual([1]);
    expect(await repo.loadRoomSave(C)).toBeNull();
    expect(other.holdsLease(C)).toBe(true);
    // The fresh room's first checkpoint stamps the new bake and loads cleanly afterwards.
    await other.save(C, [{ chunkId: 2, payload: payload(2) }], 5);
    expect((await repo.loadRoomSave(C))!.bakeHash).toBe(BAKE_B);
    await other.release(C);
    const again = new DurableShiftDustStore({ repo, instance: "c", bakeHash: BAKE_B });
    expect((await again.load(C)).map((c) => c.chunkId)).toEqual([2]);
    expect(repo.archives).toHaveLength(1); // a matching bake archives nothing more
    a.dispose();
    other.dispose();
    again.dispose();
  });

  it("does not archive when the database is down during the archive step: the room is refused, the save stays", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = new DurableShiftDustStore({ repo, instance: "a", bakeHash: BAKE_A });
    await a.load(C);
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 10);
    await a.release(C);
    repo.archiveRoomSave = () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNRESET" }));
    const other = new DurableShiftDustStore({ repo, instance: "b", bakeHash: BAKE_B });
    await expect(other.load(C)).rejects.toMatchObject({ reason: "storage_down" });
    expect(repo.archives).toHaveLength(0);
    expect((await repo.loadRoomSave(C))!.bakeHash).toBe(BAKE_A); // still the original world
    expect(other.holdsLease(C)).toBe(false); // the failed room does not keep the lease (it expires on its own)
    a.dispose();
    other.dispose();
  });

  it("stamps the real TERRAIN_BAKE_HASH: a save of that bake restores unchanged, any other bake is archived", async () => {
    const real = TERRAIN_BAKE_HASH;
    const stale = real.replace(/^./, real.startsWith("0") ? "1" : "0"); // a re-bake changed one nibble
    const repo = new MemoryRoomSaveRepository();
    const a = new DurableShiftDustStore({ repo, instance: "a", bakeHash: real });
    await a.load(C);
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 10);
    await a.release(C);
    expect((await repo.loadRoomSave(C))!.bakeHash).toBe(real);

    // Match: loads unchanged, nothing archived.
    const current = new DurableShiftDustStore({ repo, instance: "c", bakeHash: real });
    expect((await current.load(C)).length).toBe(1);
    expect(repo.archives).toHaveLength(0);
    await current.release(C);

    // Mismatch: archived, fresh start.
    const staleServer = new DurableShiftDustStore({ repo, instance: "b", bakeHash: stale });
    expect(await staleServer.load(C)).toEqual([]);
    expect(repo.archives).toHaveLength(1);
    expect(repo.archives[0]!.bakeHash).toBe(real);
    expect(repo.commits).toBe(1); // nothing was written over the real save: it was moved, not overwritten
    expect(staleServer.counters.archives).toBe(1);
    a.dispose();
    staleServer.dispose();
    current.dispose();
  });

  it("does not count the 'nothing to archive' outcome in the archives counter", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = new DurableShiftDustStore({ repo, instance: "a", bakeHash: BAKE_A });
    await a.load(C);
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 10);
    await a.release(C);
    const b = new DurableShiftDustStore({ repo, instance: "b", bakeHash: BAKE_B });
    repo.archiveRoomSave = () => Promise.resolve({ kind: "nothing" } as never);
    expect(await b.load(C)).toEqual([]);
    expect(b.counters.archives).toBe(0);
    a.dispose();
    b.dispose();
  });

  it("loads a legacy save that recorded no bake hash (v0/v1 era) unchanged and archives nothing", async () => {
    const repo = new MemoryRoomSaveRepository();
    const legacy = store(repo, "a"); // no bakeHash: its checkpoints record none, like a pre-stamp header
    await legacy.load(C);
    await legacy.save(C, [{ chunkId: 1, payload: payload(1) }], 10);
    await legacy.release(C);
    expect((await repo.loadRoomSave(C))!.bakeHash).toBeNull();
    const stamped = new DurableShiftDustStore({ repo, instance: "b", bakeHash: BAKE_B });
    expect((await stamped.load(C)).length).toBe(1);
    expect(repo.archives).toHaveLength(0);
    legacy.dispose();
    stamped.dispose();
  });

  it("checks nothing while the server world has no bake hash", async () => {
    const repo = new MemoryRoomSaveRepository();
    const a = new DurableShiftDustStore({ repo, instance: "a", bakeHash: BAKE_A });
    await a.load(C);
    await a.save(C, [{ chunkId: 1, payload: payload(1) }], 10);
    await a.release(C);
    const unbaked = store(repo, "b");
    expect((await unbaked.load(C)).length).toBe(1);
    a.dispose();
    unbaked.dispose();
  });
});

describe("checkpointRooms (SIGTERM drain)", () => {
  const room = (roomId: string, run: () => Promise<void>) => ({ roomId, checkpoint: run });

  it("checkpoints every room in parallel and counts saved, failed and timed out", async () => {
    const order: string[] = [];
    const rooms = [
      room("ok1", async () => {
        order.push("ok1");
      }),
      room("slow", () => new Promise<void>((resolve) => setTimeout(() => (order.push("slow"), resolve()), 500))),
      room("bad", () => Promise.reject(new Error("db down"))),
      room("hung", () => new Promise<void>(() => undefined)),
    ];
    const run = checkpointRooms(rooms, { deadlineMs: 2_000 });
    await vi.advanceTimersByTimeAsync(600);
    expect(order).toEqual(["ok1", "slow"]); // all started together: "slow" did not block the others
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await run).toMatchObject({ rooms: 4, saved: 2, failed: 1, timedOut: 1 });
  });

  it("returns at the deadline even when every room hangs", async () => {
    const run = checkpointRooms([room("a", () => new Promise<void>(() => undefined))], { deadlineMs: 1_000 });
    await vi.advanceTimersByTimeAsync(999);
    let done = false;
    void run.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await run).toMatchObject({ rooms: 1, saved: 0, timedOut: 1 });
  });

  it("is a no-op for a server with no rooms", async () => {
    expect(await checkpointRooms([])).toMatchObject({ rooms: 0, saved: 0, failed: 0, timedOut: 0 });
  });
});

describe("StorageLink", () => {
  it("backs off 1, 2, 4 ... capped at 30 s and recovers on success", async () => {
    const link = new StorageLink();
    const fail = (): Promise<never> => Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await link.run(fail).catch(() => undefined);
      delays.push(link.retryDelayMs);
      expect(link.canAttempt()).toBe(false);
      vi.setSystemTime(Date.now() + link.retryDelayMs);
      expect(link.canAttempt()).toBe(true);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    await link.run(() => Promise.resolve(1));
    expect(link.state).toBe("ok");
    expect(link.failures).toBe(0);
  });

  it("times a hung call out and counts it as an outage", async () => {
    const link = new StorageLink({ timeoutMs: 100 });
    const hung = link.run(() => new Promise<never>(() => undefined)).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(101);
    expect(await hung).toMatchObject({ code: "STORAGE_TIMEOUT" });
    expect(link.isDown).toBe(true);
  });
});

describe("UsagePersister", () => {
  it("seeds the month total, writes deltas and survives a failed write", async () => {
    const repo = new MemoryRoomSaveRepository();
    const bandwidth = new BandwidthCounter(Date.now());
    await repo.addEgress("2026-11-03", 1_000);
    const usage = new UsagePersister({ repo, bandwidth });
    await usage.seed();
    expect(bandwidth.report(Date.now()).monthToDateBytes).toBe(1_000);

    bandwidth.add(500);
    await usage.flush();
    expect(await repo.monthEgress("2026-11")).toBe(1_500);

    bandwidth.add(300);
    repo.offline = true;
    await usage.flush();
    expect(usage.counters.failures).toBe(1);
    repo.offline = false;
    bandwidth.add(200);
    await usage.flush();
    expect(await repo.monthEgress("2026-11")).toBe(2_000); // 300 kept and retried, nothing lost or doubled
    expect(dayKeyUtc(Date.now())).toBe("2026-11-15");
  });
});
