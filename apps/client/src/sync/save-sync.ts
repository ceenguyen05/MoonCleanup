// Solo checkpoint sync controller (M1-W5-T08, ADR-0031, data-model.md section 3.7c, save/sync-rules.ts normative).
//
// What it does, for the ONE active Solo Contract:
//   - listens to `save.checkpointed` (the sim-host worker wrote a local checkpoint) and keeps a newest-only pending
//     marker; uploads it at most every 120 s (urgently on hidden / pause / Clock Out / handoff, never faster than the
//     server's 20 s per Contract), only after the first user interaction and never from automated browsers;
//   - on failure backs off 30 s -> 5 min (server `retry-after` wins when longer); offline and "server asleep" are not
//     errors, the queue is simply held;
//   - head check at Clock In: silent fast-forward up (local descends) or down (server descends), a `conflict` state when
//     the copies diverged, with the keep-local / use-server resolution and the local backup slot (7 days);
//   - restores a Contract on another device (download pages, verify, install into the local store);
//   - registers a locally created Contract (`clientContractId`) before its first upload.
// It never runs per frame: everything is event, timer or user driven, and CPU work is sliced (copy.ts). The host is
// never touched directly: installs go through `LocalInstallPort`, which the composition root wires to the sim-host.

import {
  SAVE_FORMAT_VERSION,
  SOLO_BACKUP_RETENTION_DAYS,
  SoloCheckpointBeginRequestSchema,
  type ContractId,
  type EventBus,
  type ProfileDelta,
  type SaveConflictChoice,
  type SaveRestoreSource,
  type SoloCheckpointSummary,
  type UiSaveSyncRequest,
  type UiSaveSyncState,
} from "@moon-cleanup/shared";
import { backoffDelayMs } from "./backoff";
import {
  assembleCopy,
  copyToStoreShapes,
  readLocalCopy,
  type CheckpointCopy,
  type CopyFailure,
  type CrcCache,
  type InstallDust,
  type LocalStoreReader,
  type StoredCheckpointLike,
} from "./copy";
import { compress, decompress } from "./compress";
import { withGeneration } from "./envelope";
import {
  DOWNLOAD_MAX_PAGES,
  DOWNLOAD_MAX_RESTARTS,
  HEADER_RAW_MAX_BYTES,
  UPLOAD_INTERVAL_MS,
  UPLOAD_MIN_INTERVAL_MS,
  UPLOAD_PACKAGE_MAX_BYTES,
} from "./limits";
import { encodeMcck, mcckTrailerCrc, packPages } from "./mcck";
import {
  emptyMeta,
  type BackupRecord,
  type ContractSyncMeta,
  type PendingCheckpoint,
  type SyncMetaStore,
} from "./meta-store";
import { createConnectivity, createInteractionGate, type Connectivity, type InteractionGate } from "./gate";
import type { SaveApi, SyncFailure } from "./save-api";

// ---- ports ---------------------------------------------------------------------------------------------------------

/** What the app knows about the running game when a checkpoint is written. Plain data, no I/O, called every checkpoint. */
export interface SaveSummaryInput {
  readonly playtimeS: number;
  readonly shinePolished: number;
  readonly walletLumens: number;
  /** Short device name for the "Which copy?" prompt (at most 40 chars). */
  readonly deviceLabel?: string;
  /** Profile credit earned since the last accepted upload (the server caps it); default none. */
  readonly profileDelta?: Partial<ProfileDelta>;
}

export interface SaveSummaryProvider {
  snapshot(info: {
    readonly contractId: string;
    readonly generation: number;
    readonly simTick: number;
  }): SaveSummaryInput;
}

/** Playtime from the sim tick, no wallet or Shine: a stand-in until the app supplies the real readers. */
export function tickSummaryProvider(simTickHz: number): SaveSummaryProvider {
  return {
    snapshot: ({ simTick }) => ({ playtimeS: Math.floor(simTick / simTickHz), shinePolished: 0, walletLumens: 0 }),
  };
}

/**
 * Replaces the local copy and makes the sim-host continue from it. The composition root implements it: stop or pause
 * the worker, write `store.save(record, dust)` (dust null = header only: the "rebase" of an overwrite), then reboot the
 * host from the store so its generation counter continues after `record.generation`. Resolves after both.
 */
export interface LocalInstallPort {
  install(args: {
    readonly contractId: string;
    readonly record: StoredCheckpointLike;
    readonly dust: InstallDust | null;
    readonly source: SaveRestoreSource | "rebase";
  }): Promise<void>;
}

export interface SaveSyncOptions {
  readonly api: SaveApi;
  /** Read side of the sim-host's CheckpointStore (IndexedDB; a memory store is invisible to the main thread). */
  readonly store: LocalStoreReader;
  readonly install: LocalInstallPort;
  readonly meta: SyncMetaStore;
  readonly events: EventBus;
  /** Writes a patch into the UI `saveSync` slice (`saveSync.set`). */
  readonly sink: (patch: Partial<UiSaveSyncState>) => void;
  readonly summary: SaveSummaryProvider;
  /** `gameDataVersion` of this build (1..32 chars); the server may reject unknown ones. */
  readonly gameDataVersion: string;
  readonly gate?: InteractionGate;
  readonly connectivity?: Connectivity;
  /** Wall clock ms (default `Date.now`). */
  readonly now?: () => number;
  /** Monotonic ms for CPU slicing (default `performance.now`). */
  readonly perfNow?: () => number;
  readonly random?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly yieldFn?: () => Promise<void>;
  readonly uploadIntervalMs?: number;
  readonly minIntervalMs?: number;
}

// ---- results -------------------------------------------------------------------------------------------------------

export type ClockInResult =
  /** Local and server copies are the same. */
  | { readonly kind: "synced" }
  /** Local is ahead (or the server has none): an upload is queued. */
  | { readonly kind: "queued" }
  /** The server copy was newer and was installed (silently, rule 2). */
  | { readonly kind: "restored"; readonly generation: number }
  /** Divergence: `saveSync.state` is `conflict`, the player must choose. */
  | { readonly kind: "conflict" }
  /** Neither side has a save. */
  | { readonly kind: "local_only" }
  /** Server unreachable or asleep (queue held), or a request failed. */
  | { readonly kind: "offline"; readonly failure: SyncFailure }
  /** The check did not complete in time or is not allowed yet; it continues in the background. */
  | { readonly kind: "background" }
  | { readonly kind: "restore_failed"; readonly reason: CopyFailure | "download" };

export type FlushResult =
  | { readonly kind: "accepted"; readonly generation: number }
  | { readonly kind: "nothing_pending" }
  | { readonly kind: "conflict" }
  | { readonly kind: "failed"; readonly failure: SyncFailure }
  | { readonly kind: "blocked"; readonly why: "no_session" | "automated" | "offline" | "not_registered" };

export type ResolveResult =
  | { readonly kind: "resolved"; readonly generation: number }
  | { readonly kind: "no_conflict" }
  | { readonly kind: "no_backup" }
  /** The choice was not applied (download or upload failed); the prompt stays. */
  | {
      readonly kind: "failed";
      readonly why: "download" | "upload" | "local" | "install" | CopyFailure;
      readonly failure?: SyncFailure;
    }
  /** The server moved again while resolving: the prompt now shows the newer server copy. */
  | { readonly kind: "conflict_again" };

type AttemptResult =
  | { readonly kind: "accepted"; readonly generation: number }
  | { readonly kind: "nothing" }
  | { readonly kind: "conflict"; readonly server: SoloCheckpointSummary }
  | { readonly kind: "failed"; readonly failure: SyncFailure }
  | { readonly kind: "skipped" };

export type HeadDecision = "none" | "upload" | "in_sync" | "download" | "conflict";

/** The head-check rule of save/sync-rules.ts, as a pure function (see the table in data-model.md section 3.7c). */
export function decideHead(input: {
  readonly hasLocal: boolean;
  readonly localGeneration: number;
  readonly localSimTick: number;
  readonly baseGeneration: number;
  /** This device wrote after `baseGeneration` (a pending marker or a local generation above the base). */
  readonly dirty: boolean;
  readonly server: SoloCheckpointSummary | null;
}): HeadDecision {
  const { server } = input;
  if (server === null) return input.hasLocal ? "upload" : "none";
  if (!input.hasLocal) return "download";
  if (!input.dirty) {
    if (server.generation === input.localGeneration) return "in_sync";
    return server.generation > input.localGeneration ? "download" : "upload";
  }
  if (server.generation === input.baseGeneration) return "upload";
  // We wrote after our base and the server moved. Only an identical copy (our own upload whose answer was lost) is silent.
  if (server.generation === input.localGeneration && server.simTick === input.localSimTick) return "in_sync";
  return "conflict";
}

// ---- runtime -------------------------------------------------------------------------------------------------------

interface Runtime {
  readonly id: string;
  meta: ContractSyncMeta;
  localGeneration: number;
  conflict: { local: SoloCheckpointSummary; server: SoloCheckpointSummary } | null;
  error: SyncFailure | null;
  /** A hard failure (rejected, version, too large): uploads wait for the next checkpoint or an explicit flush. */
  blocked: boolean;
  /** The server refused to register this Contract (quota, id taken): it stays local-only this session. */
  refused: boolean;
  /**
   * No usable access token (signed out, sign-in pending, refresh refused): no request is made and no timer is armed
   * until `notifyAuthChanged`, a new checkpoint or an explicit flush. Without it an auth failure (which has no backoff
   * and costs no network round trip) would re-arm a zero-delay timer in a tight loop while the guest account is still
   * being created, which takes up to a minute on a cold Render instance.
   */
  authHeld: boolean;
  inFlight: boolean;
  failures: number;
  nextAttemptAtMs: number;
  lastAttemptAtMs: number;
  urgent: boolean;
  timer: unknown;
  headChecked: boolean;
  headBusy: boolean;
  hostRunning: boolean;
  storageWarning: UiSaveSyncState["storageWarning"];
  backup: BackupRecord | null;
  chain: Promise<unknown>;
  persistChain: Promise<unknown>;
  crcCache: CrcCache;
  disposed: boolean;
}

const TRANSIENT = new Set(["offline", "server_error", "rate_limited"]);
const DAY_MS = 86_400_000;
const MAX_FLUSH_WAIT_MS = 25_000;

export interface SaveSync {
  /** Loads the persisted sync state of the Contract and starts tracking it (local I/O only, fast, never fails). */
  attach(
    contractId: string,
    registration?: { readonly name: string; readonly seed: string },
  ): Promise<{ readonly hasLocalCopy: boolean }>;
  /**
   * Clock In: `attach`, then the head check. When the check has no answer after `maxWaitMs` (a cold Render instance
   * takes about a minute) it returns `background`, the host may boot from the local copy, and the check completes later
   * (a newer server copy then becomes a conflict prompt instead of a silent swap). Pass `Infinity` when there is no
   * local copy and the player waits for a restore.
   */
  clockIn(
    contractId: string,
    options?: { readonly registration?: { readonly name: string; readonly seed: string }; readonly maxWaitMs?: number },
  ): Promise<ClockInResult>;
  /**
   * Uploads the newest local checkpoint now (pause, Clock Out, handoff). Call after `host.checkpoint(...)` so the marker
   * is current. Resolves when accepted, conflicted or failed; open-to-friends requires `accepted` (or `nothing_pending`).
   */
  flush(contractId: string, reason: "pause" | "clock_out" | "handoff" | "manual"): Promise<FlushResult>;
  /** Downloads the server copy and installs it (new device, explicit "restore from server"). */
  restoreFromServer(contractId: string): Promise<ClockInResult>;
  resolveConflict(choice: SaveConflictChoice): Promise<ResolveResult>;
  /** Loads the backup slot as a new generation on top of the current state (the current copy takes its place). */
  restoreBackup(): Promise<ResolveResult>;
  /** Consumes a `saveSync.request` from the UI store; the caller clears the request afterwards. */
  handleRequest(request: UiSaveSyncRequest): Promise<void>;
  /** Call after sign-in or a token refresh so a held queue retries. */
  notifyAuthChanged(): void;
  /** Stops timers for the Contract (Clock Out, after `flush`). */
  detach(contractId: string): void;
  readonly state: UiSaveSyncState["state"] | null;
  dispose(): void;
}

export function createSaveSync(options: SaveSyncOptions): SaveSync {
  const { api, store, meta: metaStore, events, sink } = options;
  const now = options.now ?? (() => Date.now());
  const perfNow = options.perfNow ?? (() => performance.now());
  const random = options.random ?? Math.random;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  const uploadIntervalMs = options.uploadIntervalMs ?? UPLOAD_INTERVAL_MS;
  const minIntervalMs = options.minIntervalMs ?? UPLOAD_MIN_INTERVAL_MS;
  const gate = options.gate ?? createInteractionGate();
  const connectivity = options.connectivity ?? createConnectivity();
  const copyEnv = { now: perfNow, ...(options.yieldFn !== undefined ? { yieldFn: options.yieldFn } : {}) };

  let rt: Runtime | null = null;
  const offs: (() => void)[] = [];

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimer(resolve, ms));

  // ---- state publication -------------------------------------------------------------------------------------------

  function stateOf(r: Runtime): UiSaveSyncState["state"] {
    if (r.conflict !== null) return "conflict";
    if (r.inFlight) return "uploading";
    if (r.refused) return "local_only";
    if (r.error !== null) {
      if (r.error.kind === "rate_limited") return "pending";
      return TRANSIENT.has(r.error.kind) ? "offline" : "error";
    }
    if (r.meta.pending !== null) return "pending";
    return r.meta.baseGeneration === 0 ? "local_only" : "synced";
  }

  function publish(r: Runtime): void {
    if (rt !== r || r.disposed) return;
    const retained = r.backup !== null && r.backup.expiresAtMs > now();
    sink({
      state: stateOf(r),
      localGeneration: r.localGeneration,
      serverGeneration: r.meta.baseGeneration > 0 ? r.meta.baseGeneration : null,
      lastSyncedAtMs: r.meta.lastSyncedAtMs,
      pendingSinceMs: r.meta.pending?.sinceMs ?? null,
      conflict: r.conflict,
      backupAvailable: retained,
      backupExpiresAtMs: retained && r.backup !== null ? r.backup.expiresAtMs : null,
      error: r.error === null ? null : { kind: r.error.kind, reason: r.error.reason },
      storageWarning: r.storageWarning,
    });
  }

  function persist(r: Runtime): void {
    const snapshot = r.meta;
    r.persistChain = r.persistChain.then(() => metaStore.putMeta(snapshot)).catch(() => undefined);
  }

  function setMeta(r: Runtime, patch: Partial<ContractSyncMeta>): void {
    r.meta = { ...r.meta, ...patch };
    persist(r);
  }

  function exclusive<T>(r: Runtime, fn: () => Promise<T>): Promise<T> {
    const run = r.chain.then(fn, fn);
    r.chain = run.catch(() => undefined);
    return run;
  }

  // ---- summaries ---------------------------------------------------------------------------------------------------

  function summaryOf(
    info: { generation: number; parentGeneration: number; simTick: number; savedAtMs: number },
    input: SaveSummaryInput,
  ): SoloCheckpointSummary {
    return {
      generation: info.generation,
      parentGeneration: info.parentGeneration,
      originKind: "solo",
      savedAt: new Date(info.savedAtMs).toISOString(),
      simTick: info.simTick,
      playtimeS: Math.max(0, Math.floor(input.playtimeS)),
      shinePolished: Math.max(0, Math.floor(input.shinePolished)),
      walletLumens: Number.isFinite(input.walletLumens) ? Math.max(0, input.walletLumens) : 0,
      saveFormatVersion: SAVE_FORMAT_VERSION,
      gameDataVersion: options.gameDataVersion,
      ...(input.deviceLabel !== undefined ? { deviceLabel: input.deviceLabel.slice(0, 40) } : {}),
    };
  }

  function pendingOf(
    r: Runtime,
    info: { generation: number; parentGeneration: number; simTick: number; savedAtMs: number },
  ): PendingCheckpoint {
    const input = options.summary.snapshot({ contractId: r.id, generation: info.generation, simTick: info.simTick });
    return {
      ...info,
      sinceMs: r.meta.pending?.sinceMs ?? info.savedAtMs,
      summary: summaryOf(info, input),
      profileDelta: {
        playtimeS: 0,
        tenurePoints: Math.max(0, Math.floor(input.profileDelta?.tenurePoints ?? 0)),
        commendations: Math.max(0, Math.floor(input.profileDelta?.commendations ?? 0)),
        achievementIds: (input.profileDelta?.achievementIds ?? []).slice(0, 32),
      },
    };
  }

  // ---- scheduling --------------------------------------------------------------------------------------------------

  function canSync(): boolean {
    return gate.hasInteracted() && !gate.automated() && connectivity.isOnline();
  }

  function clearTimerOf(r: Runtime): void {
    if (r.timer !== undefined) clearTimer(r.timer);
    r.timer = undefined;
  }

  /**
   * Arms the single timer from the current state; idempotent. The timer runs the head check first when it has not
   * succeeded yet (offline at Clock In, no interaction yet), then the upload of the newest pending checkpoint.
   */
  function schedule(r: Runtime): void {
    clearTimerOf(r);
    if (
      rt !== r ||
      r.disposed ||
      r.conflict !== null ||
      r.blocked ||
      r.refused ||
      r.authHeld ||
      r.inFlight ||
      r.headBusy
    )
      return;
    if (r.meta.pending === null && r.headChecked) return;
    if (!canSync()) return;
    const t = now();
    const interval = r.urgent ? minIntervalMs : uploadIntervalMs;
    const due = r.headChecked
      ? Math.max(t, r.lastAttemptAtMs + interval, r.nextAttemptAtMs)
      : Math.max(t, r.nextAttemptAtMs);
    r.timer = setTimer(() => {
      r.timer = undefined;
      void exclusive(r, async () => {
        if (!r.headChecked) await runHead(r);
        else await attemptUpload(r);
      })
        .catch(() => undefined)
        .then(() => schedule(r));
    }, due - t);
  }

  async function runHead(r: Runtime): Promise<ClockInResult> {
    r.headBusy = true;
    try {
      return await headCheck(r);
    } finally {
      r.headBusy = false;
    }
  }

  /** Something that gates the network changed (interaction, online, sign-in): retry now instead of at the backoff time. */
  function kick(r: Runtime): void {
    if (rt !== r || r.disposed) return;
    r.nextAttemptAtMs = 0;
    publish(r);
    schedule(r);
  }

  // ---- failures ----------------------------------------------------------------------------------------------------

  function recordFailure(r: Runtime, failure: SyncFailure, generation: number): void {
    r.error = failure;
    if (failure.auth) {
      // Signed out or the refresh failed: hold the queue until `notifyAuthChanged`.
      r.authHeld = true;
      emitFailed(r, failure, generation, null);
    } else if (TRANSIENT.has(failure.kind)) {
      r.failures += 1;
      const delay = backoffDelayMs(r.failures, random, failure.retryAfterMs);
      r.nextAttemptAtMs = now() + delay;
      emitFailed(r, failure, generation, r.nextAttemptAtMs);
    } else {
      r.blocked = true;
      emitFailed(r, failure, generation, null);
    }
    publish(r);
  }

  function emitFailed(r: Runtime, failure: SyncFailure, generation: number, retryAtMs: number | null): void {
    events.emit("save.upload_failed", {
      contractId: r.id as ContractId,
      atMs: now(),
      generation,
      kind: failure.kind,
      reason: failure.reason,
      retryAtMs,
    });
  }

  function clearError(r: Runtime): void {
    r.error = null;
    r.failures = 0;
    r.nextAttemptAtMs = 0;
  }

  // ---- registration ------------------------------------------------------------------------------------------------

  /** Registers a locally created Contract before its first upload. Returns a failure to hold the queue, or null. */
  async function ensureRegistered(r: Runtime): Promise<SyncFailure | null> {
    const reg = r.meta.registration;
    if (r.meta.registered || reg === null) return null;
    const res = await api.registerContract(r.id, reg.name, reg.seed);
    if (!res.ok) return res.failure;
    if (res.value.kind === "registered") {
      setMeta(r, { registered: true });
      return null;
    }
    // Quota used up or the id was refused: the Contract stays local-only (the UI shows a banner from `error`).
    r.refused = true;
    r.error = { kind: "rejected", reason: null, retryAfterMs: null, status: 409, auth: false };
    emitFailed(r, r.error, r.meta.pending?.generation ?? r.localGeneration, null);
    publish(r);
    return r.error;
  }

  // ---- upload ------------------------------------------------------------------------------------------------------

  interface OverwriteSpec {
    readonly generation: number;
    readonly baseGeneration: number;
  }

  async function attemptUpload(r: Runtime, overwrite?: OverwriteSpec): Promise<AttemptResult> {
    const pending = r.meta.pending;
    if (overwrite === undefined && (pending === null || r.conflict !== null || r.refused)) return { kind: "skipped" };
    if (!canSync()) {
      publish(r);
      return { kind: "skipped" };
    }
    r.urgent = false;
    r.inFlight = true;
    r.lastAttemptAtMs = now();
    r.error = null;
    publish(r);
    try {
      const regFailure = await ensureRegistered(r);
      if (regFailure !== null) {
        if (!r.refused) recordFailure(r, regFailure, pending?.generation ?? r.localGeneration);
        return { kind: "failed", failure: regFailure };
      }

      const baseGen = overwrite?.baseGeneration ?? r.meta.baseGeneration;
      const read = await readLocalCopy(store, r.id, {
        ...copyEnv,
        sinceGeneration: baseGen,
        full: overwrite !== undefined,
        crcCache: r.crcCache,
        ...(overwrite !== undefined
          ? { generationOverride: { generation: overwrite.generation, parentGeneration: await localParent(r) } }
          : {}),
      });
      if (!read.ok) return handleReadFailure(r, read.reason, pending?.generation ?? r.localGeneration);
      const copy = read.copy;
      if (overwrite === undefined && copy.generation <= r.meta.baseGeneration) {
        // The local copy is not newer than what the server has (a stale marker): nothing to send.
        setMeta(r, { pending: null });
        return { kind: "nothing" };
      }
      const pkg = encodeMcck({
        contractId: r.id,
        generation: copy.generation,
        baseGeneration: baseGen,
        header: copy.header,
        chunks: copy.chunks,
      });
      if (pkg.byteLength > UPLOAD_PACKAGE_MAX_BYTES) {
        // The server has no multi-part route yet: a package above one request cannot be uploaded.
        const failure: SyncFailure = { kind: "too_large", reason: null, retryAfterMs: null, status: null, auth: false };
        recordFailure(r, failure, copy.generation);
        return { kind: "failed", failure };
      }

      const summary = uploadSummary(r, copy, overwrite !== undefined);
      const body = SoloCheckpointBeginRequestSchema.safeParse({
        contractId: r.id,
        generation: copy.generation,
        parentGeneration: copy.parentGeneration,
        baseGeneration: baseGen,
        saveFormatVersion: copy.facts.saveFormatVersion,
        gameDataVersion: options.gameDataVersion,
        bakeHash: copy.facts.bakeHash,
        totalBytes: pkg.byteLength,
        partCount: 1,
        packageCrc32: mcckTrailerCrc(pkg),
        summary,
        profileDelta: {
          playtimeS: Math.max(0, summary.playtimeS - (r.meta.serverSummary?.playtimeS ?? 0)),
          tenurePoints: pending?.profileDelta.tenurePoints ?? 0,
          commendations: pending?.profileDelta.commendations ?? 0,
          achievementIds: pending?.profileDelta.achievementIds ?? [],
        },
        deviceId: await metaStore.getDeviceId(),
        overwrite: overwrite !== undefined,
      });
      if (!body.success) {
        const failure: SyncFailure = { kind: "rejected", reason: null, retryAfterMs: null, status: null, auth: false };
        recordFailure(r, failure, copy.generation);
        return { kind: "failed", failure };
      }

      const res = await api.uploadCheckpoint(r.id, body.data, pkg);
      if (!res.ok) {
        recordFailure(r, res.failure, copy.generation);
        return { kind: "failed", failure: res.failure };
      }
      if (res.value.kind === "conflict") {
        enterConflict(r, res.value.server);
        return { kind: "conflict", server: res.value.server };
      }

      const accepted = res.value.accepted;
      clearError(r);
      const stillPending = r.meta.pending !== null && r.meta.pending.generation > copy.generation;
      setMeta(r, {
        baseGeneration: accepted.acceptedGeneration,
        registered: true,
        pending: stillPending ? r.meta.pending : null,
        serverSummary: { ...summary, generation: accepted.acceptedGeneration, savedAt: accepted.savedAt },
        lastSyncedAtMs: now(),
      });
      events.emit("save.synced", {
        contractId: r.id as ContractId,
        atMs: now(),
        generation: accepted.acceptedGeneration,
        flags: accepted.flags,
      });
      if (overwrite !== undefined) {
        // The local store still has the old generation: install the rebased header so the host continues after it.
        const shapes = copyToStoreShapes(copy);
        await options.install.install({ contractId: r.id, record: shapes.record, dust: null, source: "server" });
        r.localGeneration = copy.generation;
        r.crcCache.clear();
      }
      return { kind: "accepted", generation: accepted.acceptedGeneration };
    } finally {
      r.inFlight = false;
      publish(r);
    }
  }

  async function localParent(r: Runtime): Promise<number> {
    const rec = await store.load(r.id);
    return rec?.parentGeneration ?? 0;
  }

  function uploadSummary(r: Runtime, copy: CheckpointCopy, overwrite: boolean): SoloCheckpointSummary {
    const p = r.meta.pending;
    // An overwrite re-uploads the newest local state under a new generation: its summary is the pending one, renumbered.
    if (p !== null && (p.generation === copy.generation || overwrite)) {
      return { ...p.summary, generation: copy.generation, parentGeneration: copy.parentGeneration };
    }
    const input = options.summary.snapshot({ contractId: r.id, generation: copy.generation, simTick: copy.simTick });
    return summaryOf(copy, { ...input });
  }

  function handleReadFailure(r: Runtime, reason: CopyFailure, generation: number): AttemptResult {
    if (reason === "no_local_copy") {
      setMeta(r, { pending: null });
      return { kind: "nothing" };
    }
    if (reason === "unstable") {
      // A checkpoint landed while reading: try again soon (no backoff step, nothing is wrong).
      r.nextAttemptAtMs = now() + 5000;
      return { kind: "skipped" };
    }
    const failure: SyncFailure = {
      kind: reason === "too_large" ? "too_large" : "rejected",
      reason: null,
      retryAfterMs: null,
      status: null,
      auth: false,
    };
    if (reason === "unsupported") r.storageWarning = "unavailable";
    recordFailure(r, failure, generation);
    return { kind: "failed", failure };
  }

  function enterConflict(r: Runtime, server: SoloCheckpointSummary): void {
    const local =
      r.meta.pending?.summary ??
      summaryOf(
        {
          generation: r.localGeneration,
          parentGeneration: Math.max(0, r.localGeneration - 1),
          simTick: 0,
          savedAtMs: now(),
        },
        options.summary.snapshot({ contractId: r.id, generation: r.localGeneration, simTick: 0 }),
      );
    clearTimerOf(r);
    r.conflict = { local, server };
    r.error = null;
    setMeta(r, { serverSummary: server });
    events.emit("save.conflict", { contractId: r.id as ContractId, atMs: now(), local, server });
    publish(r);
  }

  // ---- download / install ------------------------------------------------------------------------------------------

  type DownloadResult =
    | { readonly ok: true; readonly copy: CheckpointCopy; readonly pages: Uint8Array[] }
    | { readonly ok: false; readonly why: "download" | CopyFailure; readonly failure?: SyncFailure };

  async function downloadServerCopy(r: Runtime): Promise<DownloadResult> {
    for (let restart = 0; restart <= DOWNLOAD_MAX_RESTARTS; restart++) {
      const pages: Uint8Array[] = [];
      let total = 1;
      let consistent = true;
      for (let i = 0; i < total; i++) {
        const res = await api.downloadPage(r.id, i);
        if (!res.ok) return { ok: false, why: "download", failure: res.failure };
        if (i === 0) total = res.value.pages;
        else if (res.value.pages !== total) {
          consistent = false;
          break;
        }
        if (total > DOWNLOAD_MAX_PAGES) return { ok: false, why: "too_large" };
        pages.push(res.value.bytes);
      }
      if (!consistent) continue;
      const assembled = await assembleCopy(pages, r.id, copyEnv, now());
      if (assembled.ok) return { ok: true, copy: assembled.copy, pages };
      if (assembled.reason === "mixed_generation" && restart < DOWNLOAD_MAX_RESTARTS) continue;
      return { ok: false, why: assembled.reason };
    }
    return { ok: false, why: "mixed_generation" };
  }

  /** Installs a verified server copy as the local copy; base = its generation, nothing pending. */
  async function installServerCopy(
    r: Runtime,
    copy: CheckpointCopy,
    serverSummary: SoloCheckpointSummary | null,
  ): Promise<boolean> {
    const shapes = copyToStoreShapes(copy);
    try {
      await options.install.install({ contractId: r.id, record: shapes.record, dust: shapes.dust, source: "server" });
    } catch {
      return false;
    }
    r.crcCache.clear();
    r.localGeneration = copy.generation;
    r.conflict = null;
    clearError(r);
    r.blocked = false;
    clearTimerOf(r);
    setMeta(r, {
      baseGeneration: copy.generation,
      registered: true,
      pending: null,
      serverSummary: serverSummary ?? r.meta.serverSummary,
      lastSyncedAtMs: now(),
    });
    events.emit("save.restored", {
      contractId: r.id as ContractId,
      atMs: now(),
      generation: copy.generation,
      source: "server",
    });
    publish(r);
    return true;
  }

  async function restoreFromServerCopy(
    r: Runtime,
    serverSummary: SoloCheckpointSummary | null,
  ): Promise<ClockInResult> {
    const dl = await downloadServerCopy(r);
    if (!dl.ok) {
      if (dl.failure !== undefined && !dl.failure.auth) recordFailure(r, dl.failure, r.localGeneration);
      return dl.failure !== undefined && TRANSIENT.has(dl.failure.kind)
        ? { kind: "offline", failure: dl.failure }
        : { kind: "restore_failed", reason: dl.why };
    }
    if (!(await installServerCopy(r, dl.copy, serverSummary))) return { kind: "restore_failed", reason: "download" };
    return { kind: "restored", generation: dl.copy.generation };
  }

  // ---- backup slot -------------------------------------------------------------------------------------------------

  async function storeBackup(r: Runtime, copy: CheckpointCopy, summary: SoloCheckpointSummary): Promise<boolean> {
    const pages = packPages(r.id, copy.generation, copy.generation, copy.header, copy.chunks);
    const record: BackupRecord = {
      contractId: r.id,
      generation: copy.generation,
      summary,
      storedAtMs: now(),
      expiresAtMs: now() + SOLO_BACKUP_RETENTION_DAYS * DAY_MS,
      pages: pages.map((p) => p.slice().buffer),
    };
    try {
      await metaStore.putBackup(record);
    } catch {
      r.storageWarning = "quota";
      return false;
    }
    r.backup = record;
    events.emit("save.backup_stored", {
      contractId: r.id as ContractId,
      atMs: now(),
      generation: record.generation,
      expiresAtMs: record.expiresAtMs,
    });
    return true;
  }

  // ---- head check --------------------------------------------------------------------------------------------------

  async function headCheck(r: Runtime): Promise<ClockInResult> {
    if (!canSync()) {
      publish(r);
      return { kind: "background" };
    }
    const regFailure = await ensureRegistered(r);
    if (regFailure !== null) {
      if (!r.refused) recordFailure(r, regFailure, r.localGeneration);
      return { kind: "offline", failure: regFailure };
    }
    const head = await api.head(r.id);
    if (!head.ok) {
      recordFailure(r, head.failure, r.localGeneration);
      return { kind: "offline", failure: head.failure };
    }
    r.headChecked = true;
    clearError(r);
    const server = head.value;
    const local = await store.load(r.id).catch(() => null);
    const dirty = r.meta.pending !== null || (local !== null && local.generation > r.meta.baseGeneration);
    const decision = decideHead({
      hasLocal: local !== null,
      localGeneration: local?.generation ?? 0,
      localSimTick: local?.simTick ?? 0,
      baseGeneration: r.meta.baseGeneration,
      dirty,
      server,
    });

    if (decision === "none") {
      publish(r);
      return { kind: "local_only" };
    }
    if (decision === "in_sync") {
      const gen = (server as SoloCheckpointSummary).generation;
      setMeta(r, { baseGeneration: gen, pending: null, serverSummary: server, lastSyncedAtMs: now() });
      publish(r);
      return { kind: "synced" };
    }
    if (decision === "upload") {
      const base = server === null ? 0 : server.generation;
      const rec = local as StoredCheckpointLike;
      // Server older than our base (rolled back) or empty: restart the fast-forward chain from what it has.
      setMeta(r, {
        baseGeneration: base,
        serverSummary: server,
        pending:
          r.meta.pending ??
          pendingOf(r, {
            generation: rec.generation,
            parentGeneration: rec.parentGeneration,
            simTick: rec.simTick,
            savedAtMs: rec.savedAtMs,
          }),
      });
      publish(r);
      return { kind: "queued" };
    }
    if (decision === "download") {
      if (r.hostRunning) {
        // The host already runs on a local copy: never swap its state silently. Ask.
        enterConflict(r, server as SoloCheckpointSummary);
        return { kind: "conflict" };
      }
      return restoreFromServerCopy(r, server);
    }
    enterConflict(r, server as SoloCheckpointSummary);
    return { kind: "conflict" };
  }

  // ---- events ------------------------------------------------------------------------------------------------------

  offs.push(
    events.on("save.checkpointed", (e) => {
      const r = rt;
      if (r === null || r.disposed || e.contractId !== r.id) return;
      const pending = pendingOf(r, {
        generation: e.generation,
        parentGeneration: e.parentGeneration,
        simTick: e.simTick,
        savedAtMs: e.atMs,
      });
      r.localGeneration = e.generation;
      r.blocked = false;
      r.authHeld = false; // a new checkpoint is a cheap, natural moment to try again (the token may have come back)
      if (r.error !== null && !TRANSIENT.has(r.error.kind)) r.error = null;
      setMeta(r, { pending });
      if (r.conflict !== null) r.conflict = { local: pending.summary, server: r.conflict.server };
      events.emit("save.queued", {
        contractId: r.id as ContractId,
        atMs: now(),
        generation: e.generation,
        pendingSinceMs: pending.sinceMs,
      });
      if (e.reason !== "timer") r.urgent = true;
      publish(r);
      schedule(r);
    }),
    events.on("save.storage_warning", (e) => {
      const r = rt;
      if (r === null || r.disposed || e.contractId !== r.id) return;
      r.storageWarning = e.warning;
      // Quota trouble: the local copy may stop updating, so the server copy becomes the safety net (data-model 3.7c).
      if (e.warning === "quota") r.urgent = true;
      publish(r);
      schedule(r);
    }),
    gate.onInteraction(() => {
      if (rt !== null) kick(rt);
    }),
    connectivity.onOnline(() => {
      if (rt !== null) kick(rt);
    }),
  );

  // ---- public API --------------------------------------------------------------------------------------------------

  function detachCurrent(): void {
    if (rt === null) return;
    clearTimerOf(rt);
    rt.disposed = true;
    rt = null;
  }

  async function attach(
    contractId: string,
    registration?: { readonly name: string; readonly seed: string },
  ): Promise<{ hasLocalCopy: boolean }> {
    detachCurrent();
    let meta = (await metaStore.getMeta(contractId).catch(() => null)) ?? emptyMeta(contractId, registration ?? null);
    if (registration !== undefined && meta.registration === null && !meta.registered) {
      meta = { ...meta, registration };
    }
    let backup = await metaStore.getBackup(contractId).catch(() => null);
    if (backup !== null && backup.expiresAtMs <= now()) {
      await metaStore.deleteBackup(contractId).catch(() => undefined);
      backup = null;
    }
    const local = await store.load(contractId).catch(() => null);
    const r: Runtime = {
      id: contractId,
      meta,
      localGeneration: local?.generation ?? 0,
      conflict: null,
      error: null,
      blocked: false,
      refused: false,
      authHeld: false,
      inFlight: false,
      failures: 0,
      nextAttemptAtMs: 0,
      lastAttemptAtMs: 0,
      urgent: false,
      timer: undefined,
      headChecked: false,
      headBusy: false,
      hostRunning: false,
      storageWarning: null,
      backup,
      chain: Promise.resolve(),
      persistChain: Promise.resolve(),
      crcCache: new Map(),
      disposed: false,
    };
    rt = r;
    // A local generation above the base without a marker (the marker write was lost): derive it.
    if (local !== null && r.meta.pending === null && local.generation > r.meta.baseGeneration) {
      r.meta = {
        ...r.meta,
        pending: pendingOf(r, {
          generation: local.generation,
          parentGeneration: local.parentGeneration,
          simTick: local.simTick,
          savedAtMs: local.savedAtMs,
        }),
      };
      persist(r);
    }
    publish(r);
    return { hasLocalCopy: local !== null };
  }

  async function clockIn(
    contractId: string,
    opts: {
      readonly registration?: { readonly name: string; readonly seed: string };
      readonly maxWaitMs?: number;
    } = {},
  ): Promise<ClockInResult> {
    gate.markInteracted(); // Clock In is a user action
    await attach(contractId, opts.registration);
    const r = rt as Runtime;
    const check = exclusive(r, () => runHead(r));
    const maxWait = opts.maxWaitMs ?? 3000;
    if (!Number.isFinite(maxWait)) {
      const result = await check;
      if (result.kind === "background" || result.kind === "offline") r.hostRunning = true;
      schedule(r);
      return result;
    }
    const TIMEOUT = Symbol("timeout");
    const raced = await Promise.race([check, sleep(maxWait).then(() => TIMEOUT)]);
    if (raced === TIMEOUT) {
      // No answer yet (cold server): the caller boots from the local copy; a newer server copy becomes a prompt.
      r.hostRunning = true;
      void check.then(() => schedule(r)).catch(() => undefined);
      return { kind: "background" };
    }
    const result = raced as ClockInResult;
    if (result.kind === "background" || result.kind === "offline") r.hostRunning = true;
    schedule(r);
    return result;
  }

  async function flush(contractId: string, reason: "pause" | "clock_out" | "handoff" | "manual"): Promise<FlushResult> {
    const r = rt;
    if (r === null || r.id !== contractId) return { kind: "blocked", why: "no_session" };
    void reason; // every reason is "as soon as the server allows"; the caller already wrote the checkpoint
    gate.markInteracted();
    if (gate.automated()) return { kind: "blocked", why: "automated" };
    if (!connectivity.isOnline()) return { kind: "blocked", why: "offline" };
    r.blocked = false;
    r.authHeld = false;
    r.nextAttemptAtMs = 0;
    r.urgent = true;
    const startBase = r.meta.baseGeneration;
    // A concurrent timer-driven upload may take the pending checkpoint first: that still counts as accepted.
    const settled = (): FlushResult =>
      r.meta.pending === null && r.meta.baseGeneration > startBase
        ? { kind: "accepted", generation: r.meta.baseGeneration }
        : { kind: "nothing_pending" };
    const unreachable: SyncFailure = {
      kind: "server_error",
      reason: null,
      retryAfterMs: null,
      status: null,
      auth: false,
    };
    try {
      for (let round = 0; round < 3; round++) {
        const wait = Math.min(MAX_FLUSH_WAIT_MS, r.lastAttemptAtMs + minIntervalMs - now());
        if (wait > 0) await sleep(wait);
        const result: AttemptResult = await exclusive(r, async (): Promise<AttemptResult> => {
          // The head check comes first when it has not succeeded yet, so a stale base is caught before the upload.
          if (!r.headChecked) {
            const head = await runHead(r);
            if (head.kind === "conflict")
              return { kind: "conflict", server: r.conflict?.server as SoloCheckpointSummary };
            if (head.kind === "offline") return { kind: "failed", failure: head.failure };
          }
          return attemptUpload(r);
        });
        if (result.kind === "accepted") return result;
        if (result.kind === "conflict") return { kind: "conflict" };
        if (result.kind === "nothing") return settled();
        if (result.kind === "skipped") {
          if (r.meta.pending === null) return settled();
          if (r.refused) return { kind: "blocked", why: "not_registered" };
          continue; // a checkpoint landed while reading: try again
        }
        const f = result.failure;
        if (f.kind === "rate_limited" && f.retryAfterMs !== null && f.retryAfterMs <= MAX_FLUSH_WAIT_MS && round < 2) {
          await sleep(f.retryAfterMs);
          r.nextAttemptAtMs = 0;
          continue;
        }
        return { kind: "failed", failure: f };
      }
    } catch {
      return { kind: "failed", failure: unreachable };
    }
    return { kind: "failed", failure: unreachable };
  }

  async function restoreFromServer(contractId: string): Promise<ClockInResult> {
    if (rt === null || rt.id !== contractId) await attach(contractId);
    const r = rt as Runtime;
    gate.markInteracted();
    return exclusive(r, () => restoreFromServerCopy(r, null));
  }

  async function resolveConflict(choice: SaveConflictChoice): Promise<ResolveResult> {
    const r = rt;
    if (r === null || r.conflict === null) return { kind: "no_conflict" };
    return exclusive(r, async (): Promise<ResolveResult> => {
      const conflict = r.conflict;
      if (conflict === null) return { kind: "no_conflict" };
      const dl = await downloadServerCopy(r);
      if (!dl.ok) {
        if (dl.failure !== undefined && !dl.failure.auth) recordFailure(r, dl.failure, r.localGeneration);
        return { kind: "failed", why: dl.why, ...(dl.failure !== undefined ? { failure: dl.failure } : {}) };
      }
      const serverCopy = dl.copy;

      if (choice === "use_server") {
        // 1. The local copy goes to the backup slot (if it can be read and stored); 2. the server copy replaces it.
        const local = await readLocalCopy(store, r.id, {
          ...copyEnv,
          sinceGeneration: 0,
          full: true,
          crcCache: r.crcCache,
        });
        if (local.ok) {
          if (!(await storeBackup(r, local.copy, conflict.local))) return { kind: "failed", why: "local" };
        }
        if (!(await installServerCopy(r, serverCopy, conflict.server))) return { kind: "failed", why: "install" };
        events.emit("save.resolved", { contractId: r.id as ContractId, atMs: now(), choice });
        return { kind: "resolved", generation: serverCopy.generation };
      }

      // keep_local: 1. the server copy goes to the backup slot; 2. the newest local copy is re-uploaded as an explicit overwrite.
      const backupRecord: BackupRecord = {
        contractId: r.id,
        generation: serverCopy.generation,
        summary: conflict.server,
        storedAtMs: now(),
        expiresAtMs: now() + SOLO_BACKUP_RETENTION_DAYS * DAY_MS,
        pages: dl.pages.map((p) => p.slice().buffer),
      };
      try {
        await metaStore.putBackup(backupRecord);
      } catch {
        r.storageWarning = "quota";
        return { kind: "failed", why: "local" };
      }
      r.backup = backupRecord;
      events.emit("save.backup_stored", {
        contractId: r.id as ContractId,
        atMs: now(),
        generation: backupRecord.generation,
        expiresAtMs: backupRecord.expiresAtMs,
      });
      const newGeneration = Math.max(r.localGeneration, serverCopy.generation) + 1;
      // The upload gate: resolving is a user action, so interaction is satisfied; the conflict itself pauses plain uploads.
      const result = await attemptUpload(r, { generation: newGeneration, baseGeneration: serverCopy.generation });
      if (result.kind === "accepted") {
        r.conflict = null;
        r.blocked = false;
        events.emit("save.resolved", { contractId: r.id as ContractId, atMs: now(), choice });
        publish(r);
        return { kind: "resolved", generation: result.generation };
      }
      if (result.kind === "conflict") {
        r.conflict = { local: r.conflict?.local ?? conflict.local, server: result.server };
        publish(r);
        return { kind: "conflict_again" };
      }
      return { kind: "failed", why: "upload", ...(result.kind === "failed" ? { failure: result.failure } : {}) };
    });
  }

  async function restoreBackup(): Promise<ResolveResult> {
    const r = rt;
    if (r === null) return { kind: "no_backup" };
    return exclusive(r, async (): Promise<ResolveResult> => {
      const backup = r.backup ?? (await metaStore.getBackup(r.id).catch(() => null));
      if (backup === null || backup.expiresAtMs <= now()) return { kind: "no_backup" };
      const assembled = await assembleCopy(
        backup.pages.map((p) => new Uint8Array(p)),
        r.id,
        copyEnv,
        now(),
      );
      if (!assembled.ok) return { kind: "failed", why: assembled.reason };
      const saved = assembled.copy;

      // New generation on top of the current state: above the local, base and server generations.
      const newGeneration = Math.max(r.localGeneration, r.meta.baseGeneration, r.conflict?.server.generation ?? 0) + 1;
      const parent = r.localGeneration;
      let rawHeader: Uint8Array;
      try {
        rawHeader = await decompress(saved.header, "gzip", HEADER_RAW_MAX_BYTES);
        rawHeader = withGeneration(rawHeader, newGeneration, parent);
      } catch {
        return { kind: "failed", why: "corrupt" };
      }
      const header = await compress(rawHeader, "gzip");
      const restored: CheckpointCopy = {
        ...saved,
        header,
        generation: newGeneration,
        parentGeneration: parent,
        savedAtMs: now(),
        facts: { ...saved.facts, generation: newGeneration, parentGeneration: parent },
      };

      // Swap: the copy being replaced takes the slot, so nothing is lost by restoring.
      const current = await readLocalCopy(store, r.id, {
        ...copyEnv,
        sinceGeneration: 0,
        full: true,
        crcCache: r.crcCache,
      });
      if (current.ok) {
        const summary =
          r.meta.pending?.summary ??
          summaryOf(
            current.copy,
            options.summary.snapshot({
              contractId: r.id,
              generation: current.copy.generation,
              simTick: current.copy.simTick,
            }),
          );
        if (!(await storeBackup(r, current.copy, summary))) return { kind: "failed", why: "local" };
      } else {
        await metaStore.deleteBackup(r.id).catch(() => undefined);
        r.backup = null;
      }

      const shapes = copyToStoreShapes(restored);
      try {
        await options.install.install({ contractId: r.id, record: shapes.record, dust: shapes.dust, source: "backup" });
      } catch {
        return { kind: "failed", why: "install" };
      }
      r.crcCache.clear();
      r.localGeneration = newGeneration;
      const pending = pendingOf(r, {
        generation: newGeneration,
        parentGeneration: parent,
        simTick: restored.simTick,
        savedAtMs: restored.savedAtMs,
      });
      setMeta(r, {
        pending: { ...pending, summary: { ...backup.summary, generation: newGeneration, parentGeneration: parent } },
      });
      if (r.conflict !== null)
        r.conflict = { local: r.meta.pending?.summary ?? r.conflict.local, server: r.conflict.server };
      events.emit("save.restored", {
        contractId: r.id as ContractId,
        atMs: now(),
        generation: newGeneration,
        source: "backup",
      });
      publish(r);
      schedule(r);
      return { kind: "resolved", generation: newGeneration };
    });
  }

  return {
    attach,
    clockIn,
    flush,
    restoreFromServer,
    resolveConflict,
    restoreBackup,
    async handleRequest(request) {
      try {
        if (request.kind === "resolve_conflict") await resolveConflict(request.choice);
        else await restoreBackup();
      } finally {
        sink({ request: null }); // the request is consumed whatever the outcome
      }
    },
    notifyAuthChanged() {
      if (rt !== null) {
        rt.authHeld = false;
        rt.nextAttemptAtMs = 0;
        kick(rt);
      }
    },
    detach(contractId) {
      if (rt !== null && rt.id === contractId) detachCurrent();
    },
    get state() {
      return rt === null ? null : stateOf(rt);
    },
    dispose() {
      detachCurrent();
      for (const off of offs.splice(0)) off();
    },
  };
}
