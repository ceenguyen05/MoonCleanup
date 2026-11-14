// Unit: TRANSPORT parsing and the uWS -> ws fallback decision (injected loaders; no sockets).
import type { Transport } from "@colyseus/core";
import { describe, expect, it, vi } from "vitest";
import { Admission } from "./admission";
import { createOriginPolicy } from "./cors";
import type { NetLogger } from "./http-routes";
import {
  DEFAULT_TRANSPORT_MODE,
  TransportModeError,
  describeLoadFailure,
  loadTransportMode,
  parseTransportMode,
  selectTransport,
  type BoundTransport,
  type TransportDeps,
  type TransportKind,
  type TransportLoaders,
} from "./transport";

function recordingLogger() {
  const lines: Array<{ level: "info" | "warn" | "error" | "debug"; obj: object; msg: string | undefined }> = [];
  const logger: NetLogger = {
    info: (obj, msg) => lines.push({ level: "info", obj, msg }),
    warn: (obj, msg) => lines.push({ level: "warn", obj, msg }),
    error: (obj, msg) => lines.push({ level: "error", obj, msg }),
    debug: (obj, msg) => lines.push({ level: "debug", obj, msg }),
  };
  return { logger, lines };
}

function deps(logger: NetLogger): TransportDeps {
  return {
    routes: [],
    policy: createOriginPolicy(["http://localhost:5177"]),
    clientIpHeader: "true-client-ip",
    logger,
    admission: new Admission({ maxRooms: 1, maxClients: 1 }, logger),
    beforeUpgrade: () => undefined,
  };
}

function fake(kind: TransportKind): BoundTransport {
  return { kind, transport: {} as Transport, listen: () => Promise.resolve(0) };
}

describe("parseTransportMode", () => {
  it("defaults blank and unset to auto", () => {
    expect(DEFAULT_TRANSPORT_MODE).toBe("auto");
    expect(parseTransportMode(undefined)).toBe("auto");
    expect(parseTransportMode("")).toBe("auto");
    expect(parseTransportMode("   ")).toBe("auto");
  });

  it("accepts auto, uws and ws (trimmed, case-insensitive)", () => {
    expect(parseTransportMode("auto")).toBe("auto");
    expect(parseTransportMode("uws")).toBe("uws");
    expect(parseTransportMode(" WS ")).toBe("ws");
    expect(parseTransportMode("UWS")).toBe("uws");
  });

  it("rejects anything else with a readable error that does not echo the value", () => {
    for (const bad of ["uwebsockets", "websocket", "ws,uws", "1", "true"]) {
      expect(() => parseTransportMode(bad)).toThrow(TransportModeError);
    }
    try {
      parseTransportMode("secret-ish-value");
    } catch (error) {
      expect((error as Error).message).toContain("TRANSPORT: expected one of auto, uws, ws");
      expect((error as Error).message).not.toContain("secret-ish-value");
    }
  });

  it("loadTransportMode reads TRANSPORT from the given source", () => {
    expect(loadTransportMode({})).toBe("auto");
    expect(loadTransportMode({ TRANSPORT: "ws" })).toBe("ws");
    expect(() => loadTransportMode({ TRANSPORT: "nope" })).toThrow(TransportModeError);
  });
});

describe("describeLoadFailure", () => {
  it("keeps the first line, bounded", () => {
    expect(describeLoadFailure(new Error("Cannot find package 'uWebSockets.js'\n    at stack"))).toBe(
      "Cannot find package 'uWebSockets.js'",
    );
    expect(describeLoadFailure("plain")).toBe("plain");
    expect(describeLoadFailure(new Error(""))).toBe("unknown error");
    expect(describeLoadFailure(new Error("x".repeat(500))).length).toBe(203);
  });
});

describe("selectTransport", () => {
  it("auto: uses uWS when it loads and logs `[net] transport=uws`", async () => {
    const { logger, lines } = recordingLogger();
    const loaders: TransportLoaders = { uws: vi.fn(() => Promise.resolve(fake("uws"))), ws: vi.fn() };
    const bound = await selectTransport("auto", deps(logger), loaders);
    expect(bound.kind).toBe("uws");
    expect(loaders.ws).not.toHaveBeenCalled();
    expect(lines).toEqual([{ level: "info", obj: { transport: "uws", mode: "auto" }, msg: "[net] transport=uws" }]);
  });

  it("auto: falls back to ws on an import / native-load failure with ONE warning line", async () => {
    const { logger, lines } = recordingLogger();
    const loaders: TransportLoaders = {
      uws: () => Promise.reject(new Error("Cannot find package 'uWebSockets.js' imported from /srv/dist/x.js\nstack")),
      ws: vi.fn(() => Promise.resolve(fake("ws"))),
    };
    const bound = await selectTransport("auto", deps(logger), loaders);
    expect(bound.kind).toBe("ws");
    expect(loaders.ws).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("warn");
    expect(lines[0]?.msg).toBe(
      "[net] transport=ws (uWebSockets.js unavailable: Cannot find package 'uWebSockets.js' imported from /srv/dist/x.js)",
    );
    expect(lines[0]?.obj).toMatchObject({ transport: "ws", mode: "auto" });
  });

  it("auto: a synchronous throw inside the uWS loader also falls back", async () => {
    const { logger } = recordingLogger();
    const loaders: TransportLoaders = {
      uws: () => {
        throw new Error("This version of uWS.js supports only Node.js versions 22, 24 and 26");
      },
      ws: () => Promise.resolve(fake("ws")),
    };
    expect((await selectTransport("auto", deps(logger), loaders)).kind).toBe("ws");
  });

  it("ws: never touches uWS", async () => {
    const { logger, lines } = recordingLogger();
    const loaders: TransportLoaders = { uws: vi.fn(), ws: () => Promise.resolve(fake("ws")) };
    expect((await selectTransport("ws", deps(logger), loaders)).kind).toBe("ws");
    expect(loaders.uws).not.toHaveBeenCalled();
    expect(lines.map((l) => l.msg)).toEqual(["[net] transport=ws (TRANSPORT=ws)"]);
  });

  it("uws: a load failure is fatal (no silent fallback when uWS was explicitly requested)", async () => {
    const { logger } = recordingLogger();
    const loaders: TransportLoaders = { uws: () => Promise.reject(new Error("no addon")), ws: vi.fn() };
    await expect(selectTransport("uws", deps(logger), loaders)).rejects.toThrow("no addon");
    expect(loaders.ws).not.toHaveBeenCalled();
  });
});
