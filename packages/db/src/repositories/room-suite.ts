// Port-conformance suite of the room durability layer (M1-W5-T01; data-model.md 3.5, 3.7, 3.7b, 3.12). A non-test file
// so ONE definition runs against the memory repository and the PostgreSQL (PGlite) repository: both must give callers
// exactly the same answers.

import { describe, expect, it } from "vitest";
import { LEASE_TTL_MS, type LeaseOwner, type RoomSaveRepository, type UsageRepository } from "./room-types.ts";

export interface RoomSuiteHarness {
  readonly repo: RoomSaveRepository & UsageRepository;
  /** Moves the repository's database clock (epoch ms). */
  setNow(ms: number): void;
  now(): number;
  /** Creates a fresh Contract the repository can lease and save (a row for SQL, nothing for memory). */
  newContract(): Promise<string>;
}

export interface RoomSuiteDriver {
  create(): Promise<RoomSuiteHarness>;
}

const T0 = Date.parse("2026-11-14T12:00:00.000Z");
const BAKE = "ab".repeat(32);
const payload = (n: number, size = 64): Uint8Array => new Uint8Array(size).fill(n);

export function runRoomSuite(label: string, driver: RoomSuiteDriver): void {
  describe(`RoomSaveRepository (${label})`, () => {
    async function setup() {
      const h = await driver.create();
      h.setNow(T0);
      const contractId = await h.newContract();
      const owner = (instance: string, roomId = contractId): LeaseOwner => ({ contractId, instance, roomId });
      return { h, repo: h.repo, contractId, owner };
    }

    it("grants the lease to one owner at a time and answers busy to the other", async () => {
      const { repo, owner } = await setup();
      expect(await repo.acquireLease(owner("a"))).toBe("acquired");
      expect(await repo.acquireLease(owner("a"))).toBe("acquired"); // idempotent for the holder
      expect(await repo.acquireLease(owner("b"))).toBe("busy");
      expect(await repo.acquireLease(owner("a", "other-room"))).toBe("busy"); // same instance, other room
    });

    it("lets another owner take an expired lease and tells the old owner it lost", async () => {
      const { h, repo, owner } = await setup();
      await repo.acquireLease(owner("a"));
      h.setNow(T0 + LEASE_TTL_MS - 1);
      expect(await repo.acquireLease(owner("b"))).toBe("busy");
      h.setNow(T0 + LEASE_TTL_MS + 1);
      expect(await repo.renewLease(owner("a"))).toBe("renewed"); // expired but nobody took it: still renewable
      h.setNow(T0 + 3 * LEASE_TTL_MS);
      expect(await repo.acquireLease(owner("b"))).toBe("acquired");
      expect(await repo.renewLease(owner("a"))).toBe("lost");
      expect(await repo.renewLease(owner("b"))).toBe("renewed");
    });

    it("renewal extends the expiry from the database clock", async () => {
      const { h, repo, owner } = await setup();
      await repo.acquireLease(owner("a"));
      h.setNow(T0 + 20_000);
      expect(await repo.renewLease(owner("a"))).toBe("renewed");
      h.setNow(T0 + 20_000 + LEASE_TTL_MS - 1);
      expect(await repo.acquireLease(owner("b"))).toBe("busy");
    });

    it("release frees the lease for the holding room only", async () => {
      const { repo, owner } = await setup();
      await repo.acquireLease(owner("a"));
      await repo.releaseLease(owner("b", "someone-else")); // not the holder: no effect
      expect(await repo.acquireLease(owner("b"))).toBe("busy");
      await repo.releaseLease(owner("a"));
      expect(await repo.acquireLease(owner("b"))).toBe("acquired");
    });

    it("loads null for a Contract that was never saved", async () => {
      const { repo, contractId } = await setup();
      expect(await repo.loadRoomSave(contractId)).toBeNull();
    });

    it("refuses a checkpoint without the lease and writes nothing", async () => {
      const { repo, contractId, owner } = await setup();
      const noLease = await repo.commitRoomCheckpoint({
        owner: owner("a"),
        simTick: 5,
        chunks: [{ chunkId: 1, payload: payload(1) }],
      });
      expect(noLease.kind).toBe("lease_lost");
      await repo.acquireLease(owner("b"));
      const wrong = await repo.commitRoomCheckpoint({
        owner: owner("a"),
        simTick: 5,
        chunks: [{ chunkId: 1, payload: payload(1) }],
      });
      expect(wrong.kind).toBe("lease_lost");
      expect(await repo.loadRoomSave(contractId)).toBeNull();
    });

    it("round-trips only the dirty chunks across checkpoints and keeps the generation monotonic", async () => {
      const { repo, contractId, owner } = await setup();
      await repo.acquireLease(owner("a"));
      const first = await repo.commitRoomCheckpoint({
        owner: owner("a"),
        simTick: 100,
        chunks: [
          { chunkId: 7, payload: payload(7) },
          { chunkId: 640, payload: payload(9, 300) },
        ],
        bakeHash: BAKE,
      });
      expect(first).toMatchObject({ kind: "saved", generation: 1 });
      const second = await repo.commitRoomCheckpoint({
        owner: owner("a"),
        simTick: 200,
        chunks: [
          { chunkId: 7, payload: payload(8) },
          { chunkId: 3, payload: payload(3) },
        ],
        bakeHash: BAKE,
      });
      expect(second).toMatchObject({ kind: "saved", generation: 2 });
      const snapshot = await repo.loadRoomSave(contractId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.generation).toBe(2);
      expect(snapshot!.simTick).toBe(200);
      expect(snapshot!.bakeHash).toBe(BAKE);
      expect(snapshot!.chunks.map((c) => c.chunkId)).toEqual([3, 7, 640]);
      expect(Array.from(snapshot!.chunks[1]!.payload)).toEqual(Array.from(payload(8))); // newest version wins
      expect(snapshot!.chunks[2]!.payload.byteLength).toBe(300); // untouched chunk survives
    });

    it("keeps the newest state through many alternating header slots and chunk versions", async () => {
      const { repo, contractId, owner } = await setup();
      await repo.acquireLease(owner("a"));
      let last = 0;
      for (let i = 1; i <= 7; i++) {
        const r = await repo.commitRoomCheckpoint({
          owner: owner("a"),
          simTick: i * 10,
          chunks: [{ chunkId: 2, payload: payload(i) }],
        });
        expect(r).toMatchObject({ kind: "saved", generation: i });
        last = i;
      }
      const snapshot = await repo.loadRoomSave(contractId);
      expect(snapshot).toMatchObject({ generation: last, simTick: last * 10 });
      expect(Array.from(snapshot!.chunks[0]!.payload)).toEqual(Array.from(payload(last)));
    });

    it("reports stored bytes that stay bounded to two versions per chunk", async () => {
      const { repo, owner } = await setup();
      await repo.acquireLease(owner("a"));
      let stored = 0;
      for (let i = 1; i <= 6; i++) {
        const r = await repo.commitRoomCheckpoint({
          owner: owner("a"),
          simTick: i,
          chunks: [{ chunkId: 1, payload: payload(i, 4096) }],
        });
        expect(r.kind).toBe("saved");
        if (r.kind === "saved") stored = r.storedBytes;
      }
      expect(stored).toBeGreaterThan(0);
      expect(stored).toBeLessThan(2 * 4096); // deflated 4 KiB of one repeated byte, two versions plus headers
    });

    it("lets a checkpoint pass when the lease expired but nobody took it, and refuses it once someone did", async () => {
      const { h, repo, contractId, owner } = await setup();
      await repo.acquireLease(owner("a"));
      h.setNow(T0 + 5 * LEASE_TTL_MS);
      const stillOurs = await repo.commitRoomCheckpoint({
        owner: owner("a"),
        simTick: 1,
        chunks: [{ chunkId: 4, payload: payload(4) }],
      });
      expect(stillOurs.kind).toBe("saved");
      h.setNow(T0 + 10 * LEASE_TTL_MS);
      expect(await repo.acquireLease(owner("b"))).toBe("acquired");
      const stolen = await repo.commitRoomCheckpoint({
        owner: owner("a"),
        simTick: 2,
        chunks: [{ chunkId: 4, payload: payload(5) }],
      });
      expect(stolen.kind).toBe("lease_lost");
      const snapshot = await repo.loadRoomSave(contractId);
      expect(snapshot).toMatchObject({ generation: 1, simTick: 1 });
      expect(Array.from(snapshot!.chunks[0]!.payload)).toEqual(Array.from(payload(4)));
    });

    it("records no bakeHash when the checkpoint carried none", async () => {
      const { repo, contractId, owner } = await setup();
      await repo.acquireLease(owner("a"));
      await repo.commitRoomCheckpoint({ owner: owner("a"), simTick: 1, chunks: [{ chunkId: 4, payload: payload(4) }] });
      expect((await repo.loadRoomSave(contractId))!.bakeHash).toBeNull();
    });
  });

  describe(`UsageRepository (${label})`, () => {
    it("adds egress to the day row, sums per month and never loses bytes", async () => {
      const h = await driver.create();
      h.setNow(T0);
      const { repo } = h;
      expect(await repo.monthEgress("2026-11")).toBe(0);
      await repo.addEgress("2026-11-03", 1_000);
      await repo.addEgress("2026-11-03", 500);
      await repo.addEgress("2026-11-30", 2_000);
      await repo.addEgress("2026-12-01", 7_000);
      await repo.addEgress("2026-10-31", 9_000);
      expect(await repo.monthEgress("2026-11")).toBe(3_500);
      expect(await repo.monthEgress("2026-12")).toBe(7_000);
      expect(await repo.monthEgress("2026-10")).toBe(9_000);
    });

    it("ignores negative and fractional deltas safely", async () => {
      const h = await driver.create();
      const { repo } = h;
      await repo.addEgress("2026-11-05", 100.9);
      await repo.addEgress("2026-11-05", -50);
      expect(await repo.monthEgress("2026-11")).toBe(100);
    });
  });
}
