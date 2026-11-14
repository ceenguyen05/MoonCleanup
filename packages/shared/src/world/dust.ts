// @contract world/dust v1
// @consumers packages/world (ledger rasterisation, state machine, hashes), packages/sim (Dust Cell rules, robots),
//   packages/protocol (dust sections and bytes messages), apps/server/src/world (authority, snapshot cache, chunk
//   payloads), apps/client/src/terrain (two ledger views, tiles, drift check), packages/db and apps/server/src/
//   persistence (via save/dust-chunk), tools/bots (/bot-test hash match), tools/balance-sim
//
// Dust model contracts: plot states, terrain classes, the coarse ledger (dimensions, units, integer thresholds,
// rasterisation constants), the ledger header, and the logical payloads of every dust message of WDS section 5.1.
// Specification: docs/architecture/world-and-dust-simulation.md sections 4.1 to 4.7 and 5.1 to 5.5; ADR-0026
// (absolute coverage-weighted removal). Dust levels per terrain class and kg/m^2 are NOT restated here: they are
// game-data (progression-and-economy.md section 1.1: levels 5 / 8 / 13); this file only fixes how a level maps to
// ledger units (LEDGER_UNITS_PER_LEVEL) and the largest level a u8 texel can hold.
//
// Ledger algorithm summary (the exact integer rule lives in packages/world, vectors in ./vectors):
//   initial unit per owned texel u0 = 16 * L_P; per texel removal r = floor((depth16 * C + A/2) / A) with
//   A = LEDGER_TEXEL_AREA_MM2, raised to 1 when C >= LEDGER_MIN_COVERAGE_MM2; u = max(0, u - r). Removal never depends
//   on the texel's current value, so ledger bytes are order-independent.
//
// Thresholds (integer, section 4.2), with initialUnits = u0 * ownedTexels:
//   Opened   when removed >= ceil(initialUnits / OPENED_THRESHOLD_DIVISOR)
//   Polished when remainingUnits <= floor(initialUnits / POLISHED_THRESHOLD_DIVISOR)
//
// Messages: this file defines the DECODED logical payloads. Channel, type ids, FRAME sections, section framing
// (counts, flags) and bit packing are bound by protocol/messages.ts (M1-W0-T02) and the codec in packages/protocol;
// the widths this file states in DUST_WIRE are the budget that layout must meet (WDS section 5.1).
//
// v1 decisions not spelled out in the WDS (flagged [R] for the owners named in the report): the ledger hash
// algorithm (FNV-1a 32), the chunk drift hash mix, `laneMask` as 64 lanes, DustClass code values, and the
// dust.ack width (u24 grams).

import { z } from "zod";
import type { PlotId } from "../ids";
import type { Metres, Tick } from "../units";
import { CHUNK_COUNT, PLOT_NEIGHBOR_SLOTS } from "./plot-grid";
import { StrokeActorSlotSchema, StrokeChainSchema, type StrokeChain } from "./stroke";

// ---- Plot states and classes -----------------------------------------------------------------------------------------------

/** Version of the dust model (ledger rule, thresholds, hashes). Stored in the save header as `dustModelVersion`. */
export const DUST_MODEL_VERSION = 1;

/**
 * Plot state with its 2-bit wire code. Transitions are monotonic Grimy -> Opened -> Polished; Empty never changes.
 * Display names (naming bible): Grimy (deep umber), Opened (cool cyan), Polished and Empty (ivory glow).
 */
export const PlotState = {
  /** Untouched, or touched below the Opened threshold. */
  Grimy: 0,
  /** Removed at least 0.1 % of the starting dust. */
  Opened: 1,
  /** At most 1 % remaining: Inspector's Stamp; latched, ledger freed. */
  Polished: 2,
  /** No dust (outpost pads); counts as Polished for the Shine Index. */
  Empty: 3,
} as const;
export type PlotState = (typeof PlotState)[keyof typeof PlotState];

/** Schema of the 2-bit state code. */
export const PlotStateSchema = z.union([
  z.literal(PlotState.Grimy),
  z.literal(PlotState.Opened),
  z.literal(PlotState.Polished),
  z.literal(PlotState.Empty),
]);

/** Bits per plot state on the wire and in chunk payloads. */
export const PLOT_STATE_BITS = 2;

/** Terrain / dust class of a plot, baked per plot as a uint8 (section 4.1). Empty = outpost pad, no dust. */
export const DustClass = {
  Highland: 0,
  Mare: 1,
  CraterFloor: 2,
  Empty: 3,
} as const;
export type DustClass = (typeof DustClass)[keyof typeof DustClass];

export const DustClassSchema = z.union([
  z.literal(DustClass.Highland),
  z.literal(DustClass.Mare),
  z.literal(DustClass.CraterFloor),
  z.literal(DustClass.Empty),
]);

/** game-data ids of the dust-bearing classes (config/world.schema terrain table). `Empty` has no terrain id. */
export const DUST_CLASS_TERRAIN_ID = {
  [DustClass.Highland]: "terrain.highland",
  [DustClass.Mare]: "terrain.mare",
  [DustClass.CraterFloor]: "terrain.crater_floor",
} as const;

/** Per-plot data baked once and shared immutably by every room (WDS sections 2.5 and 4.3). */
export interface PlotAttributes {
  /** Baked dust class of `id`. */
  classOf(id: PlotId): DustClass;
  /** Spherical area of the plot in square metres (Dust mass scales with it, section 4.1). */
  areaM2(id: PlotId): number;
}

// ---- Coarse ledger ----------------------------------------------------------------------------------------------------------

/** Ledger texels per plot-frame edge: 32 x 32 texels (section 0). */
export const LEDGER_EDGE_TEXELS = 32;

/** Bytes of one ledger (one u8 per texel), byte index = b * 32 + a for texel (a, b), 0 <= a, b <= 31. */
export const LEDGER_BYTES = LEDGER_EDGE_TEXELS * LEDGER_EDGE_TEXELS;

/** Edge of one ledger texel in millimetres (0.8 m). */
export const LEDGER_TEXEL_SIZE_MM = 800;

/** Area A of one ledger texel in square millimetres (0.64 m^2). */
export const LEDGER_TEXEL_AREA_MM2 = LEDGER_TEXEL_SIZE_MM * LEDGER_TEXEL_SIZE_MM;

/** Edge of the plot frame in millimetres (25.6 m = 32 texels). */
export const LEDGER_FRAME_EDGE_MM = LEDGER_EDGE_TEXELS * LEDGER_TEXEL_SIZE_MM;

/** Texel unit: 1/16 of a dust level (ADR-0026). */
export const LEDGER_UNITS_PER_LEVEL = 16;

/** Largest value of a ledger texel (u8). */
export const LEDGER_UNIT_MAX = 255;

/** Largest dust level a u8 texel can hold at 16 units per level (15; the shipped maximum is 13, Crater Floor). */
export const LEDGER_MAX_DUST_LEVEL = 15;

/** Minimum coverage for the minimum-removal rule: A / 64 = 10,000 mm^2 (section 4.5 step 4). */
export const LEDGER_MIN_COVERAGE_MM2 = LEDGER_TEXEL_AREA_MM2 / 64;

/** Minimum per-pass removal (units) once coverage reaches LEDGER_MIN_COVERAGE_MM2. */
export const LEDGER_MIN_REMOVAL_UNITS = 1;

/** Lattice pitch = clamp(width_mm / LEDGER_LATTICE_PITCH_DIVISOR, MIN, MAX), rounded to whole mm (section 4.5 step 3). */
export const LEDGER_LATTICE_PITCH_DIVISOR = 8;
export const LEDGER_LATTICE_PITCH_MIN_MM = 25;
export const LEDGER_LATTICE_PITCH_MAX_MM = 100;

/** Detailing (Desk Duster RMB): a disc op of this diameter with depth16 255 (section 4.4, [R] game-designer confirms). */
export const DETAILING_DIAMETER_MM = 500;

/** Opened when removed units >= ceil(initialUnits / OPENED_THRESHOLD_DIVISOR): 0.1 % (section 4.2). */
export const OPENED_THRESHOLD_DIVISOR = 1000;

/** Polished when remainingUnits <= floor(initialUnits / POLISHED_THRESHOLD_DIVISOR): 1 % (section 4.2). */
export const POLISHED_THRESHOLD_DIVISOR = 100;

/** The ledger's owned-texel ownership test checks the plot and its 6 neighbours (section 4.3). */
export const LEDGER_OWNERSHIP_CANDIDATES = PLOT_NEIGHBOR_SLOTS + 1;

/** Contributions kept per plot ledger (the biggest removers; section 4.3, 4.7). */
export const LEDGER_MAX_CONTRIBUTIONS = 4;

/** Most recent strokes kept in a saved plot log (section 6). The in-memory ring is 256. */
export const SAVED_STROKE_LOG_MAX = 32;

/** In-memory stroke log ring per touched plot (section 4.3). */
export const STROKE_LOG_RING = 256;

/** Ledger drift hash: FNV-1a 32-bit over the 1,024 texel bytes in byte-index order (offset basis 0x811c9dc5, prime 0x01000193). [R] */
export const LEDGER_HASH_ALGORITHM = "fnv1a-32";
export const FNV1A_32_OFFSET_BASIS = 0x811c_9dc5;
export const FNV1A_32_PRIME = 0x0100_0193;

/**
 * Chunk drift hash (section 5.5): XOR over the chunk's Opened plots of mix(plotId, ledgerHash), where mix is FNV-1a
 * 32 over the 8 bytes (plotId u32 LE, ledgerHash u32 LE). [R] Changing either hash bumps DUST_MODEL_VERSION.
 */
export const CHUNK_HASH_MIX = "fnv1a-32(plotId u32le, hash u32le)";

const U8 = z.int().min(0).max(0xff);
const U16 = z.int().min(0).max(0xffff);
const U32 = z.int().min(0).max(0xffff_ffff);

const PlotIdFieldSchema = z
  .int()
  .min(0)
  .max((1 << 18) - 1)
  .transform((value) => value as PlotId);
const ChunkIdFieldSchema = z
  .int()
  .min(0)
  .max(CHUNK_COUNT - 1);

/** Plot id as carried by dust payloads: 18 bits. The grid-specific upper bound (plotCount - 1) is checked by the codec. */
export const PlotIdWireSchema = PlotIdFieldSchema;

/** Dust chunk id as carried by dust payloads: 0 .. 640 (10 bits). */
export const ChunkIdWireSchema = ChunkIdFieldSchema;

/** `contributions[k]`: how many units an actor slot removed from this plot (credit for the Inspector's Stamp). */
export const LedgerContributionSchema = z.object({
  actorSlot: StrokeActorSlotSchema,
  units: U32,
});
export type LedgerContribution = z.infer<typeof LedgerContributionSchema>;

/**
 * Fixed fields stored with every plot ledger (section 4.3), in this order, little-endian:
 *   version u32 | remainingUnits u32 | initialUnits u32 | ownedTexels u16 | mgPerUnit u32 | hash u32 |
 *   contributionCount u8 | contributionCount x (actorSlot u8, units u32)
 * `version` increments on every applied op, `hash` is LEDGER_HASH_ALGORITHM of the texel bytes.
 */
export const LedgerHeaderSchema = z
  .object({
    version: U32,
    remainingUnits: U32,
    initialUnits: U32,
    ownedTexels: z.int().min(0).max(LEDGER_BYTES),
    mgPerUnit: U32,
    hash: U32,
    contributions: z.array(LedgerContributionSchema).max(LEDGER_MAX_CONTRIBUTIONS),
  })
  .refine((h) => h.remainingUnits <= h.initialUnits, {
    message: "remainingUnits must not exceed initialUnits",
    path: ["remainingUnits"],
  });
export type LedgerHeader = z.infer<typeof LedgerHeaderSchema>;

/** Bytes of the fixed part of a serialised LedgerHeader (without contributions). */
export const LEDGER_HEADER_FIXED_BYTES = 4 + 4 + 4 + 2 + 4 + 4 + 1;

/** Bytes per serialised contribution. */
export const LEDGER_CONTRIBUTION_BYTES = 5;

/** The 1,024 texel bytes of one ledger. */
export const LedgerTexelsSchema = z.instanceof(Uint8Array).refine((bytes) => bytes.length === LEDGER_BYTES, {
  message: "ledger texels must be exactly 1024 bytes",
});

// ---- Message limits and wire widths ------------------------------------------------------------------------------------

/** `dust_interest` residency radius is clamped to this range (WDS section 5.1, metres). */
export const DUST_RESIDENCY_RADIUS_MIN_M: Metres = 60;
export const DUST_RESIDENCY_RADIUS_MAX_M: Metres = 220;

/** Hysteresis added to the residency radius to form the dust radius (section 5.2, metres). */
export const DUST_RADIUS_HYSTERESIS_M: Metres = 20;

/** The server clamps the dust radius to this range (section 5.2, metres). */
export const DUST_RADIUS_MIN_M: Metres = 60;
export const DUST_RADIUS_MAX_M: Metres = 240;

/** Ledgers and stroke logs within this radius are in the blocking join snapshot (section 5.2, metres). */
export const DUST_BLOCKING_SNAPSHOT_RADIUS_M: Metres = 60;

/** `dust.request` carries up to 8 plot ids (or exactly one chunk id); at most 1 per 2 s (section 5.1). */
export const DUST_REQUEST_MAX_PLOTS = 8;
export const DUST_REQUEST_MIN_INTERVAL_S = 2;

/** `dust.check` cadence (section 5.1/5.5). */
export const DUST_CHECK_INTERVAL_S = 5;

/** Bytes message slice limit (section 5.1). */
export const DUST_MESSAGE_SLICE_MAX_BYTES = 4096;

/** Width in bits / bytes of the dust wire fields (the budget of WDS section 5.1). */
export const DUST_WIRE = {
  plotIdBits: 18,
  chunkIdBits: 10,
  plotStateBits: PLOT_STATE_BITS,
  /** `dust.plots` record: PlotId 18 + state 2 + remaining fraction 8 + 4 spare = 32 bits. */
  plotDeltaBits: 32,
  /** `dust.ack`: Dust Cell grams, u24. */
  ackGramsBits: 24,
  /** `dust.check` record: chunkId 10 + XOR hash 32 bits. */
  checkRecordBits: 42,
  /** Detail-mode record: PlotId + ledger version u32 + hash u32. */
  checkDetailRecordBits: 18 + 32 + 32,
  /** Robot intent field widths (see RobotPlotIntentSchema). */
  robotIdBits: 16,
  robotWidthCmBits: 10,
  robotSpeedCmPerSBits: 10,
  robotLaneMaskBits: 64,
} as const;

/** Largest Dust Cell grams carried by `dust.ack` (u24). */
export const DUST_ACK_GRAMS_MAX = (1 << DUST_WIRE.ackGramsBits) - 1;

// ---- Payload schemas (WDS section 5.1) ------------------------------------------------------------------------------

/**
 * `dust.strokes` (FRAME section, S->C every frame): accepted stroke chains per actor, including the originator's own
 * echoes (header.actorSlot + header.inputSeq).
 */
export const DustStrokesPayloadSchema = z.object({
  chains: z.array(StrokeChainSchema),
});
export interface DustStrokesPayload {
  readonly chains: readonly StrokeChain[];
}

/**
 * `robot.plot` (FRAME section, S->C when a robot starts a plot). Clients replay lane chunks locally keyed by server
 * tick (startTick + k * SIM_TICK_HZ). `laneMask` is two u32 words [low 32 lanes, high 32 lanes]; lane k is bit
 * (k mod 32) of word floor(k / 32), lane 0 at the smallest v. Budget: 158 bits, about 20 B (the WDS estimate of 17 B
 * assumed a shorter mask; flagged to netcode-engineer).
 */
export const RobotPlotIntentSchema = z.object({
  robotId: U16,
  plotId: PlotIdFieldSchema,
  startTick: U32,
  /** Robot work width in centimetres. */
  widthCm: z
    .int()
    .min(1)
    .max((1 << DUST_WIRE.robotWidthCmBits) - 1),
  depth16: U8,
  /** Travel speed along a lane, centimetres per second. */
  speedCmPerS: z
    .int()
    .min(1)
    .max((1 << DUST_WIRE.robotSpeedCmPerSBits) - 1),
  laneMask: z.tuple([U32, U32]),
});
export interface RobotPlotIntent {
  readonly robotId: number;
  readonly plotId: PlotId;
  readonly startTick: Tick;
  readonly widthCm: number;
  readonly depth16: number;
  readonly speedCmPerS: number;
  readonly laneMask: readonly [number, number];
}

/** `dust.ack` (FRAME section, when changed): authoritative Dust Cell grams of the receiving client's actor. */
export const DustAckPayloadSchema = z.object({
  grams: z.int().min(0).max(DUST_ACK_GRAMS_MAX),
});
export type DustAckPayload = z.infer<typeof DustAckPayloadSchema>;

/** One `dust.plots` delta: a changed plot's state and remaining fraction (0 .. 255 of its initial dust). */
export const DustPlotDeltaSchema = z.object({
  plotId: PlotIdFieldSchema,
  state: PlotStateSchema,
  remainingFrac: U8,
});
export interface DustPlotDelta {
  readonly plotId: PlotId;
  readonly state: PlotState;
  /** Remaining dust, 0 .. 255 (255 = untouched). Polished and Empty plots carry 0. */
  readonly remainingFrac: number;
}

/** `dust.plots` (FRAME section, every SNAPSHOT_HZ/2-th frame): L0 deltas for every changed plot on the moon. */
export const DustPlotsPayloadSchema = z.object({
  deltas: z.array(DustPlotDeltaSchema),
});
export interface DustPlotsPayload {
  readonly deltas: readonly DustPlotDelta[];
}

/** `dust.ledger` (bytes, on interest entry or request): one plot's full ledger (deflated on the wire). */
export const DustLedgerPayloadSchema = z.object({
  plotId: PlotIdFieldSchema,
  header: LedgerHeaderSchema,
  texels: LedgerTexelsSchema,
});
export interface DustLedgerPayload {
  readonly plotId: PlotId;
  readonly header: LedgerHeader;
  readonly texels: Uint8Array;
}

/** `dust.log` (bytes, within 60 m on entry or request): one plot's stroke log as chains, oldest first. */
export const DustLogPayloadSchema = z.object({
  plotId: PlotIdFieldSchema,
  chains: z.array(StrokeChainSchema),
});
export interface DustLogPayload {
  readonly plotId: PlotId;
  readonly chains: readonly StrokeChain[];
}

/**
 * `dust.snapshot` (bytes, sliced; the slice header {sliceIndex u16, sliceCount u16, snapshotVersion u32} belongs to
 * the protocol message). Inflated content of section 5.4:
 *   plotStates     2 bits per plot in PlotId order, little-endian bit order within a byte, ceil(plotCount / 4) bytes
 *   openedRemaining  one remaining-fraction byte per Opened plot, in PlotId order (count = Opened plots in plotStates)
 *   ledgers        Opened plots within DUST_BLOCKING_SNAPSHOT_RADIUS_M (ledger + header)
 *   logs           stroke logs of those plots
 * Ledgers farther out stream afterwards as separate `dust.ledger` messages.
 */
export const DustSnapshotPayloadSchema = z.object({
  plotCount: z.int().min(1),
  plotStates: z.instanceof(Uint8Array),
  openedRemaining: z.instanceof(Uint8Array),
  ledgers: z.array(DustLedgerPayloadSchema),
  logs: z.array(DustLogPayloadSchema),
});
export interface DustSnapshotPayload {
  readonly plotCount: number;
  readonly plotStates: Uint8Array;
  readonly openedRemaining: Uint8Array;
  readonly ledgers: readonly DustLedgerPayload[];
  readonly logs: readonly DustLogPayload[];
}

/** One chunk entry of `dust.check`: XOR of mix(plotId, ledger hash) over the chunk's Opened plots (CHUNK_HASH_MIX). */
export const DustChunkCheckSchema = z.object({
  chunkId: ChunkIdFieldSchema,
  xorHash: U32,
});
export type DustChunkCheck = z.infer<typeof DustChunkCheckSchema>;

/** One Opened plot entry of `dust.check` detail mode. */
export const DustPlotCheckSchema = z.object({
  plotId: PlotIdFieldSchema,
  ledgerVersion: U32,
  hash: U32,
});
export interface DustPlotCheck {
  readonly plotId: PlotId;
  readonly ledgerVersion: number;
  readonly hash: number;
}

/**
 * `dust.check` (bytes, every 5 s): per chunk intersecting the client's dust radius, or, in detail mode (answer to a
 * `dust.request` for one chunk), the per-plot versions and hashes of that chunk's Opened plots.
 */
export const DustCheckPayloadSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("chunks"), chunks: z.array(DustChunkCheckSchema) }),
  z.object({ mode: z.literal("detail"), chunkId: ChunkIdFieldSchema, plots: z.array(DustPlotCheckSchema) }),
]);
export type DustCheckPayload =
  | { readonly mode: "chunks"; readonly chunks: readonly DustChunkCheck[] }
  | { readonly mode: "detail"; readonly chunkId: number; readonly plots: readonly DustPlotCheck[] };

/** `dust.request` (bytes, C->S, at most 1 per 2 s): up to 8 plot ids (ledger + log wanted) or one chunk (detail check). */
export const DustRequestPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plots"), plotIds: z.array(PlotIdFieldSchema).min(1).max(DUST_REQUEST_MAX_PLOTS) }),
  z.object({ kind: z.literal("chunk"), chunkId: ChunkIdFieldSchema }),
]);
export type DustRequestPayload =
  | { readonly kind: "plots"; readonly plotIds: readonly PlotId[] }
  | { readonly kind: "chunk"; readonly chunkId: number };

/** `dust_interest` (control, C->S, on join and preset change): the client's tile residency radius in metres. */
export const DustInterestPayloadSchema = z.object({
  residencyRadiusM: z.int().min(DUST_RESIDENCY_RADIUS_MIN_M).max(DUST_RESIDENCY_RADIUS_MAX_M),
});
export type DustInterestPayload = z.infer<typeof DustInterestPayloadSchema>;

/** Integer grams: Dust Cell content, credit and the milligram accumulator's whole-gram output (section 4.1). UI shows kg. */
export type DustGrams = number;
