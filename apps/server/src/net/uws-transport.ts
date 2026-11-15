// uWebSockets.js transport adapter (TRANSPORT=uws, or auto when the native addon loads). Loaded ONLY through
// `import("./uws-transport")` in ./transport: its static imports (the native `uWebSockets.js`, which is optional and
// external to the bundle, and @colyseus/uwebsockets-transport) then live in a lazy chunk, so a missing or
// incompatible addon rejects that import instead of failing the whole process.
//
// - HTTP: `HttpRouteDef[]` mounted as plain uWS handlers (./http-routes, why not Colyseus' router).
// - Upgrades: `beforeUpgrade` (origin 403, handshake shape 400, per-IP socket cap 429); open/close reported to
//   Admission. The AuthContext headers it reads come from `req.forEach` here (all headers, lower-case), so the
//   handshake check sees `upgrade` / `sec-websocket-key` / `-version` (./upgrade-handshake, review NB2).
// - Payload 2 KB, backpressure 128 KB with close (security review B1c).

import { uWebSocketsTransport, type TransportOptions } from "@colyseus/uwebsockets-transport";
import { us_socket_local_port } from "uWebSockets.js";
import type { Admission } from "./admission";
import { WS_MAX_BACKPRESSURE_BYTES, WS_MAX_PAYLOAD_BYTES } from "./limits";
import { mountFallbackRoutes, mountHttpRoutes } from "./http-routes";
import type { BoundTransport, TransportDeps } from "./transport";

interface UpgradeSocket {
  readonly context?: object;
}

/**
 * uWS transport that reports socket open/close to Admission so the per-IP socket cap counts live sockets. The
 * transport's `open` handler calls `onConnection`, whose synchronous part registers the close wrapper.
 */
class AdmittingTransport extends uWebSocketsTransport {
  constructor(
    options: TransportOptions,
    private readonly admission: Admission,
  ) {
    super(options);
  }

  protected override onConnection(rawClient: Parameters<uWebSocketsTransport["onConnection"]>[0]): Promise<void> {
    const context = (rawClient as UpgradeSocket).context;
    const done = super.onConnection(rawClient);
    if (context !== undefined && this.admission.socketOpened(context) !== undefined) {
      const wrapper = this.clientWrappers.get(rawClient);
      if (wrapper === undefined) this.admission.socketClosed(context);
      else wrapper.once("close", () => this.admission.socketClosed(context));
    }
    return done;
  }
}

export function createUwsTransport(deps: TransportDeps): BoundTransport {
  const transport = new AdmittingTransport(
    {
      maxPayloadLength: WS_MAX_PAYLOAD_BYTES,
      maxBackpressure: WS_MAX_BACKPRESSURE_BYTES,
      closeOnBackpressureLimit: true,
      beforeUpgrade: deps.beforeUpgrade,
    },
    deps.admission,
  );
  mountHttpRoutes(transport.app, deps.routes, {
    policy: deps.policy,
    clientIpHeader: deps.clientIpHeader,
    logger: deps.logger,
    ...(deps.rawBodyAuth === undefined ? {} : { rawBodyAuth: deps.rawBodyAuth }),
  });

  return {
    kind: "uws",
    transport,
    async listen(run, port) {
      await run();
      mountFallbackRoutes(transport.app, deps.policy);
      // The uWS transport reports success even when the bind failed (listen socket `false`): check it here.
      const listenSocket: unknown = Reflect.get(transport, "_listeningSocket");
      if (!listenSocket) throw new Error(`could not bind port ${port}`);
      return us_socket_local_port(listenSocket as Parameters<typeof us_socket_local_port>[0]);
    },
  };
}
