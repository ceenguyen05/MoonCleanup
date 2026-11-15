// WebSocket limits shared by both transports (./uws-transport, ./ws-transport).

/** Client -> server WebSocket message limit in bytes (netcode.md N8; uWS default is 4096, ws transport 4096). */
export const WS_MAX_PAYLOAD_BYTES = 2048;
/**
 * Per-socket send backpressure cap (security review B1c; transport default 1 MB). A busy client gets ~5 KB/s, so
 * 128 KB is >20 s of backlog: a socket that stops reading is closed instead of pinning memory.
 */
export const WS_MAX_BACKPRESSURE_BYTES = 128 * 1024;
/**
 * Ceiling of the bulk dust sends (DUST_SNAPSHOT slices) against a socket's buffered amount: 3/4 of the backpressure cap.
 * The 32 KB left over is the reserve for the frames, events and streamed ledgers that keep flowing while a slow client
 * drains, so a paced snapshot can never push the socket over `WS_MAX_BACKPRESSURE_BYTES` by itself.
 */
export const WS_BULK_SEND_CEILING_BYTES = (WS_MAX_BACKPRESSURE_BYTES / 4) * 3;
/** Wire overhead assumed per bytes message (Colyseus protocol + type bytes + WebSocket frame header). */
export const WS_SEND_OVERHEAD_BYTES = 8;
