import { describe, expect, expectTypeOf, it } from "vitest";
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  API_ROUTES,
  ApiErrorBodySchema,
  CHECKPOINT_REJECT_REASONS,
  CONTRACT_QUOTA_PER_PLAYER,
  CheckpointRejectedBodySchema,
  ContractPatchRequestSchema,
  ContractSummarySchema,
  CreateContractRequestSchema,
  DisplayNameSchema,
  GetContractResponseSchema,
  GuestCreateResponseSchema,
  HTTP_METHODS,
  InviteCodeSchema,
  JoinContractResponseSchema,
  ListContractsResponseSchema,
  ProfileSchema,
  RecoveryCodeSchema,
  RefreshRequestSchema,
  SaveConflictBodySchema,
  SoloCheckpointAcceptedSchema,
  SoloCheckpointBeginRequestSchema,
  SoloCheckpointSummarySchema,
  type CreateContractRequest,
  type GetContractResponse,
} from "./rest";
import { SAVE_FORMAT_VERSION } from "../save";

const UUID = "0190a6c4-7d3e-7b1a-9c55-2f8e4d6a1b00";
const TOKEN = "A".repeat(43);
const summary = {
  generation: 4,
  parentGeneration: 3,
  originKind: "solo",
  savedAt: "2026-11-13T12:00:00.000Z",
  simTick: 1200,
  playtimeS: 60,
  shinePolished: 5,
  walletLumens: 100,
  saveFormatVersion: SAVE_FORMAT_VERSION,
  gameDataVersion: "1",
};
const contract = {
  id: UUID,
  name: "Boreal Test",
  shiftType: "solo",
  role: "holder",
  maxPlayers: 1,
  status: "active",
  gridM: 128,
  plotCount: 163842,
  shinePolished: 0,
  walletLumens: 0,
  playtimeS: 0,
  lastPlayedAt: null,
  online: 0,
};

describe("error codes", () => {
  it("map every code to an HTTP status and add the ADR-0031 codes", () => {
    expect(Object.keys(API_ERROR_STATUS).sort()).toEqual([...API_ERROR_CODES].sort());
    expect(API_ERROR_STATUS.SAVE_CONFLICT).toBe(409);
    expect(API_ERROR_STATUS.CHECKPOINT_REJECTED).toBe(422);
    expect(API_ERROR_STATUS.SAVE_VERSION_UNSUPPORTED).toBe(409);
    expect(API_ERROR_STATUS.PAYLOAD_TOO_LARGE).toBe(413);
    expect(API_ERROR_STATUS.STORAGE_FULL).toBe(507);
  });

  it("has VERSION_CONFLICT for a stale profile version (v0.3.0)", () => {
    expect(API_ERROR_CODES).toContain("VERSION_CONFLICT");
    expect(API_ERROR_STATUS.VERSION_CONFLICT).toBe(409);
    expect(ApiErrorBodySchema.parse({ error: "VERSION_CONFLICT" })).toEqual({ error: "VERSION_CONFLICT" });
  });

  it("routes use known methods and unique method+path pairs", () => {
    const keys = Object.values(API_ROUTES).map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const route of Object.values(API_ROUTES)) {
      expect(HTTP_METHODS).toContain(route.method);
      expect(route.path.startsWith("/v1/")).toBe(true);
    }
  });
});

describe("names and codes", () => {
  it("validates display names", () => {
    expect(DisplayNameSchema.safeParse("Cee").success).toBe(true);
    expect(DisplayNameSchema.safeParse("Cee_the-Great.1").success).toBe(true);
    for (const bad of ["ab", "x".repeat(21), " Cee", "Cee ", "Ce<e>", "Ceée".normalize("NFD")]) {
      expect(DisplayNameSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("validates invite and recovery codes", () => {
    expect(InviteCodeSchema.safeParse("7QXK2M9T").success).toBe(true);
    expect(InviteCodeSchema.safeParse("7QXK2M9I").success).toBe(false);
    expect(InviteCodeSchema.safeParse("7QXK2M9").success).toBe(false);
    expect(RecoveryCodeSchema.safeParse("ABCD-EFGH-JKMN-PQRS").success).toBe(true);
    expect(RecoveryCodeSchema.safeParse("ABCDEFGHJKMNPQRS").success).toBe(true);
    expect(RecoveryCodeSchema.safeParse("ABCD-EFGH-JKMN").success).toBe(false);
  });
});

describe("auth and profile DTOs", () => {
  it("guest create response carries tokens and the one-time code", () => {
    const body = {
      playerId: UUID,
      displayName: "Cee",
      accessToken: "a".repeat(40),
      accessExpiresInS: 900,
      refreshToken: TOKEN,
      recoveryCode: "ABCD-EFGH-JKMN-PQRS",
    };
    expect(GuestCreateResponseSchema.parse(body)).toEqual(body);
    expect(RefreshRequestSchema.safeParse({ refreshToken: "short" }).success).toBe(false);
  });

  it("profile round-trips and rejects negative currency", () => {
    const profile = {
      playerId: UUID,
      displayName: "Cee",
      isGuest: true,
      tenureLevel: 0,
      tenurePoints: 0,
      commendations: 0,
      lifetimeLumens: 0,
      lifetimePlotsPolished: 0,
      cosmeticsOwned: [],
      equippedCosmetics: {},
      version: 1,
    };
    expect(ProfileSchema.parse(profile)).toEqual(profile);
    expect(ProfileSchema.safeParse({ ...profile, commendations: -1 }).success).toBe(false);
  });
});

describe("contract DTOs", () => {
  it("lists contracts with the quota", () => {
    const list = { contracts: [contract], ownedCount: 1, ownedQuota: CONTRACT_QUOTA_PER_PLAYER };
    expect(ListContractsResponseSchema.parse(list)).toEqual(list);
    expect(ContractSummarySchema.safeParse({ ...contract, role: "boss" }).success).toBe(false);
    expect(ContractSummarySchema.safeParse({ ...contract, maxPlayers: 7 }).success).toBe(false);
  });

  it("GET contract adds the Holder's invite code and stays compatible with the summary (v0.3.0)", () => {
    expect(GetContractResponseSchema.parse(contract)).toEqual(contract);
    const holder = { ...contract, shiftType: "private", maxPlayers: 6, inviteCode: "7QXK2M9T" };
    expect(GetContractResponseSchema.parse(holder).inviteCode).toBe("7QXK2M9T");
    expect(GetContractResponseSchema.parse({ ...contract, inviteCode: null }).inviteCode).toBeNull();
    expect(GetContractResponseSchema.safeParse({ ...holder, inviteCode: "7QXK2M9I" }).success).toBe(false);
    // An older client that only knows ContractSummarySchema still parses the richer body (key stripped).
    expect(ContractSummarySchema.parse(holder)).toEqual({ ...holder, inviteCode: undefined });
    expectTypeOf<GetContractResponse["inviteCode"]>().toEqualTypeOf<string | null | undefined>();
  });

  it("create defaults to solo and accepts a client id and seed", () => {
    expect(CreateContractRequestSchema.parse({ name: "Boreal Test" }).shiftType).toBe("solo");
    const local: CreateContractRequest = { name: "Boreal Test", clientContractId: UUID, seed: "18446744073709551615" };
    expect(CreateContractRequestSchema.safeParse(local).success).toBe(true);
    expect(CreateContractRequestSchema.safeParse({ name: "ab" }).success).toBe(false);
    expect(CreateContractRequestSchema.safeParse({ name: "Boreal Test", shiftType: "open" }).success).toBe(false);
    expect(CreateContractRequestSchema.safeParse({ name: "Boreal Test", seed: "-1" }).success).toBe(false);
  });

  it("patch needs at least one change", () => {
    expect(ContractPatchRequestSchema.safeParse({}).success).toBe(false);
    expect(ContractPatchRequestSchema.safeParse({ shiftType: "private" }).success).toBe(true);
  });

  it("join response keeps unknown reservation fields", () => {
    const body = {
      reservation: { name: "shift", sessionId: "s1", roomId: "r1", processId: "p1", reconnectionToken: "x" },
      joinTicket: "t".repeat(32),
      role: "staff",
    };
    expect(JoinContractResponseSchema.parse(body).reservation).toMatchObject({ reconnectionToken: "x" });
  });
});

describe("solo checkpoint DTOs (ADR-0031)", () => {
  it("has the ten reject reasons of the ADR", () => {
    expect(CHECKPOINT_REJECT_REASONS).toEqual([
      "bad_crc",
      "bad_envelope",
      "format_too_new",
      "game_data_unknown",
      "bake_mismatch",
      "size_limit",
      "chunk_id_out_of_range",
      "generation_not_increasing",
      "contract_not_solo",
      "not_holder",
    ]);
    expect(CheckpointRejectedBodySchema.parse({ error: "CHECKPOINT_REJECTED", reason: "bad_crc" })).toBeDefined();
    expect(CheckpointRejectedBodySchema.safeParse({ error: "CHECKPOINT_REJECTED", reason: "other" }).success).toBe(
      false,
    );
  });

  it("summary, accepted and conflict bodies round-trip", () => {
    expect(SoloCheckpointSummarySchema.parse(summary)).toEqual(summary);
    expect(SoloCheckpointSummarySchema.safeParse({ ...summary, originKind: "cloud" }).success).toBe(false);
    const accepted = { acceptedGeneration: 4, savedAt: summary.savedAt, flags: ["solo_implausible"] };
    expect(SoloCheckpointAcceptedSchema.parse(accepted)).toEqual(accepted);
    expect(SaveConflictBodySchema.parse({ error: "SAVE_CONFLICT", server: summary }).server.generation).toBe(4);
  });

  it("begin request enforces size, part and hash bounds", () => {
    const begin = {
      contractId: UUID,
      generation: 4,
      parentGeneration: 3,
      baseGeneration: 3,
      saveFormatVersion: SAVE_FORMAT_VERSION,
      gameDataVersion: "1",
      bakeHash: "a".repeat(64),
      totalBytes: 2048,
      partCount: 1,
      packageCrc32: 123,
      summary,
      profileDelta: { playtimeS: 60, tenurePoints: 0, commendations: 0, achievementIds: [] },
      deviceId: UUID,
    };
    expect(SoloCheckpointBeginRequestSchema.parse(begin).overwrite).toBe(false);
    for (const bad of [
      { ...begin, totalBytes: 4 * 1024 * 1024 + 1 },
      { ...begin, partCount: 5 },
      { ...begin, bakeHash: "xyz" },
      { ...begin, generation: 0 },
      { ...begin, packageCrc32: -1 },
    ]) {
      expect(SoloCheckpointBeginRequestSchema.safeParse(bad).success).toBe(false);
    }
    expectTypeOf<ReturnType<typeof SoloCheckpointBeginRequestSchema.parse>["overwrite"]>().toEqualTypeOf<boolean>();
  });
});
