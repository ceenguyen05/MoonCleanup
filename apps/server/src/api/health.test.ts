import { HealthResponseSchema, PROTOCOL_VERSION, ReadyResponseSchema, type HttpRequest } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { READYZ_CACHE_MS, createHealthRoutes, type DbState, type HealthDeps } from "./health";

const request: HttpRequest = {
  method: "GET",
  path: "/",
  params: {},
  query: {},
  headers: {},
  body: undefined,
  remoteAddress: "127.0.0.1",
};

function setup(overrides: Partial<HealthDeps> = {}, initial: DbState = "up") {
  let now = 100_000;
  let probes = 0;
  let result: DbState = initial;
  const state = { draining: false, admitting: true, rooms: 1 };
  const deps: HealthDeps = {
    envName: "local",
    buildVersion: "abc123",
    maxRooms: 3,
    persistenceDriver: "postgres",
    startedAtMs: 40_000,
    now: () => now,
    db: {
      schema: "prod",
      probe: () => {
        probes += 1;
        return Promise.resolve(result);
      },
    },
    runtime: {
      draining: () => state.draining,
      admitting: () => state.admitting,
      rooms: () => state.rooms,
      storage: () => "ok",
    },
    ...overrides,
  };
  const routes = createHealthRoutes(deps);
  const find = (path: string) => {
    const route = routes.find((r) => r.path === path);
    if (route === undefined) throw new Error(`no route ${path}`);
    return route;
  };
  return {
    find,
    state,
    probes: () => probes,
    setDb: (r: DbState) => void (result = r),
    advance: (ms: number) => void (now += ms),
  };
}

describe("GET /healthz", () => {
  it("answers 200 with the shared HealthResponse and never touches the database", async () => {
    const t = setup({}, "error");
    const res = await t.find("/healthz").handle(request);
    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(res.body)).toMatchObject({
      service: "moon-cleanup-server",
      env: "local",
      build: "abc123",
      protocolVersion: PROTOCOL_VERSION,
      uptimeS: 60,
    });
    expect(t.probes()).toBe(0);
    expect(res.headers?.["access-control-allow-origin"]).toBe("*");
  });
});

describe("GET /readyz", () => {
  it("is ready (200) with the db up and reports the active schema", async () => {
    const t = setup();
    const res = await t.find("/readyz").handle(request);
    expect(res.status).toBe(200);
    expect(ReadyResponseSchema.parse(res.body)).toMatchObject({
      ready: true,
      db: "up",
      maxRooms: 3,
      rooms: 1,
      storage: "ok",
    });
    expect(res.body).toMatchObject({ schema: "prod", dbState: "up" });
  });

  it("is 503 with db down when the database is powered off", async () => {
    const t = setup({}, "powered-off");
    const res = await t.find("/readyz").handle(request);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ready: false, db: "down", dbState: "powered-off" });
  });

  it("is 503 when draining or not admitting", async () => {
    const t = setup();
    t.state.draining = true;
    expect((await t.find("/readyz").handle(request)).status).toBe(503);
    t.state.draining = false;
    t.state.admitting = false;
    expect((await t.find("/readyz").handle(request)).body).toMatchObject({ ready: false, admitting: false });
  });

  it("not-configured: ready only for the local memory driver", async () => {
    const notConfigured = { schema: null, probe: () => Promise.resolve<DbState>("not-configured") };
    const memory = setup({ persistenceDriver: "memory", db: notConfigured });
    const ok = await memory.find("/readyz").handle(request);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ db: "down", schema: null, dbState: "not-configured" });
    const pg = setup({ db: notConfigured });
    expect((await pg.find("/readyz").handle(request)).status).toBe(503);
  });

  it("caches the probe for 10 s, then refreshes", async () => {
    const t = setup();
    await t.find("/readyz").handle(request);
    t.advance(READYZ_CACHE_MS - 1);
    await t.find("/readyz").handle(request);
    expect(t.probes()).toBe(1);
    t.setDb("powered-off");
    t.advance(1);
    const res = await t.find("/readyz").handle(request);
    expect(t.probes()).toBe(2);
    expect(res.status).toBe(503);
  });

  it("coalesces concurrent probes and does not leak a throwing probe's message", async () => {
    let calls = 0;
    const t = setup({
      db: {
        schema: "prod",
        probe: () => {
          calls += 1;
          return Promise.reject(new Error("postgres://u:secret@h/d"));
        },
      },
    });
    const [a, b] = await Promise.all([t.find("/readyz").handle(request), t.find("/readyz").handle(request)]);
    expect(calls).toBe(1);
    expect(a.status).toBe(503);
    expect(JSON.stringify(b.body)).not.toContain("secret");
  });
});
