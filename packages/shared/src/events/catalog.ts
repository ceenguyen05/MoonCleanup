// @contract events/catalog v1.2
// @consumers apps/client/src/net (emits net.status), apps/client/src/render (emits render.backendSelected and
//   quality.changed), apps/client/src/ui, apps/client/src/audio, apps/client/src/visuals, apps/client/src/debug
//   (listen), apps/client/src/app (builds the bus), this package's client/module and ui/store
//
// Version note: v1.1 (M1-W0-T06) adds SaveEventMap from events/save; additive. v1.2 (contracts bump 1 of M1) carries the
// four new presentation events of events/gameplay v1.1 (`avatar.stepped`, `vehicle.motion`, `audio.cue`,
// `audio.settings`) through PresentationEventMap; no code change in this file.
//
// Typed event bus and the event catalog. Specification: docs/architecture/module-boundaries.md sections 1 (rule 5),
// 2 and 4; ADR-0022. Events are in-process notifications: sim, gameplay and net emit them; ui, audio, visuals and
// animation listen and never mutate sim state through them. Payloads are read-only.
//
// v0 held the three M0 events. v1 (M1-W0-T03) adds the MVP gameplay catalog from events/gameplay: SimEventMap (events
// the RoomSim produces) and PresentationEventMap (client-derived, never on the wire); the net.status,
// render.backendSelected and quality.changed payloads are unchanged. Adding an event is not a breaking change;
// renaming or removing one is. Naming: `<domain>.<name>`. The three M0 names are written exactly as the M0 task card
// spells them.

import type { HardwareTier, QualitySettings, RenderBackend } from "../render";
import { PRESENTATION_EVENT_NAMES, SIM_EVENT_NAMES, type PresentationEventMap, type SimEventMap } from "./gameplay";
import { SAVE_EVENT_NAMES, type SaveEventMap } from "./save";
import type { Milliseconds } from "../units";

// ---- Bus --------------------------------------------------------------------------------------------------------

/** Removes the listener it was returned for. Calling it twice is harmless. */
export type Unsubscribe = () => void;

/** Listener of one event. It must not throw and must not keep a reference to the payload after it returns. */
export type EventBusListener<P> = (payload: P) => void;

/**
 * The typed event bus. `M` maps event names to payload types; the default is this catalog. The implementation (in
 * apps/client/src/app) dispatches synchronously in subscription order.
 */
export interface EventBus<M extends object = EventMap> {
  /** Delivers `payload` to every current listener of `name`. */
  emit<K extends keyof M & string>(name: K, payload: M[K]): void;
  /** Subscribes `listener` to `name`; returns the function that unsubscribes it. */
  on<K extends keyof M & string>(name: K, listener: EventBusListener<M[K]>): Unsubscribe;
}

// ---- net.status ---------------------------------------------------------------------------------------------------

/**
 * Connection states of the client net module, in the order of a normal start (M0 task M0-W1-T04; netcode.md
 * section 10): `asleep` (no answer from the server yet), `waking` (`/healthz` probing while the host starts),
 * `connecting` (server awake, joining the room), `connected` (in the room), `lost` (the room connection closed).
 * The finer wake-up states of system-overview.md section 3 (`slow_wake`, `records_offline`, `update_required`,
 * `at_capacity`) are added with the M1 session flow.
 */
export const NET_CONNECTION_STATES = ["asleep", "waking", "connecting", "connected", "lost"] as const;
export type NetConnectionState = (typeof NET_CONNECTION_STATES)[number];

/** Emitted by the client net module on every state change. */
export interface NetStatusEvent {
  /** The new state. */
  readonly state: NetConnectionState;
  /** The state before this change; `null` on the first emit. */
  readonly previous: NetConnectionState | null;
  /** WebSocket close code that caused `lost` (for example 4100 or 4105, protocol/close-codes); otherwise `null`. */
  readonly closeCode: number | null;
  /** Last measured round-trip time from PING / PONG; `null` until the first PONG. */
  readonly rttMs: Milliseconds | null;
}

// ---- render.backendSelected ---------------------------------------------------------------------------------------

/** Emitted once by the render module after it has created its renderer. */
export interface RenderBackendSelectedEvent {
  /** The backend the renderer runs on. */
  readonly backend: RenderBackend;
  /** The hardware tier the render module detected. */
  readonly tier: HardwareTier;
  /** `true` when the `?backend=` URL parameter chose the backend instead of detection. */
  readonly forced: boolean;
}

// ---- quality.changed ----------------------------------------------------------------------------------------------

/** What caused a quality change. `detect`: the initial choice from the hardware tier. */
export const QUALITY_CHANGE_SOURCES = ["detect", "user", "url"] as const;
export type QualityChangeSource = (typeof QUALITY_CHANGE_SOURCES)[number];

/**
 * Emitted by the render module when the active quality settings change (including the first choice). Dynamic
 * resolution moving inside the preset's scale range is not a quality change and is not emitted.
 */
export interface QualityChangedEvent {
  /** The settings now in effect. */
  readonly settings: QualitySettings;
  /** The settings before this change; `null` on the first emit. */
  readonly previous: QualitySettings | null;
  readonly source: QualityChangeSource;
}

// ---- Catalog ------------------------------------------------------------------------------------------------------

/** Event name to payload type. Every key is listed in EVENT_NAMES (checked by catalog.test.ts). */
export interface EventMap extends SimEventMap, PresentationEventMap, SaveEventMap {
  "net.status": NetStatusEvent;
  "render.backendSelected": RenderBackendSelectedEvent;
  "quality.changed": QualityChangedEvent;
}

/** Name of a catalog event. */
export type EventName = keyof EventMap;

/** Every catalog event name, for runtime use (debug overlay, event log). */
export const EVENT_NAMES = [
  "net.status",
  "render.backendSelected",
  "quality.changed",
  ...SIM_EVENT_NAMES,
  ...PRESENTATION_EVENT_NAMES,
  ...SAVE_EVENT_NAMES,
] as const satisfies readonly EventName[];
