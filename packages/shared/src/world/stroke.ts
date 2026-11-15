// @contract world/stroke v1.1
// @consumers packages/world (quantisation + rasterisation), packages/sim (tool-head motion emits StrokeRecord),
//   packages/protocol (dust.strokes chain codec, dust.log, save stroke log), apps/client/src/terrain (prediction
//   keyed by inputSeq, tile replay), apps/server/src/world (validation, sequencing), tools/bots
//
// Stroke format. Specification: docs/architecture/world-and-dust-simulation.md section 4.4 (record, validation,
// cadence), section 5.1 (`dust.strokes` chains), section 4.5 (rasterisation that consumes it); ADR-0026.
//
// A stroke is a flat-ended capsule segment in the plot frame of its anchor. The SERVER creates strokes from
// server-side tool-head positions; clients never send strokes (they send inputs). `actorSlot` and `inputSeq` are part
// of the contract: the server echoes every accepted stroke to its originator with both, and the predicting client
// matches predictions to echoes by (actorSlot, inputSeq).
//
// Quantisation (determinism rule, WDS section 1): endpoints are integer millimetres in the ANCHOR plot's frame,
// rounded (Math.round) from the gnomonic projection BEFORE any other use, so server and predicting client rasterise
// identical integers. Range is int16 mm (+-32.767 m): the 25.6 m frame (+-12.8 m) plus spill into neighbours.
//
// Special case (v1 decision, flagged [R] for terrain-dust-engineer): a stroke whose start equals its end is a DISC of
// diameter `widthCm` (Detailing, WDS section 4.4: 0.5 m disc, depth16 255). The section 4.5 lattice rule
// "0 <= t < 1" is degenerate for a zero-length segment, so the rasteriser treats length 0 as "inside if the squared
// distance to the point <= (width/2)^2".
// v1.1 (doc only, 2026-11-14; wire unchanged): the Detailing disc is 0.5 m in DIAMETER (`widthCm` 50). Its size comes
// from game-data `trait.detailing` `params.diameterM` (config/traits v1.2), which replaced the ambiguous `radiusM`.
//
// Wire widths (bits, used by packages/protocol; section framing, chain counts and the FRAME flags are bound by
// protocol/messages.ts):
//   chain header, 136 bits = 17 B: anchor PlotId 18 | startU 16 | startV 16 | endU 16 | endV 16 | widthCm 10 |
//     depth16 8 | toolCode 6 | actorSlot 6 | tickOffset 8 (serverTick - tick of the FRAME, 0..255) | inputSeq 16
//   continuation, 32 bits = 4 B: actorSlot 6 | dxMm 13 (signed) | dyMm 13 (signed). Start = previous end, same anchor
//     frame, width / depth16 / toolCode of the header; tick and inputSeq advance by the frame interval
//     (SIM_TICK_HZ / SNAPSHOT_HZ ticks); a new header starts when parameters change or the anchor-frame offset of the
//     end point would exceed STROKE_CHAIN_REANCHOR_MM.
// All multi-byte fields little-endian, bits packed LSB first in field order (the protocol codec pins this with golden
// vectors in M1-W0-T02/M1-W4).

import { z } from "zod";
import type { PlotId } from "../ids";
import type { Tick } from "../units";

// ---- Field ranges -----------------------------------------------------------------------------------------------------------

/** Smallest plot-local coordinate in millimetres (int16). */
export const PLOT_LOCAL_MM_MIN = -32_768;

/** Largest plot-local coordinate in millimetres (int16); the representable half-range is about 32.767 m. */
export const PLOT_LOCAL_MM_MAX = 32_767;

/** Half edge of the plot frame in millimetres (12.8 m). */
export const PLOT_FRAME_HALF_MM = 12_800;

/** Stroke width is carried in centimetres on 10 bits. */
export const STROKE_WIDTH_CM_BITS = 10;

/** Largest stroke width, 10.23 m. The smallest legal width is 1 cm. */
export const STROKE_WIDTH_CM_MAX = (1 << STROKE_WIDTH_CM_BITS) - 1;

/** `depth16` is 16 x effective Depth in ledger units, capped at 255 (Charge and Detailing use 255). */
export const STROKE_DEPTH16_MAX = 255;

/** Tool code width on the wire (6 bits). The code is the index of the tool in the game-data tool table. */
export const STROKE_TOOL_CODE_BITS = 6;

/** Largest tool code (63). */
export const STROKE_TOOL_CODE_MAX = (1 << STROKE_TOOL_CODE_BITS) - 1;

/** Actor slot width on the wire (6 bits). */
export const STROKE_ACTOR_SLOT_BITS = 6;

/** Players use actor slots 0 .. 15 (room cap is 6; the range keeps the wire layout stable). */
export const STROKE_PLAYER_ACTOR_SLOT_MAX = 15;

/** Actor slots 16 .. 63 are reserved for vehicles and robots credited to the shift. */
export const STROKE_NON_PLAYER_ACTOR_SLOT_MIN = 16;

/** Largest actor slot (63). */
export const STROKE_ACTOR_SLOT_MAX = (1 << STROKE_ACTOR_SLOT_BITS) - 1;

/** `inputSeq` is u16 (the input that produced the stroke; 0 for robots). */
export const STROKE_INPUT_SEQ_MAX = 0xffff;

/** Server validation limit (WDS section 4.4 check 6): longest segment, 4 m. */
export const STROKE_MAX_SEGMENT_MM = 4000;

/** Signed width of a continuation delta (dx, dy) on the wire. */
export const STROKE_DELTA_BITS = 13;

/** Smallest continuation delta in millimetres (-4096). */
export const STROKE_DELTA_MM_MIN = -(1 << (STROKE_DELTA_BITS - 1));

/** Largest continuation delta in millimetres (4095); covers STROKE_MAX_SEGMENT_MM. */
export const STROKE_DELTA_MM_MAX = (1 << (STROKE_DELTA_BITS - 1)) - 1;

/** A new chain header is required when the end point moves farther than this from the anchor centre (30 m). */
export const STROKE_CHAIN_REANCHOR_MM = 30_000;

/** Width of the header `tickOffset` field (8 bits): serverTick of the FRAME minus the stroke tick. */
export const STROKE_TICK_OFFSET_MAX = 255;

/** Sizes of the wire records (bits). */
export const STROKE_WIRE_BITS = {
  header: 136,
  continuation: 32,
} as const;

/** Tool head center above the ground must be within this to produce a stroke (WDS section 4.4), metres. */
export const STROKE_MAX_HEAD_HEIGHT_M = 0.15;

/** Server per-stroke validation outcomes (WDS section 4.4, checks 1 to 8). A failed check drops the stroke. */
export const STROKE_REJECT_REASONS = [
  "tool_not_equipped",
  "dust_cell_full",
  "out_of_reach",
  "head_too_fast",
  "head_off_ground",
  "segment_too_long",
  "empty_plot",
  "rate_exceeded",
] as const;
export type StrokeRejectReason = (typeof STROKE_REJECT_REASONS)[number];

// ---- Schemas ---------------------------------------------------------------------------------------------------------------

const PlotIdFieldSchema = z
  .int()
  .min(0)
  .max((1 << 18) - 1)
  .transform((value) => value as PlotId);
const MmSchema = z.int().min(PLOT_LOCAL_MM_MIN).max(PLOT_LOCAL_MM_MAX);

/** Actor slot: 0 .. 15 players, 16 .. 63 vehicles/robots credited to the shift. */
export const StrokeActorSlotSchema = z.int().min(0).max(STROKE_ACTOR_SLOT_MAX);

/** Tool code, 0 .. 63 (index into the game-data tool table). */
export const StrokeToolCodeSchema = z.int().min(0).max(STROKE_TOOL_CODE_MAX);

/**
 * The logical stroke record (what the rasteriser consumes and what the server echoes). Chains are only a wire
 * compression of consecutive records of one actor.
 */
export const StrokeRecordSchema = z.object({
  /** Plot that contains the end point; the frame of this plot defines (u, v). */
  anchor: PlotIdFieldSchema,
  startUMm: MmSchema,
  startVMm: MmSchema,
  endUMm: MmSchema,
  endVMm: MmSchema,
  /** Width in centimetres, 1 .. 1023. Equal start and end make a disc of this diameter. */
  widthCm: z.int().min(1).max(STROKE_WIDTH_CM_MAX),
  /** Units removed by a full-coverage pass = 16 x effective Depth, 0 .. 255. */
  depth16: z.int().min(0).max(STROKE_DEPTH16_MAX),
  toolCode: StrokeToolCodeSchema,
  /** Simulation tick the stroke belongs to (u32). */
  tick: z.int().min(0).max(0xffff_ffff),
  actorSlot: StrokeActorSlotSchema,
  /** u16 input sequence that produced the stroke; 0 for robots and vehicles' automatic intakes. */
  inputSeq: z.int().min(0).max(STROKE_INPUT_SEQ_MAX),
});

export interface StrokeRecord {
  readonly anchor: PlotId;
  readonly startUMm: number;
  readonly startVMm: number;
  readonly endUMm: number;
  readonly endVMm: number;
  readonly widthCm: number;
  readonly depth16: number;
  readonly toolCode: number;
  readonly tick: Tick;
  readonly actorSlot: number;
  readonly inputSeq: number;
}

/** 4-byte continuation of a chain (see the wire widths above). */
export const StrokeContinuationSchema = z.object({
  actorSlot: StrokeActorSlotSchema,
  dxMm: z.int().min(STROKE_DELTA_MM_MIN).max(STROKE_DELTA_MM_MAX),
  dyMm: z.int().min(STROKE_DELTA_MM_MIN).max(STROKE_DELTA_MM_MAX),
});
export type StrokeContinuation = z.infer<typeof StrokeContinuationSchema>;

/**
 * One chain: a full header record followed by 0 or more continuations by the same actor (the continuation
 * `actorSlot` must equal the header's). Decoders expand it to StrokeRecords: record k starts at the end of record
 * k-1, ends at that end plus (dx, dy), keeps width, depth16, toolCode and anchor, and has
 * tick = header.tick + k * frameIntervalTicks, inputSeq = (header.inputSeq + k * frameIntervalTicks) mod 65536.
 */
export const StrokeChainSchema = z
  .object({
    header: StrokeRecordSchema,
    continuations: z.array(StrokeContinuationSchema).max(0xff),
  })
  .refine((chain) => chain.continuations.every((c) => c.actorSlot === chain.header.actorSlot), {
    message: "continuation actorSlot must equal the header actorSlot",
    path: ["continuations"],
  });

export interface StrokeChain {
  readonly header: StrokeRecord;
  readonly continuations: readonly StrokeContinuation[];
}
