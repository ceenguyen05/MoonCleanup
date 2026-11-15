// Composition of the account API: tokens, rate limits, repository and the three route groups. The composition root
// (apps/server/src/app) calls `createAccountApi` once, appends `routes` to the health routes it already mounts, and injects
// `verifyToken` into the room's onAuth.

import { errorCodeForLog, type MoonRepository } from "@moon-cleanup/db";
import type { EnvName, HttpRouteDef, StorageState } from "@moon-cleanup/shared";
import { createAccountRoutes } from "./accounts";
import { createCheckpointRoutes, type CheckpointOptions } from "./checkpoints";
import { createContractRoutes } from "./contracts";
import type { ApiLogger, AuditEvent } from "./http";
import { createRateLimits, type RateLimits } from "./rate-limits";
import { createTokenService, type VerifyToken } from "./tokens";
import { createUploadAdmission, type UploadAdmission } from "./upload-admission";

export interface AccountApiDeps {
  readonly repo: MoonRepository;
  readonly envName: EnvName;
  readonly jwtSecret: string;
  readonly jwtSecretPrevious?: string | undefined;
  readonly refreshTokenPepper: string;
  readonly logger: ApiLogger;
  readonly storage?: () => StorageState;
  readonly online?: (contractId: string) => number;
  readonly blockedNames?: readonly string[];
  /** Test seams. */
  readonly now?: () => number;
  readonly rates?: RateLimits;
  readonly audit?: (event: AuditEvent) => void;
  /** Minimum gap between lazy refresh-token purges in ms (default one day; 0 disables). */
  readonly purgeIntervalMs?: number;
  /** Solo checkpoint verification options (bake hash, known game-data versions, caps). */
  readonly checkpoints?: CheckpointOptions;
}

/** The free Render service sleeps when idle, so an in-process daily timer rarely fires: purge on request as well. */
export const DEFAULT_LAZY_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After a failed purge, wait this long before the next attempt (a powered-off database must not be hammered). */
export const LAZY_PURGE_RETRY_MS = 10 * 60 * 1000;

export interface LazyPurgeDeps {
  readonly repo: Pick<MoonRepository, "purgeRefreshTokens">;
  readonly logger: ApiLogger;
  readonly now: () => number;
  readonly intervalMs: number;
}

/**
 * Returns a hook that purges expired and replaced refresh tokens at most once per `intervalMs`, fire-and-forget. The first
 * call after boot purges immediately. A failure is logged by error code only and retried after `LAZY_PURGE_RETRY_MS`.
 */
export function createLazyPurge(deps: LazyPurgeDeps): () => void {
  if (deps.intervalMs <= 0) return () => undefined;
  let nextAt = Number.NEGATIVE_INFINITY;
  let running = false;
  return () => {
    const at = deps.now();
    if (running || at < nextAt) return;
    running = true;
    nextAt = at + deps.intervalMs;
    let pending: Promise<number>;
    try {
      pending = deps.repo.purgeRefreshTokens();
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      () => {
        running = false; // success is silent: ApiLogger has no info level and a daily purge is not an event worth a warning
      },
      (error: unknown) => {
        running = false;
        nextAt = at + LAZY_PURGE_RETRY_MS;
        deps.logger.error({ code: errorCodeForLog(error) }, "refresh token purge failed");
      },
    );
  };
}

export interface AccountApi {
  readonly routes: HttpRouteDef[];
  /** Verifies a Bearer access token; inject into the room's onAuth. Never throws, `null` = reject. */
  readonly verifyToken: VerifyToken;
  /**
   * Raw-upload admission for the transport (`rawBodyAuth`): verifies the token, then rate-limits upload slot acquisition per
   * account and per client address (IPv6 by /64). Never rejects. The transport must pass the client address as 2nd argument
   * and answer a refusal with 429 (see the T07b-security-residuals report for the exact net patch).
   */
  readonly admitRawUpload: UploadAdmission;
  readonly rates: RateLimits;
}

export function createAccountApi(deps: AccountApiDeps): AccountApi {
  const now = deps.now ?? Date.now;
  const tokens = createTokenService({
    jwtSecret: deps.jwtSecret,
    jwtSecretPrevious: deps.jwtSecretPrevious,
    envName: deps.envName,
    now,
  });
  const rates = deps.rates ?? createRateLimits();
  const housekeeping = createLazyPurge({
    repo: deps.repo,
    logger: deps.logger,
    now,
    intervalMs: deps.purgeIntervalMs ?? DEFAULT_LAZY_PURGE_INTERVAL_MS,
  });
  const ctx = {
    housekeeping,
    repo: deps.repo,
    tokens,
    pepper: deps.refreshTokenPepper,
    rates,
    logger: deps.logger,
    audit: deps.audit ?? ((event: AuditEvent) => deps.logger.warn({ audit: event.kind }, "audit event")),
    now,
    storage: deps.storage ?? ((): StorageState => "ok"),
    online: deps.online ?? ((): number => 0),
    blockedNames: deps.blockedNames ?? [],
  };
  return {
    admitRawUpload: createUploadAdmission({ verifyToken: tokens.verifyToken, rates, audit: ctx.audit }),
    routes: [
      ...createAccountRoutes(ctx),
      ...createContractRoutes(ctx),
      ...createCheckpointRoutes(ctx, deps.checkpoints),
    ],
    verifyToken: tokens.verifyToken,
    rates,
  };
}
