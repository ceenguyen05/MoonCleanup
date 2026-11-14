import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { REDACTED, isSecretKey, redactString, redactValue } from "./redact";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl";

describe("redactString", () => {
  it("scrubs credentials in connection URIs and drops the query", () => {
    const out = redactString(
      "connect postgres://app:hunter2@db.example.test:5432/app?sslmode=require&password=x failed",
    );
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("password=x");
    expect(out).toContain("db.example.test:5432/app");
  });

  it("scrubs bearer tokens, JWTs and PEM blocks", () => {
    expect(redactString(`Authorization: Bearer abc.DEF-123_x`)).not.toContain("abc.DEF");
    expect(redactString(`token ${JWT} end`)).not.toContain("c2lnbmF0dXJl");
    const pem = "ca=-----BEGIN CERTIFICATE-----\nMIIBsecretbody\n-----END CERTIFICATE----- tail";
    const out = redactString(pem);
    expect(out).not.toContain("MIIBsecretbody");
    expect(out).toContain("tail");
  });

  it("leaves ordinary text alone", () => {
    expect(redactString("room 3 started on plot 17")).toBe("room 3 started on plot 17");
  });
});

describe("redactValue", () => {
  it("replaces secret-named keys at any depth", () => {
    const out = redactValue({
      ok: 1,
      refreshToken: "r-123",
      nested: {
        Authorization: "Bearer x",
        JWT_SECRET: "s",
        database_url: "postgres://u:p@h/d",
        list: [{ password: "p" }],
      },
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/r-123|Bearer x|postgres:|"s"|"p"/);
    expect(out.ok).toBe(1);
  });

  it("serialises errors and scrubs their messages", () => {
    const out = redactValue(new Error("cannot reach postgres://u:topsecret@h/db")) as { type: string; message: string };
    expect(out.type).toBe("Error");
    expect(out.message).not.toContain("topsecret");
  });

  it("survives cycles and excessive depth", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redactValue(a)).not.toThrow();
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20; i += 1) deep = (deep.next = {}) as Record<string, unknown>;
    expect(() => redactValue(root)).not.toThrow();
  });

  it("recognises secret key spellings", () => {
    for (const key of ["accessToken", "refresh_token", "COOKIE", "recoveryCode", "joinTicket", "SENTRY_DSN"]) {
      expect(isSecretKey(key), key).toBe(true);
    }
    expect(isSecretKey("roomId")).toBe(false);
    expect(REDACTED).toBe("[redacted]");
  });
});

describe("createLogger", () => {
  function capture() {
    const lines: string[] = [];
    const logger = createLogger({
      level: "debug",
      nodeEnv: "production",
      envName: "local",
      buildVersion: "abc123",
      gitCommit: "0123456789ab",
      destination: { write: (line: string) => void lines.push(line) },
    });
    return { logger, lines };
  }

  it("writes JSON with service, env, build and commit fields", () => {
    const { logger, lines } = capture();
    logger.info({ roomId: "r1" }, "hello");
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      service: "moon-cleanup-server",
      env: "local",
      build: "abc123",
      commit: "0123456789ab",
      roomId: "r1",
      msg: "hello",
    });
  });

  it("redacts tokens and URIs in messages and context", () => {
    const { logger, lines } = capture();
    logger.error({ accessToken: JWT, err: new Error("fail postgres://u:pw123@h/d") }, `login with Bearer ${JWT}`);
    const out = lines.join("");
    expect(out).not.toContain("pw123");
    expect(out).not.toContain("c2lnbmF0dXJl");
    expect(out).toContain(REDACTED);
  });
});
