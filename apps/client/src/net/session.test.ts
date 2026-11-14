import { CloseCode, MESSAGE_CATALOG, PROTOCOL_VERSION, type EventBus, type NetStatusEvent } from "@moon-cleanup/shared";
import { PONG_BODY_BYTES, readPingBody, writePongBody } from "@moon-cleanup/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNetSession, shouldProbe, type ConnectFn, type RoomLike } from "./session";

function bus(seen: NetStatusEvent[]): EventBus {
  return {
    emit: (_name, payload) => void seen.push(payload as NetStatusEvent),
    on: () => () => {},
  } as EventBus;
}

const HEALTH = {
  ok: true,
  service: "moon-cleanup-server",
  env: "local",
  build: "dev",
  protocolVersion: PROTOCOL_VERSION,
  uptimeS: 1,
};
const RESERVATION = { reservation: { name: "hello", sessionId: "s", roomId: "r", processId: "p" } };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

class FakeRoom implements RoomLike {
  handlers = new Map<string | number, (p: never) => void>();
  leaveCb: ((code: number) => void) | undefined;
  sent: Uint8Array[] = [];
  onMessage(type: string | number, cb: (p: never) => void) {
    this.handlers.set(type, cb);
  }
  onLeave(cb: (code: number) => void) {
    this.leaveCb = cb;
  }
  sendBytes(_type: number, bytes: Uint8Array) {
    this.sent.push(bytes.slice());
  }
  leave() {}
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("net session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("walks asleep -> waking -> connecting -> connected, retries probes every 3 s, reports RTT, then lost", async () => {
    const seen: NetStatusEvent[] = [];
    let probes = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/healthz")) {
        probes++;
        if (probes < 3) return new Response("<html>waking</html>", { status: 200 });
        return json(HEALTH);
      }
      expect(JSON.parse(String(init?.body))).toEqual({ protocolVersion: PROTOCOL_VERSION, clientBuild: "dev" });
      return json(RESERVATION);
    });
    const room = new FakeRoom();
    const connect: ConnectFn = vi.fn(async () => room);
    let clock = 1000;
    const session = createNetSession({
      httpUrl: "http://localhost:2571/",
      wsUrl: "ws://localhost:2571",
      clientBuild: "dev",
      events: bus(seen),
      fetch: fetchFn as typeof fetch,
      connect,
      now: () => clock,
    });
    expect(seen[0]).toEqual({ state: "asleep", previous: null, closeCode: null, rttMs: null });

    session.wake();
    await flush();
    expect(session.state).toBe("waking");
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await flush();
    expect(probes).toBe(3);
    expect(session.state).toBe("connected");
    expect(seen.map((e) => e.state)).toEqual(["asleep", "waking", "connecting", "connected"]);

    // First PING goes out on join; answer it 42 ms later.
    expect(room.sent).toHaveLength(1);
    const sentAt = readPingBody(room.sent[0] as Uint8Array);
    expect(sentAt).toBe(1000);
    clock += 42;
    const pong = new Uint8Array(PONG_BODY_BYTES);
    writePongBody({ clientTimeMs: sentAt, serverTick: 7 }, pong);
    (room.handlers.get(MESSAGE_CATALOG.PONG.id) as (p: Uint8Array) => void)(pong);
    expect(session.rttMs).toBe(42);
    expect(seen.at(-1)).toMatchObject({ state: "connected", previous: "connected", rttMs: 42 });

    await vi.advanceTimersByTimeAsync(2000);
    expect(room.sent).toHaveLength(2);

    room.leaveCb?.(1006);
    expect(seen.at(-1)).toMatchObject({ state: "lost", previous: "connected", closeCode: 1006 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(room.sent).toHaveLength(2);
    session.dispose();
  });

  it("reports a 4100 join rejection as lost with that close code", async () => {
    const seen: NetStatusEvent[] = [];
    const fetchFn = async (url: string | URL | Request) =>
      String(url).endsWith("/healthz") ? json(HEALTH) : json(RESERVATION);
    const session = createNetSession({
      httpUrl: "http://x",
      wsUrl: "ws://x",
      clientBuild: "dev",
      events: bus(seen),
      fetch: fetchFn as typeof fetch,
      connect: () => Promise.reject(Object.assign(new Error("{}"), { code: CloseCode.PROTOCOL_MISMATCH })),
    });
    session.wake();
    await flush();
    expect(seen.at(-1)).toMatchObject({ state: "lost", closeCode: 4100 });
    session.wake();
    expect(session.state).toBe("waking");
    session.dispose();
  });

  it("honours the no-probe rules", () => {
    const base = { webdriver: false, userAgent: "Mozilla/5.0 Chrome", prerendering: false, hidden: false };
    expect(shouldProbe(base)).toBe(true);
    expect(shouldProbe({ ...base, webdriver: true })).toBe(false);
    expect(shouldProbe({ ...base, webdriver: true, allowAutomation: true })).toBe(true);
    expect(shouldProbe({ ...base, userAgent: "Googlebot/2.1" })).toBe(false);
    expect(shouldProbe({ ...base, hidden: true })).toBe(false);
    expect(shouldProbe({ ...base, prerendering: true, allowAutomation: true })).toBe(false);
  });
});
