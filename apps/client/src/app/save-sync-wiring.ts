// Solo checkpoint sync wiring of the composition root (M1-W5-T08 hooks): the `LocalInstallPort` (stop the Solo host,
// write the installed copy into the main-thread view of its IndexedDB store, boot a fresh host from it), the
// `SaveSummaryProvider` (playtime from the sim tick, wallet and Shine from the UI store) and the UI glue
// (`saveSync.set` sink, `saveSync.request` consumer). Event and timer driven only: nothing here runs per frame.

import type { ContractId, EventBus, SaveEventMap, UiSaveSyncRequest, UiSaveSyncState } from "@moon-cleanup/shared";
import type {
  LocalInstallPort,
  LocalStoreReader,
  ResolveResult,
  SaveSummaryProvider,
  SaveSync,
  StoredCheckpointLike,
  StoredDustChunkLike,
} from "../sync";
import type { AppUiStore } from "./ui-store";

/** The write side of the sim-host checkpoint store the install port needs (sim-host `CheckpointStore` satisfies it). */
export interface CheckpointStoreWriter {
  save(
    record: StoredCheckpointLike & { readonly contractId: ContractId },
    dust?: { readonly replaceAll: boolean; readonly chunks: readonly StoredDustChunkLike[] },
  ): Promise<void>;
}

export interface InstallPortDeps {
  /** The main-thread store on the host's database (the same `dbName`). */
  readonly store: () => Promise<CheckpointStoreWriter>;
  /** Stops the running Solo host WITHOUT a final checkpoint (it would overwrite the copy being installed). */
  readonly stopHost: () => Promise<void>;
  /** Boots a fresh Solo host; it restores the newest local checkpoint, so its generation continues after it. */
  readonly startHost: () => void;
}

/**
 * Restore / use-server / keep-local rebase / restore-backup all end here: stop, write (header and, unless `dust` is
 * null, every dust row of the copy in the same transaction), boot again. A failed write still boots the host again
 * from whatever the store holds, then rejects so the sync controller reports the failure.
 */
export function createLocalInstallPort(deps: InstallPortDeps): LocalInstallPort {
  return {
    async install({ contractId, record, dust }) {
      await deps.stopHost();
      try {
        const store = await deps.store();
        const stored = { ...record, contractId: contractId as ContractId };
        if (dust === null) await store.save(stored);
        else await store.save(stored, dust);
      } finally {
        deps.startHost();
      }
    },
  };
}

/** A read view keyed by plain strings over the sim-host store (whose methods take branded Contract ids). */
export function storeReader(
  store: () => Promise<{
    load(contractId: ContractId): Promise<StoredCheckpointLike | null>;
    loadDustChunks(contractId: ContractId): Promise<StoredDustChunkLike[]>;
  }>,
): LocalStoreReader {
  return {
    load: async (id) => (await store()).load(id as ContractId),
    loadDustChunks: async (id) => (await store()).loadDustChunks(id as ContractId),
  };
}

/** Playtime from the sim tick; wallet and Shine as the HUD shows them (the UI store slices the host writes). */
export function createSummaryProvider(store: AppUiStore, simTickHz: number, deviceLabel?: string): SaveSummaryProvider {
  return {
    snapshot: ({ simTick }) => {
      const s = store.getState();
      return {
        playtimeS: Math.floor(simTick / Math.max(1, simTickHz)),
        shinePolished: s.shine.polished,
        walletLumens: s.wallet.lm,
        ...(deviceLabel !== undefined ? { deviceLabel } : {}),
      };
    },
  };
}

/** Short device label for the "Which copy?" prompt (no fingerprinting: platform family only). */
export function deviceLabelOf(userAgent: string): string {
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad/i.test(userAgent)) return "iOS";
  if (/Windows/i.test(userAgent)) return "Windows PC";
  if (/Mac OS X/i.test(userAgent)) return "Mac";
  if (/Linux|CrOS/i.test(userAgent)) return "Linux";
  return "Browser";
}

/** Host save events onto the app event bus (the sync controller listens to `save.checkpointed`). */
export function saveEventForwarder(
  events: EventBus,
): <K extends keyof SaveEventMap>(name: K, payload: SaveEventMap[K]) => void {
  // EventMap extends SaveEventMap, so the app bus is a save-event bus too.
  const bus: EventBus<SaveEventMap> = events;
  return (name, payload) => bus.emit(name, payload);
}

/** Default name of the solo Contract on the server (3 to 32 letters, digits, spaces; the player can rename it later). */
export const SOLO_CONTRACT_NAME = "My Moon";

/**
 * What `POST /v1/contracts` needs to create the server row of a Solo Contract that was first created locally
 * (ADR-0031): `{ name, shiftType: "solo", clientContractId, seed }`. The call is idempotent by `clientContractId`, so
 * every Clock In may pass it. Without it the server answers 404 to the head check and the upload of an unseen Contract,
 * and a Contract with no registration is treated as already registered (sync/meta-store `emptyMeta`).
 * The seed is a stable decimal string (the server accepts 0 to 2^64 - 1) taken from the low 64 bits of the Contract
 * id: the solo world is a fixed bake, so the value only has to be valid and the same on every device.
 */
export function soloRegistration(
  contractId: string,
  name: string = SOLO_CONTRACT_NAME,
): { readonly name: string; readonly seed: string } {
  const hex = contractId.replaceAll("-", "").slice(-16);
  const seed = /^[0-9a-f]{16}$/i.test(hex) ? BigInt(`0x${hex}`).toString() : "0";
  return { name, seed };
}

/** Backoff between sign-in attempts after a network failure (server asleep or offline): 30 s, doubling, capped. */
export const SIGN_IN_RETRY_MIN_MS = 30_000;
export const SIGN_IN_RETRY_MAX_MS = 300_000;

export interface SignInRetryDeps {
  readonly signIn: () => Promise<boolean>;
  /** `SaveSync.notifyAuthChanged`: releases the queue the sync controller holds while signed out. */
  readonly notify: () => void;
  readonly onProblem: (source: string, error: unknown) => void;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Signs in (guest account) and tells the sync controller; a failure (cold Render instance past the request timeout,
 * offline) is retried with a doubling delay instead of leaving the queue held until the next page load. Returns a stop
 * function. Event and timer driven only.
 */
export function signInUntilReady(deps: SignInRetryDeps): () => void {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stopped = false;
  let timer: unknown;
  let delay = SIGN_IN_RETRY_MIN_MS;
  const attempt = (): void => {
    timer = undefined;
    deps
      .signIn()
      .then((signedIn) => {
        if (stopped) return;
        if (signedIn) {
          deps.notify();
          return;
        }
        timer = setTimer(attempt, delay);
        delay = Math.min(delay * 2, SIGN_IN_RETRY_MAX_MS);
      })
      .catch((error: unknown) => {
        deps.onProblem("guest sign-in", error);
        if (!stopped) timer = setTimer(attempt, SIGN_IN_RETRY_MAX_MS);
      });
  };
  attempt();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimer(timer);
  };
}

type RequestError = NonNullable<UiSaveSyncState["error"]>;

/**
 * What the "Which copy?" prompt and the Settings row need after a request did not go through. A failure the controller
 * already classified (offline, server error, rejected) keeps its kind; a download/upload that failed without one reads
 * as a server problem; a local store or install failure is `local_store_failed`; an unreadable or oversize copy reads
 * as "did not accept this copy". The
 * conflict stays (`state: "conflict"` while a conflict is held), so the prompt shows its failure line, never a blank.
 */
export function requestFailurePatch(
  request: UiSaveSyncRequest,
  result: Extract<ResolveResult, { kind: "failed" }> | null,
  current: UiSaveSyncState,
): Partial<UiSaveSyncState> {
  const error: RequestError =
    result?.failure !== undefined
      ? { kind: result.failure.kind, reason: result.failure.reason }
      : result !== null && (result.why === "download" || result.why === "upload")
        ? { kind: "server_error", reason: null }
        : result === null
          ? { kind: "server_error", reason: null }
          : result.why === "local" || result.why === "install"
            ? { kind: "local_store_failed", reason: null }
            : { kind: "rejected", reason: null };
  return request.kind === "resolve_conflict" && current.conflict !== null ? { state: "conflict", error } : { error };
}

/**
 * Hands each new `saveSync.request` of the UI store to the controller once, clears it, and writes the outcome back:
 * a failed resolve keeps the conflict and sets `error`; a missing backup clears `backupAvailable`. The controller's own
 * `sink` already writes `backupAvailable`, `backupExpiresAtMs`, `pendingSinceMs`, `lastSyncedAtMs` and `error` on every
 * state change; this only covers the failures that return without publishing.
 */
export function bindSaveSyncRequests(
  store: AppUiStore,
  sync: Pick<SaveSync, "resolveConflict" | "restoreBackup">,
  onProblem: (source: string, error: unknown) => void,
): () => void {
  // The clear is queued (applied by the next store flush), so the request object stays visible until then; it is
  // handled once by identity (the reducer builds a new object for every request).
  let last: UiSaveSyncRequest | null = null;
  const check = (): void => {
    const request = store.getState().saveSync.request;
    if (request === null || request === last) return;
    last = request;
    store.dispatch({ type: "saveSync.set", patch: { request: null } });
    const run = request.kind === "resolve_conflict" ? sync.resolveConflict(request.choice) : sync.restoreBackup();
    run
      .then((result) => {
        if (result.kind === "failed") {
          store.dispatch({
            type: "saveSync.set",
            patch: requestFailurePatch(request, result, store.getState().saveSync),
          });
        } else if (result.kind === "no_backup") {
          store.dispatch({ type: "saveSync.set", patch: { backupAvailable: false, backupExpiresAtMs: null } });
        }
      })
      .catch((error: unknown) => {
        onProblem("save sync request", error);
        store.dispatch({
          type: "saveSync.set",
          patch: requestFailurePatch(request, null, store.getState().saveSync),
        });
      });
  };
  check();
  return store.subscribe(check);
}
