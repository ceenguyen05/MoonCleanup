// Sign-in timing of the checkpoint sync (M1-W5-T08 with M1-W4-T04b guest auth): the app starts Clock In and the guest
// sign-in together, so the head check runs signed out. The queue must be HELD (no timer storm) and released by
// `notifyAuthChanged`, which retries the head check and uploads the local checkpoint.
import { describe, expect, it } from "vitest";
import { createSaveApi, type TokenSource } from "./save-api";
import { CONTRACT, FakeServer, makeDevice, type Device } from "./test-support";

/** A token source like `GuestAuth`: null until signed in; counts how often the API asked. */
class FakeAuth implements TokenSource {
  token: string | null = null;
  calls = 0;
  getAccessToken(): Promise<string | null> {
    this.calls += 1;
    return Promise.resolve(this.token);
  }
}

function deviceWith(server: FakeServer, auth: FakeAuth): Device {
  return makeDevice(server, {
    api: createSaveApi({ baseUrl: "http://server.test", auth, fetch: server.fetch }),
  });
}

describe("sign-in after Clock In", () => {
  it("holds the queue while signed out (no retry loop), then uploads after notifyAuthChanged", async () => {
    const server = new FakeServer();
    server.addContract();
    const auth = new FakeAuth();
    const dev = deviceWith(server, auth);
    await dev.checkpoint({ generation: 1, parent: 0 });

    // Boot order of the app: Clock In in the background (maxWaitMs 0) while the guest sign-in is still running.
    await dev.sync.clockIn(CONTRACT, { maxWaitMs: 0 });
    await dev.advance(600_000);
    // A held queue asks for the token once or twice, not once per timer tick (a zero-delay loop would never end).
    expect(auth.calls).toBeLessThanOrEqual(3);
    expect(server.uploads).toHaveLength(0);
    expect(dev.ui.state).toBe("offline");
    expect(dev.names()).toContain("save.upload_failed");

    // Guest sign-in finished.
    auth.token = "tok";
    dev.sync.notifyAuthChanged();
    await dev.advance(1000);
    expect(server.requests).toContain("GET /v1/contracts/" + CONTRACT + "/save/head");
    expect(server.uploads).toHaveLength(1);
    expect(server.uploads[0]).toMatchObject({ generation: 1, baseGeneration: 0 });
    expect(dev.ui).toMatchObject({ state: "synced", serverGeneration: 1, error: null });
  });

  it("a checkpoint written while signed out is held too, and the notify uploads the newest one", async () => {
    const server = new FakeServer();
    server.addContract();
    const auth = new FakeAuth();
    auth.token = "tok";
    const dev = deviceWith(server, auth);
    await dev.checkpoint({ generation: 1, parent: 0 });
    await dev.sync.clockIn(CONTRACT, { maxWaitMs: Infinity });
    await dev.advance(1000);
    expect(server.uploads).toHaveLength(1);

    auth.token = null; // the refresh token was refused later in the session
    await dev.checkpoint({ generation: 2, parent: 1 });
    await dev.advance(300_000);
    expect(server.uploads).toHaveLength(1);
    const asked = auth.calls;
    await dev.advance(300_000);
    expect(auth.calls).toBe(asked); // held: no more attempts without a trigger

    auth.token = "tok";
    dev.sync.notifyAuthChanged();
    await dev.advance(1000);
    expect(server.uploads).toHaveLength(2);
    expect(server.uploads[1]).toMatchObject({ generation: 2, baseGeneration: 1 });
    expect(dev.ui.state).toBe("synced");
  });

  it("a server that is asleep after sign-in is retried with backoff, not held", async () => {
    const server = new FakeServer();
    server.addContract();
    const auth = new FakeAuth();
    const dev = deviceWith(server, auth);
    await dev.checkpoint({ generation: 1, parent: 0 });
    await dev.sync.clockIn(CONTRACT, { maxWaitMs: 0 });
    server.mode = "asleep";
    auth.token = "tok";
    dev.sync.notifyAuthChanged();
    await dev.advance(1000);
    expect(dev.ui.state).toBe("offline");
    server.mode = "ok";
    await dev.advance(120_000);
    expect(server.uploads).toHaveLength(1);
    expect(dev.ui.state).toBe("synced");
  });
});
