// Factory of the Solo LocalRoomHost (ADR-0031). Not wired into app/boot.ts here (integrator later): the app calls
// `createLocalRoomHost(...)` at Clock In and publishes the result through the `roomHost` service.
// Adds the browser-only duties around the host: the Web Locks one-tab-per-Contract rule, `navigator.storage.persist()`
// and a `hidden` checkpoint on visibilitychange. Every browser API is optional (guarded), so tests and odd browsers
// still get a working host.

import type { ContractId } from "@moon-cleanup/shared";
import { LocalRoomHostImpl, type LocalRoomHostOptions, type SimWorkerLike } from "./local-room-host";

export interface CreateLocalRoomHostOptions extends Omit<LocalRoomHostOptions, "spawnWorker" | "onDispose"> {
  /** Override the worker (tests); default: the module worker `sim.worker.ts`. */
  readonly spawnWorker?: () => SimWorkerLike;
  /** Checkpoint when the tab is hidden (default true). */
  readonly checkpointOnHide?: boolean;
  /** Enforce one tab per Contract with the Web Locks API (default true). */
  readonly singleTabLock?: boolean;
}

export class SimHostLockedError extends Error {
  override readonly name = "SimHostLockedError";
  constructor(readonly contractId: ContractId) {
    super(`Contract ${contractId} is already open in another tab`);
  }
}

export function spawnModuleWorker(): SimWorkerLike {
  return new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module", name: "sim-host" });
}

interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
}

/** Holds `mc-solo:<contractId>` until `release` is called. Resolves null when another tab holds it. */
async function acquireLock(contractId: ContractId): Promise<{ release: () => void } | "none" | null> {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  if (!locks) return "none";
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  const granted = await new Promise<boolean>((resolve) => {
    void locks
      .request(`mc-solo:${contractId}`, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(false);
          return;
        }
        resolve(true);
        return held;
      })
      .catch(() => resolve(true));
  });
  return granted ? { release } : null;
}

/**
 * Boots a LocalRoomHost. Rejects with SimHostLockedError when the Contract is open in another tab; otherwise resolves
 * immediately with the host in state `booting` (watch `onStateChange` for `running`).
 */
export async function createLocalRoomHost(options: CreateLocalRoomHostOptions): Promise<LocalRoomHostImpl> {
  const lock = options.singleTabLock === false ? "none" : await acquireLock(options.contractId);
  if (lock === null) throw new SimHostLockedError(options.contractId);
  const nav = globalThis.navigator as { storage?: { persist?: () => Promise<boolean> } } | undefined;
  if (nav?.storage?.persist) {
    void nav.storage.persist().then(
      (ok) => {
        if (!ok) emitPersistDenied(options);
      },
      () => emitPersistDenied(options),
    );
  }
  let removeVisibility: () => void = () => undefined;
  const host = new LocalRoomHostImpl({
    ...options,
    spawnWorker: options.spawnWorker ?? spawnModuleWorker,
    onDispose: () => {
      removeVisibility();
      if (lock !== "none") lock.release();
    },
  });
  const doc = globalThis.document as Document | undefined;
  if (options.checkpointOnHide !== false && doc) {
    const onVis = (): void => {
      if (doc.visibilityState === "hidden" && host.state === "running") void host.checkpoint("hidden").catch(() => 0);
    };
    doc.addEventListener("visibilitychange", onVis);
    removeVisibility = () => doc.removeEventListener("visibilitychange", onVis);
  }
  return host;
}

function emitPersistDenied(options: CreateLocalRoomHostOptions): void {
  options.onSaveEvent?.("save.storage_warning", {
    contractId: options.contractId,
    atMs: Date.now(),
    warning: "persist_denied",
  });
}
