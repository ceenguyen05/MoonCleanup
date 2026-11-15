import { describe, expect, it } from "vitest";
import type { AudioCueId } from "@moon-cleanup/shared";
import {
  BufferStore,
  PREWARM_ORDER,
  renderCuePcm,
  type CueRenderRemote,
  type RenderReply,
  type RenderRequest,
} from "./buffer-store";
import { FakeContext } from "./fake-audio";
import { MusicDirector } from "./music";
import { renderLayer } from "./music-recipes";
import { handleRenderRequest } from "./render-worker";

class FakeRemote implements CueRenderRemote {
  requests: RenderRequest[] = [];
  disposed = false;
  private onReply: (r: RenderReply) => void = () => undefined;
  fail: () => void = () => undefined;
  connect(onReply: (r: RenderReply) => void, onFailure: () => void): void {
    this.onReply = onReply;
    this.fail = onFailure;
  }
  request(req: RenderRequest): void {
    this.requests.push(req);
  }
  /** Runs the worker handler for the oldest queued request and delivers the reply. */
  deliverOne(): void {
    const req = this.requests.shift();
    if (req !== undefined) this.onReply(handleRenderRequest(req));
  }
  dispose(): void {
    this.disposed = true;
  }
}

describe("BufferStore off-thread rendering", () => {
  it("never renders on the calling thread: a miss requests and returns null, delivery fills the cache", () => {
    const remote = new FakeRemote();
    const ctx = new FakeContext();
    const store = new BufferStore(ctx, remote);
    expect(store.offThread).toBe(true);
    expect(store.get("music.stinger_fulfilled", 0)).toBeNull();
    expect(ctx.buffers.length).toBe(0);
    expect(remote.requests).toHaveLength(1);
    store.get("music.stinger_fulfilled", 0); // deduped while pending
    expect(remote.requests).toHaveLength(1);
    remote.deliverOne();
    expect(store.get("music.stinger_fulfilled", 0)).not.toBeNull();
    expect(store.residentBytes).toBeGreaterThan(0);
  });

  it("prewarm queues everything once in PREWARM_ORDER without rendering", () => {
    const remote = new FakeRemote();
    const store = new BufferStore(new FakeContext(), remote);
    expect(store.prewarmStep()).toBe(false);
    const n = remote.requests.length;
    expect(n).toBeGreaterThan(PREWARM_ORDER.length / 2);
    expect(remote.requests[0]).toEqual({ kind: "cue", id: "ui.click", variant: 0 });
    store.prewarmStep();
    expect(remote.requests).toHaveLength(n);
  });

  it("falls back to main-thread rendering when the worker fails", () => {
    const remote = new FakeRemote();
    const store = new BufferStore(new FakeContext(), remote);
    let restarted = 0;
    store.onFallback = () => restarted++;
    remote.fail();
    expect(store.offThread).toBe(false);
    expect(remote.disposed).toBe(true);
    expect(restarted).toBe(1);
    expect(store.get("ui.click", 0)).not.toBeNull();
  });

  it("worker output equals the main-thread render (loop recipes are copied to an exact-length buffer)", () => {
    for (const id of ["ui.click", "ambience.suit_bed", "tool.sweep"] as AudioCueId[]) {
      const a = renderCuePcm(id, 0);
      const b = handleRenderRequest({ kind: "cue", id, variant: 0 });
      if (b.kind !== "cue") throw new Error("kind");
      expect(b.pcm.length).toBe(a.pcm.length);
      expect(b.pcm.buffer.byteLength).toBe(a.pcm.length * 4);
      expect(Array.from(b.pcm.subarray(0, 64))).toEqual(Array.from(a.pcm.subarray(0, 64)));
    }
  });

  it("music layers are requested from the worker and delivered to the director callback", () => {
    const remote = new FakeRemote();
    const store = new BufferStore(new FakeContext(), remote);
    const got: string[] = [];
    store.onLayer = (set, layer, pcm) => got.push(`${set}/${layer}/${pcm.length > 0}`);
    expect(store.requestLayer("day", "pulse")).toBe(true);
    remote.deliverOne();
    expect(got).toEqual(["day/pulse/true"]);
    store.onFallback = null;
    remote.fail();
    expect(store.requestLayer("day", "pulse")).toBe(false);
  });
});

describe("MusicDirector layer gating", () => {
  it("with a worker the set does not start until the layers arrive; nothing renders in begin()", () => {
    const ctx = new FakeContext();
    const dest = ctx.createGain();
    const asked: string[] = [];
    const music = new MusicDirector(ctx, dest, (set, layer) => {
      asked.push(`${set}/${layer}`);
      return true;
    });
    music.setSet("day");
    for (let i = 0; i < 400; i++) music.tick(i / 30); // pad renders in slices
    expect(asked.sort()).toEqual(["day/melody", "day/pulse"]);
    expect(music.currentSet).toBeNull();
    music.acceptLayer("day", "pulse", renderLayer("day", "pulse") ?? new Float32Array(0));
    music.tick(14);
    expect(music.currentSet).toBeNull();
    music.acceptLayer("day", "melody", renderLayer("day", "melody") ?? new Float32Array(0));
    music.tick(15);
    expect(music.currentSet).toBe("day");
  });

  it("without a worker, layers render one per tick", () => {
    const ctx = new FakeContext();
    const music = new MusicDirector(ctx, ctx.createGain());
    music.setSet("day");
    for (let i = 0; i < 400; i++) music.tick(i / 30);
    expect(music.currentSet).toBe("day");
  });
});
