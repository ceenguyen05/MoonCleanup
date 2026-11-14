// `HttpRouteDef[]` on a plain Node `http.Server`: the request handler of the ws fallback transport (./transport).
//
// Mirrors ./http-routes (uWS) exactly, through the same `executeRoute` pipeline: exact allowlist CORS (`/healthz`
// public), preflight for every path, REST body limit (declared or streamed, 16 KB -> 413, then the connection closes
// so an oversized upload cannot keep streaming), malformed `:param` percent-encoding -> 400, malformed JSON -> 400,
// handler errors -> 500 INTERNAL, unknown paths and Colyseus' `/matchmake/*` -> 404, client IP from the one trusted
// edge header (socket mode: the TCP peer). Route precedence follows uWS: a route whose segments are all static beats
// a `:param` route; otherwise registration order.

import type { IncomingMessage, ServerResponse } from "node:http";
import { STATUS_CODES } from "node:http";
import type { HttpMethod, HttpResponse, HttpRouteDef } from "@moon-cleanup/shared";
import { PUBLIC_CORS_PATHS } from "./cors";
import {
  MAX_HTTP_BODY_BYTES,
  errorBody,
  executeRoute,
  responseBodyText,
  responseHeaderPairs,
  routeParamNames,
  safeDecodeURIComponent,
  type MountHttpOptions,
  type RouteInput,
} from "./http-routes";

interface CompiledRoute {
  readonly route: HttpRouteDef;
  /** Path segments; `null` marks a `:param` segment. */
  readonly segments: readonly (string | null)[];
  /** `:name` segments in order. */
  readonly paramNames: readonly string[];
  readonly isStatic: boolean;
  readonly isPublic: boolean;
}

export type NodeRequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

function compile(routes: readonly HttpRouteDef[]): Map<HttpMethod, CompiledRoute[]> {
  const byMethod = new Map<HttpMethod, CompiledRoute[]>();
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`duplicate HTTP route: ${key}`);
    seen.add(key);
    const segments = route.path.split("/").map((s) => (s.startsWith(":") ? null : s));
    const compiled: CompiledRoute = {
      route,
      segments,
      paramNames: routeParamNames(route.path),
      isStatic: !segments.includes(null),
      isPublic: PUBLIC_CORS_PATHS.includes(route.path),
    };
    const list = byMethod.get(route.method) ?? [];
    list.push(compiled);
    byMethod.set(route.method, list);
  }
  // Static routes first (stable sort keeps registration order within each group).
  for (const list of byMethod.values()) list.sort((a, b) => Number(b.isStatic) - Number(a.isStatic));
  return byMethod;
}

/** Matches `pathSegments` against a compiled route; returns the RAW (still percent-encoded) param values. */
function match(compiled: CompiledRoute, pathSegments: readonly string[]): string[] | undefined {
  if (compiled.segments.length !== pathSegments.length) return undefined;
  const raw: string[] = [];
  for (let i = 0; i < pathSegments.length; i++) {
    const want = compiled.segments[i];
    const got = pathSegments[i] ?? "";
    if (want === null) {
      if (got.length === 0) return undefined;
      raw.push(got);
    } else if (want !== got) {
      return undefined;
    }
  }
  return raw;
}

/** Lower-case headers from `rawHeaders`; a repeated header keeps its LAST value (what uWS `forEach` yields). */
function copyHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) headers[(raw[i] ?? "").toLowerCase()] = raw[i + 1] ?? "";
  return headers;
}

function write(
  res: ServerResponse,
  response: HttpResponse,
  corsHeaders: Readonly<Record<string, string>>,
  closeConnection: boolean,
): void {
  if (res.headersSent || res.destroyed || res.writableEnded) return;
  const body = responseBodyText(response);
  for (const [k, v] of responseHeaderPairs(response, corsHeaders)) res.setHeader(k, v);
  res.setHeader("content-length", Buffer.byteLength(body));
  if (closeConnection) res.setHeader("connection", "close");
  res.writeHead(response.status, STATUS_CODES[response.status] ?? "");
  res.end(body);
}

/** Reads the body up to MAX_HTTP_BODY_BYTES; `null` on overflow (`state.overflow` set) or a broken request. */
function readNodeBody(req: IncomingMessage, state: { overflow: boolean; aborted: boolean }): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: Buffer | null): void => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      resolve(value);
    };
    const onData = (chunk: Buffer): void => {
      total += chunk.byteLength;
      if (total > MAX_HTTP_BODY_BYTES) {
        state.overflow = true;
        chunks.length = 0;
        // Stop buffering; the 413 is written with `connection: close`, which ends the upload.
        req.pause();
        finish(null);
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.once("end", () => finish(Buffer.concat(chunks, total)));
    req.once("error", () => {
      state.aborted = true;
      finish(null);
    });
  });
}

/** Builds the Node `request` listener for `routes` (the Node twin of `mountHttpRoutes` + `mountFallbackRoutes`). */
export function createNodeRequestHandler(
  routes: readonly HttpRouteDef[],
  options: MountHttpOptions,
): NodeRequestHandler {
  const { policy, clientIpHeader, logger } = options;
  const table = compile(routes);

  return (req, res) => {
    const headers = copyHeaders(req);
    const origin = headers.origin;
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    const path = q === -1 ? url : url.slice(0, q);
    const rawQuery = q === -1 ? "" : url.slice(q + 1);

    // Preflight for every path: allowlisted origins only; others get 204 without CORS headers (the browser blocks).
    if (req.method === "OPTIONS") {
      res.writeHead(204, policy.preflightHeaders(origin));
      res.end();
      return;
    }

    const pathSegments = path.startsWith("/") ? path.split("/") : undefined;
    let found: { compiled: CompiledRoute; raw: string[] } | undefined;
    const candidates = pathSegments === undefined ? undefined : table.get(req.method as HttpMethod);
    if (candidates !== undefined && pathSegments !== undefined) {
      for (const compiled of candidates) {
        const raw = match(compiled, pathSegments);
        if (raw !== undefined) {
          found = { compiled, raw };
          break;
        }
      }
    }
    if (found === undefined) {
      // Everything else (including Colyseus' `/matchmake/*`, disabled by the REST-only join flow, ADR-0025) is 404.
      write(res, { status: 404, body: errorBody("NOT_FOUND") }, policy.responseHeaders(origin), false);
      return;
    }

    const { compiled, raw } = found;
    const paramNames = compiled.paramNames;
    let params: Record<string, string> | null = {};
    for (let i = 0; i < paramNames.length; i++) {
      const value = safeDecodeURIComponent(raw[i] ?? "");
      if (value === null) {
        params = null;
        break;
      }
      params[paramNames[i] ?? ""] = value;
    }

    const cors = compiled.isPublic ? { "access-control-allow-origin": "*" } : policy.responseHeaders(origin);
    const state = { overflow: false, aborted: false };
    res.once("close", () => {
      if (!res.writableEnded) state.aborted = true;
    });
    const input: RouteInput = {
      path,
      rawQuery,
      headers,
      params,
      socketAddress: clientIpHeader === null ? req.socket.remoteAddress : undefined,
    };
    void executeRoute(
      compiled.route,
      input,
      () => readNodeBody(req, state),
      () => state.aborted,
      clientIpHeader,
      logger,
    ).then((response) => {
      if (response === undefined || state.aborted) return;
      // An early 413 (declared length) or a streamed overflow: close so the rest of the upload is not read.
      const close = response.status === 413 || state.overflow || (!req.complete && req.method !== "GET");
      write(res, response, cors, close);
    });
  };
}
