// The behavioural suite every MoonRepository implementation must pass (memory.test.ts and postgres.test.ts both call
// it). It lives in a non-test file so one definition runs against both drivers. Time is controlled through the
// injected clock, so grace windows and expiry are deterministic.

import { describe, expect, it } from "vitest";
import { uuidv7 } from "../ids.ts";
import type { MoonRepository } from "./types.ts";

export interface SuiteHarness {
  readonly repo: MoonRepository;
  /** Sets the clock both the repository and the suite use. */
  setNow(date: Date): void;
  now(): Date;
}

export interface SuiteDriver {
  /** A repository with no data in it (new instance, or truncated tables). */
  create(): Promise<SuiteHarness>;
}

const hex = (n: number): string => n.toString(16).padStart(64, "0");
let counter = 1;
const nextHash = (): string => hex(counter++);

const DAY = 86_400_000;
const T0 = new Date("2026-11-14T12:00:00.000Z");

export function runRepositorySuite(label: string, driver: SuiteDriver): void {
  describe(`MoonRepository behaviour (${label})`, () => {
    async function guest(h: SuiteHarness, name = "Alex Guest") {
      const playerId = uuidv7();
      const tokenHash = nextHash();
      const familyId = uuidv7();
      const recoveryHash = nextHash();
      await h.repo.createGuest({
        playerId,
        displayName: name,
        recoveryHash,
        token: { id: uuidv7(), hash: tokenHash, expiresAt: new Date(h.now().getTime() + 180 * DAY), familyId },
      });
      return { playerId, tokenHash, familyId, recoveryHash };
    }

    async function setup() {
      const h = await driver.create();
      h.setNow(T0);
      return h;
    }

    function contractInput(ownerPlayerId: string, over: Record<string, unknown> = {}) {
      return {
        id: uuidv7(),
        ownerPlayerId,
        name: "Moon One",
        shiftType: "solo" as const,
        maxPlayers: 1,
        gridM: 128,
        plotCount: 163842,
        seed: "18446744073709551615",
        inviteCode: null,
        ownedQuota: 3,
        ...over,
      };
    }

    // ---- guests and profiles ----------------------------------------------------------------------------------
    it("creates a guest with a default profile", async () => {
      const h = await setup();
      const g = await guest(h, "Pat Smith");
      const profile = await h.repo.getProfile(g.playerId);
      expect(profile).toMatchObject({
        playerId: g.playerId,
        displayName: "Pat Smith",
        isGuest: true,
        commendations: 0,
        version: 0,
        cosmeticsOwned: [],
        equippedCosmetics: {},
      });
      expect(await h.repo.getProfile(uuidv7())).toBeNull();
    });

    it("rejects a duplicate token hash or recovery hash", async () => {
      const h = await setup();
      const g = await guest(h);
      await expect(
        h.repo.createGuest({
          playerId: uuidv7(),
          displayName: "Dup Token",
          recoveryHash: nextHash(),
          token: { id: uuidv7(), hash: g.tokenHash, expiresAt: new Date(T0.getTime() + DAY), familyId: uuidv7() },
        }),
      ).rejects.toBeDefined();
      await expect(
        h.repo.createGuest({
          playerId: uuidv7(),
          displayName: "Dup Code",
          recoveryHash: g.recoveryHash,
          token: { id: uuidv7(), hash: nextHash(), expiresAt: new Date(T0.getTime() + DAY), familyId: uuidv7() },
        }),
      ).rejects.toBeDefined();
    });

    it("updates a profile with optimistic concurrency", async () => {
      const h = await setup();
      const g = await guest(h);
      const ok = await h.repo.updateProfile(g.playerId, {
        displayName: "New Name",
        equippedCosmetics: { helmet: "cos.red" },
        expectedVersion: 0,
      });
      expect(ok.kind).toBe("updated");
      if (ok.kind === "updated") {
        expect(ok.profile.version).toBe(1);
        expect(ok.profile.displayName).toBe("New Name");
        expect(ok.profile.equippedCosmetics).toEqual({ helmet: "cos.red" });
      }
      expect((await h.repo.updateProfile(g.playerId, { displayName: "Stale", expectedVersion: 0 })).kind).toBe(
        "version_conflict",
      );
      expect((await h.repo.updateProfile(uuidv7(), { displayName: "Ghost", expectedVersion: 0 })).kind).toBe(
        "not_found",
      );
    });

    // ---- refresh rotation ---------------------------------------------------------------------------------------
    it("rotates a refresh token and invalidates nothing else", async () => {
      const h = await setup();
      const g = await guest(h);
      const next = { id: uuidv7(), hash: nextHash(), expiresAt: new Date(T0.getTime() + 180 * DAY) };
      expect(await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next })).toEqual({
        kind: "rotated",
        playerId: g.playerId,
      });
      const again = { id: uuidv7(), hash: nextHash(), expiresAt: new Date(T0.getTime() + 180 * DAY) };
      h.setNow(new Date(T0.getTime() + 120_000));
      expect((await h.repo.rotateRefreshToken({ presentedHash: next.hash, next: again })).kind).toBe("rotated");
    });

    it("treats an unknown or expired token as invalid", async () => {
      const h = await setup();
      const g = await guest(h);
      const next = () => ({ id: uuidv7(), hash: nextHash(), expiresAt: new Date(T0.getTime() + 400 * DAY) });
      expect((await h.repo.rotateRefreshToken({ presentedHash: nextHash(), next: next() })).kind).toBe("invalid");
      h.setNow(new Date(T0.getTime() + 181 * DAY));
      expect((await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: next() })).kind).toBe("invalid");
    });

    it("grace window: a retry of a just-rotated token with an unused successor reissues and keeps the family", async () => {
      const h = await setup();
      const g = await guest(h);
      const exp = new Date(T0.getTime() + 180 * DAY);
      const first = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: first });
      h.setNow(new Date(T0.getTime() + 10_000));
      const retry = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      expect((await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: retry })).kind).toBe("rotated");
      // The unused successor was revoked (superseded); the fresh one works.
      h.setNow(new Date(T0.getTime() + 20_000));
      expect(
        (
          await h.repo.rotateRefreshToken({
            presentedHash: first.hash,
            next: { ...retry, id: uuidv7(), hash: nextHash() },
          })
        ).kind,
      ).not.toBe("rotated");
      const final = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      expect((await h.repo.rotateRefreshToken({ presentedHash: retry.hash, next: final })).kind).toBe("rotated");
    });

    it("grace window: successor already used -> superseded (409) and nothing is revoked", async () => {
      const h = await setup();
      const g = await guest(h);
      const exp = new Date(T0.getTime() + 180 * DAY);
      const first = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: first });
      h.setNow(new Date(T0.getTime() + 5_000));
      const second = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      await h.repo.rotateRefreshToken({ presentedHash: first.hash, next: second }); // the other tab won
      h.setNow(new Date(T0.getTime() + 8_000));
      const res = await h.repo.rotateRefreshToken({
        presentedHash: g.tokenHash,
        next: { id: uuidv7(), hash: nextHash(), expiresAt: exp },
      });
      expect(res).toEqual({ kind: "superseded", playerId: g.playerId });
      // The winner's chain is intact.
      expect(
        (
          await h.repo.rotateRefreshToken({
            presentedHash: second.hash,
            next: { id: uuidv7(), hash: nextHash(), expiresAt: exp },
          })
        ).kind,
      ).toBe("rotated");
    });

    it("reuse of a replaced token after the grace window revokes the whole family", async () => {
      const h = await setup();
      const g = await guest(h);
      const exp = new Date(T0.getTime() + 180 * DAY);
      const first = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: first });
      h.setNow(new Date(T0.getTime() + 61_000));
      const res = await h.repo.rotateRefreshToken({
        presentedHash: g.tokenHash,
        next: { id: uuidv7(), hash: nextHash(), expiresAt: exp },
      });
      expect(res).toEqual({ kind: "reuse_detected", playerId: g.playerId });
      // The legitimate newest token of the family is revoked too.
      expect(
        (
          await h.repo.rotateRefreshToken({
            presentedHash: first.hash,
            next: { id: uuidv7(), hash: nextHash(), expiresAt: exp },
          })
        ).kind,
      ).toBe("invalid");
    });

    it("an older ancestor (not the immediate predecessor) inside the window counts as theft", async () => {
      const h = await setup();
      const g = await guest(h);
      const exp = new Date(T0.getTime() + 180 * DAY);
      const a = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      const b = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: a });
      h.setNow(new Date(T0.getTime() + 1000));
      await h.repo.rotateRefreshToken({ presentedHash: a.hash, next: b });
      h.setNow(new Date(T0.getTime() + 2000));
      // g -> a (used) is "superseded" by the rules (successor already used), but a 2-step-old token must not
      // be silently tolerated forever: after the window it is theft.
      h.setNow(new Date(T0.getTime() + 70_000));
      const res = await h.repo.rotateRefreshToken({
        presentedHash: g.tokenHash,
        next: { id: uuidv7(), hash: nextHash(), expiresAt: exp },
      });
      expect(res.kind).toBe("reuse_detected");
    });

    it("logout revokes the family; unknown tokens are reported as null", async () => {
      const h = await setup();
      const g = await guest(h);
      expect(await h.repo.revokeFamilyByHash(nextHash())).toBeNull();
      expect(await h.repo.revokeFamilyByHash(g.tokenHash)).toEqual({ playerId: g.playerId });
      expect(
        (
          await h.repo.rotateRefreshToken({
            presentedHash: g.tokenHash,
            next: { id: uuidv7(), hash: nextHash(), expiresAt: new Date(T0.getTime() + DAY) },
          })
        ).kind,
      ).toBe("invalid");
    });

    it("recovery revokes every family, swaps the code and starts a new family", async () => {
      const h = await setup();
      const g = await guest(h, "Recover Me");
      const newCode = nextHash();
      const token = {
        id: uuidv7(),
        hash: nextHash(),
        expiresAt: new Date(T0.getTime() + 180 * DAY),
        familyId: uuidv7(),
      };
      expect(await h.repo.recover({ codeHash: nextHash(), newCodeHash: nextHash(), token })).toBeNull();
      const res = await h.repo.recover({ codeHash: g.recoveryHash, newCodeHash: newCode, token });
      expect(res).toEqual({ playerId: g.playerId, displayName: "Recover Me" });
      // Old refresh token dead, new one alive.
      const next = () => ({ id: uuidv7(), hash: nextHash(), expiresAt: new Date(T0.getTime() + DAY) });
      expect((await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: next() })).kind).toBe("invalid");
      expect((await h.repo.rotateRefreshToken({ presentedHash: token.hash, next: next() })).kind).toBe("rotated");
      // The old code no longer works; the replacement does.
      const again = { ...token, id: uuidv7(), hash: nextHash(), familyId: uuidv7() };
      expect(await h.repo.recover({ codeHash: g.recoveryHash, newCodeHash: nextHash(), token: again })).toBeNull();
      expect(
        await h.repo.recover({
          codeHash: newCode,
          newCodeHash: nextHash(),
          token: { ...again, id: uuidv7(), hash: nextHash() },
        }),
      ).not.toBeNull();
    });

    it("purges expired and long-rotated refresh tokens", async () => {
      const h = await setup();
      const g = await guest(h);
      const exp = new Date(T0.getTime() + 180 * DAY);
      const first = { id: uuidv7(), hash: nextHash(), expiresAt: exp };
      await h.repo.rotateRefreshToken({ presentedHash: g.tokenHash, next: first });
      expect(await h.repo.purgeRefreshTokens()).toBe(0);
      h.setNow(new Date(T0.getTime() + 8 * DAY));
      expect(await h.repo.purgeRefreshTokens()).toBe(1); // g's token, replaced more than 7 days ago
      expect(
        (
          await h.repo.rotateRefreshToken({
            presentedHash: g.tokenHash,
            next: { ...first, id: uuidv7(), hash: nextHash() },
          })
        ).kind,
      ).toBe("invalid");
      h.setNow(new Date(T0.getTime() + 181 * DAY));
      expect(await h.repo.purgeRefreshTokens()).toBe(1);
    });

    it("touchPlayer is a no-throw write at most hourly", async () => {
      const h = await setup();
      const g = await guest(h);
      await h.repo.touchPlayer(g.playerId);
      h.setNow(new Date(T0.getTime() + 2 * 3600_000));
      await h.repo.touchPlayer(g.playerId);
      await h.repo.touchPlayer(uuidv7());
    });

    // ---- contracts ----------------------------------------------------------------------------------------------
    it("creates a Solo Contract with a Holder membership and lists it", async () => {
      const h = await setup();
      const g = await guest(h);
      const input = contractInput(g.playerId);
      const res = await h.repo.createContract(input);
      expect(res.kind).toBe("created");
      if (res.kind === "created") {
        expect(res.contract).toMatchObject({
          id: input.id,
          role: "holder",
          shiftType: "solo",
          maxPlayers: 1,
          seed: "18446744073709551615",
          inviteCode: null,
          shinePolished: 0,
        });
      }
      const list = await h.repo.listContracts(g.playerId);
      expect(list.ownedCount).toBe(1);
      expect(list.contracts.map((c) => c.id)).toEqual([input.id]);
      expect((await h.repo.getContract(input.id, g.playerId))?.name).toBe("Moon One");
      const stranger = await guest(h, "Stranger");
      expect(await h.repo.getContract(input.id, stranger.playerId)).toBeNull();
    });

    it("preserves the full unsigned 64-bit seed range", async () => {
      const h = await setup();
      const g = await guest(h);
      for (const seed of ["0", "1", "9223372036854775807", "9223372036854775808", "18446744073709551615"]) {
        const res = await h.repo.createContract(contractInput(g.playerId, { seed, ownedQuota: 99 }));
        expect(res.kind === "created" && res.contract.seed).toBe(seed);
        if (res.kind === "created") expect((await h.repo.getContract(res.contract.id, g.playerId))?.seed).toBe(seed);
      }
    });

    it("enforces the 3-owned quota and idempotent client ids", async () => {
      const h = await setup();
      const g = await guest(h);
      const other = await guest(h, "Other Player");
      const first = contractInput(g.playerId);
      await h.repo.createContract(first);
      expect((await h.repo.createContract(first)).kind).toBe("existing");
      expect((await h.repo.createContract(contractInput(g.playerId, { name: "Moon Two" }))).kind).toBe("created");
      expect((await h.repo.createContract(contractInput(g.playerId, { name: "Moon Three" }))).kind).toBe("created");
      expect((await h.repo.createContract(contractInput(g.playerId, { name: "Moon Four" }))).kind).toBe(
        "quota_exceeded",
      );
      // Idempotent replay still answers even at quota; another player cannot claim the id.
      expect((await h.repo.createContract(first)).kind).toBe("existing");
      expect((await h.repo.createContract({ ...contractInput(other.playerId), id: first.id })).kind).toBe("id_taken");
      expect((await h.repo.listContracts(g.playerId)).ownedCount).toBe(3);
    });

    it("creates a Private Contract, joins by code as Staff, and refuses duplicates and overflow", async () => {
      const h = await setup();
      const holder = await guest(h, "Holder One");
      const mate = await guest(h, "Mate One");
      const input = contractInput(holder.playerId, { shiftType: "private", maxPlayers: 6, inviteCode: "ABCD2345" });
      expect((await h.repo.createContract(input)).kind).toBe("created");
      expect(
        (
          await h.repo.createContract(
            contractInput(holder.playerId, { shiftType: "private", maxPlayers: 6, inviteCode: "ABCD2345" }),
          )
        ).kind,
      ).toBe("invite_code_taken");

      expect((await h.repo.joinByInviteCode({ code: "NOPE0000", playerId: mate.playerId, maxMembers: 6 })).kind).toBe(
        "not_found",
      );
      const joined = await h.repo.joinByInviteCode({ code: "ABCD2345", playerId: mate.playerId, maxMembers: 6 });
      expect(joined.kind).toBe("joined");
      if (joined.kind === "joined") expect(joined.contract.role).toBe("staff");
      expect((await h.repo.joinByInviteCode({ code: "ABCD2345", playerId: mate.playerId, maxMembers: 6 })).kind).toBe(
        "already_member",
      );
      const third = await guest(h, "Third One");
      expect((await h.repo.joinByInviteCode({ code: "ABCD2345", playerId: third.playerId, maxMembers: 2 })).kind).toBe(
        "full",
      );
      // Joined Contracts show up in the joiner's list but do not count against the owned quota.
      const list = await h.repo.listContracts(mate.playerId);
      expect(list.contracts.map((c) => c.id)).toEqual([input.id]);
      expect(list.ownedCount).toBe(0);
      expect(list.contracts[0]?.role).toBe("staff");
    });

    it("members list: Holder first, display names, only for active members", async () => {
      const h = await setup();
      const holder = await guest(h, "Holder Two");
      const mate = await guest(h, "Mate Two");
      const outsider = await guest(h, "Outsider");
      const input = contractInput(holder.playerId, { shiftType: "private", maxPlayers: 6, inviteCode: "EFGH6789" });
      await h.repo.createContract(input);
      await h.repo.joinByInviteCode({ code: "EFGH6789", playerId: mate.playerId, maxMembers: 6 });
      const res = await h.repo.listMembers(input.id, mate.playerId);
      expect(res.kind).toBe("ok");
      if (res.kind === "ok") {
        expect(res.members.map((m) => [m.displayName, m.role])).toEqual([
          ["Holder Two", "holder"],
          ["Mate Two", "staff"],
        ]);
      }
      expect((await h.repo.listMembers(input.id, outsider.playerId)).kind).toBe("not_found");
      expect((await h.repo.listMembers(uuidv7(), holder.playerId)).kind).toBe("not_found");
    });

    it("rotates the invite code (Holder, private only) and the old code stops working", async () => {
      const h = await setup();
      const holder = await guest(h, "Holder Three");
      const mate = await guest(h, "Mate Three");
      const solo = contractInput(holder.playerId);
      const priv = contractInput(holder.playerId, { shiftType: "private", maxPlayers: 6, inviteCode: "JKMN2345" });
      await h.repo.createContract(solo);
      await h.repo.createContract(priv);
      await h.repo.joinByInviteCode({ code: "JKMN2345", playerId: mate.playerId, maxMembers: 6 });

      expect(
        (await h.repo.rotateInviteCode({ contractId: solo.id, playerId: holder.playerId, newCode: "PQRS2345" })).kind,
      ).toBe("not_private");
      expect(
        (await h.repo.rotateInviteCode({ contractId: priv.id, playerId: mate.playerId, newCode: "PQRS2345" })).kind,
      ).toBe("forbidden");
      expect(
        (await h.repo.rotateInviteCode({ contractId: uuidv7(), playerId: holder.playerId, newCode: "PQRS2345" })).kind,
      ).toBe("not_found");
      expect(
        (await h.repo.rotateInviteCode({ contractId: priv.id, playerId: holder.playerId, newCode: "PQRS2345" })).kind,
      ).toBe("rotated");
      const late = await guest(h, "Late Joiner");
      expect((await h.repo.joinByInviteCode({ code: "JKMN2345", playerId: late.playerId, maxMembers: 6 })).kind).toBe(
        "not_found",
      );
      expect((await h.repo.joinByInviteCode({ code: "PQRS2345", playerId: late.playerId, maxMembers: 6 })).kind).toBe(
        "joined",
      );
    });

    it("patches name and shift type (Holder only); switching to private mints a code, to solo clears it", async () => {
      const h = await setup();
      const holder = await guest(h, "Holder Four");
      const stranger = await guest(h, "Stranger Four");
      const solo = contractInput(holder.playerId);
      await h.repo.createContract(solo);

      expect(
        (
          await h.repo.patchContract({
            contractId: solo.id,
            playerId: stranger.playerId,
            name: "Hacked",
            privateMaxPlayers: 6,
          })
        ).kind,
      ).toBe("not_found");
      const renamed = await h.repo.patchContract({
        contractId: solo.id,
        playerId: holder.playerId,
        name: "Renamed",
        privateMaxPlayers: 6,
      });
      expect(renamed.kind === "updated" && renamed.contract.name).toBe("Renamed");

      const priv = await h.repo.patchContract({
        contractId: solo.id,
        playerId: holder.playerId,
        shiftType: "private",
        inviteCode: "TVWX2345",
        privateMaxPlayers: 6,
      });
      expect(priv.kind).toBe("updated");
      if (priv.kind === "updated") {
        expect(priv.contract).toMatchObject({ shiftType: "private", maxPlayers: 6, inviteCode: "TVWX2345" });
      }
      const mate = await guest(h, "Mate Four");
      await h.repo.joinByInviteCode({ code: "TVWX2345", playerId: mate.playerId, maxMembers: 6 });
      expect(
        (
          await h.repo.patchContract({
            contractId: solo.id,
            playerId: mate.playerId,
            name: "Nope",
            privateMaxPlayers: 6,
          })
        ).kind,
      ).toBe("forbidden");

      const back = await h.repo.patchContract({
        contractId: solo.id,
        playerId: holder.playerId,
        shiftType: "solo",
        privateMaxPlayers: 6,
      });
      expect(back.kind === "updated" && back.contract).toMatchObject({
        shiftType: "solo",
        maxPlayers: 1,
        inviteCode: null,
      });
      expect(
        (await h.repo.joinByInviteCode({ code: "TVWX2345", playerId: (await guest(h)).playerId, maxMembers: 6 })).kind,
      ).toBe("not_found");
    });

    it("getMembership reports role, status and Contract facts for a join decision", async () => {
      const h = await setup();
      const holder = await guest(h, "Holder Five");
      const input = contractInput(holder.playerId);
      await h.repo.createContract(input);
      expect(await h.repo.getMembership(input.id, holder.playerId)).toEqual({
        contractId: input.id,
        role: "holder",
        status: "active",
        shiftType: "solo",
        maxPlayers: 1,
        contractStatus: "active",
      });
      expect(await h.repo.getMembership(input.id, uuidv7())).toBeNull();
      expect(await h.repo.getMembership(uuidv7(), holder.playerId)).toBeNull();
    });
  });
}
