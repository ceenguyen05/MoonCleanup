// W4-T06 two-client online loop against the REAL server (apps/server startServer -> ShiftRoom, memory persistence,
// `ws` transport) in this process. Two OnlineRooms (the same chunk the game loads) join one Private Shift through the
// lobby's accounts client (create + join by invite code); asserts both see each other's avatar, A's tool strokes reach
// B's dust mirror, and both mirrors end with the same worldHash. The server is loaded by a computed path so the client
// type-check never compiles server sources.

import { afterAll, describe, expect, it } from "vitest";
import {
  GuestCreateResponseSchema,
  INPUT_BUTTON_BIT,
  QUALITY_PRESETS,
  ShiftStateViewSchema,
  type FrameInfo,
  type ShiftStateView,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { ENTITY_KIND_AVATAR } from "@moon-cleanup/protocol";
import { createContractsApi } from "../ui/online/contracts-api";
import type { OnlineAuthPort } from "../ui/online/online-model";
import { AnimationModule, AvatarAnimInput } from "../animation";
import { createOnlineRoom, createRemoteAvatarFeed, createRemoteRoomHost, type OnlineRoom } from "./online-room";

interface ServerHarness {
  readonly port: number;
  shutdown(): Promise<void>;
}
interface ServerModule {
  startServer(env: unknown, options?: Readonly<Record<string, unknown>>): Promise<ServerHarness>;
}
interface OpsModule {
  parseServerEnv(raw: Readonly<Record<string, string>>): Readonly<Record<string, unknown>>;
}

const SERVER_APP = new URL("../../../server/src/app/server.ts", import.meta.url).href;
const SERVER_OPS = new URL("../../../server/src/ops/index.ts", import.meta.url).href;

let app: ServerHarness | null = null;
const rooms: OnlineRoom[] = [];
const ORIGIN = "http://localhost:5178";

// Browsers send `Origin` on the WebSocket upgrade and the server requires an allowed one; Node's WebSocket (undici)
// sends none unless given `headers`. Test-only stand-in so the real SDK path (colyseusConsume) runs unchanged.
type WsInit = string | string[] | { protocols?: string | string[]; headers?: Record<string, string> };
type WsCtor = new (url: string | URL, init?: WsInit) => WebSocket;
const NativeWebSocket = globalThis.WebSocket;
const NativeCtor = NativeWebSocket as unknown as WsCtor;
class BrowserLikeWebSocket extends NativeCtor {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, { ...(protocols !== undefined ? { protocols } : {}), headers: { origin: ORIGIN } });
  }
}
globalThis.WebSocket = BrowserLikeWebSocket as unknown as typeof WebSocket;

afterAll(async () => {
  for (const r of rooms) r.dispose();
  await app?.shutdown();
  globalThis.WebSocket = NativeWebSocket;
}, 30_000);

function diag(): string {
  return JSON.stringify(
    rooms.map((r) => ({
      phase: r.session.phase,
      failure: r.session.failure,
      ready: r.dust.ready,
      stats: r.stats,
      session: r.session.stats,
      core: r.session.core.stats,
    })),
  );
}

async function waitFor(what: string, cond: () => boolean, ms: number, tick?: () => void): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${diag()}`);
    tick?.();
    await new Promise((r) => setTimeout(r, 25));
  }
}

function avatarCount(room: OnlineRoom): number {
  const kinds = room.session.core.table.kind;
  let n = 0;
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === ENTITY_KIND_AVATAR) n++;
  return n;
}

describe("online loop: two clients on the real ShiftRoom", () => {
  it("both join, see each other, A's strokes reach B's mirror and worldHash matches", async () => {
    const ops = (await import(/* @vite-ignore */ SERVER_OPS)) as OpsModule;
    const server = (await import(/* @vite-ignore */ SERVER_APP)) as ServerModule;
    const env = {
      ...ops.parseServerEnv({
        NODE_ENV: "production",
        ENV_NAME: "local",
        PERSISTENCE_DRIVER: "memory",
        PORT: "2599",
        JWT_SECRET: "a".repeat(32),
        REFRESH_TOKEN_PEPPER: "b".repeat(32),
        ALLOWED_ORIGINS: "http://localhost:5178",
        LOG_LEVEL: "fatal",
      }),
      port: 0,
    };
    app = await server.startServer(env, { transport: "ws", purgeIntervalMs: 0 });
    const httpUrl = `http://127.0.0.1:${app.port}`;
    const wsUrl = `ws://127.0.0.1:${app.port}`;

    const guest = async (name: string, ip: string): Promise<string> => {
      const res = await fetch(`${httpUrl}/v1/auth/guest`, {
        method: "POST",
        headers: { "content-type": "application/json", "true-client-ip": ip },
        body: JSON.stringify({ displayName: name }),
      });
      expect(res.status).toBe(201);
      return GuestCreateResponseSchema.parse(await res.json()).accessToken;
    };
    const tokenA = await guest("Loop A", "203.0.113.81");
    const tokenB = await guest("Loop B", "203.0.113.82");
    const port = (token: string): OnlineAuthPort => ({
      signedIn: true,
      signIn: () => Promise.resolve(true),
      getAccessToken: () => Promise.resolve(token),
    });

    // Lobby path: A creates a Private Shift, B redeems the invite code.
    const created = await createContractsApi({ httpUrl, auth: port(tokenA) }).createPrivateShift("Loop Shift");
    if (!created.ok) throw new Error(`create failed: ${created.failure.key}`);
    const code = created.value.inviteCode;
    expect(code).not.toBeNull();
    const joined = await createContractsApi({ httpUrl, auth: port(tokenB) }).joinByCode(code ?? "");
    if (!joined.ok) throw new Error(`join by code failed: ${joined.failure.key}`);
    const contractId = created.value.contractId;
    expect(joined.value.contractId).toBe(contractId);

    const open = (token: string): OnlineRoom => {
      const room = createOnlineRoom({
        httpUrl,
        wsUrl,
        clientBuild: "t06-loop",
        contractId,
        auth: { getAccessToken: () => Promise.resolve(token) },
        wakeProbe: false,
      });
      rooms.push(room);
      return room;
    };
    const a = open(tokenA);
    const b = open(tokenB);
    const hostA = createRemoteRoomHost(a, contractId);
    let framesA = 0;
    hostA.onFrame((f) => {
      framesA++;
      f.release();
    });
    let shiftA: ShiftStateView | null = null;
    hostA.onShiftState((s) => (shiftA = s));
    a.start();
    b.start();
    const pump = (): void => {
      a.frame(25);
      b.frame(25);
    };
    await waitFor("both joined with dust mirrors", () => a.dust.ready && b.dust.ready, 30_000, pump);
    await waitFor("A host running", () => hostA.state === "running", 5_000, pump);
    await waitFor("each sees an avatar", () => avatarCount(a) >= 1 && avatarCount(b) >= 1, 10_000, pump);
    await waitFor("A predictor started", () => a.predictor.ready, 5_000, pump);

    // B's animation feed: A's avatar from B's interpolation buffer (pool slot 0).
    const avatarsB = createRemoteAvatarFeed(b);
    const animIn = new AvatarAnimInput();
    const animFrame: FrameInfo = { dt: 0.025, time: 0, alpha: 0, simTick: 0, quality: QUALITY_PRESETS.medium };
    const seenByB = (): boolean => avatarsB.provider(0, animFrame, animIn);
    // The same feed bound into a real animation pool, the way boot's online hooks bind it on open.
    const animPoolB = new AnimationModule();
    animPoolB.bind(avatarsB.provider, { heightsAt: (_d, out, n) => void out.fill(0, 0, n) }, b.config.moonRadiusM);
    expect(seenByB()).toBe(true);
    const startX = animIn.pos[0]!;
    const startY = animIn.pos[1]!;
    const startZ = animIn.pos[2]!;

    const hashBefore = b.feed.ledger.worldHash();
    expect(a.feed.ledger.worldHash()).toBe(hashBefore);

    // A sweeps forward with the primary tool for 3 s (one input per 50 ms sim tick).
    const cmd: SimInputCommand = {
      seq: 0,
      moveX: 0,
      moveY: 127,
      yaw: 0,
      pitch: 0,
      buttons: 1 << INPUT_BUTTON_BIT.toolPrimary,
      toolParam: 0,
    };
    for (let i = 1; i <= 60; i++) {
      a.sendInput({ ...cmd, seq: i });
      pump();
      seenByB();
      animPoolB.update(animFrame);
      await new Promise((r) => setTimeout(r, 50));
    }
    a.sendInput({ ...cmd, seq: 61, moveY: 0, buttons: 0 });
    // Quiesce, then both mirrors must agree and differ from the start.
    let last = -1;
    await waitFor(
      "mirrors agree after the strokes",
      () => {
        const ha = a.feed.ledger.worldHash();
        const hb = b.feed.ledger.worldHash();
        const ok = ha === hb && hb !== hashBefore && hb === last;
        last = hb;
        return ok;
      },
      15_000,
      pump,
    );
    seenByB();
    animPoolB.update(animFrame);
    expect(animPoolB.animatorFor(0)).not.toBeNull();
    expect(animPoolB.lastUpdated).toBeGreaterThanOrEqual(1);
    // A's own avatar: the feed's last pool slot, read from A's predictor (the pose the camera follows), marked local.
    const avatarsA = createRemoteAvatarFeed(a);
    const ownIn = new AvatarAnimInput();
    expect(avatarsA.provider(avatarsA.ownSlot, animFrame, ownIn)).toBe(true);
    expect(ownIn.pos[0]).toBeCloseTo(a.predictor.state.px + a.predictor.offset[0]!, 9);
    expect(ownIn.pos[1]).toBeCloseTo(a.predictor.state.py + a.predictor.offset[1]!, 9);
    expect(ownIn.pos[2]).toBeCloseTo(a.predictor.state.pz + a.predictor.offset[2]!, 9);
    const animPoolA = new AnimationModule();
    animPoolA.bind(avatarsA.provider, { heightsAt: (_d, out, n) => void out.fill(0, 0, n) }, a.config.moonRadiusM);
    animPoolA.setLocalSlot(avatarsA.ownSlot);
    animPoolA.update(animFrame);
    expect(animPoolA.animatorFor(avatarsA.ownSlot)).not.toBeNull();
    expect(avatarsA.stats.ownPresent).toBe(true);
    const movedM = Math.hypot(animIn.pos[0]! - startX, animIn.pos[1]! - startY, animIn.pos[2]! - startZ);
    const evidence = {
      movedSeenByB: movedM,
      animB: { ...avatarsB.stats },
      hashBefore,
      hashAfter: b.feed.ledger.worldHash(),
      a: { ...a.stats, avatars: avatarCount(a) },
      b: { ...b.stats, avatars: avatarCount(b) },
      hostA: { state: hostA.state, framesA, ...hostA.stats },
    };
    console.info("[t06-loop]", JSON.stringify(evidence));
    expect(a.stats.inputsSent).toBeGreaterThanOrEqual(60);
    expect(framesA).toBeGreaterThan(0);
    // The real server's Schema reaches the RemoteRoomHost as a valid ShiftStateView (v1.1 mask included).
    const view = shiftA as ShiftStateView | null;
    expect(view).not.toBeNull();
    expect(ShiftStateViewSchema.safeParse(view).success).toBe(true);
    expect(view!.contractId).toBe(contractId.toLowerCase());
    expect(view!.players.length).toBe(2);
    expect(view!.nearParcelsCollected).toBe(a.readouts.collectedMask);
    expect(a.readouts.authoritativeMask).toBe(true);
    expect(b.stats.framesApplied).toBeGreaterThan(0);
    expect(movedM).toBeGreaterThan(0.5);
  }, 120_000);
});
