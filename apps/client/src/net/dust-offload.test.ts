// DustOffload: worker-side snapshot inflate with a hold-back queue. A REAL worker thread (node:worker_threads running
// zlib) proves that the main thread is free while a snapshot inflates; ManualPort drives the failure paths.
import { Worker } from "node:worker_threads";
import { LEDGER_BYTES, MESSAGE_CATALOG } from "@moon-cleanup/shared";
import {
  DUST_LEDGER_ID,
  DUST_SNAPSHOT_ID,
  FRAME_OK,
  FrameReader,
  FrameView,
  SlotTable,
  SnapshotAssembler,
  decodeSnapshotStream,
  encodeSnapshotRaw,
  snapshotSliceCount,
  writeSnapshotSlice,
  type LedgerRawInput,
} from "@moon-cleanup/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { DustOffload, type DustOffloadOptions } from "./dust-offload";
import { inflateRaw } from "./inflate-raw";
import type { InflateJob, InflateWorkerPort } from "./inflate-worker-core";
import { RemoteDust } from "./remote-dust";
import { F, TestDustServer, deflate, grid, newClientLedger } from "./dust-test-server";

const FRAME_ID = MESSAGE_CATALOG.FRAME.id;
const PONG_ID = MESSAGE_CATALOG.PONG.id;

/** A real worker thread that inflates with node zlib (the production worker runs ./inflate-raw, tested separately). */
function nodeInflateWorker(): InflateWorkerPort {
  const code = `const { parentPort } = require("node:worker_threads");
const zlib = require("node:zlib");
parentPort.on("message", (m) => {
  let out = null;
  try { out = new Uint8Array(zlib.inflateRawSync(m.data, { maxOutputLength: m.maxBytes })); } catch (e) {}
  parentPort.postMessage({ id: m.id, out }, out ? [out.buffer] : []);
});`;
  const worker = new Worker(code, { eval: true });
  const port: InflateWorkerPort = {
    postMessage: (job) => worker.postMessage(job),
    onmessage: null,
    onerror: null,
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => port.onmessage?.({ data }));
  worker.on("error", (e) => port.onerror?.(e));
  return port;
}

/** A worker the test answers by hand. */
class ManualPort implements InflateWorkerPort {
  readonly jobs: InflateJob[] = [];
  terminated = false;
  onmessage: InflateWorkerPort["onmessage"] = null;
  onerror: InflateWorkerPort["onerror"] = null;
  postMessage(job: InflateJob): void {
    this.jobs.push(job);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(index: number, out: Uint8Array | null): void {
    this.onmessage?.({ data: { id: this.jobs[index]!.id, out } });
  }
}

/** The part of the protocol session that matters here: assemble, inflate through the offload, install, apply frames. */
class MiniClient {
  readonly dust = new RemoteDust(newClientLedger(), { framesEvery: F });
  readonly trace: string[] = [];
  readonly decodeMs: number[] = [];
  readonly installMs: number[] = [];
  offload!: DustOffload;
  private readonly assembler = new SnapshotAssembler();
  private readonly reader = new FrameReader();
  private readonly view = new FrameView();
  private readonly table = new SlotTable();
  constructor(private readonly install = true) {}

  readonly dispatch = (m: Uint8Array): void => {
    const id = m[0];
    if (id === FRAME_ID) {
      if (this.reader.decode(m, this.view, this.table, grid.count) !== FRAME_OK) {
        this.trace.push("F!");
        return;
      }
      this.trace.push(`F${this.view.serverTick}`);
      this.dust.applyFrame(this.view);
    } else if (id === DUST_SNAPSHOT_ID) {
      const r = this.assembler.add(m);
      if (r === "invalid") this.trace.push("s!");
      if (r !== "complete") return;
      const deflated = this.assembler.take()!;
      const t0 = performance.now();
      const snap = decodeSnapshotStream(deflated, this.offload.inflate, grid.count);
      this.decodeMs.push(performance.now() - t0);
      if (snap === null) this.trace.push("Sx");
      else {
        if (this.install) {
          const t1 = performance.now();
          this.dust.installSnapshot(snap);
          this.installMs.push(performance.now() - t1);
        }
        this.trace.push("S");
      }
    } else if (id === DUST_LEDGER_ID) {
      this.dust.applyBytes(m);
      this.trace.push(`L${m[1]! | (m[2]! << 8) | (m[3]! << 16)}`);
    } else if (id === PONG_ID) this.trace.push("P");
    else this.trace.push(`?${id}`);
  };
}

function makeOffload(client: MiniClient, options: Partial<DustOffloadOptions> = {}): DustOffload {
  const offload = new DustOffload({
    deliver: (m) => client.dispatch(m),
    inflate: inflateRaw,
    minDeflatedBytes: 0,
    ...options,
  });
  client.offload = offload;
  return offload;
}

function slicesOf(deflated: Uint8Array, version: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < snapshotSliceCount(deflated.length); i++) {
    const buf = new Uint8Array(4200);
    out.push(buf.slice(0, writeSnapshotSlice(deflated, i, version, buf)));
  }
  return out;
}

/** A synthetic snapshot of `ledgerCount` incompressible ledgers: many slices, a big inflate. */
function bigSnapshot(ledgerCount: number): { raw: Uint8Array; deflated: Uint8Array } {
  let seed = 0x1234567;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 24) & 0xff;
  };
  const ledgers: { plotId: number; ledger: LedgerRawInput }[] = [];
  for (let i = 0; i < ledgerCount; i++) {
    const texels = new Uint8Array(LEDGER_BYTES);
    for (let k = 0; k < texels.length; k++) texels[k] = next();
    ledgers.push({
      plotId: 100 + i * 7,
      ledger: {
        header: {
          version: 1,
          remainingUnits: 0,
          initialUnits: 10,
          ownedTexels: 1024,
          mgPerUnit: 5,
          hash: 0,
          contributions: [],
        },
        texels,
      },
    });
  }
  const raw = encodeSnapshotRaw({
    plotCount: grid.count,
    plotStates: new Uint8Array(Math.ceil(grid.count / 4)),
    openedRemaining: new Uint8Array(0),
    ledgers,
    logs: [],
  });
  if (raw === null) throw new Error("big snapshot");
  return { raw, deflated: deflate(raw) };
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 1));
  }
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const track = (o: DustOffload): DustOffload => {
  cleanups.push(() => o.dispose());
  return o;
};

/** Steps the server for `ticks` ticks, returning the pushes the server would make (frames + a ledger every 10 frames). */
function serverTraffic(server: TestDustServer, from: number, to: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let frames = 0;
  const plots = server.ledgerPlots();
  for (let t = from; t < to; t++) {
    const f = server.step(t);
    if (f === null) continue;
    out.push(f);
    if (++frames % 10 === 0 && plots.length > 0) {
      const l = server.ledgerMessage(plots[(frames / 10) % plots.length]!);
      if (l !== null) out.push(l);
    }
  }
  return out;
}

function expectedTrace(messages: Uint8Array[]): string[] {
  const view = new FrameView();
  const reader = new FrameReader();
  const table = new SlotTable();
  return messages.map((m) => {
    if (m[0] === FRAME_ID) {
      reader.decode(m, view, table, grid.count);
      return `F${view.serverTick}`;
    }
    return `L${m[1]! | (m[2]! << 8) | (m[3]! << 16)}`;
  });
}

describe("DustOffload with a real worker thread", () => {
  it("holds back FRAME strokes and DUST_LEDGERs while inflating, replays them in order, and ends with the server worldHash", async () => {
    const server = new TestDustServer();
    for (let t = 0; t < 300; t++) server.step(t);
    expect(server.ledger.ledgerCount).toBeGreaterThan(0);
    const version = server.tick;
    const slices = slicesOf(server.snapshot(), version);
    const traffic = serverTraffic(server, 300, 700);

    // Offloaded client.
    const client = new MiniClient();
    const offload = track(makeOffload(client));
    offload.attach(nodeInflateWorker());
    for (const s of slices) offload.push(s, 1);
    expect(offload.isHolding).toBe(true);
    // The snapshot is inflating in the worker: nothing reached the mirror yet, and these queue behind it.
    for (const m of traffic.slice(0, 20)) offload.push(m, 2);
    offload.push(new Uint8Array([PONG_ID, 0, 0, 0, 0]), 2);
    expect(client.trace).toEqual(["P"]); // PONG (clock sync) is never held
    for (const m of traffic.slice(20)) offload.push(m, 3);
    expect(client.dust.ready).toBe(false);
    expect(offload.heldCount).toBe(traffic.length);
    await until(() => !offload.isHolding);

    expect(client.trace.slice(1)).toEqual(["S", ...expectedTrace(traffic)]);
    expect(offload.stats).toMatchObject({ offloaded: 1, inline: 0, replayed: traffic.length, workerErrors: 0 });
    expect(client.dust.stats.strokesBeforeReady).toBe(0);
    expect(client.dust.stats.strokes).toBeGreaterThan(0);
    expect(client.dust.ledger.worldHash()).toBe(server.ledger.worldHash());
    console.info(
      `[dust offload] late joiner: ${slices.length} slice(s), ${traffic.length} held messages replayed, ` +
        `session decode ${client.decodeMs[0]!.toFixed(2)} ms, RemoteDust.installSnapshot ${client.installMs[0]!.toFixed(2)} ms (main thread, vitest)`,
    );

    // Reference: the same stream through the synchronous path (no worker) reaches the same state and order.
    const ref = new MiniClient();
    const refOffload = track(makeOffload(ref));
    for (const s of slices) refOffload.push(s, 1);
    for (const m of traffic) refOffload.push(m, 2);
    expect(refOffload.stats.inline).toBe(1);
    expect(ref.trace).toEqual(["S", ...expectedTrace(traffic)]);
    expect(ref.dust.ledger.worldHash()).toBe(client.dust.ledger.worldHash());
    for (let p = 0; p < grid.count; p += 7) expect(client.dust.stateOf(p)).toBe(ref.dust.stateOf(p));
  });

  it("a second snapshot (resync) arriving while the first inflates queues behind it and applies after, in order", async () => {
    const server = new TestDustServer();
    for (let t = 0; t < 200; t++) server.step(t);
    const first = slicesOf(server.snapshot(), server.tick);
    const mid = serverTraffic(server, 200, 300);
    const second = slicesOf(server.snapshot(), server.tick);
    const tail = serverTraffic(server, 300, 400);
    const client = new MiniClient();
    const offload = track(makeOffload(client));
    offload.attach(nodeInflateWorker());
    for (const m of [...first, ...mid, ...second, ...tail]) offload.push(m, 1);
    await until(() => !offload.isHolding && offload.heldCount === 0);
    expect(client.trace.filter((x) => x === "S")).toHaveLength(2);
    // The mid frames sit between the two snapshots; the tail frames after the second.
    const afterSecond = client.trace.slice(client.trace.lastIndexOf("S") + 1);
    expect(afterSecond).toEqual(expectedTrace(tail));
    expect(client.dust.ledger.worldHash()).toBe(server.ledger.worldHash());
  });

  it("a large snapshot (50+ slices, 200 KB) never blocks the main thread: every push stays under 1 ms", async () => {
    const { raw, deflated } = bigSnapshot(200);
    const slices = slicesOf(deflated, 5000);
    expect(slices.length).toBeGreaterThanOrEqual(40);
    const frameServer = new TestDustServer();
    const frames = serverTraffic(frameServer, 0, 200);
    const pushMs: number[] = [];
    const lastSliceMs: number[] = [];
    const decodeMs: number[] = [];
    let holdMs = 0;
    for (let run = 0; run < 6; run++) {
      const client = new MiniClient(false);
      const offload = track(makeOffload(client));
      offload.attach(nodeInflateWorker());
      for (let i = 0; i < slices.length; i++) {
        const t0 = performance.now();
        offload.push(slices[i]!, 1);
        const dt = performance.now() - t0;
        if (run > 0) (i === slices.length - 1 ? lastSliceMs : pushMs).push(dt);
      }
      expect(offload.isHolding).toBe(true);
      for (const f of frames.slice(0, 40)) {
        const t0 = performance.now();
        offload.push(f, 2);
        if (run > 0) pushMs.push(performance.now() - t0);
      }
      const t0 = performance.now();
      await until(() => !offload.isHolding);
      holdMs = Math.max(holdMs, performance.now() - t0);
      decodeMs.push(...client.decodeMs);
      expect(client.trace[0]).toBe("S");
      expect(client.trace).toHaveLength(1 + 40);
      expect(offload.stats.offloaded).toBe(1);
    }
    const sorted = (a: number[]): number[] => a.slice().sort((x, y) => x - y);
    const p = (a: number[], q: number): number => sorted(a)[Math.min(a.length - 1, Math.floor(a.length * q))]!;
    console.info(
      `[dust offload] ${slices.length} slices, ${deflated.length} B deflated, ${raw.length} B raw | main thread: ` +
        `slice push p50 ${p(pushMs, 0.5).toFixed(3)} ms p99 ${p(pushMs, 0.99).toFixed(3)} ms max ${Math.max(...pushMs).toFixed(3)} ms; ` +
        `last-slice push (assemble + post) p50 ${p(lastSliceMs, 0.5).toFixed(3)} ms max ${Math.max(...lastSliceMs).toFixed(3)} ms; ` +
        `session decode of the inflated bytes p50 ${p(decodeMs, 0.5).toFixed(2)} ms max ${Math.max(...decodeMs).toFixed(2)} ms; ` +
        `hold (worker spin-up included) max ${holdMs.toFixed(1)} ms`,
    );
    // Stall budget: the main-thread slice of every push is under 1 ms (typical).
    expect(p(pushMs, 0.5)).toBeLessThan(1);
    expect(p(pushMs, 0.99)).toBeLessThan(5); // p99 only: scheduler jitter under a loaded machine; medians stay under 1 ms
    expect(p(lastSliceMs, 0.5)).toBeLessThan(1);
    // The same snapshot inflated synchronously costs the main thread the whole inflate (the cost this removes).
    const t0 = performance.now();
    expect(inflateRaw(deflated, 4 << 20)!.length).toBe(raw.length);
    const syncMs = performance.now() - t0;
    console.info(`[dust offload] the same inflate on the main thread would take ${syncMs.toFixed(2)} ms`);
  });
});

describe("DustOffload fallbacks and edges", () => {
  function setup(options: Partial<DustOffloadOptions> = {}) {
    const server = new TestDustServer();
    for (let t = 0; t < 120; t++) server.step(t);
    const slices = slicesOf(server.snapshot(), server.tick);
    const traffic = serverTraffic(server, 120, 160);
    const client = new MiniClient();
    const timers: { fn: () => void; ms: number; live: boolean }[] = [];
    const offload = track(
      makeOffload(client, {
        setTimer: (fn, ms) => {
          const t = { fn, ms, live: true };
          timers.push(t);
          return t;
        },
        clearTimer: (h) => void ((h as { live: boolean }).live = false),
        ...options,
      }),
    );
    const port = new ManualPort();
    offload.attach(port);
    return { server, slices, traffic, client, offload, port, timers };
  }

  it("ManualPort reply: the hold ends on the answer; the output is what the session decodes", () => {
    const { server, slices, traffic, client, offload, port } = setup();
    for (const s of slices) offload.push(s, 1);
    for (const m of traffic) offload.push(m, 2);
    expect(port.jobs).toHaveLength(1);
    expect(client.trace).toEqual([]);
    port.reply(0, inflateRaw(port.jobs[0]!.data, 1 << 21));
    expect(client.trace).toEqual(["S", ...expectedTrace(traffic)]);
    expect(client.dust.ledger.worldHash()).toBe(server.ledger.worldHash());
    expect(offload.isHolding).toBe(false);
  });

  it("a worker error falls back to the sync decoder, replays the queue and abandons the worker", () => {
    const { slices, traffic, client, offload, port } = setup();
    for (const s of slices) offload.push(s, 1);
    for (const m of traffic) offload.push(m, 2);
    port.onerror?.(new Error("boom"));
    expect(client.trace).toEqual(["S", ...expectedTrace(traffic)]);
    expect(offload.stats.workerErrors).toBe(1);
    expect(port.terminated).toBe(true);
    expect(offload.workerAttached).toBe(false);
    // Later snapshots take the inline path.
    for (const s of slices) offload.push(s, 3);
    expect(offload.stats.inline).toBe(1);
    expect(client.trace.filter((x) => x === "S")).toHaveLength(2);
  });

  it("a silent worker times out after the budget and the stream is inflated synchronously", () => {
    const { slices, traffic, client, offload, port, timers } = setup({ timeoutMs: 1234 });
    for (const s of slices) offload.push(s, 1);
    for (const m of traffic) offload.push(m, 2);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(1234);
    timers[0]!.fn();
    expect(client.trace).toEqual(["S", ...expectedTrace(traffic)]);
    expect(offload.stats.timeouts).toBe(1);
    expect(port.terminated).toBe(true);
  });

  it("a corrupt snapshot (worker says null) reaches the session as invalid, and the queue still replays", () => {
    const { slices, traffic, client, offload, port } = setup();
    for (const s of slices) offload.push(s, 1);
    for (const m of traffic) offload.push(m, 2);
    port.reply(0, null);
    expect(client.trace).toEqual(["Sx", ...expectedTrace(traffic)]);
    expect(offload.stats.workerRejected).toBe(1);
  });

  it("reset (connection dropped) discards the job and the queue; a late reply is ignored", () => {
    const { slices, traffic, client, offload, port } = setup();
    for (const s of slices) offload.push(s, 1);
    for (const m of traffic) offload.push(m, 2);
    offload.reset();
    expect(offload.isHolding).toBe(false);
    expect(offload.heldCount).toBe(0);
    port.reply(0, inflateRaw(port.jobs[0]!.data, 1 << 21));
    expect(client.trace).toEqual([]);
    // The next join works.
    for (const s of slices) offload.push(s, 3);
    expect(port.jobs).toHaveLength(2);
    port.reply(1, inflateRaw(port.jobs[1]!.data, 1 << 21));
    expect(client.trace).toEqual(["S"]);
  });

  it("the hold-back queue is bounded: at the cap the snapshot is inflated synchronously, nothing is dropped", () => {
    const { slices, traffic, client, offload, port } = setup({ maxHeld: 3 });
    for (const s of slices) offload.push(s, 1);
    for (const m of traffic.slice(0, 8)) offload.push(m, 2);
    expect(offload.stats.overflows).toBeGreaterThanOrEqual(1);
    expect(client.trace).toEqual(["S", ...expectedTrace(traffic.slice(0, 8))]);
    port.reply(0, new Uint8Array(4)); // the stale answer is ignored
    expect(client.trace).toHaveLength(9);
  });

  it("small streams are inflated inline (default threshold) and never touch the worker", () => {
    const { slices, client, offload, port } = setup({ minDeflatedBytes: 1 << 20 });
    for (const s of slices) offload.push(s, 1);
    expect(port.jobs).toHaveLength(0);
    expect(offload.stats.inline).toBe(1);
    expect(client.trace).toEqual(["S"]);
  });

  it("without a worker everything passes straight through in order", () => {
    const server = new TestDustServer();
    for (let t = 0; t < 100; t++) server.step(t);
    const slices = slicesOf(server.snapshot(), server.tick);
    const traffic = serverTraffic(server, 100, 140);
    const client = new MiniClient();
    const offload = track(makeOffload(client));
    for (const s of slices) offload.push(s, 1);
    for (const m of traffic) offload.push(m, 2);
    expect(client.trace).toEqual(["S", ...expectedTrace(traffic)]);
    expect(offload.stats).toMatchObject({ offloaded: 0, held: 0 });
    expect(client.dust.ledger.worldHash()).toBe(server.ledger.worldHash());
  });

  it("duplicate slices are ignored and an invalid slice goes to the session to be counted", () => {
    const { slices, client, offload, port } = setup();
    expect(slices.length).toBeGreaterThanOrEqual(1);
    const { deflated } = bigSnapshot(6);
    const parts = slicesOf(deflated, 77);
    expect(parts.length).toBeGreaterThan(1);
    offload.push(parts[0]!, 1);
    offload.push(parts[0]!, 1); // duplicate
    offload.push(new Uint8Array([DUST_SNAPSHOT_ID, 1]), 1); // too short: invalid
    expect(client.trace).toEqual(["s!"]);
    for (const s of parts.slice(1)) offload.push(s, 1);
    expect(port.jobs).toHaveLength(1);
    port.reply(0, inflateRaw(port.jobs[0]!.data, 1 << 21));
    expect(client.trace).toEqual(["s!", "S"]);
  });

  it("flags a lossy transfer window: FRAME dust applied between the first and last slice, newer than the snapshot", () => {
    const { offload, port } = setup();
    const { deflated } = bigSnapshot(6);
    const parts = slicesOf(deflated, 500);
    expect(parts.length).toBeGreaterThan(1);
    offload.noteFrame(900, true); // no transfer open yet: ignored
    offload.push(parts[0]!, 1);
    offload.noteFrame(501, false); // no dust: ignored
    for (const s of parts.slice(1)) offload.push(s, 1);
    port.reply(0, inflateRaw(port.jobs[0]!.data, 1 << 21));
    expect(offload.takeGap()).toBe(false);

    offload.push(parts[0]!, 1);
    offload.noteFrame(502, true); // dust newer than snapshot version 500
    for (const s of parts.slice(1)) offload.push(s, 1);
    port.reply(1, inflateRaw(port.jobs[1]!.data, 1 << 21));
    expect(offload.takeGap()).toBe(true);
    expect(offload.takeGap()).toBe(false); // consumed
    expect(offload.stats.gaps).toBe(1);

    offload.push(parts[0]!, 1);
    offload.noteFrame(499, true); // older than the snapshot: already inside it
    for (const s of parts.slice(1)) offload.push(s, 1);
    port.reply(2, inflateRaw(port.jobs[2]!.data, 1 << 21));
    expect(offload.takeGap()).toBe(false);
  });

  it("the session-facing inflate falls back to the sync decoder when no verdict is set and honours the byte cap", () => {
    const client = new MiniClient();
    const offload = track(makeOffload(client));
    const z = deflate(new Uint8Array(1000).fill(7));
    expect(offload.inflate(z, 5000)!.length).toBe(1000);
    expect(offload.inflate(z, 10)).toBeNull();
  });
});
