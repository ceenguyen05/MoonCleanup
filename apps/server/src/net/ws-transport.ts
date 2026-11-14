// `ws` fallback transport adapter (TRANSPORT=ws, or auto when uWebSockets.js cannot load). Loaded ONLY through
// `import("./ws-transport")` in ./transport (lazy chunk in the bundle: express/ws are evaluated only when chosen).
//
// Colyseus' WebSocketTransport behind OUR Node http server, with the same protections as ./uws-transport:
// - HTTP: ./node-http (same pipeline as the uWS routes: 16 KB body limit, safe percent-decoding -> 400, CORS, client
//   IP rules, 404 fallback). Colyseus binds its own router to the server's `request` event inside `listen()`; it is
//   removed synchronously in the same listening callback, before any request can reach it (no `/matchmake`, no
//   credentialed CORS, no unbounded body buffering).
// - Upgrades: `beforeUpgrade` (origin 403, per-IP socket cap 429) runs before the handshake; open/close reported to
//   Admission. Message payload 2 KB (`maxPayload`, close 1009 above it).
// - Backpressure: `ws` has no send cap, so a 1 s sweep terminates sockets whose `bufferedAmount` exceeds 128 KB
//   (the uWS `closeOnBackpressureLimit` equivalent, security review B1c).
// - Slow clients: header and request timeouts on the http server.

import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { AuthContext } from "@colyseus/core";
import { WebSocketTransport, type TransportOptions } from "@colyseus/ws-transport";
import type { Admission } from "./admission";
import { WS_MAX_BACKPRESSURE_BYTES, WS_MAX_PAYLOAD_BYTES } from "./limits";
import { createNodeRequestHandler, type NodeRequestHandler } from "./node-http";
import type { BoundTransport, TransportDeps } from "./transport";

/** Time allowed to receive the request headers (slowloris guard; uWS: 10 s idle). */
export const HTTP_HEADERS_TIMEOUT_MS = 10_000;
/** Time allowed to receive a whole REST request (bodies are at most 16 KB). */
export const HTTP_REQUEST_TIMEOUT_MS = 15_000;
/** Backpressure sweep period. */
export const BACKPRESSURE_SWEEP_MS = 1_000;

interface RawSocket {
  readonly bufferedAmount: number;
  once(event: "close", listener: () => void): unknown;
  terminate(): void;
}

class AdmittingWsTransport extends WebSocketTransport {
  private sweep: ReturnType<typeof setInterval> | undefined;

  constructor(
    options: TransportOptions,
    private readonly admission: Admission,
    private readonly requestHandler: NodeRequestHandler,
  ) {
    super(options);
    // A second `connection` listener: Colyseus' own one (registered in super) connects the client to its room.
    this.wss.on("connection", (socket: RawSocket, _req: IncomingMessage, upgrade?: { context?: AuthContext }) => {
      const context = upgrade?.context;
      if (context !== undefined && this.admission.socketOpened(context) !== undefined) {
        socket.once("close", () => this.admission.socketClosed(context));
      }
    });
  }

  override listen(port: number, hostname?: string, backlog?: number, listeningListener?: () => void): this {
    const server = this.server as HttpServer;
    return super.listen(port, hostname, backlog, () => {
      // Colyseus binds its router (prependListener 'request') inside this callback: run it, then strip it.
      listeningListener?.();
      for (const listener of server.listeners("request")) {
        if (listener !== this.requestHandler) server.removeListener("request", listener as never);
      }
      this.startBackpressureSweep();
    });
  }

  override shutdown(): void {
    if (this.sweep !== undefined) clearInterval(this.sweep);
    this.sweep = undefined;
    super.shutdown();
  }

  private startBackpressureSweep(): void {
    if (this.sweep !== undefined) return;
    this.sweep = setInterval(() => {
      for (const socket of this.wss.clients) {
        if (socket.bufferedAmount > WS_MAX_BACKPRESSURE_BYTES) socket.terminate();
      }
    }, BACKPRESSURE_SWEEP_MS);
    this.sweep.unref();
  }
}

export function createWsTransport(deps: TransportDeps): BoundTransport {
  const requestHandler = createNodeRequestHandler(deps.routes, {
    policy: deps.policy,
    clientIpHeader: deps.clientIpHeader,
    logger: deps.logger,
  });
  const server = createServer(
    { headersTimeout: HTTP_HEADERS_TIMEOUT_MS, requestTimeout: HTTP_REQUEST_TIMEOUT_MS },
    requestHandler,
  );
  const transport = new AdmittingWsTransport(
    {
      server,
      maxPayload: WS_MAX_PAYLOAD_BYTES,
      perMessageDeflate: false,
      beforeUpgrade: deps.beforeUpgrade,
    },
    deps.admission,
    requestHandler,
  );

  return {
    kind: "ws",
    transport,
    async listen(run) {
      // Colyseus' listen never settles when the bind fails (EADDRINUSE is only emitted as 'error'): race it.
      let onError: ((error: Error) => void) | undefined;
      const failed = new Promise<never>((_, reject) => {
        onError = reject;
        server.once("error", onError);
      });
      try {
        await Promise.race([run(), failed]);
      } finally {
        if (onError !== undefined) server.removeListener("error", onError);
      }
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("http server is not bound to a port");
      return address.port;
    },
  };
}
