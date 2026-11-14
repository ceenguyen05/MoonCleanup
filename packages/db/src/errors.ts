// Classification of database failures into "the database is asleep or unreachable" (retry, report powered-off) versus
// "something else is wrong" (report error, do not hammer). Error messages from drivers may contain host names, so
// callers log only the classification and the error code, never the full message.

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "PROBE_TIMEOUT",
]);

/** Thrown by `DbConnection.db()` when no `DATABASE_URL` is configured (memory mode). */
export class DbNotConfiguredError extends Error {
  constructor() {
    super("database is not configured");
    this.name = "DbNotConfiguredError";
  }
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** True when the failure means the server is down, waking up, or unreachable (retry with backoff). */
export function isUnreachableError(error: unknown, depth = 0): boolean {
  if (depth > 3 || typeof error !== "object" || error === null) return false;
  const code = codeOf(error);
  if (code !== undefined) {
    if (UNREACHABLE_CODES.has(code)) return true;
    // 57P01-57P03: admin shutdown, crash shutdown, cannot connect now (starting up). Class 08: connection exception.
    if (code.startsWith("57P0") || code.startsWith("08")) return true;
  }
  const nested = (error as { errors?: unknown }).errors;
  if (Array.isArray(nested)) return nested.some((inner) => isUnreachableError(inner, depth + 1));
  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && isUnreachableError(cause, depth + 1);
}

/** The code of an error for logging (never the message). */
export function errorCodeForLog(error: unknown): string {
  return codeOf(error) ?? (error instanceof Error ? error.name : "UNKNOWN");
}
