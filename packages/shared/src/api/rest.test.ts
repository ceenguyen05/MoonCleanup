import { describe, expect, expectTypeOf, it } from "vitest";
import { PROTOCOL_VERSION } from "../protocol";
import {
  API_ERROR_CODES,
  ApiErrorBodySchema,
  DB_STATES,
  type ApiErrorCode,
  HealthResponseSchema,
  ReadyResponseSchema,
  type DbState,
  type HealthResponse,
  type HttpRouteDef,
  type ReadyResponse,
} from "./rest";

const health: HealthResponse = {
  ok: true,
  service: "clean-the-moon-server",
  env: "local",
  build: "dev",
  protocolVersion: PROTOCOL_VERSION,
  uptimeS: 12.5,
};

const ready: ReadyResponse = {
  ready: true,
  db: "up",
  draining: false,
  rooms: 1,
  maxRooms: 4,
  admitting: true,
  storage: "ok",
};

describe("HealthResponseSchema", () => {
  it("parses and JSON round-trips", () => {
    expect(HealthResponseSchema.parse(JSON.parse(JSON.stringify(health)))).toEqual(health);
  });

  it("strips unknown keys so the server can add fields", () => {
    expect(HealthResponseSchema.parse({ ...health, extra: 1 })).toEqual(health);
  });

  it("rejects a host placeholder page and malformed values", () => {
    const bad: unknown[] = [
      "<html>waking</html>",
      null,
      {},
      { ...health, ok: false },
      { ...health, env: "prod" },
      { ...health, env: "staging" }, // ADR-0029: no staging environment (api/rest v0.1.1)
      { ...health, build: "has space" },
      { ...health, protocolVersion: -1 },
      { ...health, protocolVersion: 70_000 },
      { ...health, uptimeS: -1 },
    ];
    for (const value of bad) expect(HealthResponseSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });
});

describe("ReadyResponseSchema", () => {
  it("parses and JSON round-trips", () => {
    expect(ReadyResponseSchema.parse(JSON.parse(JSON.stringify(ready)))).toEqual(ready);
    const notReady = { ...ready, ready: false, db: "down", storage: "full" } as const;
    expect(ReadyResponseSchema.parse(notReady)).toEqual(notReady);
  });

  it("v0.1: accepts the optional schema and dbState the server sends, and their absence", () => {
    const detailed: ReadyResponse = { ...ready, schema: "ctm_prod", dbState: "up" };
    expect(ReadyResponseSchema.parse(JSON.parse(JSON.stringify(detailed)))).toEqual(detailed);
    const local = { ...ready, ready: true, db: "down", schema: null, dbState: "not-configured" } as const;
    expect(ReadyResponseSchema.parse(local)).toEqual(local);
    expect(DB_STATES).toEqual(["up", "powered-off", "not-configured", "error"]);
    expectTypeOf<ReadyResponse["schema"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<ReadyResponse["dbState"]>().toEqualTypeOf<DbState | undefined>();
  });

  it("rejects bad states and counts", () => {
    for (const value of [
      { ...ready, db: "ok" },
      { ...ready, rooms: 1.5 },
      { ...ready, storage: "huge" },
      { ...ready, dbState: "asleep" },
      { ...ready, schema: "" },
    ]) {
      expect(ReadyResponseSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("ApiErrorBodySchema and HttpRouteDef", () => {
  it("accepts documented codes only", () => {
    expect(ApiErrorBodySchema.parse({ error: "CONTRACT_BUSY" })).toEqual({ error: "CONTRACT_BUSY" });
    expect(ApiErrorBodySchema.safeParse({ error: "TEAPOT" }).success).toBe(false);
  });

  it("v0.1.2: accepts AT_CAPACITY (additive; ROOM_FULL stays valid)", () => {
    for (const body of [
      { error: "AT_CAPACITY", message: "at_capacity:rooms" },
      { error: "AT_CAPACITY", message: "at_capacity:clients" },
      { error: "ROOM_FULL" },
    ] as const) {
      expect(ApiErrorBodySchema.parse(JSON.parse(JSON.stringify(body)))).toEqual(body);
    }
    expect(API_ERROR_CODES).toContain("AT_CAPACITY");
    expect(API_ERROR_CODES.indexOf("AT_CAPACITY")).toBe(API_ERROR_CODES.indexOf("INTERNAL") + 1);
    expectTypeOf<"AT_CAPACITY">().toExtend<ApiErrorCode>();
  });

  it("can be implemented without transport types", async () => {
    const route: HttpRouteDef = { method: "GET", path: "/healthz", handle: () => ({ status: 200, body: health }) };
    const response = await route.handle({
      method: "GET",
      path: "/healthz",
      params: {},
      query: {},
      headers: {},
      body: undefined,
      remoteAddress: "127.0.0.1",
    });
    expect(HealthResponseSchema.parse(response.body)).toEqual(health);
    expectTypeOf<HttpRouteDef["method"]>().toEqualTypeOf<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">();
  });
});
