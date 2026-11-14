// Contract routes (data-model.md sections 3.5-3.6, security.md section 5).
//
//   GET   /v1/contracts                    list (owned and joined) + owned quota usage
//   POST  /v1/contracts                    create (Solo or Private); idempotent by clientContractId; quota 3, 10 per day
//   GET   /v1/contracts/:id                one Contract (members only; others get 404)
//   PATCH /v1/contracts/:id                Holder: rename / change shift type
//   POST  /v1/contracts/join-code          join a Private Shift as Staff by invite code
//   POST  /v1/contracts/:id/invite-code    Holder: rotate the invite code
//   GET   /v1/contracts/:id/members
//
// Not here: `POST /v1/contracts/:id/join` (seat reservation + join ticket) belongs to the room layer (needs the matchmaker)
// and the solo checkpoint / save routes belong to M1-W5-T07. `contractJoin` rate limiting is exported for them.

import { uuidv7, type ContractView } from "@moon-cleanup/db";
import {
  API_ROUTES,
  CONTRACT_QUOTA_PER_PLAYER,
  ContractIdSchema,
  ContractPatchRequestSchema,
  CreateContractRequestSchema,
  JoinCodeRequestSchema,
  MAX_PLAYERS_PER_ROOM,
  STANDARD_GRID_M,
  STANDARD_PLOT_COUNT,
  type ContractMember,
  type ContractSummary,
  type CreateContractResponse,
  type HttpResponse,
  type HttpRouteDef,
  type InviteRotateResponse,
  type JoinCodeResponse,
  type ListContractsResponse,
  type ListMembersResponse,
} from "@moon-cleanup/shared";
import { generateInviteCode, generateSeed } from "./crypto";
import { authed, fail, gate, notFound, parse, type ApiContext } from "./http";
import { isBlockedName } from "./accounts";

const INVITE_RETRIES = 6;
const SEED_MAX = (1n << 64n) - 1n;

export function toSummary(ctx: ApiContext, c: ContractView): ContractSummary {
  return {
    id: c.id,
    name: c.name,
    shiftType: c.shiftType,
    role: c.role,
    maxPlayers: c.maxPlayers,
    status: c.status,
    gridM: c.gridM,
    plotCount: c.plotCount,
    shinePolished: c.shinePolished,
    walletLumens: c.walletLumens,
    playtimeS: c.playtimeS,
    lastPlayedAt: c.lastPlayedAt === null ? null : c.lastPlayedAt.toISOString(),
    online: Math.min(MAX_PLAYERS_PER_ROOM, Math.max(0, ctx.online(c.id))),
  } as ContractSummary;
}

export function createContractRoutes(ctx: ApiContext): HttpRouteDef[] {
  const idParam = (value: string | undefined): string | undefined => {
    const parsed = ContractIdSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };

  const list = authed(ctx, "contractsList", async (_request, playerId) => {
    const { contracts, ownedCount } = await ctx.repo.listContracts(playerId);
    const body: ListContractsResponse = {
      contracts: contracts.map((c) => toSummary(ctx, c)),
      ownedCount,
      ownedQuota: CONTRACT_QUOTA_PER_PLAYER,
    };
    return { status: 200, body };
  });

  const create = authed(ctx, "contractsCreate", async (request, playerId): Promise<HttpResponse> => {
    const body = parse(CreateContractRequestSchema, request.body);
    if (!body.ok) return body.response;
    const { name, shiftType, clientContractId, seed: clientSeed } = body.value;
    if (isBlockedName(name, ctx.blockedNames)) return fail("BAD_REQUEST", "invalid request");
    if (clientSeed !== undefined && BigInt(clientSeed) > SEED_MAX) return fail("BAD_REQUEST", "invalid request");

    const limited = await gate(ctx, [{ rule: "contractCreate", key: playerId }]);
    if (limited !== undefined) return limited;
    const storage = ctx.storage();
    if (storage === "full" || storage === "emergency") return fail("STORAGE_FULL", "new Contracts are paused");

    const isPrivate = shiftType === "private";
    for (let attempt = 0; attempt < INVITE_RETRIES; attempt += 1) {
      const inviteCode = isPrivate ? generateInviteCode() : null;
      const result = await ctx.repo.createContract({
        id: clientContractId ?? uuidv7(ctx.now()),
        ownerPlayerId: playerId,
        name,
        shiftType,
        maxPlayers: isPrivate ? MAX_PLAYERS_PER_ROOM : 1,
        gridM: STANDARD_GRID_M,
        plotCount: STANDARD_PLOT_COUNT,
        seed: clientSeed ?? generateSeed(),
        inviteCode,
        ownedQuota: CONTRACT_QUOTA_PER_PLAYER,
      });
      switch (result.kind) {
        case "created":
        case "existing": {
          const response: CreateContractResponse = {
            contract: toSummary(ctx, result.contract),
            inviteCode: result.contract.inviteCode as CreateContractResponse["inviteCode"],
          };
          return { status: result.kind === "created" ? 201 : 200, body: response };
        }
        case "quota_exceeded":
          return fail("QUOTA_EXCEEDED", "Contract quota used up");
        case "id_taken":
          return fail("BAD_REQUEST", "invalid request");
        case "invite_code_taken":
          continue; // astronomically rare collision: draw another code
      }
    }
    return fail("INTERNAL");
  });

  const get = authed(ctx, "contractGet", async (request, playerId) => {
    const id = idParam(request.params.id);
    if (id === undefined) return notFound();
    const contract = await ctx.repo.getContract(id, playerId);
    return contract === null ? notFound() : { status: 200, body: toSummary(ctx, contract) };
  });

  const patch = authed(ctx, "contractPatch", async (request, playerId): Promise<HttpResponse> => {
    const id = idParam(request.params.id);
    if (id === undefined) return notFound();
    const body = parse(ContractPatchRequestSchema, request.body);
    if (!body.ok) return body.response;
    if (body.value.name !== undefined && isBlockedName(body.value.name, ctx.blockedNames)) {
      return fail("BAD_REQUEST", "invalid request");
    }
    for (let attempt = 0; attempt < INVITE_RETRIES; attempt += 1) {
      const result = await ctx.repo.patchContract({
        contractId: id,
        playerId,
        ...(body.value.name !== undefined ? { name: body.value.name } : {}),
        ...(body.value.shiftType !== undefined ? { shiftType: body.value.shiftType } : {}),
        inviteCode: generateInviteCode(),
        privateMaxPlayers: MAX_PLAYERS_PER_ROOM,
      });
      switch (result.kind) {
        case "updated":
          return { status: 200, body: toSummary(ctx, result.contract) };
        case "not_found":
          return notFound();
        case "forbidden":
          return fail("FORBIDDEN");
        case "invite_code_taken":
          continue;
      }
    }
    return fail("INTERNAL");
  });

  const joinByCode = authed(ctx, "contractJoinByCode", async (request, playerId): Promise<HttpResponse> => {
    // Per-IP guess limit on top of the authenticated per-player limit (code space 32^8 is large, guessing is throttled).
    const limited = await gate(ctx, [{ rule: "joinByCode", key: request.remoteAddress }]);
    if (limited !== undefined) return limited;
    const body = parse(JoinCodeRequestSchema, request.body);
    if (!body.ok) return body.response;
    const result = await ctx.repo.joinByInviteCode({
      code: body.value.code.toUpperCase(),
      playerId,
      maxMembers: MAX_PLAYERS_PER_ROOM,
    });
    switch (result.kind) {
      case "joined":
      case "already_member": {
        const response: JoinCodeResponse = { contract: toSummary(ctx, result.contract) };
        return { status: 200, body: response };
      }
      case "full":
        return fail("ROOM_FULL", "Contract is full");
      case "not_found":
        // Unknown code, deleted Contract and banned caller are deliberately indistinguishable.
        return notFound();
    }
  });

  const rotate = authed(ctx, "contractInviteRotate", async (request, playerId): Promise<HttpResponse> => {
    const id = idParam(request.params.id);
    if (id === undefined) return notFound();
    for (let attempt = 0; attempt < INVITE_RETRIES; attempt += 1) {
      const result = await ctx.repo.rotateInviteCode({ contractId: id, playerId, newCode: generateInviteCode() });
      switch (result.kind) {
        case "rotated": {
          const response: InviteRotateResponse = {
            inviteCode: result.inviteCode as InviteRotateResponse["inviteCode"],
          };
          return { status: 200, body: response };
        }
        case "not_found":
          return notFound();
        case "forbidden":
          return fail("FORBIDDEN");
        case "not_private":
          return fail("BAD_REQUEST", "Solo Contracts have no invite code");
        case "invite_code_taken":
          continue;
      }
    }
    return fail("INTERNAL");
  });

  const members = authed(ctx, "contractMembers", async (request, playerId): Promise<HttpResponse> => {
    const id = idParam(request.params.id);
    if (id === undefined) return notFound();
    const result = await ctx.repo.listMembers(id, playerId);
    if (result.kind === "not_found") return notFound();
    const body: ListMembersResponse = {
      members: result.members.map(
        (m) =>
          ({
            playerId: m.playerId,
            displayName: m.displayName,
            role: m.role,
            status: m.status,
            online: false,
          }) as ContractMember,
      ),
    };
    return { status: 200, body };
  });

  return [
    { ...API_ROUTES.contractsList, handle: list },
    { ...API_ROUTES.contractsCreate, handle: create },
    { ...API_ROUTES.contractGet, handle: get },
    { ...API_ROUTES.contractPatch, handle: patch },
    { ...API_ROUTES.contractJoinByCode, handle: joinByCode },
    { ...API_ROUTES.contractInviteRotate, handle: rotate },
    { ...API_ROUTES.contractMembers, handle: members },
  ];
}
