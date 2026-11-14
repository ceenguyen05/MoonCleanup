// @contract client/room-host v1
// @consumers apps/client/src/sim-host (implements LocalRoomHost), apps/client/src/net (implements RemoteRoomHost and
//   publishes the roomHost service), apps/client/src/{gameplay,terrain,ui,debug} (consume RoomHost through the
//   `roomHost` service), apps/client/src/app (registers the service), this package's client/module
//
// RoomHost: the one surface the client gameplay path talks to, whether the authoritative RoomSim runs in the Solo Web
// Worker (LocalRoomHost) or on the server (RemoteRoomHost). Specification: ADR-0031; docs/architecture/netcode.md
// section 19; module-boundaries.md sections 3 and 4. Contract proposal: docs/agent-reports/M0-adr-0031-local-first.md.
//
// Rules:
// - No DOM, Worker, MessagePort, WebSocket or Colyseus type appears here. The worker message envelopes stay private to
//   apps/client/src/sim-host (single owner); the Colyseus room stays private to apps/client/src/net.
// - Frames use the packages/protocol FRAME layout in both modes (one decode path, shared golden vectors). A frame's
//   buffer is pooled: read it inside the listener (or until `release()`), then release it; never keep it. The pool is
//   fixed (3 buffers locally), so a consumer that never releases starves the host.
// - `sendInput` copies the command into a pooled buffer and `onFrame` hands out pooled buffers: zero steady-state
//   allocation on the render thread (ADR-0031 "Render-thread budget"). `sendIntent` is rare (purchases, tool select).
// - Solo-first: nothing in this surface may add latency to LocalRoomHost. `sendInput` returns synchronously and never
//   waits for an acknowledgement; the prediction path reconciles against `RoomHostFrame.ackInputSeq`.
// - Open to friends: the app calls `LocalRoomHost.checkpoint("handoff")`, uploads it (must be accepted), then
//   `suspend()`. Once the room is joined the app publishes the RemoteRoomHost through the service and closes the local
//   host with `close("open_to_friends")`. Return to solo is the reverse: remote host `close("return_to_solo")`, download
//   the newest save, boot a fresh LocalRoomHost.
// - Adding a state, close reason or checkpoint reason is not breaking; renaming or removing one is.

import { z } from "zod";
import type { ContractId } from "../ids";
import { ContractIdSchema } from "../ids";
import type { ControlIntent, RoomSimEvent, ShiftStateView, ShiftType, SimInputCommand } from "../sim";
import type { Unsubscribe } from "../events";
import type { Tick } from "../units";

// ---- Kinds, states, reasons ---------------------------------------------------------------------------------------

/** `local`: RoomSim in the Solo Web Worker. `remote`: RoomSim on the server (Colyseus room). */
export const ROOM_HOST_KINDS = ["local", "remote"] as const;
export type RoomHostKind = (typeof ROOM_HOST_KINDS)[number];

/**
 * Lifecycle of a host.
 * - `booting`: created, worker or socket starting. `loading`: restoring the newest save / receiving the join keyframe.
 * - `running`: stepping (local) or receiving frames (remote).
 * - `paused`: local only; `pause()` stopped the loop (for example a hidden tab). The newest checkpoint is current.
 * - `suspended`: local only; the loop is stopped for an Open-to-friends handoff and can `resume()` if the handoff fails.
 * - `closed`: disposed on purpose (see RoomHostCloseReason). `failed`: unrecoverable (worker boot failed twice, socket
 *   lost for good); the UI offers Reload / Return.
 */
export const ROOM_HOST_STATES = ["booting", "loading", "running", "paused", "suspended", "closed", "failed"] as const;
export type RoomHostState = (typeof ROOM_HOST_STATES)[number];

/** Why a host is closed. */
export const ROOM_HOST_CLOSE_REASONS = [
  "clock_out",
  "open_to_friends",
  "return_to_solo",
  "conflict_resolved",
  "error",
] as const;
export type RoomHostCloseReason = (typeof ROOM_HOST_CLOSE_REASONS)[number];

/** What triggered a local checkpoint (cadence rules: SOLO_LOCAL_CHECKPOINT_INTERVAL_S when dirty, plus these). */
export const LOCAL_CHECKPOINT_REASONS = ["timer", "hidden", "pause", "clock_out", "handoff"] as const;
export type LocalCheckpointReason = (typeof LOCAL_CHECKPOINT_REASONS)[number];

// ---- Frames and checkpoint meta -----------------------------------------------------------------------------------

/**
 * One frame in the packages/protocol FRAME layout. `bytes` is a pooled buffer with `byteLength` valid bytes; it is valid
 * until `release()` (call it exactly once; a second call is harmless). Locally the buffer is a transferred
 * `ArrayBuffer` returned to the worker by `release()`.
 */
export interface RoomHostFrame {
  readonly tick: Tick;
  /** Highest input seq of the local player this frame includes; 0 before the first input. */
  readonly ackInputSeq: number;
  readonly bytes: ArrayBuffer;
  readonly byteLength: number;
  release(): void;
}

/** What a finished local checkpoint reports (the encoded save itself stays inside sim-host). */
export const LocalCheckpointMetaSchema = z.object({
  contractId: ContractIdSchema,
  /** Generation written; `parentGeneration` is the one it descends from (SaveHeader rule: generation > parent). */
  generation: z.int().min(1),
  parentGeneration: z.int().min(0),
  simTick: z.int().min(0),
  /** `Date.now()` when the write finished. */
  savedAtMs: z.int().min(0),
  /** Compressed bytes stored. */
  bytes: z.int().min(1),
});
export interface LocalCheckpointMeta {
  readonly contractId: ContractId;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly simTick: Tick;
  readonly savedAtMs: number;
  readonly bytes: number;
}

// ---- Host interfaces ----------------------------------------------------------------------------------------------

interface RoomHostBase {
  readonly kind: RoomHostKind;
  readonly contractId: ContractId;
  /** Fixed-step rate of the authority (SIM_TICK_HZ): 20, or the supported 30. */
  readonly simTickHz: number;
  readonly state: RoomHostState;
  /** Queues the local player's input for the next step. Copies into a pooled buffer; never allocates, never throws. */
  sendInput(cmd: SimInputCommand): void;
  /** Queues a control intent (purchase, build, tool select). Rare; may allocate. The outcome arrives as an event. */
  sendIntent(intent: ControlIntent): void;
  /** Frames at the host's cadence: every sim tick when local, snapshot rate (10 Hz) plus own-avatar when remote. */
  onFrame(listener: (frame: RoomHostFrame) => void): Unsubscribe;
  /** Low-rate shared state (wallet, upgrades, roster, beacons): plain readonly data, delivered only on change. */
  onShiftState(listener: (state: ShiftStateView) => void): Unsubscribe;
  /** RoomSim events (`SimEventMap`; `dust.collected` excluded on remote hosts, it rides the dust channel). */
  onEvent(listener: (event: RoomSimEvent) => void): Unsubscribe;
  onStateChange(listener: (state: RoomHostState) => void): Unsubscribe;
  /** Final flush, then dispose. Resolves when the host is `closed`. Never rejects (failures end in `failed`). */
  close(reason: RoomHostCloseReason): Promise<void>;
}

/** Solo Shift host: RoomSim in a module Web Worker, saves in IndexedDB (apps/client/src/sim-host). */
export interface LocalRoomHost extends RoomHostBase {
  readonly kind: "local";
  /** Newest local save generation (0 before the first checkpoint of a new Contract). */
  readonly generation: number;
  /** Encodes and stores a checkpoint now (also the cadence entry point). Resolves after the IndexedDB commit. */
  checkpoint(reason: LocalCheckpointReason): Promise<LocalCheckpointMeta>;
  /** Stops the loop (state `paused`). */
  pause(): void;
  /** Writes the `handoff` checkpoint, then stops the loop (state `suspended`). */
  suspend(): Promise<LocalCheckpointMeta>;
  /** Restarts the loop from `paused` or `suspended`. */
  resume(): void;
}

/** Server room host: Colyseus room via apps/client/src/net. Covers Private, Open and a Solo Shift opened to friends. */
export interface RemoteRoomHost extends RoomHostBase {
  readonly kind: "remote";
  readonly roomId: string;
  readonly shiftType: ShiftType;
  /** Last measured round-trip time in ms; `null` until the first PONG. */
  readonly rttMs: number | null;
}

export type RoomHost = LocalRoomHost | RemoteRoomHost;

// ---- Service ------------------------------------------------------------------------------------------------------

/**
 * The `roomHost` service (`ServiceTypes.roomHost`). A stable facade, because the registry rejects a second registration
 * and the host changes during a session (Open to friends, Return to solo, Clock Out). Gameplay, terrain, ui and debug
 * read `current` and re-bind in `onChange`. `current` is `null` before Clock In and after Clock Out.
 */
export interface RoomHostService {
  readonly current: RoomHost | null;
  /** Called after `current` changed (the new host is already in `state` `booting` or later). */
  onChange(listener: (host: RoomHost | null, previous: RoomHost | null) => void): Unsubscribe;
}
