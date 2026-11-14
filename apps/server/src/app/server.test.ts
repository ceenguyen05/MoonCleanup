import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GuestCreateResponseSchema, PROTOCOL_VERSION, ProfileSchema } from "@moon-cleanup/shared";
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
    expect(bootMs).toBeLessThan(5000);

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
