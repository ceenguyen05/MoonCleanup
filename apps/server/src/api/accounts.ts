// Guest authentication and profile routes (security.md section 3, data-model.md sections 3.1-3.4).
//
//   POST  /v1/auth/guest    create player + profile + recovery code + first refresh token
//   POST  /v1/auth/refresh  rotate the refresh token (60 s grace window for lost responses)
//   POST  /v1/auth/recover  recovery code -> new token family and a replacement recovery code
//   POST  /v1/auth/logout   revoke the family of the presented refresh token (always 204)
//   GET   /v1/me, PATCH /v1/me
//
// The raw refresh token and recovery code leave this module only inside the response that creates them; storage sees
// HMAC-SHA256 digests under REFRESH_TOKEN_PEPPER.

import { uuidv7 } from "@moon-cleanup/db";
import {
  API_ROUTES,
  DisplayNameSchema,
  GuestCreateRequestSchema,
  LogoutRequestSchema,
  ProfilePatchRequestSchema,
  RESERVED_DISPLAY_NAMES,
  RecoverRequestSchema,
  RefreshRequestSchema,
  type GuestCreateResponse,
  type HttpRequest,
  type HttpResponse,
  type HttpRouteDef,
  type Profile,
  type RefreshResponse,
} from "@moon-cleanup/shared";
import { generateRecoveryCode, generateRefreshToken, normalizeCode, pepperedHash, randomDigits4 } from "./crypto";
import { authed, fail, gate, notFound, parse, safe, unauthorized, type ApiContext } from "./http";
import { ACCESS_TOKEN_TTL_S } from "./tokens";

/** Refresh token lifetime (data-model.md section 3.3): 180 days, sliding. */
export const REFRESH_TTL_MS = 180 * 86_400_000;
/** Global recovery throttle (security.md section 3): more than 100 failures in an hour locks the endpoint 15 minutes. */
export const RECOVER_GLOBAL_FAILURES_PER_HOUR = 100;
export const RECOVER_GLOBAL_LOCK_MS = 15 * 60_000;

const PROFILE_EQUIPPED_MAX_BYTES = 1024;

/** True when a display / Contract name is reserved or blocked (case-insensitive, NFC). */
export function isBlockedName(name: string, extra: readonly string[]): boolean {
  const folded = name.normalize("NFC").trim().toLowerCase();
  if (RESERVED_DISPLAY_NAMES.some((reserved) => reserved.toLowerCase() === folded)) return true;
  return extra.some((word) => word.length > 0 && folded.includes(word.toLowerCase()));
}

export function createAccountRoutes(ctx: ApiContext): HttpRouteDef[] {
  const hash = (value: string): string => pepperedHash(ctx.pepper, value);
  const newRefresh = () => {
    const raw = generateRefreshToken();
    return { raw, id: uuidv7(ctx.now()), hash: hash(raw), expiresAt: new Date(ctx.now() + REFRESH_TTL_MS) };
  };

  // Recover failure window (hour) and the global lock.
  let failureWindowStart = 0;
  let failuresInWindow = 0;
  let lockedUntil = 0;
  const recordRecoverFailure = (): void => {
    const now = ctx.now();
    if (now - failureWindowStart >= 3_600_000) {
      failureWindowStart = now;
      failuresInWindow = 0;
    }
    failuresInWindow += 1;
    ctx.audit({ kind: "recover_failed" });
    if (failuresInWindow > RECOVER_GLOBAL_FAILURES_PER_HOUR && lockedUntil <= now) {
      lockedUntil = now + RECOVER_GLOBAL_LOCK_MS;
      ctx.audit({ kind: "recover_global_lock" });
    }
  };

  const guestResponse = async (
    playerId: string,
    displayName: string,
    refreshToken: string,
    recoveryCode: string,
  ): Promise<GuestCreateResponse> =>
    ({
      playerId,
      displayName,
      accessToken: await ctx.tokens.signAccessToken(playerId),
      accessExpiresInS: ACCESS_TOKEN_TTL_S,
      refreshToken,
      recoveryCode,
    }) as GuestCreateResponse;

  const guestCreate = safe(ctx, "guestCreate", async (request: HttpRequest): Promise<HttpResponse> => {
    const limited = await gate(
      ctx,
      [
        { rule: "ipRest", key: request.remoteAddress },
        { rule: "guestCreate", key: request.remoteAddress },
      ],
      () => ctx.audit({ kind: "guest_create_limited" }),
    );
    if (limited !== undefined) return limited;
    const body = parse(GuestCreateRequestSchema, request.body ?? {});
    if (!body.ok) return body.response;
    const displayName = body.value.displayName ?? `Custodian ${randomDigits4()}`;
    if (isBlockedName(displayName, ctx.blockedNames)) return fail("BAD_REQUEST", "invalid request");

    const playerId = uuidv7(ctx.now());
    const refresh = newRefresh();
    const recoveryCode = generateRecoveryCode();
    await ctx.repo.createGuest({
      playerId,
      displayName,
      recoveryHash: hash(normalizeCode(recoveryCode)),
      token: { id: refresh.id, hash: refresh.hash, expiresAt: refresh.expiresAt, familyId: uuidv7(ctx.now()) },
    });
    return { status: 201, body: await guestResponse(playerId, displayName, refresh.raw, recoveryCode) };
  });

  const authRefresh = safe(ctx, "authRefresh", async (request: HttpRequest): Promise<HttpResponse> => {
    const limited = await gate(ctx, [
      { rule: "ipRest", key: request.remoteAddress },
      { rule: "refresh", key: request.remoteAddress },
    ]);
    if (limited !== undefined) return limited;
    const body = parse(RefreshRequestSchema, request.body);
    if (!body.ok) return body.response;

    const next = newRefresh();
    const result = await ctx.repo.rotateRefreshToken({
      presentedHash: hash(body.value.refreshToken),
      next: { id: next.id, hash: next.hash, expiresAt: next.expiresAt },
    });
    switch (result.kind) {
      case "rotated": {
        const response: RefreshResponse = {
          accessToken: await ctx.tokens.signAccessToken(result.playerId),
          accessExpiresInS: ACCESS_TOKEN_TTL_S,
          refreshToken: next.raw,
        };
        return { status: 200, body: response };
      }
      case "superseded":
        return fail("TOKEN_SUPERSEDED", "another session already refreshed this token");
      case "reuse_detected":
        ctx.audit({ kind: "token_reuse", playerId: result.playerId });
        return unauthorized();
      case "invalid":
        return unauthorized();
    }
  });

  const authRecover = safe(ctx, "authRecover", async (request: HttpRequest): Promise<HttpResponse> => {
    if (ctx.now() < lockedUntil) {
      return fail("RATE_LIMITED", "too many requests", {
        "retry-after": String(Math.max(1, Math.ceil((lockedUntil - ctx.now()) / 1000))),
      });
    }
    const limited = await gate(ctx, [
      { rule: "ipRest", key: request.remoteAddress },
      { rule: "recover", key: request.remoteAddress },
    ]);
    if (limited !== undefined) return limited;
    const body = parse(RecoverRequestSchema, request.body);
    if (!body.ok) return body.response;

    const refresh = newRefresh();
    const newCode = generateRecoveryCode();
    const recovered = await ctx.repo.recover({
      codeHash: hash(normalizeCode(body.value.code)),
      newCodeHash: hash(normalizeCode(newCode)),
      token: { id: refresh.id, hash: refresh.hash, expiresAt: refresh.expiresAt, familyId: uuidv7(ctx.now()) },
    });
    if (recovered === null) {
      recordRecoverFailure();
      return unauthorized();
    }
    return { status: 200, body: await guestResponse(recovered.playerId, recovered.displayName, refresh.raw, newCode) };
  });

  const authLogout = safe(ctx, "authLogout", async (request: HttpRequest): Promise<HttpResponse> => {
    const limited = await gate(ctx, [{ rule: "ipRest", key: request.remoteAddress }]);
    if (limited !== undefined) return limited;
    const body = parse(LogoutRequestSchema, request.body);
    if (!body.ok) return body.response;
    await ctx.repo.revokeFamilyByHash(hash(body.value.refreshToken)); // unknown token is not an oracle: still 204
    return { status: 204 };
  });

  const toProfileDto = (p: NonNullable<Awaited<ReturnType<ApiContext["repo"]["getProfile"]>>>): Profile =>
    ({
      playerId: p.playerId,
      displayName: p.displayName,
      isGuest: p.isGuest,
      tenureLevel: p.tenureLevel,
      tenurePoints: p.tenurePoints,
      commendations: p.commendations,
      lifetimeLumens: p.lifetimeLumens,
      lifetimePlotsPolished: p.lifetimePlotsPolished,
      cosmeticsOwned: [...p.cosmeticsOwned],
      equippedCosmetics: { ...p.equippedCosmetics },
      version: p.version,
    }) as Profile;

  const profileGet = authed(ctx, "profileGet", async (_request, playerId) => {
    const profile = await ctx.repo.getProfile(playerId);
    return profile === null ? notFound() : { status: 200, body: toProfileDto(profile) };
  });

  const profilePatch = authed(ctx, "profilePatch", async (request, playerId) => {
    const body = parse(ProfilePatchRequestSchema, request.body);
    if (!body.ok) return body.response;
    const { displayName, equippedCosmetics, version } = body.value;
    if (displayName === undefined && equippedCosmetics === undefined) return fail("BAD_REQUEST", "nothing to change");
    if (displayName !== undefined) {
      if (!DisplayNameSchema.safeParse(displayName).success || isBlockedName(displayName, ctx.blockedNames)) {
        return fail("BAD_REQUEST", "invalid request");
      }
    }
    if (equippedCosmetics !== undefined) {
      if (Buffer.byteLength(JSON.stringify(equippedCosmetics), "utf8") > PROFILE_EQUIPPED_MAX_BYTES) {
        return fail("BAD_REQUEST", "invalid request");
      }
      // Only owned cosmetics can be equipped.
      const current = await ctx.repo.getProfile(playerId);
      if (current === null) return notFound();
      const owned = new Set(current.cosmeticsOwned);
      if (!Object.values(equippedCosmetics).every((id) => owned.has(id))) return fail("BAD_REQUEST", "invalid request");
    }
    const result = await ctx.repo.updateProfile(playerId, {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(equippedCosmetics !== undefined ? { equippedCosmetics } : {}),
      expectedVersion: version,
    });
    switch (result.kind) {
      case "updated":
        return { status: 200, body: toProfileDto(result.profile) };
      case "version_conflict":
        // REST contract v0.3.0: the client refetches /v1/me, reapplies its edit and resends.
        return fail("VERSION_CONFLICT", "stale version");
      case "not_found":
        return notFound();
    }
  });

  return [
    { ...API_ROUTES.guestCreate, handle: guestCreate },
    { ...API_ROUTES.authRefresh, handle: authRefresh },
    { ...API_ROUTES.authRecover, handle: authRecover },
    { ...API_ROUTES.authLogout, handle: authLogout },
    { ...API_ROUTES.profileGet, handle: profileGet },
    { ...API_ROUTES.profilePatch, handle: profilePatch },
  ];
}
