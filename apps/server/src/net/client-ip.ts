// Client address for HTTP handlers, WebSocket upgrades and rate-limit keys (security.md section 5, M14).
//
// Only the one header the hosting edge documents is trusted (`CLIENT_IP_HEADER`, default `true-client-ip`). For
// `x-forwarded-for` the RIGHT-most entry is used (the one the edge appended); the left-most entry is attacker
// controlled and never used. A missing header yields the shared `unknown` bucket (tighter limits, logged), never the
// proxy socket address.
//
// Socket mode (`CLIENT_IP_HEADER` set but blank; env validation allows it only for ENV_NAME=local, where no proxy
// exists): the TCP peer address is the key and NO header is trusted.

export const DEFAULT_CLIENT_IP_HEADER = "true-client-ip";
export const UNKNOWN_CLIENT_IP = "unknown";

/** Longest address we accept (IPv6 with zone id fits easily); longer values are treated as missing. */
const MAX_IP_LENGTH = 64;
const IP_CHARS = /^[0-9A-Fa-f:.%]+$/;

/** Returns the trimmed address when it looks like an IP literal, else `unknown`. */
export function sanitizeIp(value: string | null | undefined): string {
  const candidate = (value ?? "").trim();
  if (candidate.length === 0 || candidate.length > MAX_IP_LENGTH || !IP_CHARS.test(candidate)) {
    return UNKNOWN_CLIENT_IP;
  }
  return candidate;
}

/**
 * Resolves the client address.
 * @param headers lower-case request headers.
 * @param headerName lower-case header name (for example `true-client-ip` or `x-forwarded-for`), or `null` for socket
 *   mode, where `socketAddress` is used and headers are ignored.
 * @param socketAddress the TCP peer address (socket mode only).
 */
export function resolveClientIp(
  headers: Readonly<Record<string, string>>,
  headerName: string | null,
  socketAddress?: string,
): string {
  if (headerName === null) return sanitizeIp(socketAddress);
  const name = headerName.toLowerCase();
  const raw = headers[name];
  if (raw === undefined) return UNKNOWN_CLIENT_IP;
  let candidate = raw;
  if (name === "x-forwarded-for") {
    const parts = raw.split(",");
    candidate = parts[parts.length - 1] ?? "";
  }
  return sanitizeIp(candidate);
}

/** Headers Colyseus' own resolver would prefer over the socket address (core Transport `resolveClientIp`). */
const COLYSEUS_FORWARD_HEADERS = ["x-real-ip", "x-forwarded-for", "x-client-ip"] as const;

/**
 * Client address at the WebSocket upgrade. In header mode it reads the configured header like REST. In socket mode
 * the transport only exposes Colyseus' `context.ip`, which prefers forwarding headers: when any of them is present
 * the value is client-controlled, so the request is keyed `unknown`; otherwise `context.ip` is the socket address.
 */
export function resolveUpgradeClientIp(
  getHeader: (name: string) => string | null,
  headerName: string | null,
  contextIp: string | undefined,
): string {
  if (headerName !== null) {
    const value = getHeader(headerName);
    return resolveClientIp(value === null ? {} : { [headerName]: value }, headerName);
  }
  for (const name of COLYSEUS_FORWARD_HEADERS) {
    if (getHeader(name) !== null) return UNKNOWN_CLIENT_IP;
  }
  return sanitizeIp(contextIp);
}
