// WebSocket transport selection (env TRANSPORT; Cee-approved automatic fallback, 2026-11-13).
//
// - `uws`: uWebSockets.js via @colyseus/uwebsockets-transport (./uws-transport). Preferred: lowest CPU per socket on
//   the 0.1-CPU free instance. A load failure is fatal (boot fails, exit 1).
// - `ws`: Colyseus' built-in WebSocketTransport (`ws`) behind a Node http server (./ws-transport) with the SAME
//   protections as the uWS path (body limit, origin check at upgrade, per-IP socket cap, room-create rate, safe
//   percent-decoding, trusted client-IP header, CORS, payload and backpressure caps).
// - `auto` (default): try `uws`; on ANY import / native-load / construction failure log ONE warning line
//   `[net] transport=ws (uWebSockets.js unavailable: <reason>)` and boot `ws`.
//
// Both adapters are loaded with dynamic `import()` so neither the native addon nor either Colyseus transport is
// evaluated unless chosen; the server bundle code-splits them into lazy chunks (build.config.mjs).

import type { BeforeUpgradeHandler, Transport } from "@colyseus/core";
import type { HttpRouteDef } from "@moon-cleanup/shared";
import type { Admission } from "./admission";
import type { OriginPolicy } from "./cors";
import type { NetLogger, RawBodyAuth } from "./http-routes";

/** TRANSPORT env values. */
export const TRANSPORT_MODES = ["auto", "uws", "ws"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];
/** The transport actually serving (what /healthz-adjacent logs report). */
export type TransportKind = Exclude<TransportMode, "auto">;

export const DEFAULT_TRANSPORT_MODE: TransportMode = "auto";

export class TransportModeError extends Error {
  override readonly name = "TransportModeError";
}

/**
 * Parses TRANSPORT. Blank or unset -> `auto`; values are trimmed and case-insensitive. Anything else throws a
 * readable error (the composition root prints it and exits 1, like the other env validation errors).
 */
export function parseTransportMode(raw: string | undefined): TransportMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value.length === 0) return DEFAULT_TRANSPORT_MODE;
  if ((TRANSPORT_MODES as readonly string[]).includes(value)) return value as TransportMode;
  throw new TransportModeError(
    `Invalid server environment:\n  - TRANSPORT: expected one of ${TRANSPORT_MODES.join(", ")}`,
  );
}

/** Reads TRANSPORT from `source` (default `process.env`). */
export function loadTransportMode(source: Readonly<Record<string, string | undefined>> = process.env): TransportMode {
  return parseTransportMode(source.TRANSPORT);
}

/** What both adapters need from the game server. */
export interface TransportDeps {
  readonly routes: readonly HttpRouteDef[];
  readonly policy: OriginPolicy;
  /** Lower-case trusted client-IP header, or `null` for socket mode (ENV_NAME=local only). */
  readonly clientIpHeader: string | null;
  readonly logger: NetLogger;
  readonly admission: Admission;
  /** Origin check + per-IP socket claim, shared by both transports (./game-server). */
  readonly beforeUpgrade: BeforeUpgradeHandler;
  /** Bearer verifier for raw-body routes, run before an upload slot is taken (./http-routes, review M1). */
  readonly rawBodyAuth?: RawBodyAuth;
}

/** A constructed transport with its HTTP routes mounted, ready for `new Server({ transport })`. */
export interface BoundTransport {
  readonly kind: TransportKind;
  readonly transport: Transport;
  /**
   * Runs Colyseus' `listen` (`run`) and finishes the binding (fallback routes, router hardening). Resolves the bound
   * port; rejects when `port` cannot be bound.
   */
  listen(run: () => Promise<void>, port: number): Promise<number>;
}

export type TransportFactory = (deps: TransportDeps) => Promise<BoundTransport>;

/** Injectable adapter loaders (tests simulate an unavailable uWebSockets.js). */
export interface TransportLoaders {
  readonly uws: TransportFactory;
  readonly ws: TransportFactory;
}

export const defaultTransportLoaders: TransportLoaders = {
  uws: async (deps) => (await import("./uws-transport")).createUwsTransport(deps),
  ws: async (deps) => (await import("./ws-transport")).createWsTransport(deps),
};

/** Longest failure reason kept in the fallback warning. */
const MAX_REASON_LENGTH = 200;

/** First line of the error message, bounded (module-not-found / native ABI messages carry paths, never secrets). */
export function describeLoadFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = (message.split("\n")[0] ?? "").trim() || "unknown error";
  return firstLine.length > MAX_REASON_LENGTH ? `${firstLine.slice(0, MAX_REASON_LENGTH)}...` : firstLine;
}

/** Builds the transport for `mode`, falling back from uWS to ws in `auto`. Logs the chosen transport once. */
export async function selectTransport(
  mode: TransportMode,
  deps: TransportDeps,
  loaders: TransportLoaders = defaultTransportLoaders,
): Promise<BoundTransport> {
  const { logger } = deps;
  if (mode === "ws") {
    const bound = await loaders.ws(deps);
    logger.info({ transport: bound.kind, mode }, `[net] transport=${bound.kind} (TRANSPORT=ws)`);
    return bound;
  }
  if (mode === "uws") {
    const bound = await loaders.uws(deps);
    logger.info({ transport: bound.kind, mode }, `[net] transport=${bound.kind}`);
    return bound;
  }
  let bound: BoundTransport;
  try {
    bound = await loaders.uws(deps);
  } catch (error) {
    const reason = describeLoadFailure(error);
    logger.warn({ transport: "ws", mode, reason }, `[net] transport=ws (uWebSockets.js unavailable: ${reason})`);
    return loaders.ws(deps);
  }
  logger.info({ transport: bound.kind, mode }, `[net] transport=${bound.kind}`);
  return bound;
}
