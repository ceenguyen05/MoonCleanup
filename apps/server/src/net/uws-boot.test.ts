// Boot test requested by the T02 security review: the transport and uWebSockets.js must load through the SAME
// module path the server bundle uses (plain ESM import, no resolve hook) and open a real socket.
//
// Known failure while uWebSockets.js is pinned to v20.71.0: its ESM_wrapper.mjs imports a missing `./index.js`
// (ERR_MODULE_NOT_FOUND). Fix: re-pin (see docs/agent-reports/M0-W1-T04-netcode-engineer.md). Do not weaken this test.

import { describe, expect, it } from "vitest";

describe("uWebSockets.js boot (no workaround)", () => {
  it("imports the uWS transport and serves one HTTP request on a real socket", async () => {
    const uws = await import("uWebSockets.js");
    const { uWebSocketsTransport } = await import("@colyseus/uwebsockets-transport");
    const transport = new uWebSocketsTransport({});
    transport.app.get("/boot", (res) => {
      res.end("ok");
    });
    const listenSocket = await new Promise<unknown>((resolve) => {
      transport.app.listen(0, (socket) => resolve(socket));
    });
    expect(listenSocket).toBeTruthy();
    const port = uws.us_socket_local_port(listenSocket as Parameters<typeof uws.us_socket_local_port>[0]);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/boot`);
      expect(await response.text()).toBe("ok");
    } finally {
      uws.us_listen_socket_close(listenSocket as Parameters<typeof uws.us_listen_socket_close>[0]);
    }
  }, 30_000);
});
