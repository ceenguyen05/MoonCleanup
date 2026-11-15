import {
  ApiErrorBodySchema,
  GuestCreateResponseSchema,
  ProfileSchema,
  RefreshResponseSchema,
  type GuestCreateResponse,
} from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { pepperedHash, safeEqual } from "./crypto";
import { createHarness, TEST_JWT_SECRET, TEST_PEPPER, type Harness } from "./test-harness";
import { createTokenService } from "./tokens";

async function makeGuest(h: Harness, ip = "203.0.113.7", displayName?: string): Promise<GuestCreateResponse> {
  const res = await h.call("POST", "/v1/auth/guest", { ip, body: displayName === undefined ? {} : { displayName } });
  expect(res.status).toBe(201);
  return GuestCreateResponseSchema.parse(res.body);
}

describe("guest creation", () => {
  it("returns a valid DTO, a 15-minute access token and a profile reachable with it", async () => {
    const h = createHarness();
    const guest = await makeGuest(h, undefined, "Alex Guest");
    expect(guest.displayName).toBe("Alex Guest");
    expect(guest.accessExpiresInS).toBe(900);
    expect(guest.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    const me = await h.call("GET", "/v1/me", { token: guest.accessToken });
    expect(me.status).toBe(200);
    expect(ProfileSchema.parse(me.body)).toMatchObject({ playerId: guest.playerId, isGuest: true, version: 0 });
  });

  it("generates a default display name and strips unknown keys", async () => {
    const h = createHarness();
    const res = await h.call("POST", "/v1/auth/guest", { body: { isAdmin: true } });
    expect(res.status).toBe(201);
    expect(GuestCreateResponseSchema.parse(res.body).displayName).toMatch(/^Custodian \d{4}$/);
  });

  it("rejects invalid and reserved display names with a uniform 400", async () => {
    const h = createHarness();
    let n = 0;
    for (const displayName of ["ab", "x".repeat(21), " lead", "DOT", "admin", "Brightside", "bad<script>"]) {
      // Distinct addresses: invalid requests also consume the per-IP guest allowance.
      const res = await h.call("POST", "/v1/auth/guest", { body: { displayName }, ip: `192.0.2.${(n += 1)}` });
      expect(res.status, displayName).toBe(400);
      expect(ApiErrorBodySchema.parse(res.body).error).toBe("BAD_REQUEST");
    }
    expect((await h.call("POST", "/v1/auth/guest", { body: "not an object", ip: "192.0.2.99" })).status).toBe(400);
  });

  it("limits guest creation per IP (5 per hour) and audits it", async () => {
    const h = createHarness();
    for (let i = 0; i < 5; i += 1) await makeGuest(h, "198.51.100.1");
    const limited = await h.call("POST", "/v1/auth/guest", { ip: "198.51.100.1" });
    expect(limited.status).toBe(429);
    expect(limited.headers?.["retry-after"]).toMatch(/^\d+$/);
    expect(h.audits).toContain("guest_create_limited");
    // Another address is unaffected; the unresolved-IP bucket is tighter (1 per hour).
    await makeGuest(h, "198.51.100.2");
    await makeGuest(h, "unknown");
    expect((await h.call("POST", "/v1/auth/guest", { ip: "unknown" })).status).toBe(429);
  });

  it("never stores or logs the raw tokens or recovery code", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    const presented = await h.repo.rotateRefreshToken({
      presentedHash: pepperedHash(TEST_PEPPER, guest.refreshToken),
      next: { id: "00000000-0000-7000-8000-000000000001", hash: "f".repeat(64), expiresAt: new Date(h.now() + 1000) },
    });
    expect(presented.kind).toBe("rotated"); // the DIGEST is what the repository knows
    const logged = h.logs.join("\n");
    for (const secret of [guest.refreshToken, guest.recoveryCode, guest.accessToken]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("refresh rotation", () => {
  it("rotates: the new pair works, the access token carries the player", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    h.advance(120_000);
    const res = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } });
    expect(res.status).toBe(200);
    const pair = RefreshResponseSchema.parse(res.body);
    expect(pair.refreshToken).not.toBe(guest.refreshToken);
    const verified = await h.api.verifyToken(pair.accessToken);
    expect(verified?.playerId).toBe(guest.playerId);
  });

  it("an expired refresh token (180 days) is a uniform 401", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    h.advance(181 * 86_400_000);
    const res = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "UNAUTHORIZED", message: "invalid or expired credentials" });
  });

  it("reuse after the grace window revokes the family: theft signal, audit, even the newest token dies", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    h.advance(1000);
    const newest = RefreshResponseSchema.parse(
      (await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } })).body,
    );
    h.advance(61_000);
    const replay = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } });
    expect(replay.status).toBe(401);
    expect(h.audits).toContain("token_reuse");
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: newest.refreshToken } })).status).toBe(
      401,
    );
  });

  it("a retry inside the grace window (lost response) succeeds and the family survives", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    h.advance(1000);
    const first = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } });
    expect(first.status).toBe(200); // the client never saw this response
    h.advance(5000);
    const retry = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } });
    expect(retry.status).toBe(200);
    const pair = RefreshResponseSchema.parse(retry.body);
    h.advance(1000);
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: pair.refreshToken } })).status).toBe(200);
  });

  it("409 TOKEN_SUPERSEDED when another tab already used the successor, without revoking anything", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    h.advance(1000);
    const tabB = RefreshResponseSchema.parse(
      (await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } })).body,
    );
    h.advance(1000);
    const tabBNext = RefreshResponseSchema.parse(
      (await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: tabB.refreshToken } })).body,
    );
    h.advance(1000);
    const tabA = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } });
    expect(tabA.status).toBe(409);
    expect(ApiErrorBodySchema.parse(tabA.body).error).toBe("TOKEN_SUPERSEDED");
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: tabBNext.refreshToken } })).status).toBe(
      200,
    );
  });

  it("wrong pepper: a token minted under one pepper is unknown under another", async () => {
    const a = createHarness();
    const guest = await makeGuest(a);
    // Same database, rotated pepper: the stored digests no longer match what the new process computes.
    const b = createHarness({ repo: a.repo, refreshTokenPepper: "a-completely-different-pepper-0123456789abcdef" });
    const res = await b.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } });
    expect(res.status).toBe(401);
    // And the original pepper still works.
    expect((await a.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } })).status).toBe(200);
  });

  it("rejects malformed refresh bodies with 400 and unknown tokens with 401, identically shaped", async () => {
    const h = createHarness();
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: "short" } })).status).toBe(400);
    expect((await h.call("POST", "/v1/auth/refresh", {})).status).toBe(400);
    const unknown = await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: "A".repeat(43) } });
    expect(unknown.status).toBe(401);
    expect(ApiErrorBodySchema.safeParse(unknown.body).success).toBe(true);
  });

  it("limits refresh per IP (60 per hour)", async () => {
    const h = createHarness();
    for (let i = 0; i < 60; i += 1) {
      expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: "B".repeat(43) } })).status).toBe(401);
    }
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: "B".repeat(43) } })).status).toBe(429);
  });
});

describe("logout and recovery", () => {
  it("logout revokes the family and answers 204 even for unknown tokens", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    expect((await h.call("POST", "/v1/auth/logout", { body: { refreshToken: "C".repeat(43) } })).status).toBe(204);
    expect((await h.call("POST", "/v1/auth/logout", { body: { refreshToken: guest.refreshToken } })).status).toBe(204);
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } })).status).toBe(401);
  });

  it("recovery issues a new family and a new code, revokes old tokens, and the old code stops working", async () => {
    const h = createHarness();
    const guest = await makeGuest(h, undefined, "Recover Me");
    // Lower-case without dashes is accepted (schema allows optional dashes, case-insensitive).
    const typed = guest.recoveryCode.replace(/-/g, "").toLowerCase();
    const res = await h.call("POST", "/v1/auth/recover", { body: { code: typed }, ip: "198.51.100.9" });
    expect(res.status).toBe(200);
    const recovered = GuestCreateResponseSchema.parse(res.body);
    expect(recovered.playerId).toBe(guest.playerId);
    expect(recovered.displayName).toBe("Recover Me");
    expect(recovered.recoveryCode).not.toBe(guest.recoveryCode);
    expect((await h.call("POST", "/v1/auth/refresh", { body: { refreshToken: guest.refreshToken } })).status).toBe(401);
    expect(
      (await h.call("POST", "/v1/auth/recover", { body: { code: guest.recoveryCode }, ip: "198.51.100.10" })).status,
    ).toBe(401);
    expect(
      (await h.call("POST", "/v1/auth/recover", { body: { code: recovered.recoveryCode }, ip: "198.51.100.11" }))
        .status,
    ).toBe(200);
  });

  it("recover throttles per IP (5 per hour) and locks globally after 100 failures in an hour", async () => {
    const h = createHarness();
    const wrong = { code: "0000-0000-0000-0000" };
    for (let i = 0; i < 5; i += 1) {
      expect((await h.call("POST", "/v1/auth/recover", { body: wrong, ip: "192.0.2.1" })).status).toBe(401);
    }
    expect((await h.call("POST", "/v1/auth/recover", { body: wrong, ip: "192.0.2.1" })).status).toBe(429);

    // 96 more failures from distinct addresses: the 101st failure overall trips the global lock for everyone.
    for (let i = 0; i < 96; i += 1) {
      const res = await h.call("POST", "/v1/auth/recover", { body: wrong, ip: `192.0.3.${i}` });
      expect(res.status).toBe(401);
    }
    expect(h.audits).toContain("recover_global_lock");
    const locked = await h.call("POST", "/v1/auth/recover", { body: wrong, ip: "192.0.4.1" });
    expect(locked.status).toBe(429);
    h.advance(16 * 60_000);
    expect((await h.call("POST", "/v1/auth/recover", { body: wrong, ip: "192.0.4.2" })).status).toBe(401);
  });
});

describe("access tokens", () => {
  const config = { jwtSecret: TEST_JWT_SECRET, envName: "local" as const };

  it("verifies a fresh token and rejects it after 15 minutes", async () => {
    let now = Date.parse("2026-11-14T12:00:00Z");
    const svc = createTokenService({ ...config, now: () => now });
    const token = await svc.signAccessToken("0190a000-0000-7000-8000-000000000001");
    expect((await svc.verifyToken(token))?.playerId).toBe("0190a000-0000-7000-8000-000000000001");
    now += 14 * 60_000 + 59_000;
    expect(await svc.verifyToken(token)).not.toBeNull();
    now += 2000;
    expect(await svc.verifyToken(token)).toBeNull();
  });

  it("rejects wrong secret, other environment, garbage and the none algorithm; accepts the previous secret", async () => {
    const now = () => Date.parse("2026-11-14T12:00:00Z");
    const svc = createTokenService({ ...config, now });
    const token = await svc.signAccessToken("0190a000-0000-7000-8000-000000000002");

    const otherSecret = createTokenService({ ...config, jwtSecret: "z".repeat(40), now });
    expect(await otherSecret.verifyToken(token)).toBeNull();
    const production = createTokenService({ ...config, envName: "production", now });
    expect(await production.verifyToken(token)).toBeNull(); // aud mc-local rejected by production

    for (const bad of ["", "abc", "a.b.c", `${token}x`, "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0."]) {
      expect(await svc.verifyToken(bad)).toBeNull();
    }
    const rotated = createTokenService({
      ...config,
      jwtSecret: "n".repeat(40),
      jwtSecretPrevious: TEST_JWT_SECRET,
      now,
    });
    expect((await rotated.verifyToken(token))?.playerId).toBe("0190a000-0000-7000-8000-000000000002");
  });

  it("REST: missing, malformed, expired and foreign Bearer tokens are one uniform 401", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    const foreign = await createTokenService({
      ...{ jwtSecret: "q".repeat(40), envName: "local" as const },
      now: h.now,
    }).signAccessToken(guest.playerId);
    const responses = [
      await h.call("GET", "/v1/me"),
      await h.call("GET", "/v1/me", { headers: { authorization: "Basic abc" } }),
      await h.call("GET", "/v1/me", { token: "not.a.jwt-but-long-enough" }),
      await h.call("GET", "/v1/me", { token: foreign }),
    ];
    h.advance(16 * 60_000);
    responses.push(await h.call("GET", "/v1/me", { token: guest.accessToken }));
    for (const res of responses) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "UNAUTHORIZED", message: "invalid or expired credentials" });
    }
  });

  it("constant-time compare helper behaves", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("profile", () => {
  it("PATCH enforces optimistic concurrency, validation and owned cosmetics", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    const ok = await h.call("PATCH", "/v1/me", {
      token: guest.accessToken,
      body: { displayName: "New Name", version: 0 },
    });
    expect(ok.status).toBe(200);
    expect(ProfileSchema.parse(ok.body)).toMatchObject({ displayName: "New Name", version: 1 });

    const stale = await h.call("PATCH", "/v1/me", {
      token: guest.accessToken,
      body: { displayName: "Stale One", version: 0 },
    });
    expect(stale.status).toBe(409);
    // REST contract v0.3.0: the client's retry loop keys on VERSION_CONFLICT, not BAD_REQUEST.
    expect(ApiErrorBodySchema.parse(stale.body).error).toBe("VERSION_CONFLICT");
    expect((await h.call("PATCH", "/v1/me", { token: guest.accessToken, body: { version: 1 } })).status).toBe(400);
    expect(
      (await h.call("PATCH", "/v1/me", { token: guest.accessToken, body: { displayName: "admin", version: 1 } }))
        .status,
    ).toBe(400);
    // Not owned -> refused.
    expect(
      (
        await h.call("PATCH", "/v1/me", {
          token: guest.accessToken,
          body: { equippedCosmetics: { helmet: "cos.gold" }, version: 1 },
        })
      ).status,
    ).toBe(400);
    expect(
      (await h.call("PATCH", "/v1/me", { token: guest.accessToken, body: { equippedCosmetics: {}, version: 1 } }))
        .status,
    ).toBe(200);
  });

  it("limits authenticated REST to 120 per minute per player", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    for (let i = 0; i < 120; i += 1) {
      expect((await h.call("GET", "/v1/me", { token: guest.accessToken })).status).toBe(200);
    }
    expect((await h.call("GET", "/v1/me", { token: guest.accessToken })).status).toBe(429);
  });
});

describe("failure mapping", () => {
  it("maps an unreachable database to 503 RETRY_LATER and any other failure to a bare 500", async () => {
    const h = createHarness();
    const guest = await makeGuest(h);
    const broken = createHarness({
      repo: {
        ...h.repo,
        getProfile: () =>
          Promise.reject(
            Object.assign(new Error("secret connection string postgres://u:p@h/d"), { code: "ECONNREFUSED" }),
          ),
      },
      now: h.now,
    });
    const unreachable = await broken.call("GET", "/v1/me", { token: guest.accessToken });
    expect(unreachable.status).toBe(503);
    expect(unreachable.headers?.["retry-after"]).toBe("5");

    const crashing = createHarness({
      repo: { ...h.repo, getProfile: () => Promise.reject(new Error("boom postgres://u:p@h/d")) },
      now: h.now,
    });
    const res = await crashing.call("GET", "/v1/me", { token: guest.accessToken });
    expect(res).toEqual({ status: 500, body: { error: "INTERNAL" } });
    expect(crashing.logs.join("\n")).not.toContain("postgres://");
    expect(JSON.stringify(res)).not.toContain("boom");
  });
});
