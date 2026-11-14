// @contract client/module v1
// @consumers every client module (apps/client/src/{render,visuals,terrain,animation,gameplay,net,audio,ui,debug})
//   implements ClientModule; apps/client/src/app composes them and builds the ServiceRegistry
//
// Version note: v1 (M1-W0-T06) adds the `roomHost` service key; additive.
//
// Client module interface, frame contract and service registry keys. Specification:
// docs/architecture/module-boundaries.md section 4 and the M0-W0-T01 task card.
//
// Rules:
// - Modules talk to each other only through the event bus (../events) and the service registry below, never by
//   importing another module's internals (module-boundaries.md section 1, rule 5).
// - No three.js, Colyseus or DOM type appears here. Services whose real type is environment-specific are opaque
//   (OpaqueService). The client narrows them without casts by extending ServiceTypes:
//     interface ClientServices extends ServiceTypes { renderer: MyWebGpuRendererService }
//   and using `ClientModule<ClientServices>` / `ServiceRegistry<ClientServices>`. A concrete class is assignable to
//   its opaque type because the brand property is optional and never set (see OpaqueService).
// - Adding a service key or a module id is not a breaking change; renaming or removing one is.

import type { EventBus } from "../events";
import type { HardwareTier, QualitySettings, RenderBackend } from "../render";
import type { UiStore } from "../ui";
import type { Seconds, Tick } from "../units";
import type { RoomHostService } from "./room-host";

// ---- Module ids ---------------------------------------------------------------------------------------------------

/** Client modules in their fixed registration and init order (module-boundaries.md section 4). */
export const CLIENT_MODULE_IDS = [
  "render",
  "visuals",
  "terrain",
  "animation",
  "gameplay",
  "net",
  "audio",
  "ui",
  "debug",
] as const;
export type ClientModuleId = (typeof CLIENT_MODULE_IDS)[number];

// ---- Frame contract -----------------------------------------------------------------------------------------------

/**
 * What every module's `update` receives once per rendered frame. Per-frame order (module-boundaries.md section 4):
 * input -> net ingest -> sim predict (fixed step) -> gameplay -> animation -> terrain/dust -> visuals/VFX -> render ->
 * audio -> UI flush. The object may be reused between frames: read it during `update`, do not keep it.
 */
export interface FrameInfo {
  /** Real time since the previous frame, in seconds (clamped by the frame loop). */
  readonly dt: Seconds;
  /** Time since the frame loop started, in seconds. */
  readonly time: Seconds;
  /** Interpolation factor between the previous and the current sim tick, 0 <= alpha < 1. */
  readonly alpha: number;
  /** The latest simulated (predicted) tick. */
  readonly simTick: Tick;
  /** Quality settings in effect for this frame. */
  readonly quality: QualitySettings;
}

/** Size of the canvas, passed to `resize`. */
export interface ViewportSize {
  /** Width in CSS pixels. */
  readonly widthCssPx: number;
  /** Height in CSS pixels. */
  readonly heightCssPx: number;
  /** Device pixel ratio in effect for the canvas, already limited by the quality preset's `dprCap`. */
  readonly dpr: number;
}

// ---- Services -----------------------------------------------------------------------------------------------------

declare const serviceBrand: unique symbol;

/** Optional, never-set brand that keeps differently named services apart. */
export interface ServiceBrand<Name extends string> {
  readonly [serviceBrand]?: Name;
}

/**
 * A service whose real type lives in the client (three.js, DOM, Colyseus). Distinct names are not assignable to
 * each other; any object is assignable to one. The `object &` part switches off TypeScript's weak-type check, which
 * would otherwise reject concrete classes that share no property with the brand-only type.
 */
export type OpaqueService<Name extends string> = object & ServiceBrand<Name>;

/** Renderer service. The render module extends it with its real renderer handles. */
export interface RendererService extends ServiceBrand<"renderer"> {
  readonly backend: RenderBackend;
  readonly tier: HardwareTier;
}

/** Scene graph roots (world, overlay, ...). Real type: the render module's. */
export type SceneRootsService = OpaqueService<"sceneRoots">;

/** Player input (keyboard, mouse, gamepad). Real type: the client's input layer. */
export type InputService = OpaqueService<"input">;

/** The room session (transport, codec, reconciler wiring). Real type: apps/client/src/net. */
export type NetSessionService = OpaqueService<"netSession">;

/** The client's predicted simulation. Real type: the sim instance from packages/sim. */
export type SimService = OpaqueService<"sim">;

/** Asset loading (KTX2, meshopt, audio decode) with the budget-aware cache. Real type: the render module's. */
export type AssetLoaderService = OpaqueService<"assetLoader">;

/** Active quality settings; changes are announced with the `quality.changed` event. */
export interface QualityService extends ServiceBrand<"quality"> {
  readonly current: QualitySettings;
}

/** Service key to service type. Keys follow module-boundaries.md section 4. */
export interface ServiceTypes {
  renderer: RendererService;
  sceneRoots: SceneRootsService;
  eventBus: EventBus;
  uiStore: UiStore;
  input: InputService;
  netSession: NetSessionService;
  sim: SimService;
  assetLoader: AssetLoaderService;
  quality: QualityService;
  roomHost: RoomHostService;
}

/** Name of a service in the registry. */
export type ServiceKey = keyof ServiceTypes;

/** Every service key, for runtime checks (the composition root asserts all are registered before init). */
export const SERVICE_KEYS = [
  "renderer",
  "sceneRoots",
  "eventBus",
  "uiStore",
  "input",
  "netSession",
  "sim",
  "assetLoader",
  "quality",
  "roomHost",
] as const satisfies readonly ServiceKey[];

/** Typed service registry built by the composition root. `S` lets the client narrow opaque services. */
export interface ServiceRegistry<S extends ServiceTypes = ServiceTypes> {
  /** The service registered under `key`. Throws when it is missing (a composition-root bug). */
  get<K extends keyof S & string>(key: K): S[K];
  /** Whether a service is registered under `key`. */
  has(key: keyof S & string): boolean;
  /** Registers `service` under `key`. Throws when the key is already taken. */
  register<K extends keyof S & string>(key: K, service: S[K]): void;
}

// ---- Module -------------------------------------------------------------------------------------------------------

/** What a module receives in `init`. */
export interface ModuleContext<S extends ServiceTypes = ServiceTypes> {
  readonly services: ServiceRegistry<S>;
  /** The same bus as `services.get("eventBus")`, for convenience. */
  readonly events: S["eventBus"];
}

/** One client module. The composition root calls `init` in CLIENT_MODULE_IDS order and `dispose` in reverse. */
export interface ClientModule<S extends ServiceTypes = ServiceTypes> {
  readonly id: ClientModuleId;
  /** Called once before the first frame. May register services. */
  init(ctx: ModuleContext<S>): void | Promise<void>;
  /** Called once per rendered frame. Must not allocate on the hot path. */
  update(frame: FrameInfo): void;
  /** Called after the canvas size or device pixel ratio changed. */
  resize?(viewport: ViewportSize): void;
  /** Releases everything `init` acquired. */
  dispose(): void;
}
