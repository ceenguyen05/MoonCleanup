import { describe, expect, it } from "vitest";
import { corsAllows, cspAllowsServer, overallPass } from "./analysis";

const VERCEL_CSP =
  "default-src 'self'; connect-src 'self' https://*.onrender.com wss://*.onrender.com https://*.ingest.sentry.io";

describe("cspAllowsServer", () => {
  it("accepts the default onrender.com name over https and wss", () => {
    const v = cspAllowsServer(VERCEL_CSP, "https://moon-api.onrender.com", "https://moon.vercel.app");
    expect(v).toMatchObject({ hasCsp: true, https: true, wss: true });
  });
  it("rejects a custom domain not in connect-src", () => {
    const v = cspAllowsServer(VERCEL_CSP, "https://api.example.com", "https://moon.vercel.app");
    expect(v.https).toBe(false);
    expect(v.wss).toBe(false);
  });
  it("flags a missing wss source", () => {
    const v = cspAllowsServer("connect-src 'self' https://a.onrender.com", "https://a.onrender.com", "https://x.app");
    expect(v).toMatchObject({ https: true, wss: false });
  });
  it("falls back to default-src and treats no CSP as nothing blocked", () => {
    expect(cspAllowsServer("default-src 'self'", "https://a.onrender.com", "https://x.app").https).toBe(false);
    expect(cspAllowsServer(null, "https://a.onrender.com", "https://x.app").hasCsp).toBe(false);
  });
});

describe("corsAllows / overallPass", () => {
  it("matches the exact origin or *", () => {
    expect(corsAllows(new Headers({ "access-control-allow-origin": "https://a.app" }), "https://a.app")).toBe(true);
    expect(corsAllows(new Headers(), "https://a.app")).toBe(false);
    expect(corsAllows(new Headers({ "access-control-allow-origin": "https://b.app" }), "https://a.app")).toBe(false);
  });
  it("fails overall on any FAIL but not on SKIP/WARN", () => {
    const r = (status: "PASS" | "FAIL" | "SKIP" | "WARN") => ({ name: "x", status, detail: "", ms: 0 });
    expect(overallPass([r("PASS"), r("SKIP"), r("WARN")])).toBe(true);
    expect(overallPass([r("PASS"), r("FAIL")])).toBe(false);
  });
});
