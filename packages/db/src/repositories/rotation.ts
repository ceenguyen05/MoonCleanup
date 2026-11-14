// The refresh-token rotation decision (security.md section 3), as a pure function so the PostgreSQL and in-memory
// repositories apply EXACTLY the same rules. Callers load the presented row (and its successor) under a row lock, pass
// the database `now`, and then perform the writes the decision names.
//
// Rules, in order:
//  1. unknown / expired / revoked token                       -> invalid (no side effects)
//  2. current token (never replaced)                           -> rotate (replace it, issue a successor)
//  3. replaced token presented within the 60 s grace window:
//       a. its successor is the family's live newest and has never been used -> reissue (revoke the unused successor as
//          `superseded`, issue a fresh one; the original replaced_at is kept so retries cannot extend the window)
//       b. its successor was already used (another tab or browser won the race) -> superseded (409, nothing revoked)
//  4. anything else (replaced token older than 60 s, or the chain is broken) -> reuse (revoke the whole family)

import { REFRESH_GRACE_S } from "./types.ts";

export interface TokenRowView {
  readonly id: string;
  readonly familyId: string;
  readonly playerId: string;
  readonly expiresAt: Date;
  readonly replacedBy: string | null;
  readonly replacedAt: Date | null;
  readonly revokedAt: Date | null;
}

export type RotationDecision =
  | { readonly action: "invalid" }
  | { readonly action: "rotate" }
  | { readonly action: "reissue"; readonly successorId: string }
  | { readonly action: "superseded" }
  | { readonly action: "reuse" };

export function decideRotation(
  presented: TokenRowView | undefined,
  successor: TokenRowView | undefined,
  now: Date,
): RotationDecision {
  if (presented === undefined) return { action: "invalid" };
  if (presented.revokedAt !== null || presented.expiresAt.getTime() <= now.getTime()) return { action: "invalid" };
  if (presented.replacedAt === null) return { action: "rotate" };

  const withinGrace = now.getTime() - presented.replacedAt.getTime() <= REFRESH_GRACE_S * 1000;
  if (!withinGrace || successor === undefined || successor.familyId !== presented.familyId) return { action: "reuse" };

  if (successor.revokedAt === null && successor.replacedAt === null) {
    return { action: "reissue", successorId: successor.id };
  }
  // The successor was used (rotated again): a concurrent tab won. Only a still-live chain counts as a race; a revoked
  // chain means logout or recovery happened in between.
  if (successor.revokedAt === null) return { action: "superseded" };
  return { action: "invalid" };
}
