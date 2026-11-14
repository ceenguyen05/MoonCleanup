import { describe, expect, it } from "vitest";
import { resolveClientIp, resolveUpgradeClientIp, UNKNOWN_CLIENT_IP } from "./client-ip";
import { CORS_MAX_AGE_S, createOriginPolicy } from "./cors";
import { parseQuery, routeParamNames, safeDecodeURIComponent } from "./http-routes";

describe("origin policy", () => {
  const policy = createOriginPolicy(["https://moon-cleanup.vercel.app", "http://localhost:5177"]);

  it("allows exact origins only", () => {
    expect(policy.isAllowed("https://moon-cleanup.vercel.app")).toBe(true);
    expect(policy.isAllowed("http://localhost:5177")).toBe(true);
    for (const denied of [
      "https://evil-moon-cleanup.vercel.app",
      "https://moon-cleanup.vercel.app.evil.com",
      "https://other.vercel.app",
      "http://moon-cleanup.vercel.app",
      "http://localhost:5173",
      "null",
      "",
      null,
      undefined,
    ]) {
      expect(policy.isAllowed(denied)).toBe(false);
    }
  });

  it("echoes the origin with Vary and never allows credentials", () => {
    const h = policy.responseHeaders("http://localhost:5177");
    expect(h).toEqual({ "access-control-allow-origin": "http://localhost:5177", vary: "Origin" });
    const p = policy.preflightHeaders("http://localhost:5177");
    expect(p["access-control-max-age"]).toBe(String(CORS_MAX_AGE_S));
    expect(p["access-control-allow-headers"]).toBe("Authorization, Content-Type");
    expect(p["access-control-allow-methods"]).toBe("GET, POST, PATCH, DELETE");
    expect(Object.keys(p)).not.toContain("access-control-allow-credentials");
  });

  it("returns no CORS headers for denied origins", () => {
    expect(policy.responseHeaders("https://evil.example")).toEqual({});
    expect(policy.preflightHeaders("https://evil.example")).toEqual({});
  });

  it("refuses wildcards, paths and empty lists at construction", () => {
    expect(() => createOriginPolicy(["*"])).toThrow();
    expect(() => createOriginPolicy(["https://*.vercel.app"])).toThrow();
    expect(() => createOriginPolicy(["https://a.example/"])).toThrow();
    expect(() => createOriginPolicy(["https://a.example/path"])).toThrow();
    expect(() => createOriginPolicy([])).toThrow();
  });
});

describe("client IP", () => {
  it("uses only the configured edge header", () => {
    expect(resolveClientIp({ "true-client-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" }, "true-client-ip")).toBe(
      "203.0.113.9",
    );
  });

  it("takes the right-most X-Forwarded-For entry, never the forged left-most one", () => {
    expect(resolveClientIp({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }, "x-forwarded-for")).toBe("198.51.100.7");
  });

  it("falls back to the unknown bucket when the header is missing or junk", () => {
    expect(resolveClientIp({ "x-forwarded-for": "1.2.3.4" }, "true-client-ip")).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp({ "true-client-ip": "<script>" }, "true-client-ip")).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveClientIp({ "true-client-ip": "1".repeat(80) }, "true-client-ip")).toBe(UNKNOWN_CLIENT_IP);
  });

  it("socket mode (null header) uses the socket address and never trusts true-client-ip (review N1)", () => {
    expect(resolveClientIp({ "true-client-ip": "1.2.3.4" }, null, "127.0.0.1")).toBe("127.0.0.1");
    expect(resolveClientIp({ "true-client-ip": "1.2.3.4" }, null, undefined)).toBe(UNKNOWN_CLIENT_IP);
  });

  it("upgrade: header mode reads the edge header; socket mode refuses Colyseus' forwarded-header guess", () => {
    const headers: Record<string, string> = { "true-client-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" };
    const get = (name: string): string | null => headers[name] ?? null;
    expect(resolveUpgradeClientIp(get, "true-client-ip", "1.2.3.4")).toBe("203.0.113.9");
    expect(resolveUpgradeClientIp(() => null, "true-client-ip", "127.0.0.1")).toBe(UNKNOWN_CLIENT_IP);
    // Socket mode: context.ip came from the forged x-forwarded-for, so the request is keyed unknown.
    expect(resolveUpgradeClientIp(get, null, "1.2.3.4")).toBe(UNKNOWN_CLIENT_IP);
    expect(resolveUpgradeClientIp(() => null, null, "127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("safeDecodeURIComponent (review N3)", () => {
  it("returns null for malformed escapes instead of throwing", () => {
    expect(safeDecodeURIComponent("a%20b")).toBe("a b");
    expect(safeDecodeURIComponent("%E0%A4%A")).toBeNull();
    expect(safeDecodeURIComponent("%")).toBeNull();
  });
});

describe("route helpers", () => {
  it("lists :params in order", () => {
    expect(routeParamNames("/v1/contracts/:id/members/:playerId")).toEqual(["id", "playerId"]);
    expect(routeParamNames("/healthz")).toEqual([]);
  });

  it("keeps the first value of a repeated query key", () => {
    expect(parseQuery("a=1&b=2&a=3")).toEqual({ a: "1", b: "2" });
    expect(parseQuery("")).toEqual({});
  });
});
