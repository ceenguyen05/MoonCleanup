import { describe, expect, it } from "vitest";
import { createDbConnection, type ProbeClient } from "./connection.ts";
import { DbNotConfiguredError } from "./errors.ts";

const config = { url: "postgres://u:p@h/d", schema: "prod", poolMax: 2 } as const;

function fakeClient(behaviour: () => Promise<unknown>) {
  let queries = 0;
  let ended = 0;
  const client = Object.assign(
    () => {
      queries += 1;
      return behaviour();
    },
    { end: () => Promise.resolve(void (ended += 1)) },
  ) as unknown as ProbeClient;
  return { client, stats: () => ({ queries, ended }) };
}

describe("createDbConnection", () => {
  it("reports not-configured without a config and refuses db()", async () => {
    const conn = createDbConnection(undefined);
    expect(conn.schema).toBeNull();
    expect(await conn.probe()).toBe("not-configured");
    expect(() => conn.db()).toThrow(DbNotConfiguredError);
    await expect(conn.close()).resolves.toBeUndefined();
  });

  it("is lazy: no client is created until first use", async () => {
    let created = 0;
    const { client } = fakeClient(() => Promise.resolve([]));
    const conn = createDbConnection(config, {
      createClient: () => {
        created += 1;
        return client;
      },
    });
    expect(conn.schema).toBe("prod");
    expect(created).toBe(0);
    expect(await conn.probe()).toBe("up");
    await conn.probe();
    expect(created).toBe(1);
  });

  it("reports powered-off for connection failures and gates retries with backoff", async () => {
    let now = 0;
    let fail = true;
    const fake = fakeClient(() =>
      fail ? Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" })) : Promise.resolve([]),
    );
    const conn = createDbConnection(config, { createClient: () => fake.client, now: () => now, log: () => undefined });
    expect(await conn.probe()).toBe("powered-off");
    expect(fake.stats().queries).toBe(1);

    now = 500; // inside the 1 s backoff window: no new query
    expect(await conn.probe()).toBe("powered-off");
    expect(fake.stats().queries).toBe(1);

    now = 1000; // window over: second failure doubles the wait to 2 s
    expect(await conn.probe()).toBe("powered-off");
    expect(fake.stats().queries).toBe(2);
    now = 2500;
    expect(await conn.probe()).toBe("powered-off");
    expect(fake.stats().queries).toBe(2);

    fail = false;
    now = 3000;
    expect(await conn.probe()).toBe("up");
    now = 3001; // success resets the gate
    expect(await conn.probe()).toBe("up");
    expect(fake.stats().queries).toBe(4);
  });

  it("logs the wake line once per failure streak and a recovery line", async () => {
    let now = 0;
    let fail = true;
    const lines: string[] = [];
    const fake = fakeClient(() =>
      fail ? Promise.reject(Object.assign(new Error("x"), { code: "CONNECT_TIMEOUT" })) : Promise.resolve([]),
    );
    const conn = createDbConnection(config, {
      createClient: () => fake.client,
      now: () => now,
      log: (line) => lines.push(line),
    });
    await conn.probe();
    now = 1000;
    await conn.probe();
    expect(lines).toEqual(["[db] waking database…"]);
    fail = false;
    now = 5000;
    await conn.probe();
    expect(lines).toEqual(["[db] waking database…", "[db] database is up"]);
  });

  it("reports error (not powered-off) for non-connectivity failures", async () => {
    const fake = fakeClient(() => Promise.reject(Object.assign(new Error("auth"), { code: "28P01" })));
    const conn = createDbConnection(config, { createClient: () => fake.client });
    expect(await conn.probe()).toBe("error");
  });

  it("times out a hanging probe as powered-off", async () => {
    const fake = fakeClient(() => new Promise(() => undefined));
    const conn = createDbConnection(config, {
      createClient: () => fake.client,
      probeTimeoutMs: 20,
      log: () => undefined,
    });
    expect(await conn.probe()).toBe("powered-off");
  });

  it("close ends the client once", async () => {
    const fake = fakeClient(() => Promise.resolve([]));
    const conn = createDbConnection(config, { createClient: () => fake.client });
    await conn.probe();
    await conn.close();
    await conn.close();
    expect(fake.stats().ended).toBe(1);
  });
});
