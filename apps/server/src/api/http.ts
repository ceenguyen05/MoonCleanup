// Shared plumbing of the account / profile / Contract routes: uniform error bodies, strict body parsing, rate-limit gates,
// Bearer authentication and the database-failure mapping. Handlers never see raw errors and never log secrets.

import { errorCodeForLog, isUnreachableError, type MoonRepository } from "@moon-cleanup/db";
import {
  API_ERROR_STATUS,
  type ApiErrorCode,
  type HttpRequest,
  type HttpResponse,
  type StorageState,
} from "@moon-cleanup/shared";
import type { z } from "zod";
import type { RateLimits, RateRuleName } from "./rate-limits";
import type { TokenService } from "./tokens";

/** Audit event kinds this layer raises (data-model.md section 3.11; the table itself arrives later, events are logged). */
export type AuditKind =
  "guest_create_limited" | "token_reuse" | "recover_failed" | "recover_global_lock" | "rate_limited";

export interface AuditEvent {
  readonly kind: AuditKind;
  readonly playerId?: string;
}

/** Minimal logger surface (pino's Logger satisfies it). Never pass tokens, codes, hashes or request bodies. */
export interface ApiLogger {
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ApiContext {
  readonly repo: MoonRepository;
  readonly tokens: TokenService;
  /** REFRESH_TOKEN_PEPPER: HMAC key of stored token and recovery-code digests. */
  readonly pepper: string;
  readonly rates: RateLimits;
  readonly logger: ApiLogger;
  readonly audit: (event: AuditEvent) => void;
  /** Epoch ms (test seam). */
  readonly now: () => number;
  /** Storage state against the 1 GB cap; `full` and `emergency` refuse new Contracts (507). */
  readonly storage: () => StorageState;
  /** Players connected to the live room of a Contract (0 when none). */
  readonly online: (contractId: string) => number;
  /** Extra lower-case display / Contract names to refuse (profanity list is server data). */
  readonly blockedNames: readonly string[];
}

export function fail(code: ApiErrorCode, message?: string, headers?: Record<string, string>): HttpResponse {
  return {
    status: API_ERROR_STATUS[code],
    body: message === undefined ? { error: code } : { error: code, message },
    ...(headers === undefined ? {} : { headers }),
  };
}

export const unauthorized = (): HttpResponse => fail("UNAUTHORIZED", "invalid or expired credentials");
export const notFound = (): HttpResponse => fail("NOT_FOUND");

export function rateLimited(retryAfterS: number): HttpResponse {
  return fail("RATE_LIMITED", "too many requests", { "retry-after": String(retryAfterS) });
}

/** Strict parse of a JSON body: unknown keys are stripped by the shared schemas; any failure is a uniform 400. */
export function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
): { ok: true; value: z.output<S> } | { ok: false; response: HttpResponse } {
  const result = schema.safeParse(value);
  if (!result.success) return { ok: false, response: fail("BAD_REQUEST", "invalid request") };
  return { ok: true, value: result.data };
}

/** Applies rate rules in order. Returns a 429 response, or `undefined` when all pass. */
export async function gate(
  ctx: ApiContext,
  rules: readonly { rule: RateRuleName; key: string }[],
  onLimited?: () => void,
): Promise<HttpResponse | undefined> {
  for (const { rule, key } of rules) {
    const decision = await ctx.rates.consume(rule, key);
    if (!decision.ok) {
      onLimited?.();
      return rateLimited(decision.retryAfterS);
    }
  }
  return undefined;
}

/** Wraps a handler: a database that is waking or unreachable becomes 503 RETRY_LATER, anything else a bare 500. */
export function safe(
  ctx: ApiContext,
  route: string,
  handler: (request: HttpRequest) => Promise<HttpResponse>,
): (request: HttpRequest) => Promise<HttpResponse> {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (isUnreachableError(error)) {
        return fail("RETRY_LATER", "records are waking up, retry shortly", { "retry-after": "5" });
      }
      ctx.logger.error({ route, code: errorCodeForLog(error) }, "api handler failed");
      return fail("INTERNAL");
    }
  };
}

/** Extracts the bearer token from the Authorization header. */
export function bearerToken(request: HttpRequest): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9._-]{16,2048})$/.exec(header);
  return match?.[1];
}

/**
 * Authenticated route: per-IP then per-player REST limits, Bearer JWT verification, hourly `last_seen_at` touch.
 * All authentication failures answer the same 401.
 */
export function authed(
  ctx: ApiContext,
  route: string,
  handler: (request: HttpRequest, playerId: string) => Promise<HttpResponse>,
): (request: HttpRequest) => Promise<HttpResponse> {
  return safe(ctx, route, async (request) => {
    const limited = await gate(ctx, [{ rule: "ipRest", key: request.remoteAddress }]);
    if (limited !== undefined) return limited;
    const token = bearerToken(request);
    const verified = token === undefined ? null : await ctx.tokens.verifyToken(token);
    if (verified === null) return unauthorized();
    const perPlayer = await gate(ctx, [{ rule: "playerRest", key: verified.playerId }]);
    if (perPlayer !== undefined) return perPlayer;
    void ctx.repo.touchPlayer(verified.playerId).catch(() => undefined);
    return handler(request, verified.playerId);
  });
}
