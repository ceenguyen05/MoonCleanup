// Upload slot-acquisition rate limit (security review R2): per account and per client address (IPv6 by /64), on top of the
// transport's in-flight slot caps. Token verification comes first so forged tokens consume nothing.
import { GuestCreateResponseSchema } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { createRateLimits, rateKeyForIp } from "./rate-limits";
import { createHarness } from "./test-harness";
import { createUploadAdmission } from "./upload-admission";

async function guestToken(h: ReturnType<typeof createHarness>, name: string, ip: string) {
  const res = await h.call("POST", "/v1/auth/guest", { body: { displayName: name }, ip });
  return GuestCreateResponseSchema.parse(res.body);
}

describe("rateKeyForIp", () => {
  it("groups IPv6 by /64 and normalises formatting; IPv4 and unknown pass through", () => {
    expect(rateKeyForIp("203.0.113.5")).toBe("203.0.113.5");
    expect(rateKeyForIp("unknown")).toBe("unknown");
    expect(rateKeyForIp("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(rateKeyForIp("2001:0DB8:0001:0002:ffff:0:0:1")).toBe("2001:db8:1:2::/64");
    expect(rateKeyForIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(rateKeyForIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateKeyForIp("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });
});

describe("upload slot admission", () => {
  it("a forged or expired token is null (401) and consumes no allowance", async () => {
    const h = createHarness();
    const me = await guestToken(h, "Slot One", "198.51.100.1");
    const rates = createRateLimits();
    const admit = createUploadAdmission({ verifyToken: h.api.verifyToken, rates, audit: () => undefined });
    for (let i = 0; i < 100; i += 1) expect(await admit("x".repeat(40), "203.0.113.9")).toBeNull();
    // The shared address allowance is untouched: a real account from that address is still admitted.
    expect(await admit(me.accessToken, "203.0.113.9")).toBe(me.playerId);
  });

  it("limits an account's slot attempts per minute with a retry-after, and audits it", async () => {
    const h = createHarness();
    const audits: string[] = [];
    const me = await guestToken(h, "Slot Two", "198.51.100.2");
    const admit = createUploadAdmission({
      verifyToken: h.api.verifyToken,
      rates: createRateLimits(),
      audit: (e) => audits.push(e.kind),
    });
    // Rotate the address so only the account allowance (12 per minute) can trip.
    let admitted = 0;
    let refusal: unknown;
    for (let i = 0; i < 20; i += 1) {
      const out = await admit(me.accessToken, `203.0.113.${100 + i}`);
      if (out === me.playerId) admitted += 1;
      else refusal ??= out;
    }
    expect(admitted).toBe(12);
    expect(refusal).toMatchObject({ rateLimited: true });
    expect((refusal as { retryAfterS: number }).retryAfterS).toBeGreaterThanOrEqual(1);
    expect(audits).toContain("rate_limited");
  });

  it("limits per client address across accounts, grouping IPv6 by /64", async () => {
    const h = createHarness();
    const admit = createUploadAdmission({
      verifyToken: h.api.verifyToken,
      rates: createRateLimits(),
      audit: () => undefined,
    });
    const accounts = [];
    for (let i = 0; i < 6; i += 1) accounts.push(await guestToken(h, `Net Guest ${i}`, `198.51.100.${10 + i}`));
    // 30 attempts per minute per /64: spread over 6 accounts (5 each, under the account cap) and varying low 64 bits.
    let admitted = 0;
    let refused = 0;
    for (let i = 0; i < 36; i += 1) {
      const account = accounts[i % accounts.length];
      const out = await admit(account?.accessToken ?? "", `2001:db8:77:5::${(i + 1).toString(16)}`);
      if (typeof out === "string") admitted += 1;
      else refused += 1;
    }
    expect(admitted).toBe(30);
    expect(refused).toBe(6);
    // A different /64 is a different allowance.
    const other = await admit(accounts[0]?.accessToken ?? "", "2001:db8:77:6::1");
    expect(other).toBe(accounts[0]?.playerId);
  });

  it("the account API exposes the same admission for the transport", async () => {
    const h = createHarness();
    const me = await guestToken(h, "Slot Three", "198.51.100.3");
    expect(await h.api.admitRawUpload(me.accessToken, "203.0.113.50")).toBe(me.playerId);
    expect(await h.api.admitRawUpload("nope".repeat(10), "203.0.113.50")).toBeNull();
  });
});
