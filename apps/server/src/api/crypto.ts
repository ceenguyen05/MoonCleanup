// Secret handling primitives of the account API (security.md section 3). Every value that is stored or compared passes
// through HMAC-SHA256 under REFRESH_TOKEN_PEPPER; raw refresh tokens and recovery codes exist only in the response that
// creates them. Random material comes from the platform CSPRNG.

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Crockford base32 alphabet (no I, L, O, U). 32 symbols = 5 bits each. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function crockford(length: number): string {
  // No modulo bias: 256 is a multiple of 32, so a masked random byte is uniform.
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += CROCKFORD[bytes[i]! & 31];
  return out;
}

/** HMAC-SHA256(value, pepper) as lower-case hex (64 characters). Stored in bytea / identity.subject. */
export function pepperedHash(pepper: string, value: string): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

/** 256-bit opaque refresh token, base64url (43 characters, matches `RefreshRequestSchema`). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 16 Crockford characters (80 bits) shown as `XXXX-XXXX-XXXX-XXXX`. */
export function generateRecoveryCode(): string {
  const raw = crockford(16);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

/** Canonical form hashed for storage and lookup: upper-case, dashes removed. */
export function normalizeCode(code: string): string {
  return code.replace(/-/g, "").toUpperCase();
}

/** 8 Crockford characters (40 bits) invite code. */
export function generateInviteCode(): string {
  return crockford(8);
}

/** Random unsigned 64-bit seed as a decimal string. */
export function generateSeed(): string {
  return randomBytes(8).readBigUInt64BE().toString();
}

/** Four random digits for default display names. */
export function randomDigits4(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

/** Constant-time equality of two strings (hashes, tokens). Different lengths are unequal without a timing signal. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
