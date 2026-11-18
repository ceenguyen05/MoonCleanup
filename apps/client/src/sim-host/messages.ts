// Private message envelopes between LocalRoomHost (main thread) and the sim worker (ADR-0031). Single owner: this
// directory. Nothing outside apps/client/src/sim-host imports this file (module-boundaries section 3).
//
// Hot path (every tick / input) uses bare transferable ArrayBuffers, told apart by their byte length:
//   - INPUT_BUF_BYTES   main -> worker: one INPUT message (packages/protocol encodeInput, 1 input); worker -> main: the
//                       same buffer handed back to the main-thread input pool.
//   - FRAME_BUF_BYTES   worker -> main: one FRAME (packages/protocol FrameWriter) in bytes [0, length), then a trailer
//                       at FRAME_TRAILER_OFFSET; main -> worker: the buffer released back to the pool of 3.
// Everything else is a small control object (rare: boot, intents, checkpoints, events, shift state, stats).
// No SharedArrayBuffer (no COOP/COEP requirement).

import { FRAME_MAX_BYTES, type ShiftStateView } from "@moon-cleanup/shared";
import type {
  ActorJoinInfo,
  ContractId,
  ControlIntent,
  LocalCheckpointMeta,
  LocalCheckpointReason,
  RoomHostState,
  RoomSimEvent,
  SaveStorageWarning,
  ShiftType,
} from "@moon-cleanup/shared";
import type { GroundHeightOptions, HeightCubeLayout } from "@moon-cleanup/world";
import { inputMessageBytes } from "@moon-cleanup/protocol";
import type { DustChunkWrite, StoredDustChunk } from "./checkpoint-store";

/** Bumped when an envelope below changes (main and worker ship in one bundle, so this guards stale workers only). */
export const SIM_HOST_PROTOCOL_VERSION = 4;

/** One INPUT message with exactly one input (12 bytes). */
export const INPUT_BUF_BYTES = inputMessageBytes(1);

/** Frame buffers in flight (ADR-0031: fixed pool of 3, ping-pong, returned after decode). */
export const FRAME_POOL_SIZE = 3;

/** Trailer after the FRAME bytes: u16 frame length, u8 tag, u8 reserved, u32 sim tick (LE). */
export const FRAME_TRAILER_OFFSET = FRAME_MAX_BYTES;
export const FRAME_TRAILER_BYTES = 40;
export const FRAME_TRAILER_TAG = 0xf1;
/**
 * Private tool-telemetry block after the 8-byte trailer head (Solo only; never part of the FRAME protocol), offsets from
 * FRAME_TRAILER_OFFSET: +8 flags u8, +9 tool code u8, +10 phase u16 (phase01 * 65535), +12 period ms u16, +14 processed
 * input seq u16, +16 head x/y/z f64 (moon-centred metres; f32 would be 0.1 m coarse).
 */
export const TOOL_TELEMETRY_OFFSET = FRAME_TRAILER_OFFSET + 8;
export const TOOL_TELE_PRESENT = 1;
export const TOOL_TELE_SWEEPING = 2;
export const TOOL_TELE_IN_CONTACT = 4;
export const TOOL_TELE_HEAD_VALID = 8;
export const TOOL_TELE_DETAILING = 16;
export const FRAME_BUF_BYTES = FRAME_MAX_BYTES + FRAME_TRAILER_BYTES;

/** Terrain the worker builds its `SimWorld` from. `flat` is a test/debug world (H = 0). */
export type SimHostWorldConfig =
  | {
      readonly kind: "cube";
      /** Height cube bytes (transferred to the worker; the caller passes a copy if it keeps its own). */
      readonly cube: ArrayBuffer;
      readonly layout: HeightCubeLayout;
      readonly ground: GroundHeightOptions;
    }
  | { readonly kind: "flat" };

/** Clock of the worker loop. `realtime`: drift-compensated fixed step. `manual`: steps only on `step` (tests). */
export type SimHostClockMode = "realtime" | "manual";

/** Where checkpoints go. `auto`: IndexedDB when available, else memory (the host keeps a copy for crash reboots). */
export type SimHostStoreKind = "auto" | "indexeddb" | "memory";

export interface SimHostBootConfig {
  readonly protocolVersion: number;
  readonly contractId: ContractId;
  readonly shiftType: ShiftType;
  readonly player: ActorJoinInfo;
  readonly world: SimHostWorldConfig;
  readonly clock: SimHostClockMode;
  readonly store: SimHostStoreKind;
  /** IndexedDB database name (tests isolate themselves with their own). */
  readonly dbName: string;
  /** Restore the newest local checkpoint of `contractId` if one exists. */
  readonly restore: boolean;
  /** Checkpoint bytes kept by the host when IndexedDB is unavailable (crash reboot without storage). */
  readonly restoreBytes: ArrayBuffer | null;
  /** Dust chunk rows that belong to `restoreBytes` (the host's copies; used only when `restoreBytes` is). */
  readonly restoreDust: readonly StoredDustChunk[] | null;
  readonly tickHz: number | undefined;
  /** Seconds between dirty checks for `timer` checkpoints (SOLO_LOCAL_CHECKPOINT_INTERVAL_S). 0 disables. */
  readonly checkpointIntervalS: number;
  /** 64 lower-case hex chars: terrain + grid bake hash written into the save header. */
  readonly bakeHash: string;
  /** 32 lower-case hex chars: device id (save header originId). */
  readonly originId: string;
  /** Start state of a brand-new Contract (ignored when a checkpoint is restored). */
  readonly fresh: {
    readonly walletLm: number | undefined;
    readonly spawnDirection: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  };
  /** Milliseconds between worker stats posts (0 disables). */
  readonly statsIntervalMs: number;
}

// ---- main -> worker -----------------------------------------------------------------------------------------------

export type ToWorkerControl =
  | { readonly t: "boot"; readonly cfg: SimHostBootConfig; readonly frames: readonly ArrayBuffer[] }
  | { readonly t: "step"; readonly n: number }
  | { readonly t: "intent"; readonly intent: ControlIntent }
  | { readonly t: "ckpt"; readonly id: number; readonly reason: LocalCheckpointReason }
  | { readonly t: "pause"; readonly id: number }
  | { readonly t: "suspend"; readonly id: number }
  | { readonly t: "resume" }
  | { readonly t: "close"; readonly id: number; readonly finalCheckpoint: boolean }
  | { readonly t: "hash"; readonly id: number }
  /** Send the whole dust state (`dust` reply) after the current tick; deferred until boot has finished. */
  | { readonly t: "dustsync" }
  /** Read-out request (see `SimReadoutMessage`): inspect flag for the Plot Card and the item ids to quote. */
  | { readonly t: "ro_req"; readonly seq: number; readonly inspecting: boolean; readonly itemIds: readonly string[] }
  | { readonly t: "crash" };

/**
 * The whole dust ledger of the worker at the end of one tick, for the main-thread ledger view (dust-view.ts): every
 * non-pristine chunk as an uncompressed packages/world chunk payload. Frames posted before it are covered by it; frames
 * posted after it carry only newer strokes.
 */
export interface DustStateMessage {
  readonly t: "dust";
  readonly tick: number;
  readonly bakeCheck: number;
  readonly chunks: readonly ArrayBuffer[];
  /** `request`: asked for by the host; `dropped`: the frame encoder lost strokes, so the view must resync. */
  readonly reason: "request" | "dropped";
}

// ---- worker -> main -----------------------------------------------------------------------------------------------

export type RestoredFrom = "none" | "local" | "memory";

/** Worker-side measurements (E13/E14 evidence). Times in ms. */
export interface SimWorkerStats {
  readonly tick: number;
  readonly ticks: number;
  readonly tickP50Ms: number;
  readonly tickP95Ms: number;
  readonly tickMaxMs: number;
  readonly ticksDropped: number;
  readonly framesSent: number;
  readonly framesSkippedNoBuffer: number;
  readonly frameBytesP95: number;
  readonly strokesDropped: number;
  readonly inputsConsumed: number;
  readonly inputsSubstituted: number;
  readonly inputsStarved: number;
  readonly inputsDoubleStepped: number;
  readonly inputsDropped: number;
  readonly checkpoints: number;
  readonly checkpointP95Ms: number;
  /**
   * The part of a checkpoint that runs between two ticks on the worker thread: sim capture plus dust chunk encode.
   * (Compression and the IndexedDB write run after it and never hold a tick.)
   */
  readonly checkpointCaptureP95Ms: number;
  readonly checkpointCaptureMaxMs: number;
  readonly checkpointCaptureLastMs: number;
  /** Dust chunk rows written by checkpoints, their uncompressed bytes, and rows over the upload size limit. */
  readonly dustChunksWritten: number;
  readonly dustRawBytesWritten: number;
  readonly dustChunksOversize: number;
  /** Dust restore of this boot: chunks installed / rejected, plots with a ledger / Polished, repaired records. */
  readonly dustRestoreChunks: number;
  readonly dustRestoreRejected: number;
  readonly dustRestoreLedgers: number;
  readonly dustRestorePolished: number;
  readonly dustRestoreRepairs: number;
  /** Total time, number of slices and the longest slice of that restore (budget DUST_RESTORE_SLICE_BUDGET_MS). */
  readonly dustRestoreMs: number;
  readonly dustRestoreSlices: number;
  readonly dustRestoreSliceMaxMs: number;
  /** Ledgers in use, and how often the ledger pool grew during play (0 = no allocation on the tick path). */
  readonly ledgers: number;
  readonly ledgerPoolGrowths: number;
  /** Plots that became Opened / Polished since boot (the sim's counters; each Polished plot paid its Stamp). */
  readonly plotsOpened: number;
  readonly plotsPolished: number;
}

export interface CheckpointReply {
  readonly t: "ckpt";
  readonly id: number;
  readonly meta: LocalCheckpointMeta | null;
  readonly reason: LocalCheckpointReason;
  readonly error: string | null;
  /** Copy of the stored bytes when the worker has no IndexedDB (memory store). */
  readonly bytes: ArrayBuffer | null;
  /** Copies of the dust chunk rows written with it (memory store only). */
  readonly dust: DustChunkWrite | null;
}

/**
 * Read-only sim read-outs for the HUD (Hop gauge, Crown Lamp, Plot Card, Desk / Board price quotes) of the own avatar.
 * The worker owns the only MoonRoomSim, so it samples the sim's pure read helpers at most every
 * `READOUT_INTERVAL_MS` and posts this flat message only when a value changed (never on the input or frame path;
 * the worker reuses one object, the main thread copies it into a cache). `plotOpen` is false unless the host asked to
 * inspect (`ro_req.inspecting`) and a plot is in front of the avatar. `quotes[i]` answers `ro_req.itemIds[i]`
 * (`quotePriceLm`: 0 = free handback, -1 = not buyable).
 */
export interface SimReadoutMessage {
  t: "ro";
  /** `ro_req.seq` this sample answers (a sample of an older request is dropped by the host). */
  reqSeq: number;
  /** Own driven vehicle presentation, sampled with the HUD at 10 Hz. */
  vehicleMotion?: {
    tick: number;
    vehicleId: number;
    kindId: string;
    speed01: number;
    load01: number;
    workIntensity01: number;
    /** Running lamps lit. */
    lights?: boolean;
  } | null;
  /** Own vehicle out of the Motor Pool and not being driven (called, parked): chassis point and heading, 10 Hz. */
  parkedVehicle?: { x: number; y: number; z: number; fx: number; fy: number; fz: number } | null;
  hopBursts: number;
  hopMax: number;
  hopRecharge01: number;
  lampLevel: number;
  lampSwitchedOn: boolean;
  lampLit: boolean;
  plotOpen: boolean;
  plotId: number;
  plotState: number;
  plotRemainingPct: number;
  plotTerrainId: string | null;
  /** -1 = nobody. */
  plotCreditedSlot: number;
  plotCountsTowardShine: boolean;
  plotShinePctPerPlot: number;
  quotes: number[];
  /** Near Parcels of the Contract: count, collected bit mask (bit k = parcel k), unit directions (x, y, z triples). */
  parcelCount: number;
  parcelMask: number;
  parcelDirs: number[];
  /** Outposts: ids and unit directions (x, y, z triples), home first. */
  outpostIds: string[];
  outpostDirs: number[];
  /** Landing Apron plots of the home outpost: unit directions (x, y, z triples); fixed after construction. */
  apronDirs: number[];
}

/** Worker sampling period of the read-outs (ms): 10 Hz. */
export const READOUT_INTERVAL_MS = 100;

export type FromWorkerControl =
  | { readonly t: "state"; readonly state: RoomHostState }
  | {
      readonly t: "ready";
      readonly tick: number;
      readonly simTickHz: number;
      readonly generation: number;
      readonly restoredFrom: RestoredFrom;
      readonly storeKind: "indexeddb" | "memory";
    }
  | { readonly t: "ev"; readonly list: readonly RoomSimEvent[] }
  | { readonly t: "ss"; readonly view: ShiftStateView }
  | CheckpointReply
  | { readonly t: "stats"; readonly stats: SimWorkerStats }
  | { readonly t: "warn"; readonly warning: SaveStorageWarning }
  /**
   * The stored save could not be restored (corrupt, unsupported or rejected by the sim) and the game started fresh;
   * or (reason starts with "dust chunks") the save was restored but some dust chunks were unreadable and their plots
   * are untouched again.
   */
  | { readonly t: "restore_failed"; readonly reason: string }
  /** `hash`: sim state hash; `dustHash`: `WorldDustLedger.worldHash()` (every ledger and Polished plot). */
  | { readonly t: "hash"; readonly id: number; readonly tick: number; readonly hash: number; readonly dustHash: number }
  | { readonly t: "closed"; readonly id: number }
  | DustStateMessage
  | SimReadoutMessage
  | { readonly t: "fatal"; readonly message: string };

/** Minimal endpoint both sides talk through (a Worker, a DedicatedWorkerGlobalScope or a MessagePort). */
export interface SimHostEndpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
}
