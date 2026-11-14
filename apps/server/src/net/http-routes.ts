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
// Contract: handlers never see uWS objects; bodies are capped (REST 16 KB -> 413); JSON only; errors never leak
// stacks; responses carry CORS per ./cors and `cache-control: no-store`.

import { STATUS_CODES } from "node:http";
import type { HttpRequest, HttpResponse, HttpRouteDef } from "@moon-cleanup/shared";
import type { HttpRequest as UwsRequest, HttpResponse as UwsResponse, TemplatedApp } from "uWebSockets.js";
import { resolveClientIp } from "./client-ip";
import { PUBLIC_CORS_PATHS, type OriginPolicy } from "./cors";

/** REST request body limit in bytes (security.md section 5). */
export const MAX_HTTP_BODY_BYTES = 16 * 1024;

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
}

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
 * `access-control-allow-origin`, then the handler's headers (never `content-length`; the writer sets it). Shared by
 * the uWS and Node writers so both transports answer byte-for-byte the same header set.
 */
export function responseHeaderPairs(
  response: HttpResponse,
  corsHeaders: Readonly<Record<string, string>>,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = Object.entries(BASE_HEADERS);
  const extra = response.headers ?? {};
  if (!Object.hasOwn(extra, "access-control-allow-origin")) pairs.push(...Object.entries(corsHeaders));
  for (const [k, v] of Object.entries(extra)) {
    const name = k.toLowerCase();
    if (name !== "content-length") pairs.push([name, v]);
  }
  return pairs;
}

/** Serialized JSON body ("" when the response has none). */
export function responseBodyText(response: HttpResponse): string {
  return response.body === undefined ? "" : JSON.stringify(response.body);
}

/** A request already copied off the transport (uWS `req` dies when the handler returns; Node's is streamed). */
export interface RouteInput {
  readonly path: string;
  readonly rawQuery: string;
  /** Lower-case header names; a repeated header keeps its LAST value (uWS semantics). */
  readonly headers: Readonly<Record<string, string>>;
  /** Decoded `:param` values, or `null` when any segment had malformed percent-encoding (-> 400). */
  readonly params: Readonly<Record<string, string>> | null;
  /** TCP peer address (socket mode only). */
  readonly socketAddress: string | undefined;
}

/**
 * Runs one route for a copied request: malformed params -> 400, declared or streamed body over MAX_HTTP_BODY_BYTES ->
 * 413, malformed JSON -> 400, handler errors -> 500 INTERNAL (no stack). Never rejects. Resolves `undefined` when the
 * client went away (`isAborted`).
 *
 * `readBody` is called SYNCHRONOUSLY (no `await` precedes it): uWS requires `onData` to be attached before the uWS
 * handler returns. It resolves `null` when the body exceeds the limit.
 */
export async function executeRoute(
  route: HttpRouteDef,
  input: RouteInput,
  readBody: () => Promise<Buffer | null>,
  isAborted: () => boolean,
  clientIpHeader: string | null,
  logger: NetLogger,
): Promise<HttpResponse | undefined> {
  const key = `${route.method} ${route.path}`;
  if (input.params === null) return { status: 400, body: errorBody("BAD_REQUEST", "malformed path") };

  const declared = Number(input.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > MAX_HTTP_BODY_BYTES) {
    return { status: 413, body: errorBody("BAD_REQUEST", "body too large") };
  }

  let body: unknown;
  if (route.method !== "GET") {
    const raw = await readBody();
    if (raw === null) return { status: 413, body: errorBody("BAD_REQUEST", "body too large") };
    if (raw.byteLength > 0) {
      try {
        body = JSON.parse(raw.toString("utf8"));
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
    remoteAddress: resolveClientIp(input.headers, clientIpHeader, input.socketAddress),
  };
  try {
    return await route.handle(request);
  } catch (error) {
    logger.error({ err: error, route: key }, "http handler failed");
    return { status: 500, body: errorBody("INTERNAL") };
  }
}

interface PendingResponse {
  aborted: boolean;
  done: boolean;
}

function send(
  res: UwsResponse,
  state: PendingResponse,
  response: HttpResponse,
  corsHeaders: Readonly<Record<string, string>>,
): void {
  if (state.aborted || state.done) return;
  state.done = true;
  const body = responseBodyText(response);
  const headers = responseHeaderPairs(response, corsHeaders);
  res.cork(() => {
    res.writeStatus(statusLine(response.status));
    for (const [k, v] of headers) res.writeHeader(k, v);
    res.end(body);
  });
}

/** Reads the request body up to MAX_HTTP_BODY_BYTES. Resolves `null` when the limit is exceeded. */
function readBody(res: UwsResponse, state: PendingResponse): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    res.onData((chunk, isLast) => {
      if (!overflow) {
        total += chunk.byteLength;
        if (total > MAX_HTTP_BODY_BYTES) {
          overflow = true;
          chunks.length = 0;
          resolve(null);
        } else {
          // uWS reuses `chunk` after this callback returns: copy it.
          chunks.push(Buffer.from(new Uint8Array(chunk).slice()));
        }
      }
      if (isLast && !overflow && !state.aborted) resolve(Buffer.concat(chunks, total));
    });
  });
}

/** Registers one uWS handler per route (exact or `:param` patterns). */
export function mountHttpRoutes(app: TemplatedApp, routes: readonly HttpRouteDef[], options: MountHttpOptions): void {
  const { policy, clientIpHeader, logger } = options;
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
      const state: PendingResponse = { aborted: false, done: false };
      res.onAborted(() => {
        state.aborted = true;
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
          headers[k.toLowerCase()] = v;
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
        () => readBody(res, state),
        () => state.aborted,
        clientIpHeader,
        logger,
      ).then((response) => {
        if (response !== undefined) send(res, state, response, cors);
      });
    };

    switch (method) {
      case "GET":
        app.get(route.path, handler);
        break;
      case "POST":
        app.post(route.path, handler);
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
    const state: PendingResponse = { aborted: false, done: false };
    send(res, state, { status: 404, body: errorBody("NOT_FOUND") }, policy.responseHeaders(origin));
  });
}
