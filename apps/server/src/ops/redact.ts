// Log redaction (security.md section 7): tokens, connection URIs, PEM blocks and secret-named keys never reach logs.
// Pure functions, no pino import, so they are unit-tested directly and reused by the logger hooks.

export const REDACTED = "[redacted]";

/** Object keys whose values are always replaced (case-insensitive, separators ignored). */
const SECRET_KEY_RE =
  /(token|secret|password|passwd|authorization|cookie|pepper|databaseurl|cacert|privatekey|jointicket|recoverycode|dsn|connectionstring|apikey)/i;

const URI_CREDENTIALS_RE = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']*@/gi;
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const PEM_RE = /-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g;
/** Connection strings keep scheme and host but lose the query (it may carry passwords or certificates). */
const DB_QUERY_RE = /\b(postgres(?:ql)?:\/\/[^\s?"']*)\?[^\s"']*/gi;

/** Replaces secrets embedded in free text. */
export function redactString(input: string): string {
  return input
    .replace(PEM_RE, REDACTED)
    .replace(URI_CREDENTIALS_RE, `$1${REDACTED}@`)
    .replace(DB_QUERY_RE, "$1?[redacted]")
    .replace(BEARER_RE, `$1 ${REDACTED}`)
    .replace(JWT_RE, REDACTED);
}

/** True when a key name denotes a secret value. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key.replace(/[_\-\s]/g, ""));
}

const MAX_DEPTH = 6;

/**
 * Returns a deep copy with secret-named keys replaced and secrets inside strings scrubbed. Errors become plain
 * `{ type, message, stack }` objects. Depth and cycles are bounded so it is safe on arbitrary log context.
 */
export function redactValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      type: value.name,
      message: redactString(value.message),
    };
    if (value.stack !== undefined) out.stack = redactString(value.stack);
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") out.code = code;
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSecretKey(key) ? REDACTED : redactValue(inner, depth + 1, seen);
  }
  return out;
}
