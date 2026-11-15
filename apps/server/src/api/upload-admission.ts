// Admission of a raw (checkpoint) upload, run by the transport after the Bearer token is read and BEFORE a body slot is taken
// (security review R2). It verifies the token (a cheap HMAC) and then spends one point of the slot-acquisition rules per
// account and per client address (IPv6 by /64), so an authenticated client cannot churn the 4 process-wide upload slots
// (connect, hold up to ~5 s, drop, repeat) without limit. A forged token answers null (-> 401) and consumes nothing, so an
// unauthenticated client can never spend another account's or address's allowance.
//
// Structural twin of the transport's `RawBodyAuth` (net/http-routes): the api layer does not import the net layer.

import type { AuditEvent } from "./http";
import { rateKeyForIp, type RateLimits } from "./rate-limits";
import type { VerifyToken } from "./tokens";

/** The admission refused the attempt: the transport answers 429 with `retry-after`. */
export interface UploadAdmissionRefusal {
  readonly rateLimited: true;
  readonly retryAfterS: number;
}

/** Resolves the account id (admitted), a refusal (429) or `null` (invalid token, 401). Never rejects. */
export type UploadAdmission = (token: string, remoteAddress: string) => Promise<string | UploadAdmissionRefusal | null>;

export interface UploadAdmissionDeps {
  readonly verifyToken: VerifyToken;
  readonly rates: RateLimits;
  readonly audit: (event: AuditEvent) => void;
}

export function createUploadAdmission(deps: UploadAdmissionDeps): UploadAdmission {
  return async (token, remoteAddress) => {
    let verified: Awaited<ReturnType<VerifyToken>>;
    try {
      verified = await deps.verifyToken(token);
    } catch {
      return null;
    }
    if (verified === null) return null;
    const playerId = verified.playerId;
    // Account first: a churning account exhausts its own allowance without draining the shared address allowance of others.
    const byAccount = await deps.rates.consume("uploadSlotAccount", playerId);
    if (!byAccount.ok) {
      deps.audit({ kind: "rate_limited", playerId });
      return { rateLimited: true, retryAfterS: byAccount.retryAfterS };
    }
    const byAddress = await deps.rates.consume("uploadSlotIp", rateKeyForIp(remoteAddress));
    if (!byAddress.ok) {
      deps.audit({ kind: "rate_limited", playerId });
      return { rateLimited: true, retryAfterS: byAddress.retryAfterS };
    }
    return playerId;
  };
}
