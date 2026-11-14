// CORS and WebSocket origin policy (security.md sections 4.1 and 4.2).
//
// - Origins match exactly (scheme + host + port); no wildcards, no suffix matching, never `*.vercel.app`.
// - The response echoes the request origin only on an exact match, adds `Vary: Origin`, never sets
//   `Access-Control-Allow-Credentials`.
// - Public paths (`/healthz`, wake probing) answer `Access-Control-Allow-Origin: *` instead.
// - WebSocket upgrades need an allowed `Origin` header; a missing header is refused too (bots send an allowed one).

/** Paths answered with `Access-Control-Allow-Origin: *` (no data, needed for wake probing from any page state). */
export const PUBLIC_CORS_PATHS: readonly string[] = ["/healthz"];

export const CORS_ALLOWED_HEADERS = "Authorization, Content-Type";
export const CORS_ALLOWED_METHODS = "GET, POST, PATCH, DELETE";
/** Preflight cache, seconds (security.md section 4.1). */
export const CORS_MAX_AGE_S = 600;

export interface OriginPolicy {
  /** The exact allowlist this policy was built from (normalised, deduplicated). */
  readonly origins: readonly string[];
  /** Whether `origin` is on the allowlist. `null`/`undefined`/empty are never allowed. */
  isAllowed(origin: string | null | undefined): boolean;
  /**
   * CORS headers for an actual (non-preflight) response to a request from `origin`. Empty when the origin is not
   * allowed. Header names are lower-case.
   */
  responseHeaders(origin: string | null | undefined): Record<string, string>;
  /** CORS headers for a preflight (`OPTIONS`) response. Empty when the origin is not allowed. */
  preflightHeaders(origin: string | null | undefined): Record<string, string>;
}

const ORIGIN_RE = /^https?:\/\/[^/\s?#]+$/;

/**
 * Builds the policy. Every entry must be an exact http(s) origin without path or trailing slash; anything else
 * (including `*`) throws, so a misconfigured env can never widen the policy.
 */
export function createOriginPolicy(allowedOrigins: readonly string[]): OriginPolicy {
  const set = new Set<string>();
  for (const raw of allowedOrigins) {
    const origin = raw.trim();
    if (!ORIGIN_RE.test(origin) || origin.includes("*")) {
      throw new Error(`allowedOrigins: "${origin}" is not an exact http(s) origin`);
    }
    set.add(origin.toLowerCase());
  }
  if (set.size === 0) throw new Error("allowedOrigins: at least one origin is required");
  const origins = [...set];

  const isAllowed = (origin: string | null | undefined): boolean =>
    typeof origin === "string" && origin.length > 0 && set.has(origin.toLowerCase());

  return {
    origins,
    isAllowed,
    responseHeaders(origin): Record<string, string> {
      if (!isAllowed(origin)) return {};
      return { "access-control-allow-origin": origin as string, vary: "Origin" };
    },
    preflightHeaders(origin): Record<string, string> {
      if (!isAllowed(origin)) return {};
      return {
        "access-control-allow-origin": origin as string,
        "access-control-allow-headers": CORS_ALLOWED_HEADERS,
        "access-control-allow-methods": CORS_ALLOWED_METHODS,
        "access-control-max-age": String(CORS_MAX_AGE_S),
        vary: "Origin",
      };
    },
  };
}
