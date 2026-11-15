// WebSocket handshake shape check, run BEFORE a per-IP socket slot is claimed (review NB2,
// M0-closeout-netcode-security-review.md). Without it a malformed upgrade passed `beforeUpgrade`, claimed a slot, and
// was then refused by the `ws` library (400/405) without ever opening, so the slot stayed claimed until the 10 s
// PENDING_UPGRADE_MS timer: a few bad handshakes locked their own IP (or the shared `unknown` bucket) out.
//
// The rules mirror `ws` 8 `WebSocketServer.handleUpgrade` (method GET, `Upgrade: websocket`, key regex, version,
// subprotocol token list) but accept version 13 only (RFC 6455; every browser sends 13).
//
// Where it runs:
// - Both transports: `beforeUpgrade` (./game-server) reads the AuthContext headers. Verified shapes (2026-11-14):
//   uWS (@colyseus/uwebsockets-transport 0.18) builds them from `req.forEach` (every request header, lower-case
//   names), so `sec-websocket-key` / `-version` / `upgrade` are present; `ws` builds them from Node's
//   `IncomingMessage.headers`. uWS only routes requests with a 24-char key to the upgrade handler, and upgrades any
//   other shape without validating it, so on uWS this check is about consistency, not a slot leak.
// - `ws` only: the HTTP method is not in the AuthContext, so ./ws-transport also runs `checkUpgradeRequest` as the
//   upgrade filter (it refuses before Colyseus' upgrade handler, hence before `beforeUpgrade` claims anything).

/** `ws`' Sec-WebSocket-Key rule: 16 random bytes in base64. */
const KEY_RE = /^[+/0-9A-Za-z]{22}==$/;
/** RFC 7230 token characters (subprotocol names). */
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Longest Sec-WebSocket-Protocol header looked at (Colyseus clients send none). */
const MAX_PROTOCOL_HEADER = 256;

export type HandshakeRefusal = {
  readonly status: 400 | 405;
  readonly reason: "method" | "upgrade" | "key" | "version" | "protocol";
};

const REFUSE_METHOD: HandshakeRefusal = { status: 405, reason: "method" };
const REFUSE_UPGRADE: HandshakeRefusal = { status: 400, reason: "upgrade" };
const REFUSE_KEY: HandshakeRefusal = { status: 400, reason: "key" };
const REFUSE_VERSION: HandshakeRefusal = { status: 400, reason: "version" };
const REFUSE_PROTOCOL: HandshakeRefusal = { status: 400, reason: "protocol" };

/** `Sec-WebSocket-Protocol` is absent or a valid, duplicate-free token list (as `ws`' subprotocol parser). */
function protocolsOk(header: string | null): boolean {
  if (header === null) return true;
  if (header.length === 0 || header.length > MAX_PROTOCOL_HEADER) return false;
  // ws: optional spaces/tabs around each token, but not at index 0; empty or duplicate tokens are invalid.
  if (header.charCodeAt(0) === 0x20 || header.charCodeAt(0) === 0x09) return false;
  const seen = new Set<string>();
  for (const part of header.split(",")) {
    const token = part.replace(/^[ \t]+|[ \t]+$/g, "");
    if (!TOKEN_RE.test(token) || seen.has(token)) return false;
    seen.add(token);
  }
  return true;
}

/**
 * Checks the handshake headers (`get` returns the header value or null; names are lower-case). Returns null when the
 * shape is acceptable, else the refusal to answer with.
 */
export function checkUpgradeHeaders(get: (name: string) => string | null | undefined): HandshakeRefusal | null {
  const upgrade = get("upgrade");
  if (upgrade == null || upgrade.toLowerCase() !== "websocket") return REFUSE_UPGRADE;
  const key = get("sec-websocket-key");
  if (key == null || !KEY_RE.test(key)) return REFUSE_KEY;
  if (get("sec-websocket-version")?.trim() !== "13") return REFUSE_VERSION;
  if (!protocolsOk(get("sec-websocket-protocol") ?? null)) return REFUSE_PROTOCOL;
  return null;
}

/** Node `IncomingMessage` shape used by the ws-transport filter. */
export interface UpgradeRequestLike {
  readonly method?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** Method + headers check of a raw Node upgrade request (TRANSPORT=ws). */
export function checkUpgradeRequest(req: UpgradeRequestLike): HandshakeRefusal | null {
  if (req.method !== "GET") return REFUSE_METHOD;
  return checkUpgradeHeaders((name) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v.join(", ") : v;
  });
}

/** Response headers for a refusal (version: tell the client which version we speak). */
export function refusalHeaders(refusal: HandshakeRefusal): Record<string, string> {
  return refusal.reason === "version" ? { "sec-websocket-version": "13" } : {};
}
