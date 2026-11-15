import { describe, expect, it, vi } from "vitest";
import type { RoomHost } from "@moon-cleanup/shared";
import type { SimWorkerLike } from "../sim-host";
import {
  SOLO_STORAGE_KEYS,
  createRoomHostService,
  loadSoloIdentity,
  startSoloHost,
  uuidv7,
  type KeyValueStore,
} from "./solo-host";

const fixedRandom = (bytes: Uint8Array<ArrayBuffer>): void => {
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
};

function memoryStore(): KeyValueStore & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

interface FakeWorker extends SimWorkerLike {
  readonly posted: unknown[];
  terminated: boolean;
}

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    posted: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      worker.posted.push(message);
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (done: () => boolean): Promise<void> => {
  // 25 s: the cold dynamic import of the sim-host chunk can take seconds when `pnpm verify` runs packages in parallel.
  for (let i = 0; i < 2500 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

describe("uuidv7", () => {
  it("is a version 7, variant 10 UUID carrying the timestamp", () => {
    const id = uuidv7(0x0123_4567_89ab, fixedRandom);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.replaceAll("-", "").slice(0, 12)).toBe("0123456789ab");
  });
});

describe("loadSoloIdentity", () => {
  it("creates, stores and then reuses one identity", () => {
    const store = memoryStore();
    const first = loadSoloIdentity(store, 1_700_000_000_000, fixedRandom);
    expect(first.persisted).toBe(true);
    expect(first.originId).toMatch(/^[0-9a-f]{32}$/);
    expect(store.map.get(SOLO_STORAGE_KEYS.contractId)).toBe(first.contractId);
    const second = loadSoloIdentity(store, 1_800_000_000_000, fixedRandom);
    expect(second).toEqual(first);
  });
  it("replaces a corrupt stored value and survives unavailable storage", () => {
    const store = memoryStore();
    store.map.set(SOLO_STORAGE_KEYS.contractId, "not-a-uuid");
    const fixed = loadSoloIdentity(store, 1, fixedRandom);
    expect(fixed.contractId).not.toBe("not-a-uuid");
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSoloIdentity(throwing, 1, fixedRandom).persisted).toBe(false);
    expect(loadSoloIdentity(null, 1, fixedRandom).persisted).toBe(false);
  });
});

describe("roomHost service facade", () => {
  it("starts empty, publishes with the previous host and unsubscribes", () => {
    const service = createRoomHostService();
    expect(service.current).toBeNull();
    const seen: unknown[] = [];
    const off = service.onChange((host, previous) => seen.push([host, previous]));
    const host = { kind: "local" } as unknown as RoomHost;
    service.publish(host);
    service.publish(host);
    expect(service.current).toBe(host);
    service.publish(null);
    off();
    service.publish(host);
    expect(seen).toEqual([
      [host, null],
      [null, host],
    ]);
  });
});

describe("startSoloHost", () => {
  const baseOptions = () => {
    const worker = fakeWorker();
    const publisher = createRoomHostService();
    const onProblem = vi.fn();
    return {
      worker,
      publisher,
      onProblem,
      options: {
        publisher,
        onProblem,
        identity: loadSoloIdentity(memoryStore(), 1, fixedRandom),
        load: () => import("../sim-host"),
        hostOverrides: { spawnWorker: () => worker, singleTabLock: false, checkpointOnHide: false },
      },
    };
  };

  it("boots a flat-world host in the worker, publishes it and closes it on stop", async () => {
    const { worker, publisher, onProblem, options } = baseOptions();
    const handle = startSoloHost(options);
    expect(publisher.current).toBeNull();
    await until(() => publisher.current !== null);
    const host = publisher.current;
    expect(host?.kind).toBe("local");
    expect(host?.state).toBe("booting");
    const boot = worker.posted[0] as { t: string; cfg: { world: { kind: string }; shiftType: string } };
    expect(boot.t).toBe("boot");
    expect(boot.cfg.world.kind).toBe("flat");
    expect(boot.cfg.shiftType).toBe("solo");
    handle.stop();
    expect(publisher.current).toBeNull();
    handle.stop();
    expect(onProblem).not.toHaveBeenCalled();
    // Cold dynamic import of the sim-host chunk is slow when `pnpm verify` runs packages in parallel.
  }, 30_000);

  it("never spawns the worker when stop is called before the sim-host chunk has loaded", async () => {
    const { worker, publisher, options } = baseOptions();
    const handle = startSoloHost(options);
    handle.stop();
    await flush();
    expect(publisher.current).toBeNull();
    expect(worker.posted).toHaveLength(0);
  });

  it("closes a host whose creation finished after stop was called", async () => {
    const { publisher, options } = baseOptions();
    const close = vi.fn(() => Promise.resolve());
    let finish: (host: unknown) => void = () => undefined;
    const handle = startSoloHost({
      ...options,
      load: () =>
        Promise.resolve({
          createLocalRoomHost: () =>
            new Promise((resolve) => {
              finish = resolve;
            }) as never,
        }),
    });
    await flush();
    handle.stop();
    finish({ close, onStateChange: () => () => undefined });
    await flush();
    expect(close).toHaveBeenCalledWith("clock_out");
    expect(publisher.current).toBeNull();
  });

  it("stop(reason) during boot waits for the late host and closes it with that reason and its lock released", async () => {
    const { publisher, onProblem, options } = baseOptions();
    let releaseLock: () => void = () => undefined;
    let lockHeld = true;
    const close = vi.fn<(reason: string) => Promise<void>>(
      () =>
        // The real close releases the Web Lock only after the (skipped or written) checkpoint.
        new Promise<void>((resolve) => {
          releaseLock = () => {
            lockHeld = false;
            resolve();
          };
        }),
    );
    let finish: (host: unknown) => void = () => undefined;
    const handle = startSoloHost({
      ...options,
      load: () =>
        Promise.resolve({
          createLocalRoomHost: () =>
            new Promise((resolve) => {
              finish = resolve;
            }) as never,
        }),
    });
    await flush();
    let stopResolved = false;
    const stopping = handle.stop("conflict_resolved").then(() => {
      stopResolved = true;
    });
    // Caller (install port) must not proceed while the old host is still creating.
    await flush();
    expect(stopResolved).toBe(false);
    // A second stop() (disposer) joins the same promise instead of resolving early.
    let secondResolved = false;
    void handle.stop().then(() => {
      secondResolved = true;
    });
    finish({ close, onStateChange: () => () => undefined });
    await flush();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith("conflict_resolved");
    expect(stopResolved).toBe(false); // the close (lock release) is still in flight
    expect(secondResolved).toBe(false);
    releaseLock();
    await stopping;
    await flush();
    expect(stopResolved).toBe(true);
    expect(secondResolved).toBe(true);
    expect(lockHeld).toBe(false);
    expect(publisher.current).toBeNull();
    expect(onProblem).not.toHaveBeenCalled();
  });

  it("routes a save that could not be restored to onProblem (the game starts fresh)", async () => {
    const { onProblem, options } = baseOptions();
    startSoloHost({
      ...options,
      load: () =>
        Promise.resolve({
          createLocalRoomHost: (o) => {
            o.onRestoreProblem?.("save rejected: config_mismatch (tickHz)");
            return Promise.resolve({ close: () => Promise.resolve(), onStateChange: () => () => undefined } as never);
          },
        }),
    });
    await flush();
    expect(onProblem).toHaveBeenCalledWith(
      "solo save restore",
      expect.objectContaining({ message: expect.stringMatching(/config_mismatch/) }),
    );
  });

  it("routes a start failure to onProblem with its message", async () => {
    const { publisher, onProblem, options } = baseOptions();
    startSoloHost({
      ...options,
      load: () =>
        Promise.resolve({
          createLocalRoomHost: () => Promise.reject(new Error("Contract is already open in another tab")),
        }),
    });
    await flush();
    expect(publisher.current).toBeNull();
    expect(onProblem).toHaveBeenCalledWith(
      "solo room host start",
      expect.objectContaining({ message: expect.stringMatching(/another tab/) }),
    );
  });
});
