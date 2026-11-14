// Access tokens: HS256 JWT via `jose`, 15-minute expiry, claims sub / iat / exp / iss / aud / jti (security.md section 3).
// `aud` = `mc-<ENV_NAME>` so a token minted by local is rejected by production. `JWT_SECRET_PREVIOUS` is accepted for
// verification only. `createTokenService().verifyToken` is what the composition root injects into the room's onAuth.

import type { EnvName } from "@moon-cleanup/shared";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";

export const ACCESS_TOKEN_TTL_S = 900;
export const JWT_ISSUER = "moon-cleanup";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerifiedToken {
  readonly playerId: string;
  /** Expiry as epoch milliseconds. */
  readonly expiresAtMs: number;
}

/** Signature of the verifier handed to the room (`null` = reject; never throws). */
export type VerifyToken = (token: string) => Promise<VerifiedToken | null>;

export interface TokenServiceConfig {
  readonly jwtSecret: string;
  readonly jwtSecretPrevious?: string | undefined;
  readonly envName: EnvName;
  /** Test seam: epoch ms. */
  readonly now?: () => number;
}

export interface TokenService {
  signAccessToken(playerId: string): Promise<string>;
  verifyToken: VerifyToken;
}

export function createTokenService(config: TokenServiceConfig): TokenService {
  const now = config.now ?? Date.now;
  const encoder = new TextEncoder();
  const current = encoder.encode(config.jwtSecret);
  const previous = config.jwtSecretPrevious === undefined ? undefined : encoder.encode(config.jwtSecretPrevious);
  const audience = `mc-${config.envName}`;

  const verifyWith = async (token: string, key: Uint8Array): Promise<VerifiedToken | null> => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience,
      currentDate: new Date(now()),
      requiredClaims: ["sub", "exp", "iat", "jti"],
    });
    if (typeof payload.sub !== "string" || !UUID_RE.test(payload.sub) || typeof payload.exp !== "number") return null;
    return { playerId: payload.sub.toLowerCase(), expiresAtMs: payload.exp * 1000 };
  };

  return {
    async signAccessToken(playerId) {
      const iat = Math.floor(now() / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(playerId)
        .setIssuer(JWT_ISSUER)
        .setAudience(audience)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ACCESS_TOKEN_TTL_S)
        .setJti(randomUUID())
        .sign(current);
    },
    async verifyToken(token) {
      if (token.length === 0 || token.length > 2048) return null;
      for (const key of previous === undefined ? [current] : [current, previous]) {
        try {
          return await verifyWith(token, key);
        } catch {
          // wrong key, expired, malformed: try the next key, then reject uniformly
        }
      }
      return null;
    },
  };
}
