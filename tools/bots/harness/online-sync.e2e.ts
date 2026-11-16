// Headless Node check of remote dust sync + reconnect on the REAL server (apps/server startServer -> ShiftRoom, memory
// persistence, `ws` transport) with two REAL client stacks (apps/client OnlineRoom -> RoomSession -> @colyseus/sdk).
// No browser. Read-only use of apps/server and apps/client sources; it lives here so it is not part of any package suite.
//
//   pnpm --dir tools/bots exec vitest run --config harness/vitest.e2e.config.ts            (clean network)
//   NETSIM=typical pnpm --dir tools/bots exec vitest run --config harness/vitest.e2e.config.ts   (120 ms +/- 30, 1 % loss)
//
// Scenarios (one fresh server per run):
//   1. A sweeps with the primary tool (the "polish intent" is the toolPrimary input button); B receives the strokes as
//      FRAME stroke sections / DUST_LOG messages (dust.stats.strokes / deltas) and both mirrors reach the same worldHash.
//   2. In-place drop of B (SDK close 4010 = MAY_TRY_RECONNECT, seat hold): A keeps sweeping while B is away; after B
//      is `joined` again its mirror equals A's (resync via keyframe + dust snapshot).
//   3. Network kill of B's sockets (clean: close(1006-like) via netsim proxy restart; only with NETSIM): same assertions.
//   4. B leaves for good (consented) and a fresh OnlineRoom for the same player joins the same Shift: mirror == A's.
import { afterAll, describe, expect, it } from "vitest";
import { GuestCreateResponseSchema, INPUT_BUTTON_BIT, type SimInputCommand } from "@moon-cleanup/shared";
import { ENTITY_KIND_AVATAR } from "@moon-cleanup/protocol";
import { createContractsApi } from "../../../apps/client/src/ui/online/contracts-api";
import type { OnlineAuthPort } from "../../../apps/client/src/ui/online/online-model";
import { createOnlineRoom, type OnlineRoom } from "../../../apps/client/src/app/online-room";
import { colyseusConsume, type RoomConnection } from "../../../apps/client/src/net/room-session";
import { startProxy, PROFILES, isProfileName, type NetProxy, type ProfileName } from "../../netsim/src/index";

const ORIGIN = "http://localhost:5178";
const PROFILE_NAME = process.env["NETSIM"] ?? "";
const profile: ProfileName | null = isProfileName(PROFILE_NAME) ? PROFILE_NAME : null;

interface ServerHarness {
  readonly port: number;
  shutdown(): Promise<void>;
}

// Node's WebSocket sends no Origin; the server requires an allowed one on the upgrade (browser stand-in).
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

function avatarCount(room: OnlineRoom): number {
  const kinds = room.session.core.table.kind;
  let n = 0;
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === ENTITY_KIND_AVATAR) n++;
  return n;
}

describe(`online dust sync + reconnect (${profile ?? "clean"})`, () => {
  it("remote deltas, in-place drop, network kill and fresh rejoin all converge on A's worldHash", async () => {
    const ops = (await import(
      /* @vite-ignore */ new URL("../../../apps/server/src/ops/index.ts", import.meta.url).href
    )) as {
      parseServerEnv(raw: Record<string, string>): Record<string, unknown>;
    };
    const server = (await import(
      /* @vite-ignore */ new URL("../../../apps/server/src/app/server.ts", import.meta.url).href
    )) as {
      startServer(env: unknown, options?: Record<string, unknown>): Promise<ServerHarness>;
    };
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
    const direct = { http: `http://127.0.0.1:${serverPort}`, ws: `ws://127.0.0.1:${serverPort}` };

    const guest = async (name: string, ip: string): Promise<string> => {
      const res = await fetch(`${direct.http}/v1/auth/guest`, {
        method: "POST",
        headers: { "content-type": "application/json", "true-client-ip": ip },
        body: JSON.stringify({ displayName: name }),
      });
      expect(res.status).toBe(201);
      return GuestCreateResponseSchema.parse(await res.json()).accessToken;
    };
    const tokenA = await guest("Sync A", "203.0.113.91");
    const tokenB = await guest("Sync B", "203.0.113.92");
    const port = (token: string): OnlineAuthPort => ({
      signedIn: true,
      signIn: () => Promise.resolve(true),
      getAccessToken: () => Promise.resolve(token),
    });
    const created = await createContractsApi({ httpUrl: direct.http, auth: port(tokenA) }).createPrivateShift(
      "Sync Shift",
    );
    if (!created.ok) throw new Error(`create failed: ${created.failure.key}`);
    const contractId = created.value.contractId;
    const joined = await createContractsApi({ httpUrl: direct.http, auth: port(tokenB) }).joinByCode(
      created.value.inviteCode ?? "",
    );
    if (!joined.ok) throw new Error(`join failed: ${joined.failure.key}`);

    // Each client gets its own conditioned path (so killing B's sockets never touches A).
    const route = async (seed: number): Promise<{ http: string; ws: string; proxy: NetProxy | null }> => {
      if (profile === null) return { ...direct, proxy: null };
      const proxy = await startProxy({ profile: PROFILES[profile], listenPort: 0, targetPort: serverPort, seed });
      proxies.push(proxy);
      return { http: `http://127.0.0.1:${proxy.port}`, ws: `ws://127.0.0.1:${proxy.port}`, proxy };
    };
    const pathA = await route(11);
    const pathB = await route(22);

    let bConn: RoomConnection | null = null;
    const open = (token: string, p: { http: string; ws: string }, capture: boolean): OnlineRoom => {
      const room = createOnlineRoom({
        httpUrl: p.http,
        wsUrl: p.ws,
        clientBuild: "sync-e2e",
        contractId,
        auth: { getAccessToken: () => Promise.resolve(token) },
        wakeProbe: false,
        consume: async (wsUrl, reservation, policy) => {
          const c = await colyseusConsume(wsUrl, reservation, policy);
          if (capture) bConn = c;
          return c;
        },
      });
      rooms.push(room);
      return room;
    };

    const a = open(tokenA, pathA, false);
    let b = open(tokenB, pathB, true);
    const phases = { b: new Set<string>() };
    const pump = (): void => {
      a.frame(25);
      b.frame(25);
      phases.b.add(b.session.phase);
    };
    const diag = (): string =>
      JSON.stringify(
        [a, b].map((r) => ({
          phase: r.session.phase,
          failure: r.session.failure,
          ready: r.dust.ready,
          stats: r.stats,
          dust: r.dust.stats,
          session: r.session.core.stats,
        })),
      );
    const waitFor = async (what: string, cond: () => boolean, ms: number): Promise<number> => {
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${diag()}`);
        pump();
        await sleep(25);
      }
      return Date.now() - t0;
    };
    const converge = async (what: string): Promise<number> => {
      let last = -1;
      return waitFor(
        what,
        () => {
          const ha = a.feed.ledger.worldHash();
          const hb = b.feed.ledger.worldHash();
          const ok = ha === hb && hb === last;
          last = hb;
          return ok;
        },
        45_000,
      );
    };
    let seq = 0;
    const cmd = (moveY: number, buttons: number, yaw: number): SimInputCommand => ({
      seq: ++seq,
      moveX: 0,
      moveY,
      yaw,
      pitch: 0,
      buttons,
      toolParam: 0,
    });
    const sweep = async (ticks: number, yaw = 0): Promise<void> => {
      for (let i = 0; i < ticks; i++) {
        a.sendInput(cmd(127, 1 << INPUT_BUTTON_BIT.toolPrimary, yaw));
        pump();
        await sleep(50);
      }
      a.sendInput(cmd(0, 0, yaw));
    };

    const report: Record<string, unknown> = { profile: profile ?? "clean" };
    a.start();
    b.start();
    await waitFor("both joined with dust mirrors", () => a.dust.ready && b.dust.ready, 60_000);
    await waitFor("each sees an avatar", () => avatarCount(a) >= 1 && avatarCount(b) >= 1, 15_000);
    await waitFor("A predictor", () => a.predictor.ready, 10_000);
    expect(bConn).not.toBeNull();
    const hash0 = b.feed.ledger.worldHash();
    expect(a.feed.ledger.worldHash()).toBe(hash0);

    // ---- 1. remote dust deltas -------------------------------------------------------------------------------------
    const strokes0 = b.dust.stats.strokes;
    await sweep(60);
    await converge("scenario 1 convergence");
    const hash1 = b.feed.ledger.worldHash();
    report["s1"] = {
      bStrokes: b.dust.stats.strokes - strokes0,
      bDeltas: b.dust.stats.deltas,
      bFrames: b.stats.framesApplied,
      bDust: { ...b.dust.stats },
      hashChanged: hash1 !== hash0,
      checkMismatches: b.dust.stats.checkMismatches,
    };
    expect(hash1).not.toBe(hash0);
    expect(b.dust.stats.strokes - strokes0).toBeGreaterThan(0);
    expect(b.dust.stats.ledgersInvalid).toBe(0);

    // ---- 2. in-place drop (SDK reconnection, seat hold) ------------------------------------------------------------
    const snapsBefore = b.stats.snapshotsInstalled;
    const keysBefore = b.stats.keyframes;
    const sessBefore = { ...b.session.core.stats };
    phases.b.clear();
    (bConn as unknown as { connection: { close(code: number): void } }).connection.close(4010);
    await sleep(100);
    const awayPhase = b.session.phase;
    await sweep(60, 9000); // A keeps polishing in a new heading while B is away / resyncing
    const recoverMs = await waitFor(
      "B joined again after drop",
      () => b.session.phase === "joined" && phases.b.size > 1,
      60_000,
    );
    await converge("scenario 2 convergence");
    const hash2 = b.feed.ledger.worldHash();
    report["s2"] = {
      phaseRightAfterDrop: awayPhase,
      phasesSeen: [...phases.b],
      recoverMsAfterSweep: recoverMs,
      hashChangedDuringAbsence: hash2 !== hash1,
      matchesA: a.feed.ledger.worldHash() === hash2,
      snapshotsInstalledDelta: b.stats.snapshotsInstalled - snapsBefore,
      keyframesDelta: b.stats.keyframes - keysBefore,
      reconnects: b.session.core.stats.reconnects - sessBefore.reconnects,
      resyncs: b.session.core.stats.resyncs - sessBefore.resyncs,
      failure: b.session.failure,
    };
    expect(b.session.phase).toBe("joined");
    expect(hash2).not.toBe(hash1);
    expect(a.feed.ledger.worldHash()).toBe(hash2);
    expect(avatarCount(b)).toBeGreaterThanOrEqual(1);

    // ---- 3. network kill (proxy sockets destroyed -> abnormal closure), only with a proxy ---------------------------
    if (pathB.proxy !== null) {
      const proxyPort = pathB.proxy.port;
      phases.b.clear();
      const keys3 = b.stats.keyframes;
      await pathB.proxy.close();
      proxies.splice(proxies.indexOf(pathB.proxy), 1);
      await waitFor("B notices the drop", () => b.session.phase !== "joined", 15_000);
      const hashAway = b.feed.ledger.worldHash();
      await sweep(60, 18000); // B is fully offline for ~3 s of A polishing (SDK retries hit a dead port)
      const hashAwayAfter = a.feed.ledger.worldHash();
      const p2 = await startProxy({
        profile: PROFILES[profile!],
        listenPort: proxyPort,
        targetPort: serverPort,
        seed: 33,
      });
      proxies.push(p2);
      const rec = await waitFor("B joined again after network kill", () => b.session.phase === "joined", 60_000);
      await converge("scenario 3 convergence");
      report["s3"] = {
        phasesSeen: [...phases.b],
        recoverMsAfterSweep: rec,
        aChangedWhileBAway: hashAwayAfter !== hashAway,
        matchesA: a.feed.ledger.worldHash() === b.feed.ledger.worldHash(),
        keyframesDelta: b.stats.keyframes - keys3,
        failure: b.session.failure,
      };
      expect(a.feed.ledger.worldHash()).toBe(b.feed.ledger.worldHash());
    }

    // ---- 4. consented leave + fresh join of the same player --------------------------------------------------------
    b.leave();
    b.dispose();
    await sweep(30, 27000);
    b = open(tokenB, pathB.proxy === null ? pathB : { http: pathB.http, ws: pathB.ws }, false);
    phases.b.clear();
    b.start();
    const joinMs = await waitFor("fresh B joined", () => b.session.phase === "joined" && b.dust.ready, 60_000);
    await waitFor("fresh B avatar", () => avatarCount(b) >= 1, 15_000);
    await sweep(20, 27000);
    await converge("scenario 4 convergence");
    report["s4"] = {
      joinMs,
      matchesA: a.feed.ledger.worldHash() === b.feed.ledger.worldHash(),
      snapshotsInstalled: b.stats.snapshotsInstalled,
      strokesAfterJoin: b.dust.stats.strokes,
      failure: b.session.failure,
    };
    expect(a.feed.ledger.worldHash()).toBe(b.feed.ledger.worldHash());
    report["final"] = { a: { ...a.stats, rtt: a.session.core.stats }, b: { ...b.stats, dust: { ...b.dust.stats } } };
    console.info("[online-sync-e2e]", JSON.stringify(report));
  }, 400_000);
});
