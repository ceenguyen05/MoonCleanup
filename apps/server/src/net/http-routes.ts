// Mounts transport-neutral `HttpRouteDef[]` (packages/shared api/rest) as plain uWebSockets.js handlers, and holds
// the transport-neutral route pipeline (`executeRoute`, header/body serialization) that ./node-http reuses for the
// ws fallback transport (./transport), so both transports enforce identical limits and answer identical responses.
//
// Why not Colyseus' built-in router on uWS (M0-W1-T04 finding, feeds the M0 netcode ADR): its uWS binding buffers
// POST bodies with no size limit, drops the peer address and resolves the client IP from the LEFT-most
// X-Forwarded-For entry (security.md section 5 forbids both), applies one global CORS header set
// (`Access-Control-Allow-Credentials: true`, 30-day max-age) to every path, allocates Request/Headers/Response
// objects per call, and leaves unknown paths hanging without a response. Specific route patterns registered here
// beat Colyseus' `any("/*")`; our own catch-alls replace Colyseus' after it binds them (mountFallbackRoutes).
//
// Contract: handlers never see uWS objects; bodies are capped (REST 16 KB -> 413); JSON unless the route opts into a
// raw binary body (`rawBodyMaxBytes`, api/rest v0.4.0); errors never leak stacks and stay JSON; responses carry CORS
// per ./cors and `cache-control: no-store`.
//
// Raw binary bodies (solo checkpoint upload, up to ~1 MiB, M1-W5-T07b brief): cheap pre-checks run BEFORE any byte is
// buffered (Bearer present -> else 401, `content-type: application/octet-stream` -> else 400, declared length over the
// route limit -> 413), then the Bearer token is VERIFIED with the body held (`rawBodyAuth`, -> 401; its slot-attempt
// churn limit per account and address -> 429 RATE_LIMITED + retry-after, review R2), and only then is a slot taken: in-flight cap 4 per process / 1 per client address (IPv6 by /64) / 1 per account -> else 503
// RETRY_LATER + retry-after 5 (security review M1). The body is copied chunk by chunk into ONE buffer pre-sized from
// the (capped) content-length, so no concat and no large synchronous copy runs on the tick thread; chunked bodies are
// counted while streaming. Every body read has a 30 s deadline; a raw body must also average >= 32 KB/s after 5 s (a
// trickling client loses its slot at 5 s, not 30 s); either closes the connection. The Node path uses the same limits
// (its http-server requestTimeout sits above the 30 s deadline, review L2). A `binary` response is written verbatim
// with one content-type.

import { STATUS_CODES } from "node:http";
import { API_BINARY_CONTENT_TYPE, type HttpRequest, type HttpResponse, type HttpRouteDef } from "@moon-cleanup/shared";
import type { HttpRequest as UwsRequest, HttpResponse as UwsResponse, TemplatedApp } from "uWebSockets.js";
import { resolveClientIp } from "./client-ip";
import { PUBLIC_CORS_PATHS, type OriginPolicy } from "./cors";

/** REST request body limit in bytes (security.md section 5). */
export const MAX_HTTP_BODY_BYTES = 16 * 1024;
/** Raw-body reads in flight, process-wide and per client IP (M1-W5-T07b brief item 2). */
export const RAW_BODY_MAX_IN_FLIGHT = 4;
export const RAW_BODY_MAX_IN_FLIGHT_PER_IP = 1;
/** `retry-after` seconds on the raw-body concurrency refusal. */
export const RAW_BODY_RETRY_AFTER_S = 5;
/** Deadline for reading a request body; the connection is closed after it. */
export const BODY_READ_TIMEOUT_MS = 30_000;

/** Raw-body reads in flight per authenticated account (security review M1). */
export const RAW_BODY_MAX_IN_FLIGHT_PER_ACCOUNT = 1;
/**
 * Minimum raw-body throughput after the grace period (security review M1): a trickling client loses its slot after
 * RAW_BODY_RATE_GRACE_MS instead of the full deadline. 32 KB/s still fits a max-size upload (1 MiB at 35 KB/s fills
 * the 30 s deadline anyway).
 */
export const RAW_BODY_MIN_BYTES_PER_S = 32 * 1024;
export const RAW_BODY_RATE_GRACE_MS = 5_000;

/** The raw-upload admission refused the attempt (slot-acquisition churn limit, review R2): answered 429. */
export interface RawBodyRefusal {
  readonly rateLimited: true;
  readonly retryAfterS: number;
}

/**
 * Verifies a raw-body route's Bearer token BEFORE a slot is taken (security review M1) and, in the composition root,
 * spends the per-account and per-address slot-attempt allowance (review R2, api `admitRawUpload`). Resolves an
 * account key (the playerId), a refusal (-> 429 + retry-after) or `null` (-> 401). One HMAC per upload on the REST
 * path; never on the room tick path. A one-argument verifier is still assignable.
 */
export type RawBodyAuth = (token: string, remoteAddress: string) => Promise<string | RawBodyRefusal | null>;

/**
 * Slot key of a client address: an IPv6 address is grouped by its /64 (one subscriber usually owns a whole /64, so
 * per-address slots would let one client take them all); IPv4 and `unknown` are used as is.
 */
export function ipSlotKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped !== null) return mapped[1]!;
  const [headRaw = "", tailRaw] = addr.split("::", 2);
  const head = headRaw.length > 0 ? headRaw.split(":") : [];
  const tail = tailRaw === undefined || tailRaw.length === 0 ? [] : tailRaw.split(":");
  const fill = tailRaw === undefined ? 0 : Math.max(0, 8 - head.length - tail.length);
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  const prefix = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "") || "0");
  while (prefix.length < 4) prefix.push("0");
  return `${prefix.join(":")}::/64`;
}

/**
 * Counts raw-body requests in flight (from the slot grant until the handler returned), process-wide, per client
 * address (IPv6 by /64) and per account. Bounds buffered upload memory to RAW_BODY_MAX_IN_FLIGHT x the route limit
 * (about 4 MiB).
 */
export class RawBodyGate {
  private total = 0;
  private readonly perKey = new Map<string, number>();

  constructor(
    private readonly maxTotal: number = RAW_BODY_MAX_IN_FLIGHT,
    private readonly maxPerIp: number = RAW_BODY_MAX_IN_FLIGHT_PER_IP,
    private readonly maxPerAccount: number = RAW_BODY_MAX_IN_FLIGHT_PER_ACCOUNT,
  ) {}

  get inFlight(): number {
    return this.total;
  }

  /** Takes a slot for (address, account). `account` undefined = no verifier configured (address cap only). */
  tryAcquire(ip: string, account?: string): boolean {
    const ipKey = `ip:${ipSlotKey(ip)}`;
    const acKey = account === undefined ? undefined : `ac:${account}`;
    const ipCount = this.perKey.get(ipKey) ?? 0;
    const acCount = acKey === undefined ? 0 : (this.perKey.get(acKey) ?? 0);
    if (this.total >= this.maxTotal || ipCount >= this.maxPerIp) return false;
    if (acKey !== undefined && acCount >= this.maxPerAccount) return false;
    this.total++;
    this.perKey.set(ipKey, ipCount + 1);
    if (acKey !== undefined) this.perKey.set(acKey, acCount + 1);
    return true;
  }

  release(ip: string, account?: string): void {
    const ipKey = `ip:${ipSlotKey(ip)}`;
    if ((this.perKey.get(ipKey) ?? 0) <= 0) return;
    this.total--;
    this.dec(ipKey);
    if (account !== undefined) this.dec(`ac:${account}`);
  }

  private dec(key: string): void {
    const n = this.perKey.get(key) ?? 0;
    if (n <= 1) this.perKey.delete(key);
    else this.perKey.set(key, n - 1);
  }
}

/**
 * Body-read watchdog shared by both transports: the hard deadline, plus (raw routes) the minimum-throughput rule.
 * Calls `onStall` once and stops. One unref'd interval per read in progress.
 */
export function watchBodyRead(
  bytesRead: () => number,
  onStall: () => void,
  deadlineMs: number,
  minRate: { readonly bytesPerS: number; readonly graceMs: number } | undefined,
): () => void {
  const started = performance.now();
  const periodMs = minRate === undefined ? deadlineMs : Math.max(25, Math.min(1000, Math.floor(minRate.graceMs / 4)));
  const timer = setInterval(
    () => {
      const elapsed = performance.now() - started;
      const slow =
        minRate !== undefined && elapsed >= minRate.graceMs && bytesRead() < (minRate.bytesPerS * elapsed) / 1000;
      if (elapsed >= deadlineMs - 1 || slow) {
        clearInterval(timer);
        onStall();
      }
    },
    Math.min(periodMs, deadlineMs),
  );
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Accumulates a request body under a byte limit. With a declared (and already limit-checked) length it copies every
 * chunk into one pre-sized buffer (no concat at the end); otherwise it keeps the chunks and concatenates once.
 */
export class BodyBuffer {
  private fixed: Buffer | null;
  private readonly chunks: Buffer[] = [];
  total = 0;

  constructor(
    private readonly limit: number,
    expected: number | undefined,
    /** Copy chunks kept in the list (uWS reuses its chunk memory; Node hands over fresh Buffers). */
    private readonly copyChunks: boolean,
  ) {
    this.fixed = expected !== undefined && expected > 0 && expected <= limit ? Buffer.allocUnsafe(expected) : null;
  }

  /** Takes one chunk. False when the limit is exceeded (everything buffered is dropped). */
  push(chunk: Uint8Array): boolean {
    const next = this.total + chunk.byteLength;
    if (next > this.limit) {
      this.fixed = null;
      this.chunks.length = 0;
      return false;
    }
    if (this.fixed !== null && next <= this.fixed.byteLength) {
      this.fixed.set(chunk, this.total);
    } else {
      if (this.fixed !== null) {
        this.chunks.push(this.fixed.subarray(0, this.total));
        this.fixed = null;
      }
      this.chunks.push(
        this.copyChunks ? Buffer.from(chunk) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
    }
    this.total = next;
    return true;
  }

  bytes(): Buffer {
    if (this.fixed !== null) return this.fixed.subarray(0, this.total);
    if (this.chunks.length === 1) return this.chunks[0]!;
    return Buffer.concat(this.chunks, this.total);
  }
}

/** Result of a transport body read: the bytes, an overflow (-> 413), or a broken/timed-out request (no answer). */
export type BodyReadResult = Buffer | "overflow" | "aborted";
/** Options of one body read. */
export interface BodyReadOptions {
  readonly limit: number;
  /** Declared content-length when valid and within the limit. */
  readonly expected: number | undefined;
  /** Minimum-throughput rule (raw routes); undefined = deadline only. */
  readonly minRate: { readonly bytesPerS: number; readonly graceMs: number } | undefined;
}

/** A body read opened synchronously by the transport (uWS needs `onData` attached before the handler returns). */
export interface BodyRead {
  /** Starts (or resumes) reading. Called at most once. */
  read(options: BodyReadOptions): Promise<BodyReadResult>;
  /** The request is answered without its body: stop holding it (the answer closes the connection). */
  discard(): void;
}

/** Opens the body read. `hold`: keep the body paused until `read` (an async pre-check runs first). */
export type BodyOpener = (hold: boolean) => BodyRead;

/** Minimal logger surface used by the net layer (pino's Logger satisfies it). */
export interface NetLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export interface MountHttpOptions {
  readonly policy: OriginPolicy;
  /**
   * Lower-case header the edge documents for the client address (security.md section 5), or `null` for socket mode
   * (TCP peer address; local only).
   */
  readonly clientIpHeader: string | null;
  readonly logger: NetLogger;
  /** Raw-body in-flight cap; default a new gate per mount (one mount per process = process-wide). */
  readonly rawBodyGate?: RawBodyGate;
  /** Body read deadline (ms); default BODY_READ_TIMEOUT_MS. Tests shorten it. */
  readonly bodyReadTimeoutMs?: number;
  /**
   * Bearer verifier for raw-body routes, run before a slot is taken (security review M1). Absent (tests, no account
   * API): only the `Bearer ` prefix is checked and slots are keyed by address only.
   */
  readonly rawBodyAuth?: RawBodyAuth;
  /** Minimum raw-body throughput; default RAW_BODY_MIN_BYTES_PER_S after RAW_BODY_RATE_GRACE_MS. Tests shorten it. */
  readonly rawBodyMinRate?: { readonly bytesPerS: number; readonly graceMs: number };
}

/** The subset of MountHttpOptions the shared pipeline needs. */
export interface RouteRuntime {
  readonly clientIpHeader: string | null;
  readonly logger: NetLogger;
  readonly gate: RawBodyGate;
  readonly rawBodyAuth: RawBodyAuth | undefined;
  readonly minRate: { readonly bytesPerS: number; readonly graceMs: number };
}

/** Fills the defaults of the pipeline options (one call per mount). */
export function routeRuntime(options: MountHttpOptions): RouteRuntime {
  return {
    clientIpHeader: options.clientIpHeader,
    logger: options.logger,
    gate: options.rawBodyGate ?? new RawBodyGate(),
    rawBodyAuth: options.rawBodyAuth,
    minRate: options.rawBodyMinRate ?? { bytesPerS: RAW_BODY_MIN_BYTES_PER_S, graceMs: RAW_BODY_RATE_GRACE_MS },
  };
}

/** Longest Bearer token handed to the verifier (untrusted input). */
const BEARER_MAX_CHARS = 4096;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/** `:name` segments of a route path, in order (uWS `getParameter(index)` order). */
export function routeParamNames(path: string): string[] {
  const names: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.startsWith(":")) names.push(segment.slice(1));
  }
  return names;
}

/** Parses a raw query string; a repeated key keeps its first value. */
export function parseQuery(raw: string): Record<string, string> {
  const query: Record<string, string> = {};
  if (raw.length === 0) return query;
  for (const [key, value] of new URLSearchParams(raw)) {
    if (!Object.hasOwn(query, key)) query[key] = value;
  }
  return query;
}

/**
 * Records one request header (lower-case name). A repeated header is JOINED with `, ` on both transports (what the
 * WebSocket upgrade's `Headers.get` yields), so the client-IP header resolves identically for REST and upgrades: a
 * client-added duplicate of the edge header becomes an invalid address -> the shared `unknown` bucket (review NB3).
 */
export function addHeader(headers: Record<string, string>, name: string, value: string): void {
  const key = name.toLowerCase();
  headers[key] = Object.hasOwn(headers, key) ? `${headers[key]}, ${value}` : value;
}

/** `decodeURIComponent` that returns `null` on malformed percent-encoding instead of throwing `URIError`. */
export function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function statusLine(status: number): string {
  return `${status} ${STATUS_CODES[status] ?? ""}`.trimEnd();
}

/** JSON error body (`{ error }` or `{ error, message }`). Shared by both transports. */
export function errorBody(error: string, message?: string): unknown {
  return message === undefined ? { error } : { error, message };
}

/**
 * Final response headers (lower-case names, in write order): base headers, CORS unless the handler set its own
 * `access-control-allow-origin`, then the handler's headers (never `content-length`; the writer sets it). A name is
 * written ONCE: a handler header replaces the base/CORS value of the same name in place (so a binary response carries
 * exactly one `content-type`). Shared by the uWS and Node writers so both transports answer the same header set.
 */
export function responseHeaderPairs(
  response: HttpResponse,
  corsHeaders: Readonly<Record<string, string>>,
): Array<[string, string]> {
  const out = new Map<string, string>(Object.entries(BASE_HEADERS));
  const extra = response.headers ?? {};
  if (!Object.hasOwn(extra, "access-control-allow-origin")) {
    for (const [k, v] of Object.entries(corsHeaders)) out.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) {
    const name = k.toLowerCase();
    if (name !== "content-length") out.set(name, v);
  }
  return [...out];
}

/** Serialized JSON body ("" when the response has none). */
export function responseBodyText(response: HttpResponse): string {
  return response.body === undefined ? "" : JSON.stringify(response.body);
}

/** The bytes to write: `binary` verbatim (never stringified), else the JSON text. */
export function responseBody(response: HttpResponse): string | Uint8Array {
  return response.binary ?? responseBodyText(response);
}

/** Media type of a `content-type` value, lower-case, without parameters (`; charset=...`). */
export function mediaType(value: string | undefined): string {
  if (value === undefined) return "";
  const semi = value.indexOf(";");
  return (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase();
}

/** A request already copied off the transport (uWS `req` dies when the handler returns; Node's is streamed). */
export interface RouteInput {
  readonly path: string;
  readonly rawQuery: string;
  /** Lower-case header names; a repeated header is joined with `, ` (see `addHeader`). */
  readonly headers: Readonly<Record<string, string>>;
  /** Decoded `:param` values, or `null` when any segment had malformed percent-encoding (-> 400). */
  readonly params: Readonly<Record<string, string>> | null;
  /** TCP peer address (socket mode only). */
  readonly socketAddress: string | undefined;
}

const TOO_LARGE: HttpResponse = { status: 413, body: errorBody("PAYLOAD_TOO_LARGE", "body too large") };

/**
 * Runs one route for a copied request: malformed params -> 400, declared or streamed body over the route limit
 * (MAX_HTTP_BODY_BYTES, or `rawBodyMaxBytes` for a raw route) -> 413, malformed JSON -> 400, raw-route pre-checks
 * (401 / 400 / 503, see the file header), handler errors -> 500 INTERNAL (no stack). Never rejects. Resolves
 * `undefined` when the client went away or the read timed out (`isAborted` / reader `"aborted"`).
 *
 * `openBody` is called SYNCHRONOUSLY (no `await` precedes it): uWS requires `onData` to be attached before the uWS
 * handler returns. A synchronous pre-check refusal never opens the body; the asynchronous Bearer verification (raw
 * routes with `rawBodyAuth`) runs with the body HELD (uWS `pause`, Node stream not flowing) and before a slot is taken.
 */
export async function executeRoute(
  route: HttpRouteDef,
  input: RouteInput,
  openBody: BodyOpener,
  isAborted: () => boolean,
  rt: RouteRuntime,
): Promise<HttpResponse | undefined> {
  const key = `${route.method} ${route.path}`;
  if (input.params === null) return { status: 400, body: errorBody("BAD_REQUEST", "malformed path") };

  const isRaw = route.rawBodyMaxBytes !== undefined;
  const hasBody = route.method !== "GET";
  const limit = route.rawBodyMaxBytes ?? MAX_HTTP_BODY_BYTES;
  const remoteAddress = resolveClientIp(input.headers, rt.clientIpHeader, input.socketAddress);
  const declaredRaw = input.headers["content-length"];
  const declared = declaredRaw === undefined ? undefined : Number(declaredRaw);
  const expected = declared !== undefined && Number.isSafeInteger(declared) && declared >= 0 ? declared : undefined;
  const authorization = input.headers["authorization"] ?? "";

  if (isRaw) {
    if (!authorization.startsWith("Bearer ") || authorization.length > 7 + BEARER_MAX_CHARS) {
      return { status: 401, body: errorBody("UNAUTHORIZED") };
    }
    if (hasBody && mediaType(input.headers["content-type"]) !== API_BINARY_CONTENT_TYPE) {
      return { status: 400, body: errorBody("BAD_REQUEST", `content-type must be ${API_BINARY_CONTENT_TYPE}`) };
    }
  }
  if (declared !== undefined && Number.isFinite(declared) && declared > limit) return TOO_LARGE;

  const verify = isRaw && hasBody ? rt.rawBodyAuth : undefined;
  const bodyRead = hasBody ? openBody(verify !== undefined) : undefined;

  // Raw upload: verify the token (body held) BEFORE taking a slot, so unauthenticated clients never hold one.
  let account: string | undefined;
  if (verify !== undefined) {
    let verified: string | RawBodyRefusal | null;
    try {
      verified = await verify(authorization.slice(7).trim(), remoteAddress);
    } catch {
      verified = null;
    }
    if (verified === null) {
      bodyRead?.discard();
      return { status: 401, body: errorBody("UNAUTHORIZED") };
    }
    if (typeof verified === "object") {
      // Slot-attempt churn limit (review R2): refused before any slot is taken; the held body is discarded.
      bodyRead?.discard();
      const retryAfterS = Number.isFinite(verified.retryAfterS) ? Math.max(1, Math.ceil(verified.retryAfterS)) : 60;
      return {
        status: 429,
        headers: { "retry-after": String(retryAfterS) },
        body: errorBody("RATE_LIMITED", "too many upload attempts"),
      };
    }
    if (isAborted()) {
      bodyRead?.discard();
      return undefined;
    }
    account = verified;
  }
  let acquired = false;
  if (isRaw && hasBody) {
    if (!rt.gate.tryAcquire(remoteAddress, account)) {
      bodyRead?.discard();
      return {
        status: 503,
        headers: { "retry-after": String(RAW_BODY_RETRY_AFTER_S) },
        body: errorBody("RETRY_LATER"),
      };
    }
    acquired = true;
  }

  try {
    let body: unknown;
    let rawBody: Uint8Array | undefined = isRaw ? new Uint8Array(0) : undefined;
    if (bodyRead !== undefined) {
      const read = await bodyRead.read({ limit, expected, minRate: isRaw ? rt.minRate : undefined });
      if (read === "aborted") return undefined;
      if (read === "overflow") return TOO_LARGE;
      if (isRaw) {
        rawBody = read;
      } else if (read.byteLength > 0) {
        try {
          body = JSON.parse(read.toString("utf8"));
        } catch {
          return { status: 400, body: errorBody("BAD_REQUEST", "malformed JSON") };
        }
      }
    }
    if (isAborted()) return undefined;

    const request: HttpRequest = {
      method: route.method,
      path: input.path,
      params: input.params,
      query: parseQuery(input.rawQuery),
      headers: input.headers,
      body,
      remoteAddress,
      ...(rawBody === undefined ? {} : { rawBody }),
    };
    try {
      return await route.handle(request);
    } catch (error) {
      rt.logger.error({ err: error, route: key }, "http handler failed");
      return { status: 500, body: errorBody("INTERNAL") };
    }
  } finally {
    if (acquired) rt.gate.release(remoteAddress, account);
  }
}

interface PendingResponse {
  aborted: boolean;
  done: boolean;
  /** The whole request body was received (uWS `isLast`); otherwise the answer closes the connection. */
  bodyComplete: boolean;
  /** Settles a body read in progress when the client goes away (else its gate slot would never be released). */
  onAbort: (() => void) | undefined;
}

/** Bytes a held (paused) uWS body may deliver before `read` (uWS: "some buffered data may still be sent"). */
const HELD_STASH_MAX_BYTES = 64 * 1024;

function send(
  res: UwsResponse,
  state: PendingResponse,
  response: HttpResponse,
  corsHeaders: Readonly<Record<string, string>>,
  closeConnection = false,
): void {
  if (state.aborted || state.done) return;
  state.done = true;
  const body = responseBody(response);
  const headers = responseHeaderPairs(response, corsHeaders);
  res.cork(() => {
    res.writeStatus(statusLine(response.status));
    for (const [k, v] of headers) res.writeHeader(k, v);
    // A binary body goes out as the handler's view (uWS copies it into its send buffer; no string conversion).
    res.end(body, closeConnection);
  });
}

/**
 * Opens the uWS request body: attaches `onData` synchronously (uWS requirement); `hold` pauses the socket until
 * `read` (chunks uWS still delivers are copied into a small stash, at most HELD_STASH_MAX_BYTES, else the connection
 * is closed). Each chunk is copied (uWS neuters it after the callback) into one pre-sized buffer when the length was
 * declared. The watchdog (deadline, minimum throughput) closes the connection and resolves `"aborted"`.
 */
function openUwsBody(res: UwsResponse, state: PendingResponse, hold: boolean, timeoutMs: number): BodyRead {
  let buffer: BodyBuffer | undefined;
  let stash: Buffer[] | undefined = hold ? [] : undefined;
  let stashBytes = 0;
  let stashLast = false;
  let discarded = false;
  let settled = false;
  let resolveRead: ((value: BodyReadResult) => void) | undefined;
  let stopWatch: (() => void) | undefined;

  const finish = (value: BodyReadResult): void => {
    if (settled) return;
    settled = true;
    state.onAbort = undefined;
    stopWatch?.();
    resolveRead?.(value);
  };
  const take = (chunk: Uint8Array, isLast: boolean): void => {
    if (settled || buffer === undefined) return;
    if (!buffer.push(chunk)) {
      finish("overflow");
      return;
    }
    if (isLast) finish(state.aborted ? "aborted" : buffer.bytes());
  };

  res.onData((chunk, isLast) => {
    if (isLast) state.bodyComplete = true;
    if (discarded || settled) return;
    if (buffer === undefined) {
      // Held: the pre-check is still running.
      stashBytes += chunk.byteLength;
      if (stashBytes > HELD_STASH_MAX_BYTES) {
        discarded = true;
        state.aborted = true;
        stash = undefined;
        finish("aborted");
        res.close();
        return;
      }
      stash?.push(Buffer.from(new Uint8Array(chunk)));
      if (isLast) stashLast = true;
      return;
    }
    take(new Uint8Array(chunk), isLast);
  });
  if (hold) res.pause();

  return {
    read(options) {
      return new Promise((resolve) => {
        resolveRead = resolve;
        if (state.aborted) {
          finish("aborted");
          return;
        }
        state.onAbort = () => finish("aborted");
        buffer = new BodyBuffer(options.limit, options.expected, true);
        stopWatch = watchBodyRead(
          () => buffer?.total ?? 0,
          () => {
            if (settled) return;
            state.aborted = true;
            finish("aborted");
            res.close();
          },
          timeoutMs,
          options.minRate,
        );
        const held = stash ?? [];
        stash = undefined;
        for (let i = 0; i < held.length; i++) take(held[i]!, stashLast && i === held.length - 1);
        if (stashLast && held.length === 0) take(new Uint8Array(0), true);
        if (hold && !settled) res.resume();
      });
    },
    discard() {
      discarded = true;
      stash = undefined;
      if (hold && !state.aborted) res.resume();
    },
  };
}

/** Registers one uWS handler per route (exact or `:param` patterns). */
export function mountHttpRoutes(app: TemplatedApp, routes: readonly HttpRouteDef[], options: MountHttpOptions): void {
  const { policy, clientIpHeader, logger } = options;
  const rt = routeRuntime(options);
  const timeoutMs = options.bodyReadTimeoutMs ?? BODY_READ_TIMEOUT_MS;
  const seen = new Set<string>();

  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`duplicate HTTP route: ${key}`);
    seen.add(key);
    const paramNames = routeParamNames(route.path);
    const isPublic = PUBLIC_CORS_PATHS.includes(route.path);
    const method = route.method;

    const handler = (res: UwsResponse, req: UwsRequest): void => {
      // Attach the abort handler FIRST: uWS aborts the whole process when a handler returns without responding or
      // attaching one (review N3), so nothing below may run before it.
      const state: PendingResponse = {
        aborted: false,
        done: false,
        bodyComplete: false,
        onAbort: undefined,
      };
      res.onAborted(() => {
        state.aborted = true;
        state.onAbort?.();
      });

      // uWS invalidates `req` when this function returns: copy everything synchronously.
      const headers: Record<string, string> = {};
      let path = "";
      let rawQuery = "";
      let socketAddress: string | undefined;
      const params: Record<string, string> = {};
      let badParam = false;
      try {
        req.forEach((k, v) => {
          addHeader(headers, k, v);
        });
        path = req.getUrl();
        rawQuery = req.getQuery() ?? "";
        if (clientIpHeader === null) socketAddress = Buffer.from(res.getRemoteAddressAsText()).toString();
        paramNames.forEach((name, i) => {
          const value = safeDecodeURIComponent(req.getParameter(i) ?? "");
          if (value === null) badParam = true;
          else params[name] = value;
        });
      } catch (error) {
        logger.warn({ err: error, route: key }, "http request copy failed");
        badParam = true;
      }

      const origin = headers.origin;
      const cors = isPublic ? { "access-control-allow-origin": "*" } : policy.responseHeaders(origin);
      const input: RouteInput = { path, rawQuery, headers, params: badParam ? null : params, socketAddress };
      // executeRoute attaches onData synchronously (before this handler returns), as uWS requires.
      void executeRoute(
        route,
        input,
        (hold) => openUwsBody(res, state, hold, timeoutMs),
        () => state.aborted,
        rt,
      ).then((response) => {
        // An answer before the whole body arrived (pre-check refusal, 413) closes the connection, so the rest of an
        // upload is not received.
        if (response !== undefined) send(res, state, response, cors, method !== "GET" && !state.bodyComplete);
      });
    };

    switch (method) {
      case "GET":
        app.get(route.path, handler);
        break;
      case "POST":
        app.post(route.path, handler);
        break;
      case "PUT":
        app.put(route.path, handler);
        break;
      case "PATCH":
        app.patch(route.path, handler);
        break;
      case "DELETE":
        app.del(route.path, handler);
        break;
    }
  }
}

/**
 * Replaces Colyseus' `options("/*")` and `any("/*")` handlers. Must run AFTER Colyseus' `listen()`: for an identical
 * pattern uWS keeps the LAST registration (verified by game-server.test.ts), and Colyseus binds its catch-all inside
 * `listen()`. Its catch-all leaves unknown paths hanging and its preflight lacks our max-age/methods/headers.
 */
export function mountFallbackRoutes(app: TemplatedApp, policy: OriginPolicy): void {
  // Preflight for every path: allowlisted origins only; others get 204 without CORS headers (the browser blocks).
  app.options("/*", (res, req) => {
    const origin = req.getHeader("origin");
    res.cork(() => {
      res.writeStatus("204 No Content");
      for (const [k, v] of Object.entries(policy.preflightHeaders(origin))) res.writeHeader(k, v);
      res.endWithoutBody();
    });
  });

  // Everything else (including Colyseus' `/matchmake/*`, disabled by the REST-only join flow, ADR-0025) is 404.
  app.any("/*", (res, req) => {
    const origin = req.getHeader("origin");
    const state: PendingResponse = {
      aborted: false,
      done: false,
      bodyComplete: true,
      onAbort: undefined,
    };
    send(res, state, { status: 404, body: errorBody("NOT_FOUND") }, policy.responseHeaders(origin));
  });
}
