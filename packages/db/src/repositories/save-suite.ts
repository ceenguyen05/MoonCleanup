// Behavioural suite of the solo checkpoint save repository (M1-W5-T07; data-model.md 3.7, 3.7b, 3.7c). Like contract-suite.ts
// it is a non-test file so one definition runs against the memory and the PostgreSQL (PGlite) drivers.

import { describe, expect, it } from "vitest";
import { uuidv7 } from "../ids.ts";
import type { SuiteDriver, SuiteHarness } from "./contract-suite.ts";
import type { CommitSoloCheckpointInput } from "./types.ts";

const DAY = 86_400_000;
const T0 = new Date("2026-11-14T12:00:00.000Z");
const DEVICE = "0190a000-0000-7000-8000-0000000000d1";
let counter = 5000;
const hex = (): string => (counter++).toString(16).padStart(64, "0");
const bytes = (n: number, fill: number): Uint8Array => new Uint8Array(n).fill(fill);

async function guest(h: SuiteHarness, name = "Saver One") {
  const playerId = uuidv7();
  await h.repo.createGuest({
    playerId,
    displayName: name,
    recoveryHash: hex(),
    token: { id: uuidv7(), hash: hex(), expiresAt: new Date(h.now().getTime() + 180 * DAY), familyId: uuidv7() },
  });
  return playerId;
}

export function runSaveSuite(label: string, driver: SuiteDriver): void {
  describe(`MoonRepository solo checkpoint saves (${label})`, () => {
    async function soloSetup() {
      const h = await driver.create();
      h.setNow(T0);
      const playerId = await guest(h);
      const contractId = uuidv7();
      await h.repo.createContract({
        id: contractId,
        ownerPlayerId: playerId,
        name: "Moon One",
        shiftType: "solo",
        maxPlayers: 1,
        gridM: 128,
        plotCount: 163842,
        seed: "18446744073709551615",
        inviteCode: null,
        ownedQuota: 3,
      });
      const commit = (over: Partial<CommitSoloCheckpointInput> = {}) =>
        h.repo.commitSoloCheckpoint({
          contractId,
          playerId,
          deviceId: DEVICE,
          baseGeneration: 0,
          overwrite: false,
          generation: 1,
          parentGeneration: 0,
          saveFormatVersion: 1,
          gameDataVersion: "1.3",
          simTick: 100,
          header: { codec: "gzip", rawSize: 96, checksum: 0xdeadbeef, blob: bytes(40, 1) },
          chunks: [{ chunkId: 3, codec: "deflate", rawSize: 300, checksum: 0xfffffffe, blob: bytes(20, 2) }],
          playtimeS: 60,
          shinePolished: 10,
          walletLumens: 5,
          profileCredit: { tenurePoints: 7, commendations: 1 },
          minIntervalS: 20,
          hardCapBytes: 8 * 1024 * 1024,
          ...over,
        });
      const later = (ms: number): void => h.setNow(new Date(h.now().getTime() + ms));
      return { h, playerId, contractId, commit, later };
    }

    it("writes the first save to slot A, then alternates slots and chunk versions; the newest wins", async () => {
      const { h, contractId, commit, later } = await soloSetup();
      expect(await h.repo.getSaveHead(contractId)).toBeNull();
      expect(await commit()).toMatchObject({ kind: "accepted", generation: 1, replayed: false });
      later(30_000);
      await commit({
        generation: 2,
        parentGeneration: 1,
        baseGeneration: 1,
        chunks: [{ chunkId: 3, codec: "deflate", rawSize: 9, checksum: 5, blob: bytes(21, 3) }],
      });
      later(30_000);
      await commit({
        generation: 3,
        parentGeneration: 2,
        baseGeneration: 2,
        chunks: [{ chunkId: 3, codec: "deflate", rawSize: 9, checksum: 6, blob: bytes(22, 4) }],
      });
      const rows = await h.repo.loadSaveRows(contractId);
      expect(rows.slots.map((r) => `${r.slot}${r.saveSeq}`).sort()).toEqual(["A3", "B2"]);
      expect(rows.chunks.map((c) => [c.chunkId, c.ver, c.saveSeq])).toEqual([
        [3, 0, 3],
        [3, 1, 2],
      ]);
      const head = await h.repo.getSaveHead(contractId);
      expect(head).toMatchObject({
        generation: 3,
        parentGeneration: 2,
        originKind: "solo",
        playtimeS: 60,
        shinePolished: 10,
      });
      expect(head?.savedBy).toBe(`solo:${DEVICE}`);
    });

    it("round-trips bytes and unsigned CRC32 values through the signed columns", async () => {
      const { h, contractId, commit } = await soloSetup();
      await commit();
      const rows = await h.repo.loadSaveRows(contractId);
      expect(Array.from(rows.slots[0]?.blob ?? [])).toEqual(Array.from(bytes(40, 1)));
      expect(rows.slots[0]?.checksum).toBe(0xdeadbeef);
      expect(rows.chunks[0]?.checksum).toBe(0xfffffffe);
      expect(rows.chunks[0]?.blobSize).toBe(20);
    });

    it("is fast-forward only: a stale base conflicts with the server head, overwrite skips it and snapshots", async () => {
      const { h, contractId, commit, later } = await soloSetup();
      await commit();
      later(30_000);
      expect(await commit({ generation: 2, parentGeneration: 1, baseGeneration: 0 })).toMatchObject({
        kind: "conflict",
        server: { generation: 1 },
      });
      expect((await h.repo.getSaveHead(contractId))?.generation).toBe(1);
      const forced = await commit({
        generation: 2,
        parentGeneration: 0,
        baseGeneration: 1,
        overwrite: true,
        chunks: [],
      });
      expect(forced).toMatchObject({ kind: "accepted", generation: 2 });
      expect((await h.repo.loadSaveRows(contractId)).chunks).toEqual([]);
    });

    it("refuses a generation not above the server's, even when overwriting", async () => {
      const { h, contractId, commit, later } = await soloSetup();
      await commit({ generation: 5, parentGeneration: 0 });
      later(30_000);
      const other = "0190a000-0000-7000-8000-0000000000d2";
      expect(
        await commit({ generation: 5, parentGeneration: 4, baseGeneration: 5, overwrite: true, deviceId: other }),
      ).toMatchObject({ kind: "generation_not_increasing", serverGeneration: 5 });
      expect(await commit({ generation: 4, parentGeneration: 0, baseGeneration: 5, overwrite: true })).toMatchObject({
        kind: "generation_not_increasing",
      });
      expect((await h.repo.getSaveHead(contractId))?.generation).toBe(5);
    });

    it("treats the same device re-sending the stored generation as an idempotent accept", async () => {
      const { commit } = await soloSetup();
      await commit();
      expect(await commit()).toMatchObject({ kind: "accepted", generation: 1, replayed: true });
    });

    it("enforces the minimum gap between accepted saves with the repository clock", async () => {
      const { commit, later } = await soloSetup();
      await commit();
      later(5_000);
      expect(await commit({ generation: 2, parentGeneration: 1, baseGeneration: 1 })).toMatchObject({
        kind: "too_soon",
        retryAfterS: 15,
      });
      later(20_000);
      expect(await commit({ generation: 2, parentGeneration: 1, baseGeneration: 1 })).toMatchObject({
        kind: "accepted",
      });
    });

    it("refuses a stranger and a Private Contract; the hard cap rolls the whole write back", async () => {
      const { h, playerId, contractId, commit } = await soloSetup();
      const stranger = await guest(h, "Stranger One");
      expect(await commit({ playerId: stranger })).toMatchObject({ kind: "not_found" });
      expect(await commit({ hardCapBytes: 10 })).toMatchObject({ kind: "over_cap" });
      expect(await h.repo.getSaveHead(contractId)).toBeNull();
      expect((await h.repo.loadSaveRows(contractId)).chunks).toEqual([]);
      await h.repo.patchContract({
        contractId,
        playerId,
        shiftType: "private",
        inviteCode: "ABCDEFGH",
        privateMaxPlayers: 6,
      });
      expect(await commit()).toMatchObject({ kind: "not_solo" });
    });

    it("mirrors the counters onto the Contract and credits the profile in the same commit", async () => {
      const { h, playerId, contractId, commit } = await soloSetup();
      await commit();
      expect(await h.repo.getContract(contractId, playerId)).toMatchObject({
        playtimeS: 60,
        shinePolished: 10,
        walletLumens: 5,
      });
      expect(await h.repo.getProfile(playerId)).toMatchObject({ tenurePoints: 7, commendations: 1, version: 1 });
    });

    it("reports the account age and the playtime claimed across ALL owned Contracts (security review R3)", async () => {
      const { h, playerId, commit, later } = await soloSetup();
      expect(await h.repo.getPlaytimeLedger(uuidv7())).toBeNull();
      expect(await h.repo.getPlaytimeLedger(playerId)).toEqual({ accountCreatedAt: T0, contractsPlaytimeS: 0 });
      await commit({ playtimeS: 60 });
      later(30_000);
      const second = uuidv7();
      await h.repo.createContract({
        id: second,
        ownerPlayerId: playerId,
        name: "Moon Two",
        shiftType: "solo",
        maxPlayers: 1,
        gridM: 128,
        plotCount: 163842,
        seed: "1",
        inviteCode: null,
        ownedQuota: 3,
      });
      await h.repo.commitSoloCheckpoint({
        contractId: second,
        playerId,
        deviceId: DEVICE,
        baseGeneration: 0,
        overwrite: false,
        generation: 1,
        parentGeneration: 0,
        saveFormatVersion: 1,
        gameDataVersion: "1.3",
        simTick: 10,
        header: { codec: "gzip", rawSize: 96, checksum: 1, blob: bytes(40, 1) },
        chunks: [],
        playtimeS: 45,
        shinePolished: 0,
        walletLumens: 0,
        profileCredit: { tenurePoints: 0, commendations: 0 },
        minIntervalS: 20,
        hardCapBytes: 8 * 1024 * 1024,
      });
      expect(await h.repo.getPlaytimeLedger(playerId)).toEqual({ accountCreatedAt: T0, contractsPlaytimeS: 105 });
      // Another player's playtime is not mine.
      const other = await guest(h, "Other One");
      expect(await h.repo.getPlaytimeLedger(other)).toMatchObject({ contractsPlaytimeS: 0 });
    });
  });
}
