// Scenario tests of the sync controller against an in-memory server that honours the checkpoint REST contract.
// Time is virtual (device.advance); streams run on the real event loop (device.settle).
import { describe, expect, it } from "vitest";
import { UPLOAD_INTERVAL_MS } from "./limits";
import { crc32 } from "./crc32";
import { CONTRACT, FakeServer, makeDevice, type Device } from "./test-support";

const A = [
  { id: 1, fill: 1 },
  { id: 2, fill: 2 },
];

async function booted(server: FakeServer, opts?: Parameters<typeof makeDevice>[1]): Promise<Device> {
  const dev = makeDevice(server, opts);
  return dev;
}

describe("upload queue", () => {
  it("uploads nothing before the first interaction, then the newest checkpoint only", async () => {
    const server = new FakeServer();
    server.addContract();
    const dev = await booted(server);
    await dev.sync.attach(CONTRACT);
    await dev.checkpoint({ generation: 1, parent: 0, chunks: A });
    await dev.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 2, fill: 9 }] });
    await dev.checkpoint({ generation: 3, parent: 2, chunks: [{ id: 3, fill: 3 }] });
    await dev.advance(UPLOAD_INTERVAL_MS * 2);
    expect(server.uploads).toHaveLength(0);
    expect(dev.ui.state).toBe("pending");

    dev.gate.markInteracted();
    await dev.advance(1000);
    expect(server.uploads).toHaveLength(1);
    expect(server.uploads[0]).toMatchObject({ generation: 3, baseGeneration: 0 });
    // First upload: every dust row written since base 0 (chunks 1, 2, 3), the newest version of each.
    expect(server.uploads[0]?.chunkIds).toEqual([1, 2, 3]);
    expect(dev.ui).toMatchObject({ state: "synced", serverGeneration: 3, localGeneration: 3, pendingSinceMs: null });
    expect(dev.names()).toContain("save.synced");
  });

  it("sends only the chunks written since the last accepted generation, at most every 120 s", async () => {
    const server = new FakeServer();
    server.addContract();
    const dev = await booted(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT);
    await dev.checkpoint({ generation: 1, parent: 0, chunks: A });
    await dev.advance(1000);
    expect(server.uploads).toHaveLength(1);

    await dev.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 2, fill: 7 }] });
    await dev.advance(UPLOAD_INTERVAL_MS - 5000);
    expect(server.uploads).toHaveLength(1); // not before the interval
    await dev.advance(10_000);
    expect(server.uploads).toHaveLength(2);
    expect(server.uploads[1]).toMatchObject({ generation: 2, baseGeneration: 1, chunkIds: [2] });
  });

  it("uploads urgently (still no sooner than the server minimum) on pause", async () => {
    const server = new FakeServer();
    server.addContract();
    const dev = await booted(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT);
    await dev.checkpoint({ generation: 1, parent: 0 });
    await dev.advance(1000);
    await dev.checkpoint({ generation: 2, parent: 1, reason: "pause" });
    await dev.advance(10_000);
    expect(server.uploads).toHaveLength(1);
    await dev.advance(12_000);
    expect(server.uploads).toHaveLength(2);
  });
});

describe("offline tolerance and backoff", () => {
  it("holds the queue offline, backs off 30 s then doubles, and syncs when the server returns", async () => {
    const server = new FakeServer();
    server.addContract();
    server.mode = "offline";
    const dev = await booted(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT);
    await dev.checkpoint({ generation: 1, parent: 0, chunks: A });
    await dev.advance(1000);
    expect(dev.ui.state).toBe("offline");
    const failed = () =>
      dev.log
        .filter((l) => l.name === "save.upload_failed")
        .map((l) => l.payload as { kind: string; retryAtMs: number | null });
    expect(failed()).toHaveLength(1);
    const firstRetry = (failed()[0]?.retryAtMs ?? 0) - dev.clock.now;
    expect(firstRetry).toBeGreaterThan(25_000);
    expect(firstRetry).toBeLessThanOrEqual(30_000);

    await dev.advance(31_000);
    expect(failed()).toHaveLength(2);
    const secondRetry = (failed()[1]?.retryAtMs ?? 0) - dev.clock.now;
    expect(secondRetry).toBeGreaterThan(55_000); // doubled

    // Play continues: more local checkpoints replace the pending one; nothing is lost.
    await dev.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 1, fill: 5 }] });
    expect(dev.ui.state).toBe("offline");
    server.mode = "ok";
    await dev.advance(secondRetry + 1000);
    expect(server.uploads).toHaveLength(1);
    expect(server.uploads[0]).toMatchObject({ generation: 2, baseGeneration: 0 });
    expect(dev.ui.state).toBe("synced");
  });

  it("treats Render's waking page (503 html) as offline, not an error", async () => {
    const server = new FakeServer();
    server.addContract();
    server.mode = "asleep";
    const dev = await booted(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT);
    await dev.checkpoint({ generation: 1, parent: 0 });
    await dev.advance(1000);
    expect(dev.ui.state).toBe("offline");
    expect(dev.ui.error?.kind).toBe("offline");
  });

  it("retries immediately when the browser comes back online", async () => {
    const server = new FakeServer();
    server.addContract();
    const dev = await booted(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT);
    dev.online = false;
    await dev.checkpoint({ generation: 1, parent: 0 });
    await dev.advance(UPLOAD_INTERVAL_MS * 2);
    expect(server.uploads).toHaveLength(0);
    dev.online = true;
    await dev.advance(1000);
    expect(server.uploads).toHaveLength(1);
  });

  it("stops retrying after a hard rejection until the next checkpoint", async () => {
    const server = new FakeServer();
    server.addContract();
    const dev = await booted(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT);
    // A package above one request (1 MiB) cannot be uploaded: reported as too_large, not retried.
    await dev.checkpoint({
      generation: 1,
      parent: 0,
      chunks: [0, 1, 2, 3].map((id) => ({ id, fill: id + 1, size: 400_000, random: true })),
    });
    for (let i = 0; i < 10 && dev.ui.state !== "error"; i++) await dev.advance(500); // 1.6 MB of random chunks is slow to read
    expect(dev.ui).toMatchObject({ state: "error", error: { kind: "too_large" } });
    const calls = server.requests.length;
    await dev.advance(UPLOAD_INTERVAL_MS * 3);
    expect(server.requests.length).toBe(calls);
  });
});

describe("head check, restore and conflicts", () => {
  async function twoDevices() {
    const server = new FakeServer();
    server.addContract();
    const a = makeDevice(server);
    a.gate.markInteracted();
    await a.sync.attach(CONTRACT);
    await a.checkpoint({ generation: 1, parent: 0, chunks: A });
    await a.advance(1000);
    expect(server.uploads).toHaveLength(1);
    return { server, a };
  }

  it("restores a Contract on a second device (new browser) with verified chunks", async () => {
    const { server, a } = await twoDevices();
    void a;
    const b = makeDevice(server);
    const result = await b.sync.clockIn(CONTRACT, { maxWaitMs: Infinity });
    expect(result).toEqual({ kind: "restored", generation: 1 });
    expect(b.installs).toEqual([{ source: "server", generation: 1, dust: true }]);
    const rec = await b.store.load(CONTRACT as never);
    expect(rec?.generation).toBe(1);
    const rows = await b.store.loadDustChunks(CONTRACT as never);
    expect(rows.map((r) => r.chunkId)).toEqual([1, 2]);
    expect(rows.every((r) => r.generation === 1)).toBe(true);
    expect(b.ui).toMatchObject({ state: "synced", serverGeneration: 1 });
    expect(b.names()).toContain("save.restored");
    // The restored header is byte-identical to what device A uploaded.
    const sa = server.saveOf();
    expect(crc32(new Uint8Array(rec?.bytes as ArrayBuffer))).toBe(crc32(sa?.header as Uint8Array));
  });

  it("restores a multi-page save", async () => {
    const server = new FakeServer();
    server.addContract();
    // Seed the server directly with ~1.2 MB of incompressible chunks (three 400 KB chunks: two pages).
    const a = makeDevice(server);
    a.gate.markInteracted();
    await a.sync.attach(CONTRACT);
    await a.checkpoint({
      generation: 1,
      parent: 0,
      chunks: [
        { id: 0, fill: 1, size: 400_000, random: true },
        { id: 1, fill: 2, size: 400_000, random: true },
      ],
    });
    await a.advance(1000);
    await a.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 2, fill: 3, size: 400_000, random: true }] });
    await a.advance(UPLOAD_INTERVAL_MS + 1000);
    expect(server.uploads).toHaveLength(2);
    const b = makeDevice(server);
    expect(await b.sync.clockIn(CONTRACT, { maxWaitMs: Infinity })).toEqual({ kind: "restored", generation: 2 });
    expect((await b.store.loadDustChunks(CONTRACT as never)).map((r) => r.chunkId)).toEqual([0, 1, 2]);
    expect(server.requests.filter((r) => r.includes("/save") && !r.includes("head")).length).toBeGreaterThanOrEqual(2);
  });

  it("silently fast-forwards down when the server descends from the local copy", async () => {
    const { server, a } = await twoDevices();
    const b = makeDevice(server);
    expect((await b.sync.clockIn(CONTRACT, { maxWaitMs: Infinity })).kind).toBe("restored");
    // A moves on; B (clean, behind) clocks in again on a fresh session.
    await a.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 1, fill: 8 }] });
    await a.advance(UPLOAD_INTERVAL_MS + 1000);
    expect(server.saveOf()?.generation).toBe(2);
    expect(await b.sync.clockIn(CONTRACT, { maxWaitMs: Infinity })).toEqual({ kind: "restored", generation: 2 });
    expect(b.ui.state).toBe("synced");
    expect(b.log.some((l) => l.name === "save.conflict")).toBe(false);
  });

  it("detects a two-device divergence on upload and never overwrites silently", async () => {
    const { server, a } = await twoDevices();
    const b = makeDevice(server);
    b.gate.markInteracted();
    await b.sync.clockIn(CONTRACT, { maxWaitMs: Infinity });
    // Both play on from generation 1.
    await a.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 1, fill: 11 }] });
    await a.advance(UPLOAD_INTERVAL_MS + 1000);
    expect(server.saveOf()?.generation).toBe(2);
    b.summary.walletLumens = 777;
    await b.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 2, fill: 22 }] });
    await b.advance(UPLOAD_INTERVAL_MS + 1000);
    expect(b.ui.state).toBe("conflict");
    expect(b.ui.conflict?.local.walletLumens).toBe(777);
    expect(b.ui.conflict?.server.generation).toBe(2);
    expect(server.uploads).toHaveLength(2); // B's upload was refused
    // Uploads pause during the conflict, local checkpoints continue.
    await b.checkpoint({ generation: 3, parent: 2, chunks: [{ id: 2, fill: 23 }] });
    await b.advance(UPLOAD_INTERVAL_MS * 2);
    expect(server.uploads).toHaveLength(2);
    expect(b.ui.conflict?.local.generation).toBe(3);
    expect(b.names()).toContain("save.conflict");
  });

  it("keep_local: backs up the server copy, overwrites with max+1 and rebases the local store", async () => {
    const { server, a } = await twoDevices();
    const b = makeDevice(server);
    b.gate.markInteracted();
    await b.sync.clockIn(CONTRACT, { maxWaitMs: Infinity });
    await a.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 1, fill: 11 }] });
    await a.advance(UPLOAD_INTERVAL_MS + 1000);
    await b.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 2, fill: 22 }] });
    await b.advance(UPLOAD_INTERVAL_MS + 1000);
    expect(b.ui.state).toBe("conflict");

    const result = await b.sync.resolveConflict("keep_local");
    expect(result).toEqual({ kind: "resolved", generation: 3 });
    expect(server.uploads.at(-1)).toMatchObject({ generation: 3, baseGeneration: 2, overwrite: true });
    // An overwrite carries every local chunk, not only the dirty ones.
    expect(server.uploads.at(-1)?.chunkIds).toEqual([1, 2]);
    expect(server.saveOf()?.generation).toBe(3);
    expect(b.ui).toMatchObject({ state: "synced", conflict: null, backupAvailable: true, serverGeneration: 3 });
    expect(b.installs.at(-1)).toEqual({ source: "server", generation: 3, dust: false });
    expect((await b.store.load(CONTRACT as never))?.generation).toBe(3);
    expect(b.names()).toEqual(expect.arrayContaining(["save.backup_stored", "save.resolved"]));
  });

  it("use_server: backs up the local copy, installs the server copy, and restore_backup swaps back as a new generation", async () => {
    const { server, a } = await twoDevices();
    const b = makeDevice(server);
    b.gate.markInteracted();
    await b.sync.clockIn(CONTRACT, { maxWaitMs: Infinity });
    await a.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 1, fill: 11 }] });
    await a.advance(UPLOAD_INTERVAL_MS + 1000);
    await b.checkpoint({ generation: 2, parent: 1, chunks: [{ id: 2, fill: 22 }] });
    await b.advance(UPLOAD_INTERVAL_MS + 1000);
    expect(b.ui.state).toBe("conflict");

    expect(await b.sync.resolveConflict("use_server")).toEqual({ kind: "resolved", generation: 2 });
    expect(b.ui).toMatchObject({ state: "synced", conflict: null, backupAvailable: true, serverGeneration: 2 });
    expect(b.installs.at(-1)).toEqual({ source: "server", generation: 2, dust: true });
    expect((await b.store.loadDustChunks(CONTRACT as never)).map((r) => r.chunkId)).toEqual([1, 2]);

    // Settings: restore the backup (B's own chunk 2 fill 22) as generation 3 on top of generation 2.
    expect(await b.sync.restoreBackup()).toEqual({ kind: "resolved", generation: 3 });
    expect(b.installs.at(-1)).toMatchObject({ source: "backup", generation: 3 });
    expect((await b.store.load(CONTRACT as never))?.generation).toBe(3);
    expect(b.ui.state).toBe("pending");
    expect(b.ui.backupAvailable).toBe(true); // the replaced copy took the slot
    await b.advance(UPLOAD_INTERVAL_MS + 1000);
    expect(server.saveOf()?.generation).toBe(3);
  });

  it("handleRequest consumes and clears the UI request", async () => {
    const server = new FakeServer();
    server.addContract();
    const dev = makeDevice(server);
    await dev.sync.attach(CONTRACT);
    await dev.sync.handleRequest({ kind: "restore_backup" });
    expect(dev.ui.request).toBeNull();
  });
});

describe("local-only Contracts", () => {
  it("registers with clientContractId before the first upload", async () => {
    const server = new FakeServer(); // the Contract is unknown to the server
    const dev = makeDevice(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT, { name: "Mare Test", seed: "12345" });
    await dev.checkpoint({ generation: 1, parent: 0, chunks: A });
    await dev.advance(1000);
    expect(server.requests[0]).toBe("POST /v1/contracts");
    expect(server.uploads).toHaveLength(1);
    expect(dev.ui.state).toBe("synced");
  });

  it("stays local-only when the Contract quota is used up", async () => {
    const server = new FakeServer();
    server.quota = 0;
    const dev = makeDevice(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT, { name: "Mare Test", seed: "12345" });
    await dev.checkpoint({ generation: 1, parent: 0 });
    await dev.advance(1000);
    expect(dev.ui.state).toBe("local_only");
    expect(dev.ui.error?.kind).toBe("rejected");
    expect(server.uploads).toHaveLength(0);
    await dev.advance(UPLOAD_INTERVAL_MS * 3);
    expect(server.requests.filter((r) => r === "POST /v1/contracts")).toHaveLength(1);
  });
});

describe("clock in and flush", () => {
  it("returns `background` when the server does not answer in time and later prompts instead of swapping silently", async () => {
    const server = new FakeServer();
    server.addContract();
    // Device A put generation 5 on the server.
    const a = makeDevice(server);
    a.gate.markInteracted();
    await a.sync.attach(CONTRACT);
    await a.checkpoint({ generation: 5, parent: 4, chunks: A });
    await a.advance(1000);
    // Device B has an older clean copy and a server that is asleep at Clock In.
    const b = makeDevice(server);
    await b.checkpoint({ generation: 1, parent: 0 });
    server.mode = "asleep";
    const first = await b.sync.clockIn(CONTRACT, { maxWaitMs: 3000 });
    expect(first.kind).toBe("offline");
    server.mode = "ok";
    await b.advance(120_000);
    // The host already runs on the local copy: a newer server copy is a prompt, not a silent swap.
    expect(b.ui.state).toBe("conflict");
    expect(b.installs).toHaveLength(0);
  });

  it("flush uploads the newest checkpoint and reports accepted (open to friends needs it)", async () => {
    const server = new FakeServer();
    server.addContract();
    const dev = makeDevice(server);
    await dev.sync.attach(CONTRACT);
    await dev.checkpoint({ generation: 1, parent: 0, chunks: A, reason: "handoff" });
    const done = dev.sync.flush(CONTRACT, "handoff");
    await dev.advance(25_000);
    expect(await done).toEqual({ kind: "accepted", generation: 1 });
    expect(await dev.sync.flush(CONTRACT, "pause")).toEqual({ kind: "nothing_pending" });
  });

  it("flush reports a conflict instead of uploading over a diverged server copy", async () => {
    const server = new FakeServer();
    server.addContract();
    const a = makeDevice(server);
    a.gate.markInteracted();
    await a.sync.attach(CONTRACT);
    await a.checkpoint({ generation: 1, parent: 0, chunks: A });
    await a.advance(1000);
    const b = makeDevice(server);
    await b.checkpoint({ generation: 1, parent: 0, chunks: [{ id: 9, fill: 9 }] });
    b.gate.markInteracted();
    await b.sync.attach(CONTRACT);
    await b.checkpoint({ generation: 2, parent: 1, reason: "handoff" });
    const done = b.sync.flush(CONTRACT, "handoff");
    await b.advance(1000);
    expect(await done).toEqual({ kind: "conflict" });
    expect(b.ui.state).toBe("conflict");
  });

  it("never blocks on the network from the checkpoint event (no awaited work in the listener)", async () => {
    const server = new FakeServer();
    server.addContract();
    server.mode = "offline";
    const dev = makeDevice(server);
    dev.gate.markInteracted();
    await dev.sync.attach(CONTRACT);
    await dev.checkpoint({ generation: 1, parent: 0 });
    const before = server.requests.length;
    // emit() returns synchronously and the request count has not moved in the same tick.
    dev.events.emit("save.checkpointed", {
      contractId: CONTRACT as never,
      atMs: dev.clock.now,
      generation: 2,
      parentGeneration: 1,
      simTick: 400,
      reason: "timer",
      bytes: 1,
    });
    expect(server.requests.length).toBe(before);
  });
});
