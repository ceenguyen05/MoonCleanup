// WebSocket limits shared by both transports (./uws-transport, ./ws-transport).

/** Client -> server WebSocket message limit in bytes (netcode.md N8; uWS default is 4096, ws transport 4096). */
export const WS_MAX_PAYLOAD_BYTES = 2048;
/**
 * Per-socket send backpressure cap (security review B1c; transport default 1 MB). A busy client gets ~5 KB/s, so
 * 128 KB is >20 s of backlog: a socket that stops reading is closed instead of pinning memory.
 */
export const WS_MAX_BACKPRESSURE_BYTES = 128 * 1024;
