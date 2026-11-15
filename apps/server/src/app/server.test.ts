import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  GuestCreateResponseSchema,
  JoinContractResponseSchema,
  PROTOCOL_VERSION,
  ProfileSchema,
} from "@moon-cleanup/shared";
import { MemoryRoomSaveRepository } from "../persistence";
import { parseServerEnv } from "../ops";
import { startServer, type ServerApp } from "./server";

const parsed = parseServerEnv({
  NODE_ENV: "production",
  ENV_NAME: "local",
  PERSISTENCE_DRIVER: "memory",
  PORT: "2599",
  JWT_SECRET: "a".repeat(32),
  REFRESH_TOKEN_PEPPER: "b".repeat(32),
  ALLOWED_ORIGINS: "http://localhost:5178",
  LOG_LEVEL: "fatal",
});
// Port 0 (a free port) is not a valid PORT value in the env schema; the factory accepts it.
const env = { ...parsed, port: 0 };

let app: ServerApp | undefined;

// The transport adapter is imported lazily inside startServer (net/transport). Under vitest that first import is a
// cold TS transform of the Colyseus uWS transport (seconds on a loaded machine), not boot work: warm it so the
// 5 s boot budget below measures the boot itself (the built bundle boots in ~0.2 s, M0-transport-fallback report).
beforeAll(async () => {
  await import("../net/uws-transport");
}, 60_000);

afterAll(async () => {
  await app?.shutdown();
});

describe("server composition root", () => {
  it("boots on a free port, serves /healthz and /readyz, then drains", async () => {
    const started = performance.now();
    app = await startServer(env);
    const bootMs = performance.now() - started;
    expect(app.port).toBeGreaterThan(0);
    // Guard against a hung boot, not a perf budget: standalone it boots in well under 1 s, but
    // `pnpm verify` runs several packages in parallel and boot reached 6.1 s under that load.
    expect(bootMs).toBeLessThan(20_000);

    const base = `http://127.0.0.1:${app.port}`;
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, protocolVersion: PROTOCOL_VERSION, env: "local" });

    const ready = await fetch(`${base}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ ready: true, draining: false, rooms: 0, maxRooms: env.maxRooms });

    app.beginDrain();
    const draining = await fetch(`${base}/readyz`);
    expect(draining.status).toBe(503);
    expect(await draining.json()).toMatchObject({ ready: false, draining: true });

    await app.shutdown();
    await app.shutdown();
    await expect(connects(app.port)).resolves.toBe(false);
  });

  it("registers the NET_SPIKE join route only when NET_SPIKE=1", async () => {
    const post = (port: number): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}/v0/spike/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

    app = await startServer({ ...env, netSpike: false });
    expect((await post(app.port)).status).toBe(404);
    await app.shutdown();

    app = await startServer({ ...env, netSpike: true });
    // 400 (invalid join options), not 404: the route exists because createGameServer received loadTest.enabled.
    expect((await post(app.port)).status).toBe(400);
    await app.shutdown();
  });

  it("serves the account API over HTTP: guest create, then GET /v1/me with the access token", async () => {
    app = await startServer(env);
    const base = `http://127.0.0.1:${app.port}`;

    const unauthenticated = await fetch(`${base}/v1/me`);
    expect(unauthenticated.status).toBe(401);

    const created = await fetch(`${base}/v1/auth/guest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Wired Guest" }),
    });
    expect(created.status).toBe(201);
    const guest = GuestCreateResponseSchema.parse(await created.json());
    expect(guest.displayName).toBe("Wired Guest");

    const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${guest.accessToken}` } });
    expect(me.status).toBe(200);
    expect(ProfileSchema.parse(await me.json())).toMatchObject({ playerId: guest.playerId, isGuest: true });

    // The verifier handed to room onAuth accepts the same token and rejects garbage.
    expect(await app.verifyToken(guest.accessToken)).toMatchObject({ playerId: guest.playerId });
    expect(await app.verifyToken("not-a-token")).toBeNull();

    await app.shutdown();
  });

  it("wires ShiftRoom: a private Contract's member reserves a seat; solo, strangers and no Bearer are refused", async () => {
    app = await startServer(env);
    const base = `http://127.0.0.1:${app.port}`;
    // Distinct edge IPs: guest creation is rate-limited per IP (the earlier tests already used the shared bucket).
    const guest = async (name: string, ip: string) => {
      const res = await fetch(`${base}/v1/auth/guest`, {
        method: "POST",
        headers: { "content-type": "application/json", "true-client-ip": ip },
        body: JSON.stringify({ displayName: name }),
      });
      return GuestCreateResponseSchema.parse(await res.json());
    };
    const holder = await guest("Shift Holder", "203.0.113.61");
    const stranger = await guest("Shift Stranger", "203.0.113.62");
    const create = async (shiftType: "solo" | "private"): Promise<string> => {
      const res = await fetch(`${base}/v1/contracts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "true-client-ip": "203.0.113.61",
          authorization: `Bearer ${holder.accessToken}`,
        },
        body: JSON.stringify({ name: `Wired ${shiftType}`, shiftType }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { contract: { id: string } }).contract.id;
    };
    const privateId = await create("private");
    const soloId = await create("solo");
    const join = (id: string, token: string | null) =>
      fetch(`${base}/v1/contracts/${id}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "true-client-ip": "203.0.113.63",
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "wired" }),
      });

    const ok = await join(privateId, holder.accessToken);
    expect(ok.status).toBe(200);
    const raw: unknown = await ok.json();
    expect(raw).not.toHaveProperty("joinTicket");
    const body = JoinContractResponseSchema.parse(raw);
    expect(body.role).toBe("holder");
    expect(body.reservation.name).toBe("shift");
    expect((await join(privateId, null)).status).toBe(401);
    expect((await join(privateId, stranger.accessToken)).status).toBe(403);
    expect((await join(soloId, holder.accessToken)).status).toBe(403);

    // Raw upload route: the adapter verifies the access token before taking an upload slot (review M1).
    const upload = (token: string) =>
      fetch(`${base}/v1/contracts/${soloId}/solo-checkpoints`, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "true-client-ip": "203.0.113.64",
          authorization: `Bearer ${token}`,
        },
        body: new Uint8Array([1, 2, 3]),
      });
    expect((await upload("forged")).status).toBe(401);
    // A real token passes the adapter; the handler then judges the (garbage) body.
    expect((await upload(holder.accessToken)).status).not.toBe(401);
    await app.shutdown();
  }, 30_000);

  it("answers 409 CONTRACT_BUSY when another instance holds the Contract lease, 503 when storage is down, then 200", async () => {
    const roomRepository = new MemoryRoomSaveRepository();
    app = await startServer(env, { roomRepository });
    const base = `http://127.0.0.1:${app.port}`;
    const created = await fetch(`${base}/v1/auth/guest`, {
      method: "POST",
      headers: { "content-type": "application/json", "true-client-ip": "203.0.113.71" },
      body: JSON.stringify({ displayName: "Busy Holder" }),
    });
    const holder = GuestCreateResponseSchema.parse(await created.json());
    const contract = await fetch(`${base}/v1/contracts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "true-client-ip": "203.0.113.71",
        authorization: `Bearer ${holder.accessToken}`,
      },
      body: JSON.stringify({ name: "Busy Moon", shiftType: "private" }),
    });
    expect(contract.status).toBe(201);
    const contractId = ((await contract.json()) as { contract: { id: string } }).contract.id;
    const join = () =>
      fetch(`${base}/v1/contracts/${contractId}/join`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "true-client-ip": "203.0.113.72",
          authorization: `Bearer ${holder.accessToken}`,
        },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "busy" }),
      });
    const rooms = async (): Promise<number> =>
      ((await (await fetch(`${base}/readyz`)).json()) as { rooms: number }).rooms;

    // Another server instance (e.g. the previous deploy still draining) owns the Contract.
    const other = { contractId, instance: "prod:other-build:boot", roomId: "their-room" };
    expect(await roomRepository.acquireLease(other)).toBe("acquired");
    const busy = await join();
    expect(busy.status).toBe(409);
    expect(busy.headers.get("retry-after")).toBe("5");
    expect(await busy.json()).toEqual({ error: "CONTRACT_BUSY" });
    expect(await rooms()).toBe(0); // refused before any room or seat existed

    // The database is unreachable: a new room is refused with 503, never a 409 and never a pristine start.
    await roomRepository.releaseLease(other);
    roomRepository.offline = true;
    const down = await join();
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "RETRY_LATER" });
    expect(await rooms()).toBe(0);

    // Back online (the link backoff is 1 s) and the lease is free: the join goes through and the room holds the lease.
    roomRepository.offline = false;
    await vi.waitFor(async () => expect((await join()).status).toBe(200), { timeout: 5000, interval: 300 });
    expect(roomRepository.leaseHolder(contractId)).not.toBeNull();
    await app.shutdown();
  }, 30_000);

  it("checkpoints every live room on shutdown before closing them, then releases the Contract lease", async () => {
    const roomRepository = new MemoryRoomSaveRepository();
    app = await startServer(env, { roomRepository, shutdownCheckpointDeadlineMs: 3000 });
    const base = `http://127.0.0.1:${app.port}`;
    const created = await fetch(`${base}/v1/auth/guest`, {
      method: "POST",
      headers: { "content-type": "application/json", "true-client-ip": "203.0.113.73" },
      body: JSON.stringify({ displayName: "Drain Holder" }),
    });
    const holder = GuestCreateResponseSchema.parse(await created.json());
    const contract = await fetch(`${base}/v1/contracts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "true-client-ip": "203.0.113.73",
        authorization: `Bearer ${holder.accessToken}`,
      },
      body: JSON.stringify({ name: "Drain Moon", shiftType: "private" }),
    });
    const contractId = ((await contract.json()) as { contract: { id: string } }).contract.id;
    const join = await fetch(`${base}/v1/contracts/${contractId}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "true-client-ip": "203.0.113.74",
        authorization: `Bearer ${holder.accessToken}`,
      },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "drain" }),
    });
    expect(join.status).toBe(200);
    expect(roomRepository.leaseHolder(contractId)).not.toBeNull();
    expect(app.shutdownCheckpoint()).toBeUndefined();

    await app.shutdown();
    expect(app.shutdownCheckpoint()).toMatchObject({ rooms: 1, saved: 1, failed: 0, timedOut: 0 });
    expect(roomRepository.leaseHolder(contractId)).toBeNull(); // released after the final checkpoint
  }, 30_000);

  it("purges refresh tokens on the configured interval and stops the timer on shutdown", async () => {
    app = await startServer(env, { purgeIntervalMs: 20 });
    const purge = vi.spyOn(app.repo, "purgeRefreshTokens");
    await vi.waitFor(() => expect(purge).toHaveBeenCalled(), { timeout: 2000 });
    await app.shutdown();
    purge.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(purge).not.toHaveBeenCalled();
  });
});

/** Whether a fresh TCP connection to the port is accepted (a pooled keep-alive socket would hide a closed listener). */
function connects(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
