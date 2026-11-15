// Checkpoint sync hooks of the composition root (M1-W5-T08): install port order (stop without a final checkpoint ->
// one store write -> boot again, also after a failed write), summary from the UI store, request hand-off, save events
// onto the bus, and the sim-host store rows carrying the payload CRC the sync uses.
import {
  CreateContractRequestSchema,
  type ContractId,
  type SaveEventMap,
  type UiSaveSyncRequest,
} from "@moon-cleanup/shared";
import { FakeServer, makeDevice } from "../sync/test-support";
import { describe, expect, it, vi } from "vitest";
import { MemoryCheckpointStore } from "../sim-host";
import { createEventBus } from "./event-bus";
import {
  bindSaveSyncRequests,
  createLocalInstallPort,
  createSummaryProvider,
  deviceLabelOf,
  saveEventForwarder,
  signInUntilReady,
  soloRegistration,
  SIGN_IN_RETRY_MAX_MS,
  SIGN_IN_RETRY_MIN_MS,
  storeReader,
} from "./save-sync-wiring";
import { createUiStore } from "./ui-store";

const CONTRACT = "0190a5b4-1111-4222-8333-444455556666";
const record = {
  contractId: CONTRACT,
  generation: 7,
  parentGeneration: 6,
  simTick: 1200,
  savedAtMs: 1,
  codec: "gzip" as const,
  bytes: new Uint8Array([1, 2, 3]).buffer,
};
const chunk = {
  chunkId: 3,
  generation: 7,
  codec: "deflate" as const,
  rawSize: 9,
  bytes: new ArrayBuffer(4),
  crc32: 77,
};

describe("LocalInstallPort", () => {
  it("stops the host, writes header and dust in one save, then boots a new host that reads the copy", async () => {
    const store = new MemoryCheckpointStore();
    const order: string[] = [];
    const save = vi.spyOn(store, "save");
    const port = createLocalInstallPort({
      store: () => Promise.resolve(store),
      stopHost: () => {
        order.push("stop");
        return Promise.resolve();
      },
      startHost: () => order.push("start"),
    });
    await port.install({ contractId: CONTRACT, record, dust: { replaceAll: true, chunks: [chunk] }, source: "server" });
    expect(order).toEqual(["stop", "start"]);
    expect(save).toHaveBeenCalledTimes(1);
    const reader = storeReader(() => Promise.resolve(store));
    expect((await reader.load(CONTRACT))?.generation).toBe(7);
    expect((await reader.loadDustChunks(CONTRACT)).map((c) => [c.chunkId, c.crc32])).toEqual([[3, 77]]);

    // A rebase (dust null) writes the header only: the dust rows stay.
    await port.install({ contractId: CONTRACT, record: { ...record, generation: 8 }, dust: null, source: "rebase" });
    expect((await store.load(CONTRACT as ContractId))?.generation).toBe(8);
    expect(await store.loadDustChunks(CONTRACT as ContractId)).toHaveLength(1);
  });

  it("boots the host again when the write fails, and rejects", async () => {
    const order: string[] = [];
    const port = createLocalInstallPort({
      store: () => Promise.resolve({ save: () => Promise.reject(new Error("quota")) }),
      stopHost: () => Promise.resolve(void order.push("stop")),
      startHost: () => order.push("start"),
    });
    await expect(port.install({ contractId: CONTRACT, record, dust: null, source: "server" })).rejects.toThrow("quota");
    expect(order).toEqual(["stop", "start"]);
  });
});

describe("summary, requests and events", () => {
  it("summary: playtime from the tick, wallet and Shine from the UI store", () => {
    const store = createUiStore(1000, () => 0);
    const s = createSummaryProvider(store, 20, "Windows PC").snapshot({
      contractId: CONTRACT,
      generation: 1,
      simTick: 1210,
    });
    expect(s.playtimeS).toBe(60);
    expect(s.shinePolished).toBe(store.getState().shine.polished);
    expect(s.walletLumens).toBe(store.getState().wallet.lm);
    expect(s.deviceLabel).toBe("Windows PC");
    expect(deviceLabelOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
    expect(deviceLabelOf("Mozilla/5.0 (Linux; Android 14)")).toBe("Android");
  });

  it("a saveSync request is handed to the controller once and cleared", async () => {
    const store = createUiStore(1000, () => 0);
    store.dispatch({
      type: "saveSync.set",
      patch: { state: "conflict", conflict: { local: {} as never, server: {} as never } },
    });
    store.flush(0);
    const handled: UiSaveSyncRequest[] = [];
    const off = bindSaveSyncRequests(
      store,
      { handleRequest: (r) => Promise.resolve(void handled.push(r)) },
      () => undefined,
    );
    store.dispatch({ type: "saveSync.resolveConflict", choice: "use_server" });
    store.flush(100);
    store.dispatch({ type: "saveSync.set", patch: { state: "uploading" } });
    store.flush(200);
    await Promise.resolve();
    expect(handled).toEqual([{ kind: "resolve_conflict", choice: "use_server" }]);
    expect(store.getState().saveSync.request).toBeNull();
    off();
  });

  it("host save events reach the app bus", () => {
    const bus = createEventBus({ onListenerError: () => undefined });
    const seen: SaveEventMap["save.checkpointed"][] = [];
    bus.on("save.checkpointed", (e) => seen.push(e));
    const payload: SaveEventMap["save.checkpointed"] = {
      contractId: CONTRACT as ContractId,
      atMs: 1,
      generation: 2,
      parentGeneration: 1,
      simTick: 40 as never,
      reason: "timer",
      bytes: 10,
    };
    saveEventForwarder(bus)("save.checkpointed", payload);
    expect(seen).toEqual([payload]);
  });
});

describe("signInUntilReady", () => {
  function rig(answers: (boolean | Error)[]) {
    const timers: { fn: () => void; ms: number }[] = [];
    const notified: number[] = [];
    const problems: string[] = [];
    let calls = 0;
    const stop = signInUntilReady({
      signIn: () => {
        const a = answers[Math.min(calls++, answers.length - 1)] as boolean | Error;
        return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
      },
      notify: () => notified.push(calls),
      onProblem: (s) => problems.push(s),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
    });
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    return { stop, timers, notified, problems, settle, calls: () => calls };
  }

  it("notifies once as soon as the first sign-in succeeds", async () => {
    const r = rig([true]);
    await r.settle();
    expect(r.notified).toEqual([1]);
    expect(r.timers).toHaveLength(0);
  });

  it("retries a failed sign-in with a doubling delay, then notifies", async () => {
    const r = rig([false, false, false, true]);
    await r.settle();
    expect(r.timers.map((t) => t.ms)).toEqual([SIGN_IN_RETRY_MIN_MS]);
    r.timers.shift()?.fn();
    await r.settle();
    expect(r.timers.map((t) => t.ms)).toEqual([SIGN_IN_RETRY_MIN_MS * 2]);
    r.timers.shift()?.fn();
    await r.settle();
    expect(r.timers.map((t) => t.ms)).toEqual([Math.min(SIGN_IN_RETRY_MIN_MS * 4, SIGN_IN_RETRY_MAX_MS)]);
    r.timers.shift()?.fn();
    await r.settle();
    expect(r.notified).toEqual([4]);
    expect(r.timers).toHaveLength(0);
  });

  it("reports a thrown sign-in, keeps retrying slowly, and stops on dispose", async () => {
    const r = rig([new Error("boom"), true]);
    await r.settle();
    expect(r.problems).toEqual(["guest sign-in"]);
    expect(r.timers).toHaveLength(1);
    r.stop();
    r.timers.shift()?.fn();
    await r.settle();
    expect(r.notified).toEqual([]); // stopped: a late success does not notify
  });
});

describe("soloRegistration", () => {
  it("builds a body the server create route accepts, with a stable in-range seed", () => {
    const reg = soloRegistration(CONTRACT);
    const body = CreateContractRequestSchema.parse({
      name: reg.name,
      shiftType: "solo",
      clientContractId: CONTRACT,
      seed: reg.seed,
    });
    expect(body.shiftType).toBe("solo");
    expect(BigInt(reg.seed)).toBeLessThan(1n << 64n); // the server's SEED_MAX is 2^64 - 1
    expect(soloRegistration(CONTRACT)).toEqual(reg);
    expect(soloRegistration("0190a5b4-1111-4222-8333-ffffffffffff").seed).toBe(BigInt("0x8333ffffffffffff").toString());
    expect(
      CreateContractRequestSchema.safeParse({
        name: "x",
        clientContractId: CONTRACT,
        seed: soloRegistration("zz").seed,
      }).success,
    ).toBe(false);
  });

  it("registers an unseen Contract on Clock In, then uploads the first checkpoint (and again is idempotent)", async () => {
    const server = new FakeServer(); // no contract on the server
    const dev = makeDevice(server);
    await dev.checkpoint({ generation: 1, parent: 0 });
    const reg = soloRegistration(CONTRACT);
    await dev.sync.clockIn(CONTRACT, { registration: reg, maxWaitMs: Infinity });
    await dev.advance(1000);
    expect(server.requests[0]).toBe("POST /v1/contracts");
    expect(server.uploads).toHaveLength(1);
    expect(dev.ui.state).toBe("synced");
    // A second boot passes the registration again: nothing breaks, no second row.
    const again = makeDevice(server);
    await again.sync.clockIn(CONTRACT, { registration: reg, maxWaitMs: Infinity });
    expect(server.contracts.size).toBe(1);
  });

  it("without a registration an unseen Contract cannot upload (the gap the helper closes)", async () => {
    const server = new FakeServer();
    const dev = makeDevice(server);
    await dev.checkpoint({ generation: 1, parent: 0 });
    await dev.sync.clockIn(CONTRACT, { maxWaitMs: Infinity });
    await dev.advance(1000);
    expect(server.uploads).toHaveLength(0);
  });
});
