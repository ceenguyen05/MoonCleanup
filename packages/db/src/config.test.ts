import { describe, expect, it } from "vitest";
import { hostOfUrl, isPoolerUrl, planMigrationFromEnv, urlRequestsTls } from "./config.ts";
import { buildClientOptions } from "./connection.ts";

describe("planMigrationFromEnv", () => {
  it("plans a run with prod as the default schema", () => {
    const plan = planMigrationFromEnv({
      DATABASE_URL: "postgres://u:p@h:5432/d",
      DATABASE_CA_CERT: "PEM",
      ENV_NAME: "local",
    });
    expect(plan).toEqual({
      kind: "run",
      config: { url: "postgres://u:p@h:5432/d", caCert: "PEM", schema: "prod", poolMax: 1 },
    });
  });

  it("accepts staging and rejects other schemas", () => {
    expect(
      planMigrationFromEnv({ DATABASE_URL: "postgresql://h/d", DB_SCHEMA: "staging", ENV_NAME: "local" }).kind,
    ).toBe("run");
    const bad = planMigrationFromEnv({
      DATABASE_URL: "postgresql://h/d",
      DB_SCHEMA: "public; drop",
      ENV_NAME: "local",
    });
    expect(bad).toMatchObject({ kind: "invalid" });
  });

  it("skips only when memory mode is explicit; otherwise a missing URL fails the build", () => {
    expect(planMigrationFromEnv({ PERSISTENCE_DRIVER: "memory" }).kind).toBe("skip");
    expect(planMigrationFromEnv({ PERSISTENCE_DRIVER: "postgres" }).kind).toBe("invalid");
    expect(planMigrationFromEnv({}).kind).toBe("invalid");
    expect(planMigrationFromEnv({ DATABASE_URL: "mysql://h/d" }).kind).toBe("invalid");
  });

  it("runs with a Neon-style direct URL and no CA", () => {
    const url =
      "postgresql://owner:pw@ep-cool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const plan = planMigrationFromEnv({ DATABASE_URL: url, ENV_NAME: "production", DB_SCHEMA: "prod" });
    expect(plan).toEqual({ kind: "run", config: { url, caCert: undefined, schema: "prod", poolMax: 1 } });
  });

  it("refuses non-TLS URLs outside local and the pooled host for migrations", () => {
    const direct = "postgres://u:p@ep-a-1.us-east-2.aws.neon.tech/db";
    expect(planMigrationFromEnv({ DATABASE_URL: direct, ENV_NAME: "production" })).toMatchObject({ kind: "invalid" });
    expect(planMigrationFromEnv({ DATABASE_URL: direct + "?sslmode=disable", ENV_NAME: "production" }).kind).toBe(
      "invalid",
    );
    expect(planMigrationFromEnv({ DATABASE_URL: direct, ENV_NAME: "local" }).kind).toBe("run");
    const pooled = "postgres://u:p@ep-a-1-pooler.us-east-2.aws.neon.tech/db?sslmode=require";
    const plan = planMigrationFromEnv({ DATABASE_URL: pooled, ENV_NAME: "production" });
    expect(plan).toMatchObject({ kind: "invalid" });
    expect(JSON.stringify(plan)).not.toContain("ep-a-1");
  });

  it("fails closed when ENV_NAME is unset or non-local: TLS is required, CA is optional (review N10)", () => {
    const plain = "postgres://u:p@ep-a-1.us-east-2.aws.neon.tech/db";
    const tls = plain + "?sslmode=require";
    // Unset ENV_NAME is not local: a non-TLS URL is refused even with a CA certificate present.
    expect(planMigrationFromEnv({ DATABASE_URL: plain, DATABASE_CA_CERT: "PEM" }).kind).toBe("invalid");
    expect(planMigrationFromEnv({ DATABASE_URL: plain, ENV_NAME: "" }).kind).toBe("invalid");
    expect(planMigrationFromEnv({ DATABASE_URL: plain, ENV_NAME: "preview" }).kind).toBe("invalid");
    // TLS URL without a CA runs everywhere (system-CA verification is applied by buildClientOptions).
    for (const envName of [undefined, "production", "preview", "local"]) {
      const plan = planMigrationFromEnv({ DATABASE_URL: tls, ...(envName === undefined ? {} : { ENV_NAME: envName }) });
      expect(plan).toMatchObject({ kind: "run", config: { caCert: undefined } });
    }
    expect(buildClientOptions({ url: tls, schema: "prod", poolMax: 1 }).ssl).toEqual({ rejectUnauthorized: true });
    expect(planMigrationFromEnv({ DATABASE_URL: plain, ENV_NAME: "local" }).kind).toBe("run");
  });

  it("never echoes the URL in problems", () => {
    const plan = planMigrationFromEnv({ DATABASE_URL: "mysql://u:hunter2@h/d" });
    expect(JSON.stringify(plan)).not.toContain("hunter2");
  });
});

describe("buildClientOptions", () => {
  it("uses a small pool, search_path for the schema and verified TLS when a CA is given", () => {
    const options = buildClientOptions({ url: "postgres://h/d", caCert: "PEM", schema: "prod", poolMax: 4 });
    expect(options.max).toBe(4);
    expect(options.idle_timeout).toBe(20);
    expect(options.ssl).toEqual({ ca: "PEM", rejectUnauthorized: true });
    expect(options.connection).toMatchObject({ search_path: "prod" });
  });

  it("verifies against the system CA store when TLS is requested and no CA is given (Neon)", () => {
    const url = "postgres://u:p@ep-a-1.us-east-2.aws.neon.tech/neondb?sslmode=require";
    const options = buildClientOptions({ url, schema: "prod", poolMax: 4 });
    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(options.connect_timeout).toBeGreaterThanOrEqual(10);
    expect(options.prepare).toBeUndefined();
    expect(buildClientOptions({ url: url.replace("require", "verify-full"), schema: "prod", poolMax: 1 }).ssl).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("disables prepared statements for a -pooler host only", () => {
    const pooled = buildClientOptions({
      url: "postgres://u:p@ep-a-1-pooler.us-east-2.aws.neon.tech/d?sslmode=require",
      schema: "prod",
      poolMax: 4,
    });
    expect(pooled.prepare).toBe(false);
    expect(buildClientOptions({ url: "postgres://u:p@h/d", schema: "prod", poolMax: 4 }).prepare).toBeUndefined();
  });

  it("leaves ssl to the URL when there is no CA (local Postgres)", () => {
    const options = buildClientOptions(
      { url: "postgres://h/d", schema: "staging", poolMax: 2 },
      { lock_timeout: "5s" },
    );
    expect(options.ssl).toBeUndefined();
    expect(options.connection).toMatchObject({ search_path: "staging", lock_timeout: "5s" });
  });
});

describe("url helpers", () => {
  it("reads TLS demand, host and pooler from the URL", () => {
    expect(urlRequestsTls("postgres://h/d?sslmode=require")).toBe(true);
    expect(urlRequestsTls("postgres://h/d?a=1&sslmode=VERIFY-FULL")).toBe(true);
    expect(urlRequestsTls("postgres://h/d?sslmode=disable")).toBe(false);
    expect(urlRequestsTls("postgres://h/d?sslmode=prefer")).toBe(false);
    expect(urlRequestsTls("postgres://h/d")).toBe(false);
    expect(hostOfUrl("postgres://u:p%40ss@Ep-X-1-pooler.us-east-2.aws.neon.tech:5432/d")).toBe(
      "ep-x-1-pooler.us-east-2.aws.neon.tech",
    );
    expect(isPoolerUrl("postgres://u:p@ep-x-1-pooler.us-east-2.aws.neon.tech/d")).toBe(true);
    expect(isPoolerUrl("postgres://u:p@ep-x-1.us-east-2.aws.neon.tech/d")).toBe(false);
    expect(isPoolerUrl("postgres://u:pooler@localhost/d")).toBe(false);
  });
});
