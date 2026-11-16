// Online hooks: a host that fails on its own (join refused, retries exhausted) must unbind the dust feed and the
// avatar animation from the dead room, exactly as an explicit close does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOnlineDevHooks, type OnlineRoomSlot } from "./online-launch";
import { createRoomHostService } from "./solo-host";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};

describe("online hooks: failed host unbinds its bindings", { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a refused join (terminal failure) unbinds dust and animation; close does not unbind twice", async () => {
    const calls: string[] = [];
    const slot: OnlineRoomSlot = { current: null };
    const publisher = createRoomHostService();
    const refuse = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const hooks = createOnlineDevHooks(
      slot,
      {
        httpUrl: "http://srv",
        wsUrl: "ws://srv",
        clientBuild: "test",
        wakeProbe: false,
        fetch: refuse as unknown as typeof fetch,
      },
      (source, error) => calls.push(`problem:${source}:${String(error)}`),
      {
        publisher,
        animation: {
          bind: (provider) => calls.push(provider === null ? "anim:null" : "anim:bind"),
          setLocalSlot: (s) => calls.push(`slot:${s}`),
        },
        dustFeed: { bind: (feed) => calls.push(feed === null ? "dust:null" : "dust:bind") },
      },
    );
    await hooks.open("0190a5b4-1111-4222-8333-0000000000aa", "token");
    expect(calls.filter((c) => c.startsWith("problem"))).toEqual([]);
    expect(calls).toContain("dust:bind");
    expect(calls).not.toContain("dust:null");
    await flush();
    expect(publisher.current?.state).toBe("failed");
    // Unbound by the failure itself, without any close() call.
    expect(calls.slice(calls.indexOf("dust:bind"))).toEqual(["dust:bind", "anim:null", "slot:-1", "dust:null"]);
    hooks.close();
  });
});
