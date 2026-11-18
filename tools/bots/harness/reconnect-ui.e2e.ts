// Real-socket reconnect + invite-code e2e. LOCAL server only (apps/server startServer, memory persistence, `ws`
// transport, ephemeral port, fake secrets). Two real client stacks (OnlineRoom -> RoomSession -> @colyseus/sdk).
//
//   pnpm --dir tools/bots exec vitest run --config harness/vitest.e2e.config.ts harness/reconnect-ui
//
// Proves: (1) invite parsing (spaced/path/query forms) -> joinByCode -> both clients in the same room;
// (2) SDK-level drop of B (4010) and (3) hard network kill of B's socket (proxy closed -> 1006): `net.status` goes
// connected -> lost -> connected, session phase goes reconnecting -> resyncing/joined, B keeps the same sessionId, A
// keeps the same avatar slots (no duplicate seat), mirrors converge; (4) the UI store/chip (the same dispatch as
// AppNetModule and the same connView() the OnlineEntry chip renders) follows lost -> connected.
import { afterAll, describe, expect, it } from "vitest";
import { GuestCreateResponseSchema, INPUT_BUTTON_BIT, type NetStatusEvent, type SimInputCommand } from "@moon-cleanup/shared";
import { ENTITY_KIND_AVATAR } from "@moon-cleanup/protocol";
import { createContractsApi } from "../../../apps/client/src/ui/online/contracts-api";
import { connView, parseInviteLink, type OnlineAuthPort } from "../../../apps/client/src/ui/online/online-model";
import { createOnlineRoom, type OnlineRoom } from "../../../apps/client/src/app/online-room";
import { createEventBus } from "../../../apps/client/src/app/event-bus";
import { createUiStore } from "../../../apps/client/src/app/ui-store";
import { colyseusConsume, type RoomConnection } from "../../../apps/client/src/net/room-session";
import { startProxy, PROFILES, type NetProxy } from "../../netsim/src/index";

const ORIGIN = "http://localhost:5178";
interface ServerHarness {
  readonly port: number;
  shutdown(): Promise<void>;
}
type WsInit = string | string[] | { protocols?: string | string[]; headers?: Record<string, string> };
type WsCtor = new (url: string | URL, init?: WsInit) => WebSocket;
const NativeWebSocket = globalThis.WebSocket;
const NativeCtor = NativeWebSocket as unknown as WsCtor;
class BrowserLikeWebSocket extends NativeCtor {
  constructor(url: string | URL, init?: WsInit) {
    const o = typeof init === "object" && !Array.isArray(init) && init !== null ? init : { protocols: init };
    super(url, { ...o, headers: { ...(o.headers ?? {}), origin: ORIGIN } });
  }
}
globalThis.WebSocket = BrowserLikeWebSocket as unknown as typeof WebSocket;

let app: ServerHarness | null = null;
const proxies: NetProxy[] = [];
const rooms: OnlineRoom[] = [];
afterAll(async () => {
  for (const r of rooms) r.dispose();
  for (const p of proxies) await p.close().catch(() => undefined);
  await app?.shutdown();
  globalThis.WebSocket = NativeWebSocket;
}, 30_000);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function avatarSlots(room: OnlineRoom): string {
  const kinds = room.session.core.table.kind;
  const out: number[] = [];
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === ENTITY_KIND_AVATAR) out.push(i);
  return out.join(",");
}

describe("real-socket reconnect + invite join", () => {
  it("invite join, drop/reconnect with same seat, UI chip follows", async () => {
    const ops = (await import(
      /* @vite-ignore */ new URL("../../../apps/server/src/ops/index.ts", import.meta.url).href
    )) as { parseServerEnv(raw: Record<string, string>): Record<string, unknown> };
    const server = (await import(
      /* @vite-ignore */ new URL("../../../apps/server/src/app/server.ts", import.meta.url).href
    )) as { startServer(env: unknown, options?: Record<string, unknown>): Promise<ServerHarness> };
    const env = {
      ...ops.parseServerEnv({
        NODE_ENV: "production",
        ENV_NAME: "local",
        PERSISTENCE_DRIVER: "memory",
        PORT: "2599",
        JWT_SECRET: "a".repeat(32),
        REFRESH_TOKEN_PEPPER: "b".repeat(32),
        ALLOWED_ORIGINS: ORIGIN,
        LOG_LEVEL: "fatal",
      }),
      port: 0,
    };
    app = await server.startServer(env, { transport: "ws", purgeIntervalMs: 0 });
    const serverPort = app.port;
    const http = `http://127.0.0.1:${serverPort}`;

    const guest = async (name: string, ip: string): Promise<string> => {
      const res = await fetch(`${http}/v1/auth/guest`, {
        method: "POST",
        headers: { "content-type": "application/json", "true-client-ip": ip },
        body: JSON.stringify({ displayName: name }),
      });
      expect(res.status).toBe(201);
      return GuestCreateResponseSchema.parse(await res.json()).accessToken;
    };
    const tokenA = await guest("Rc A", "203.0.113.101");
    const tokenB = await guest("Rc B", "203.0.113.102");
    const port = (token: string): OnlineAuthPort => ({
      signedIn: true,
      signIn: () => Promise.resolve(true),
      getAccessToken: () => Promise.resolve(token),
    });

    // ---- invite-code end to end -------------------------------------------------------------------------------
    const created = await createContractsApi({ httpUrl: http, auth: port(tokenA) }).createPrivateShift("Reconnect Shift");
    if (!created.ok) throw new Error(`create failed: ${created.failure.key}`);
    const rawCode = created.value.inviteCode ?? "";
    expect(rawCode).not.toBe("");
    const spaced = `${rawCode.slice(0, 4)} ${rawCode.slice(4)}`.toLowerCase();
    const forms = [
      parseInviteLink("", `/join/${rawCode.toLowerCase()}`),
      parseInviteLink(`?join=${encodeURIComponent(spaced)}`, "/"),
      parseInviteLink("", "/join/nope"),
    ];
    expect(forms[0]).toBe(rawCode.replace(/[^0-9A-Za-z]/g, "").toUpperCase());
    expect(forms[1]).toBe(forms[0]);
    expect(forms[2]).toBeNull();
    const apiB = createContractsApi({ httpUrl: http, auth: port(tokenB) });
    const bad = await apiB.joinByCode("ZZZZ9999");
    expect(bad.ok).toBe(false);
    const joined = await apiB.joinByCode(forms[0] ?? "");
    if (!joined.ok) throw new Error(`invite join failed: ${joined.failure.key}`);
    const contractId = created.value.contractId;
    expect(joined.value.contractId).toBe(contractId);

    // ---- two clients, B behind a (clean) proxy so its socket can be hard-killed ------------------------------------
    const proxyB = await startProxy({ profile: PROFILES.clean, listenPort: 0, targetPort: serverPort, seed: 7 });
    proxies.push(proxyB);
    const proxyPort = proxyB.port;
    const bus = createEventBus({ onListenerError: (n, e) => { throw new Error(`listener ${n}: ${String(e)}`); } });
    const store = createUiStore(1000);
    // Same mirror as AppNetModule.init.
    bus.on("net.status", (event) =>
      store.dispatch({ type: "session.set", patch: { conn: event.state, rttMs: event.rttMs, closeCode: event.closeCode } }),
    );
    const statusLog: NetStatusEvent[] = [];
    const chipLog: string[] = [];
    let flushClock = 0;
    bus.on("net.status", (e) => {
      statusLog.push(e);
      store.flush((flushClock += 10_000));
      const s = store.getState().session;
      chipLog.push(`${s.conn}/${connView(s.conn, s.rttMs).label}`);
    });

    let bConn: RoomConnection | null = null;
    const open = (token: string, h: string, w: string, events: boolean, capture: boolean): OnlineRoom => {
      const room = createOnlineRoom({
        httpUrl: h,
        wsUrl: w,
        clientBuild: "rc-e2e",
        contractId,
        auth: { getAccessToken: () => Promise.resolve(token) },
        wakeProbe: false,
        ...(events ? { events: bus } : {}),
        consume: async (wsUrl, reservation, policy) => {
          const c = await colyseusConsume(wsUrl, reservation, policy);
          if (capture) bConn = c;
          return c;
        },
      });
      rooms.push(room);
      return room;
    };
    const a = open(tokenA, http, `ws://127.0.0.1:${serverPort}`, false, false);
    const b = open(tokenB, `http://127.0.0.1:${proxyPort}`, `ws://127.0.0.1:${proxyPort}`, true, true);
    const phases: string[] = [];
    const pump = (): void => {
      a.frame(25);
      b.frame(25);
      if (phases[phases.length - 1] !== b.session.phase) phases.push(b.session.phase);
    };
    const diag = (): string =>
      JSON.stringify({ phases, status: statusLog.map((s) => s.state), a: a.session.phase, b: b.session.phase, f: b.session.failure });
    const waitFor = async (what: string, cond: () => boolean, ms: number): Promise<void> => {
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error(`timed out: ${what} ${diag()}`);
        pump();
        await sleep(25);
      }
    };
    let seq = 0;
    const cmd = (moveY: number, buttons: number): SimInputCommand => ({
      seq: ++seq, moveX: 0, moveY, yaw: 0, pitch: 0, buttons, toolParam: 0,
    });
    const sweep = async (ticks: number): Promise<void> => {
      for (let i = 0; i < ticks; i++) {
        a.sendInput(cmd(127, 1 << INPUT_BUTTON_BIT.toolPrimary));
        pump();
        await sleep(50);
      }
      a.sendInput(cmd(0, 0));
    };
    const converge = async (what: string): Promise<void> => {
      let last = -1;
      await waitFor(what, () => {
        const ha = a.feed.ledger.worldHash();
        const hb = b.feed.ledger.worldHash();
        const ok = ha === hb && hb === last;
        last = hb;
        return ok;
      }, 45_000);
    };

    a.start();
    b.start();
    await waitFor("both joined", () => a.dust.ready && b.dust.ready, 60_000);
    await waitFor("both avatars", () => avatarSlots(a) !== "" && avatarSlots(b) !== "", 15_000);
    expect(statusLog.map((s) => s.state)).toContain("connected");
    const sessionId0 = (bConn as RoomConnection | null)?.sessionId;
    expect(sessionId0).toBeTruthy();
    const slotsA0 = avatarSlots(a);
    const slotsB0 = avatarSlots(b);
    await sweep(20);
    await converge("pre-drop convergence");

    const report: Record<string, unknown> = { invite: { forms, badCodeRejected: !bad.ok }, sessionId0, slotsA0 };

    const dropAndRecover = async (name: string, drop: () => Promise<void>): Promise<void> => {
      statusLog.length = 0;
      chipLog.length = 0;
      phases.length = 0;
      await drop();
      await waitFor(`${name}: lost seen`, () => statusLog.some((s) => s.state === "lost"), 15_000);
      const lostIdx = statusLog.findIndex((s) => s.state === "lost");
      await sweep(40); // A keeps polishing while B is away
      await waitFor(`${name}: recovered`, () => b.session.phase === "joined" && statusLog.some((s, i) => i > lostIdx && s.state === "connected"), 60_000);
      await converge(`${name}: convergence`);
      const states = statusLog.map((s) => s.state);
      expect(states.indexOf("lost")).toBeGreaterThanOrEqual(0);
      expect(states.lastIndexOf("connected")).toBeGreaterThan(states.indexOf("lost"));
      expect(statusLog[lostIdx]?.previous).toBe("connected");
      // UI chip: data-conn/label followed lost -> connected and ended on connected.
      expect(chipLog).toContain("lost/lost");
      expect(chipLog[chipLog.length - 1]).toBe("connected/connected");
      expect(chipLog.indexOf("lost/lost")).toBeLessThan(chipLog.lastIndexOf("connected/connected"));
      expect(b.session.failure).toBeNull();
      expect((bConn as RoomConnection | null)?.sessionId).toBe(sessionId0);
      expect(avatarSlots(a)).toBe(slotsA0);
      expect(avatarSlots(b)).toBe(slotsB0);
      expect(a.feed.ledger.worldHash()).toBe(b.feed.ledger.worldHash());
      report[name] = { phases: [...phases], status: states, chip: [...chipLog], sessionIdSame: true, avatarSlotsSame: true };
    };

    await dropAndRecover("sdkDrop4010", async () => {
      (bConn as unknown as { connection: { close(code: number): void } }).connection.close(4010);
      await sleep(50);
    });

    // Hard network kill: stop the proxy (destroys sockets -> 1006), keep A going, then restart it on the same port.
    await dropAndRecover("networkKill1006", async () => {
      await proxyB.close();
      proxies.splice(proxies.indexOf(proxyB), 1);
      await waitFor("B notices kill", () => b.session.phase !== "joined", 15_000);
      await sleep(1500);
      proxies.push(await startProxy({ profile: PROFILES.clean, listenPort: proxyPort, targetPort: serverPort, seed: 8 }));
    });

    console.info("[reconnect-ui-e2e]", JSON.stringify(report));
  }, 300_000);
});
