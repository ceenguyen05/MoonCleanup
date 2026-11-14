// Composition of the account API: tokens, rate limits, repository and the three route groups. The composition root
// (apps/server/src/app) calls `createAccountApi` once, appends `routes` to the health routes it already mounts, and injects
// `verifyToken` into the room's onAuth.

import type { MoonRepository } from "@moon-cleanup/db";
import type { EnvName, HttpRouteDef, StorageState } from "@moon-cleanup/shared";
import { createAccountRoutes } from "./accounts";
import { createContractRoutes } from "./contracts";
import type { ApiLogger, AuditEvent } from "./http";
import { createRateLimits, type RateLimits } from "./rate-limits";
import { createTokenService, type VerifyToken } from "./tokens";

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
}

export interface AccountApi {
  readonly routes: HttpRouteDef[];
  /** Verifies a Bearer access token; inject into the room's onAuth. Never throws, `null` = reject. */
  readonly verifyToken: VerifyToken;
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
  const ctx = {
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
    routes: [...createAccountRoutes(ctx), ...createContractRoutes(ctx)],
    verifyToken: tokens.verifyToken,
    rates,
  };
}
