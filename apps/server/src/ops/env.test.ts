import { describe, expect, it } from "vitest";
import { parseTransportMode } from "../net/transport";
import { EnvValidationError, describeEnvForLog, parseServerEnv } from "./env";

const SECRET_A = "a".repeat(40);
const SECRET_B = "b".repeat(40);

const localEnv = {
  ENV_NAME: "local",
  PERSISTENCE_DRIVER: "memory",
  JWT_SECRET: SECRET_A,
  REFRESH_TOKEN_PEPPER: SECRET_B,
  ALLOWED_ORIGINS: "http://localhost:5173",
};

const prodEnv = {
  NODE_ENV: "production",
  ENV_NAME: "production",
  PERSISTENCE_DRIVER: "postgres",
  DATABASE_URL: "postgres://user:hunter2-password@db.example.test:5432/app?sslmode=require",
  DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
  JWT_SECRET: SECRET_A,
  REFRESH_TOKEN_PEPPER: SECRET_B,
  ALLOWED_ORIGINS: "https://moon-cleanup.vercel.app",
  RENDER_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
};

function issuesOf(source: Record<string, string | undefined>): readonly string[] {
  try {
    parseServerEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error.issues;
    throw error;
  }
  return [];
}

describe("parseServerEnv", () => {
  it("applies the canonical defaults for a local environment", () => {
    const env = parseServerEnv(localEnv);
    expect(env).toMatchObject({
      nodeEnv: "development",
      port: 2567,
      dbSchema: "prod",
      dbPoolMax: 4,
      simTickHz: 20,
      snapshotHz: 10,
      maxRooms: 3,
      tickBudgetMs: 3.5,
      clientIpHeader: "true-client-ip",
      maxClients: 12,
      checkpointIntervalS: 30,
      seatHoldS: 60,
      netSpike: false,
      buildVersion: "dev",
      logLevel: "info",
      allowedOrigins: ["http://localhost:5173"],
    });
  });

  it("accepts a production environment and derives the build id from RENDER_GIT_COMMIT", () => {
    const env = parseServerEnv(prodEnv);
    expect(env.buildVersion).toBe("0123456789ab");
    expect(env.gitCommit).toBe(prodEnv.RENDER_GIT_COMMIT);
    expect(env.dbSchema).toBe("prod");
    expect(env.netSpike).toBe(false);
  });

  it("prefers an explicit BUILD_VERSION", () => {
    expect(parseServerEnv({ ...prodEnv, BUILD_VERSION: "v1.2.3" }).buildVersion).toBe("v1.2.3");
  });

  it("treats blank values like a copied .env.example as unset", () => {
    const env = parseServerEnv({ ...localEnv, DATABASE_URL: "", SENTRY_DSN: "", BUILD_VERSION: "", MAX_ROOMS: "" });
    expect(env.databaseUrl).toBeUndefined();
    expect(env.maxRooms).toBe(3);
  });

  it("maps an empty CLIENT_IP_HEADER to socket mode on local and lower-cases a header name", () => {
    expect(parseServerEnv({ ...localEnv, CLIENT_IP_HEADER: "" }).clientIpHeader).toBeNull();
    expect(parseServerEnv({ ...localEnv, CLIENT_IP_HEADER: "X-Forwarded-For" }).clientIpHeader).toBe("x-forwarded-for");
  });

  it("refuses a blank CLIENT_IP_HEADER (socket mode) outside local (review N1)", () => {
    expect(issuesOf({ ...prodEnv, CLIENT_IP_HEADER: "" })).toContain(
      "CLIENT_IP_HEADER: may be blank (socket address) only when ENV_NAME is local",
    );
    expect(issuesOf({ ...prodEnv, CLIENT_IP_HEADER: "   " }).join("|")).toContain("CLIENT_IP_HEADER");
    expect(parseServerEnv(prodEnv).clientIpHeader).toBe("true-client-ip");
  });

  it("refuses 30/20 (SNAPSHOT_HZ must divide; 30/15 is the high-rate profile)", () => {
    expect(issuesOf({ ...localEnv, SIM_TICK_HZ: "30", SNAPSHOT_HZ: "20" })).toContain(
      "SNAPSHOT_HZ: must divide SIM_TICK_HZ evenly",
    );
  });

  it("splits ALLOWED_ORIGINS on commas", () => {
    const env = parseServerEnv({ ...localEnv, ALLOWED_ORIGINS: "http://localhost:5173, https://a.example.test" });
    expect(env.allowedOrigins).toEqual(["http://localhost:5173", "https://a.example.test"]);
  });

  it("rejects origins with a path or trailing slash", () => {
    expect(issuesOf({ ...localEnv, ALLOWED_ORIGINS: "https://a.example.test/" }).join("|")).toContain(
      "ALLOWED_ORIGINS",
    );
    expect(issuesOf({ ...localEnv, ALLOWED_ORIGINS: "not-a-url" }).join("|")).toContain("ALLOWED_ORIGINS");
  });

  it("reports every problem, readably", () => {
    const issues = issuesOf({ ENV_NAME: "mars", PERSISTENCE_DRIVER: "redis" });
    const keys = issues.map((line) => line.split(":")[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        "ENV_NAME",
        "PERSISTENCE_DRIVER",
        "JWT_SECRET",
        "REFRESH_TOKEN_PEPPER",
        "ALLOWED_ORIGINS",
      ]),
    );
  });

  it("rejects short secrets without echoing them", () => {
    const short = "short-secret-value";
    let message = "";
    try {
      parseServerEnv({ ...localEnv, JWT_SECRET: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("JWT_SECRET");
    expect(message).not.toContain(short);
  });

  it("never leaks an invalid value in the error message", () => {
    const issues = issuesOf({
      ...prodEnv,
      DB_SCHEMA: "hunter2-schema",
      DATABASE_URL: "mysql://u:hunter2-password@h/db",
    });
    expect(issues.join("\n")).not.toContain("hunter2");
  });

  it("requires SNAPSHOT_HZ to divide SIM_TICK_HZ", () => {
    expect(issuesOf({ ...localEnv, SIM_TICK_HZ: "20", SNAPSHOT_HZ: "7" })).toContain(
      "SNAPSHOT_HZ: must divide SIM_TICK_HZ evenly",
    );
    expect(parseServerEnv({ ...localEnv, SIM_TICK_HZ: "30", SNAPSHOT_HZ: "15" }).snapshotHz).toBe(15);
  });

  it("refuses the memory driver outside local", () => {
    expect(issuesOf({ ...prodEnv, PERSISTENCE_DRIVER: "memory" }).join("|")).toContain("memory is only allowed");
  });

  it("requires DATABASE_URL for postgres; DATABASE_CA_CERT is optional", () => {
    expect(issuesOf({ ...prodEnv, DATABASE_URL: undefined }).join("|")).toContain("DATABASE_URL: required");
    expect(issuesOf({ ...prodEnv, DATABASE_CA_CERT: undefined })).toEqual([]);
    expect(parseServerEnv({ ...prodEnv, DATABASE_CA_CERT: "" }).databaseCaCert).toBeUndefined();
    expect(
      issuesOf({ ...localEnv, PERSISTENCE_DRIVER: "postgres", DATABASE_URL: "postgres://u:p@localhost/db" }),
    ).toEqual([]);
  });

  it("accepts a Neon-style URL with sslmode=require and no CA in production", () => {
    const neon =
      "postgresql://owner:pw@ep-cool-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    expect(issuesOf({ ...prodEnv, DATABASE_URL: neon, DATABASE_CA_CERT: undefined })).toEqual([]);
  });

  it("refuses a production DATABASE_URL without TLS, and the pooled Neon host", () => {
    const base = "postgres://owner:hunter2-pw@ep-cool-123456.us-east-2.aws.neon.tech/neondb";
    for (const url of [base, base + "?sslmode=disable", base + "?sslmode=prefer"]) {
      const issues = issuesOf({ ...prodEnv, DATABASE_URL: url, DATABASE_CA_CERT: undefined });
      expect(issues.join("|")).toContain("sslmode=require");
      expect(issues.join("\n")).not.toContain("hunter2");
    }
    const pooled = issuesOf({
      ...prodEnv,
      DATABASE_URL: "postgres://o:p@ep-cool-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    });
    expect(pooled.join("|")).toContain("DIRECT connection string");
  });

  it("accepts the staging schema and rejects unknown schemas", () => {
    expect(parseServerEnv({ ...prodEnv, DB_SCHEMA: "staging" }).dbSchema).toBe("staging");
    expect(issuesOf({ ...prodEnv, DB_SCHEMA: "public" }).join("|")).toContain("DB_SCHEMA");
  });

  it("refuses NET_SPIKE=1 in production (ADR-0029)", () => {
    expect(issuesOf({ ...prodEnv, NET_SPIKE: "1" }).join("|")).toContain("NET_SPIKE");
    expect(parseServerEnv({ ...localEnv, NET_SPIKE: "1" }).netSpike).toBe(true);
  });

  it("defaults TRANSPORT to auto, normalises case and whitespace, and accepts uws and ws", () => {
    expect(parseServerEnv(localEnv).transport).toBe("auto");
    expect(parseServerEnv({ ...localEnv, TRANSPORT: "" }).transport).toBe("auto");
    expect(parseServerEnv({ ...localEnv, TRANSPORT: "  WS " }).transport).toBe("ws");
    expect(parseServerEnv({ ...localEnv, TRANSPORT: "uws" }).transport).toBe("uws");
    expect(parseServerEnv({ ...localEnv, TRANSPORT: "auto" }).transport).toBe("auto");
  });

  it("rejects an unknown TRANSPORT with the same wording as net/transport, without echoing the value", () => {
    const issues = issuesOf({ ...localEnv, TRANSPORT: "hunter2-sockjs" });
    expect(issues).toContain("TRANSPORT: expected one of auto, uws, ws");
    expect(issues.join("\n")).not.toContain("hunter2");
    expect(() => parseTransportMode("nope")).toThrow("TRANSPORT: expected one of auto, uws, ws");
  });

  it("refuses the .env.example placeholder secrets when ENV_NAME=production (review N11)", () => {
    const placeholderJwt = "replace-me-with-a-long-random-string-from-a-password-manager";
    const placeholderPepper = "replace-me-with-another-long-random-string";
    const issues = issuesOf({ ...prodEnv, JWT_SECRET: placeholderJwt, REFRESH_TOKEN_PEPPER: placeholderPepper });
    expect(issues.some((line) => line.startsWith("JWT_SECRET:") && line.includes("placeholder"))).toBe(true);
    expect(issues.some((line) => line.startsWith("REFRESH_TOKEN_PEPPER:") && line.includes("placeholder"))).toBe(true);
    // Each key alone, the previous-key slot, and common spellings.
    expect(issuesOf({ ...prodEnv, JWT_SECRET: placeholderJwt }).join("|")).toContain("JWT_SECRET");
    expect(issuesOf({ ...prodEnv, REFRESH_TOKEN_PEPPER: placeholderPepper }).join("|")).toContain(
      "REFRESH_TOKEN_PEPPER",
    );
    expect(issuesOf({ ...prodEnv, JWT_SECRET_PREVIOUS: placeholderJwt }).join("|")).toContain("JWT_SECRET_PREVIOUS");
    for (const spelling of [
      "CHANGE_ME_".repeat(5),
      "this-is-a-Placeholder-value-0123456789abcdef",
      "<paste-secret-here-0123456789abcdef>",
    ]) {
      expect(issuesOf({ ...prodEnv, JWT_SECRET: spelling }).join("|")).toContain("JWT_SECRET");
    }
    // The error never echoes the secret text.
    expect(issues.join("\n")).not.toContain("password-manager");
    expect(issues.join("\n")).not.toContain("another-long-random");
  });

  it("allows the placeholder secrets outside production and real-looking secrets in production", () => {
    const placeholderJwt = "replace-me-with-a-long-random-string-from-a-password-manager";
    expect(parseServerEnv({ ...localEnv, JWT_SECRET: placeholderJwt }).jwtSecret).toBe(placeholderJwt);
    const real = "k9Jx2mQ7vLp4Zt8RbN3wYc6HdS1aFgU5eVo0iTqXz2M=";
    expect(issuesOf({ ...prodEnv, JWT_SECRET: real, REFRESH_TOKEN_PEPPER: real.split("").reverse().join("") })).toEqual(
      [],
    );
  });

  it("rejects an out-of-range checkpoint interval", () => {
    expect(issuesOf({ ...localEnv, CHECKPOINT_INTERVAL_S: "31" }).join("|")).toContain("CHECKPOINT_INTERVAL_S");
  });
});

describe("describeEnvForLog", () => {
  it("never contains secret values or the CA body", () => {
    const text = JSON.stringify(describeEnvForLog(parseServerEnv(prodEnv)));
    expect(text).not.toContain(SECRET_A);
    expect(text).not.toContain(SECRET_B);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("BEGIN CERTIFICATE");
    expect(text).toContain('"databaseUrl":"[set]"');
  });
});
