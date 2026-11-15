import { describe, expect, it, vi } from "vitest";
import { GuestAuth, REFRESH_TOKEN_KEY, type KeyValueStore } from "./guest-auth";

const R1 = "a".repeat(43);
const R2 = "b".repeat(43);
const R3 = "c".repeat(43);
const PLAYER = "0190a5b4-1111-7222-8333-444455556666";

class MemStore implements KeyValueStore {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pair = (access: string, refresh: string) => ({
  accessToken: access,
  accessExpiresInS: 900,
  refreshToken: refresh,
});

function rig(answers: (() => Response)[], store: MemStore | null = new MemStore()) {
  let t = 1_000_000;
  const calls: { path: string; body: unknown }[] = [];
  const changes: boolean[] = [];
  const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)) });
    const next = answers.shift();
    return next === undefined ? Promise.reject(new TypeError("offline")) : Promise.resolve(next());
  });
  const auth = new GuestAuth({
    httpUrl: "http://srv/",
    storage: store,
    fetch: fetchFn as unknown as typeof fetch,
    now: () => t,
    onChange: (s) => changes.push(s),
  });
  return { auth, calls, changes, store, advance: (ms: number) => (t += ms) };
}

describe("guest auth token source", () => {
  it("is signed out and makes no request until signIn; getAccessToken never creates an account", async () => {
    const { auth, calls } = rig([]);
    expect(auth.signedIn).toBe(false);
    expect(await auth.getAccessToken(false)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("signIn creates a guest, stores only the refresh token, caches the access token in memory", async () => {
    const { auth, calls, changes, store } = rig([
      () =>
        json({
          ...pair("access-token-0001", R1),
          playerId: PLAYER,
          displayName: "Guest 1234",
          recoveryCode: "ABCD-EFGH-JKMN-PQRS",
        }),
    ]);
    expect(await auth.signIn()).toBe(true);
    expect(calls).toEqual([{ path: "/v1/auth/guest", body: {} }]);
    expect(store!.map.get(REFRESH_TOKEN_KEY)).toBe(R1);
    expect([...store!.map.values()]).not.toContain("access-token-0001");
    expect(changes).toEqual([true]);
    expect(auth.takeRecoveryCode()).toBe("ABCD-EFGH-JKMN-PQRS");
    expect(auth.takeRecoveryCode()).toBeNull();
    expect(await auth.getAccessToken(false)).toBe("access-token-0001");
    expect(calls).toHaveLength(1);
  });

  it("refreshes a stored token when expired or forced, single-flight across concurrent callers", async () => {
    const store = new MemStore();
    store.setItem(REFRESH_TOKEN_KEY, R1);
    const { auth, calls, advance } = rig(
      [() => json(pair("access-token-0002", R2)), () => json(pair("access-token-0003", R3))],
      store,
    );
    expect(auth.signedIn).toBe(true);
    const [a, b] = await Promise.all([auth.getAccessToken(false), auth.getAccessToken(false)]);
    expect(a).toBe("access-token-0002");
    expect(b).toBe("access-token-0002");
    expect(calls).toEqual([{ path: "/v1/auth/refresh", body: { refreshToken: R1 } }]);
    expect(store.getItem(REFRESH_TOKEN_KEY)).toBe(R2);
    advance(900_000 - 29_000); // inside the expiry margin
    expect(await auth.getAccessToken(false)).toBe("access-token-0003");
    expect(calls[1]!.body).toEqual({ refreshToken: R2 });
  });

  it("409 TOKEN_SUPERSEDED re-reads the token another tab stored and retries once", async () => {
    const store = new MemStore();
    store.setItem(REFRESH_TOKEN_KEY, R1);
    const { auth, calls } = rig(
      [
        () => {
          store.setItem(REFRESH_TOKEN_KEY, R2); // the other tab won the rotation
          return json({ error: "TOKEN_SUPERSEDED" }, 409);
        },
        () => json(pair("access-token-0004", R3)),
      ],
      store,
    );
    expect(await auth.getAccessToken(true)).toBe("access-token-0004");
    expect(calls.map((c) => c.body)).toEqual([{ refreshToken: R1 }, { refreshToken: R2 }]);
    expect(auth.stats.superseded).toBe(1);
  });

  it("401 on refresh drops the account; network and 5xx failures keep it for later", async () => {
    const store = new MemStore();
    store.setItem(REFRESH_TOKEN_KEY, R1);
    const { auth, changes } = rig([() => new Response("<html>waking</html>", { status: 503 })], store);
    expect(await auth.getAccessToken(false)).toBeNull(); // 503 waking
    expect(await auth.getAccessToken(false)).toBeNull(); // network failure (no answer queued)
    expect(store.getItem(REFRESH_TOKEN_KEY)).toBe(R1);
    expect(auth.stats.networkFailures).toBe(1);

    const r2 = rig([() => json({ error: "UNAUTHORIZED" }, 401)], store);
    expect(await r2.auth.getAccessToken(false)).toBeNull();
    expect(store.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(r2.auth.signedIn).toBe(false);
    expect(r2.changes).toEqual([false]);
    expect(changes).toEqual([]);
  });

  it("works without storage and refuses malformed answers", async () => {
    const { auth } = rig([() => json({ accessToken: "x" })], null);
    expect(await auth.signIn()).toBe(false);
    expect(auth.signedIn).toBe(false);
  });
});
