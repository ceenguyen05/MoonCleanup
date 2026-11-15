// Bytes queued on a client's socket but not yet written to the network, for send pacing (./shift/shift-core). The two
// transports expose it differently: `ws` as `WebSocket.bufferedAmount` on the client's `ref`, uWebSockets.js as
// `getBufferedAmount()` on the raw socket held by Colyseus' wrapper (`ref.ws`). Anything else (tests, a closed socket)
// reads as 0 and the caller falls back to its own per-tick accounting.

interface WithBufferedAmount {
  readonly bufferedAmount: number;
}
interface WithUwsSocket {
  readonly ws?: { getBufferedAmount?: () => number };
}

/** Bytes buffered on `client`'s socket; 0 when unknown or the socket is gone. Allocation-free. */
export function socketBufferedBytes(client: { readonly ref?: unknown } | undefined): number {
  const ref = client?.ref;
  if (ref === undefined || ref === null || typeof ref !== "object") return 0;
  const amount = (ref as Partial<WithBufferedAmount>).bufferedAmount;
  if (typeof amount === "number") return amount;
  const raw = (ref as WithUwsSocket).ws;
  if (raw !== undefined && typeof raw.getBufferedAmount === "function") {
    try {
      return raw.getBufferedAmount();
    } catch {
      return 0; // uWS throws on a closed socket
    }
  }
  return 0;
}
