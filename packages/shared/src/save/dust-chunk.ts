// @contract save/dust-chunk v1.1
// @consumers packages/world (chunk payload codec; pure, shared by the Solo worker and the server), apps/server/src/
//   world (hand-off of dirty chunk payloads), apps/server/src/persistence and apps/client/src/sim-host (deflate,
//   CRC32 and storage of the row), apps/server/src/api (size and chunk id checks of solo uploads), tools/bots
//
// v1.1 (M1-W0-T08, 2026-11-14; byte layout unchanged, DUST_CHUNK_PAYLOAD_VERSION stays 1): the largest legal payload
// is now pinned here as DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES (421,959 B: 256 touched plots, 4 contributions and 32
// unchained strokes each), and save/format's DUST_CHUNK_PAYLOAD_MAX_BYTES is derived from it. The old 262,144 B limit
// was below a legal payload (256 touched plots need 269,383 B without any stroke log), so a full chunk could never be
// written or uploaded. A plot record's `strokeLog` is now bounded by strokeCount x DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES
// (every stroke at most one chain header), which every v1 writer already met. Consumers: packages/world (drop the
// local layout maximum and the log-shrinking ladder, add the strokeLog bound to the scan), apps/server/src/api
// (comments only; the code reads the constant).
//
// Dust chunk payload: the body of one `contract_dust_chunks` row (section DUST_CHUNK). Specification:
// docs/architecture/world-and-dust-simulation.md section 6, data-model.md section 3.7b. The payload is deflated as a
// whole by the persistence layer (DUST_CHUNK_CODEC); the CRC32 and sizes live in the row (and in MCCK entries).
//
// Layout v1 (this file pins it; decoded form: DustChunkPayloadSchema), little-endian, before deflate:
//   0       2     payloadVersion u16      DUST_CHUNK_PAYLOAD_VERSION
//   2       2     chunkId u16             0 .. 640
//   4       1     bakeCheck u8            first byte of the Contract's bakeHash (cheap mismatch guard)
//   5       2     touchedCount u16        number of plot records that follow
//   7       S     plotStates              2 bits per plot in local-index order, plot k at bit 2*(k mod 4) of byte
//                                         floor(k / 4) (LSB first); S = 64 for chunks 0..639, 1 for chunk 640
//   7+S     ...   touchedCount plot records, ascending localIndex, each:
//                   localIndex u8 | remainingFrac u8 (0 .. 255 of the plot's initial dust) |
//                   ledger header (LedgerHeader of world/dust: version u32, remainingUnits u32, initialUnits u32,
//                     ownedTexels u16, mgPerUnit u32, hash u32, contributionCount u8, then count x (actorSlot u8,
//                     units u32)) | texels (1024 bytes) | strokeCount u8 (<= SAVED_STROKE_LOG_MAX) |
//                   strokeLogBytes u16 | strokeLog (the strokeCount most recent strokes as chains, oldest first,
//                     in the chain wire format of world/stroke; opaque to this layer)
// A touched plot is one with an allocated ledger: Grimy-but-touched or Opened. Polished and Empty plots have no
// record (their state is in plotStates; the ledger and log are freed). Plot state lives with its ledger, so a chunk
// version is self-consistent on its own (data-model.md 3.7b). A chunk with no touched plot and all states Grimy is
// pristine and is not stored. L0 values and the Shine Index are recomputed from the chosen chunk versions on load.
//
// The payload version is independent of SAVE_FORMAT_VERSION: it changes only when this layout changes, and the
// loader upgrades old payloads in memory like any other section (data-model.md section 6).

import { z } from "zod";
import {
  LedgerHeaderSchema,
  LedgerTexelsSchema,
  LEDGER_BYTES,
  LEDGER_CONTRIBUTION_BYTES,
  LEDGER_HEADER_FIXED_BYTES,
  LEDGER_MAX_CONTRIBUTIONS,
  PlotStateSchema,
  PlotState,
  PLOTS_PER_CHUNK,
  POLE_CHUNK_ID,
  SAVED_STROKE_LOG_MAX,
} from "../world";

/** Version of the dust chunk payload layout. */
export const DUST_CHUNK_PAYLOAD_VERSION = 1;

/** Fixed bytes before the plot-state array. */
export const DUST_CHUNK_FIXED_BYTES = 7;

/** Plot-state array bytes for chunks 0 .. 639 (256 plots, 2 bits each). */
export const DUST_CHUNK_STATE_BYTES = PLOTS_PER_CHUNK / 4;

/** Plot-state array bytes for the pole chunk (2 plots). */
export const DUST_CHUNK_POLE_STATE_BYTES = 1;

/** Plots held by the pole chunk. */
export const DUST_CHUNK_POLE_PLOTS = 2;

/** Fixed bytes of a plot record excluding the ledger header's contributions and the stroke log bytes. */
export const DUST_CHUNK_PLOT_RECORD_FIXED_BYTES = 1 + 1 + LEDGER_HEADER_FIXED_BYTES + LEDGER_BYTES + 1 + 2;

/** Bytes per header contribution (re-exported name for codec readers). */
export const DUST_CHUNK_CONTRIBUTION_BYTES = LEDGER_CONTRIBUTION_BYTES;

/**
 * Bytes of one stroke chain before its continuations: the 17-byte chain header (136 bits, world/stroke wire widths)
 * plus the continuationCount u8 of the chain framing (packages/protocol codec/dust-wire). A stroke saved as its own
 * chain costs this much; a stroke saved as a continuation costs 4 bytes, so chaining only makes a log smaller.
 */
export const DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES = 17 + 1;

/** Largest saved stroke log of one plot: SAVED_STROKE_LOG_MAX strokes, each its own chain (576 B). */
export const DUST_CHUNK_STROKE_LOG_MAX_BYTES = SAVED_STROKE_LOG_MAX * DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES;

/** Largest plot record: the fixed part, LEDGER_MAX_CONTRIBUTIONS contributions and the largest stroke log (1,648 B). */
export const DUST_CHUNK_PLOT_RECORD_MAX_BYTES =
  DUST_CHUNK_PLOT_RECORD_FIXED_BYTES +
  LEDGER_MAX_CONTRIBUTIONS * LEDGER_CONTRIBUTION_BYTES +
  DUST_CHUNK_STROKE_LOG_MAX_BYTES;

/**
 * Largest payload the v1 layout can hold (421,959 B): a 256-plot chunk with every plot touched, each record at
 * DUST_CHUNK_PLOT_RECORD_MAX_BYTES. The pole chunk is far smaller. save/format's DUST_CHUNK_PAYLOAD_MAX_BYTES (the
 * validate-before-write and upload limit) equals this value, so every legal payload can be stored and uploaded.
 */
export const DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES =
  DUST_CHUNK_FIXED_BYTES + DUST_CHUNK_STATE_BYTES + PLOTS_PER_CHUNK * DUST_CHUNK_PLOT_RECORD_MAX_BYTES;

const U8 = z.int().min(0).max(0xff);

/** One touched plot (allocated ledger) of a chunk payload. */
export const DustChunkPlotRecordSchema = z
  .object({
    /** Index inside the chunk: 0 .. 255 (pole chunk 0 .. 1). */
    localIndex: U8,
    /** Remaining dust fraction, 0 .. 255 (255 = untouched). */
    remainingFrac: U8,
    ledger: LedgerHeaderSchema,
    texels: LedgerTexelsSchema,
    /** Number of strokes in `strokeLog`, 0 .. 32. */
    strokeCount: z.int().min(0).max(SAVED_STROKE_LOG_MAX),
    /**
     * The most recent strokes as chains (chain wire format of world/stroke), opaque here. At most
     * strokeCount x DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES bytes (so at most DUST_CHUNK_STROKE_LOG_MAX_BYTES).
     */
    strokeLog: z.instanceof(Uint8Array),
  })
  .refine((record) => record.strokeLog.length <= record.strokeCount * DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES, {
    message: "strokeLog exceeds strokeCount x DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES",
    path: ["strokeLog"],
  });
export type DustChunkPlotRecord = z.infer<typeof DustChunkPlotRecordSchema>;

/** Decoded dust chunk payload. `states` has one 2-bit state per plot of the chunk, in local-index order. */
export const DustChunkPayloadSchema = z
  .object({
    payloadVersion: z.int().min(0).max(0xffff),
    chunkId: z.int().min(0).max(POLE_CHUNK_ID),
    /** First byte of the Contract's bakeHash. */
    bakeCheck: U8,
    states: z.array(PlotStateSchema).min(DUST_CHUNK_POLE_PLOTS).max(PLOTS_PER_CHUNK),
    plots: z.array(DustChunkPlotRecordSchema).max(PLOTS_PER_CHUNK),
  })
  .superRefine((chunk, ctx) => {
    const expectedPlots = chunk.chunkId === POLE_CHUNK_ID ? DUST_CHUNK_POLE_PLOTS : PLOTS_PER_CHUNK;
    if (chunk.states.length !== expectedPlots) {
      ctx.addIssue({
        code: "custom",
        path: ["states"],
        message: `chunk ${chunk.chunkId} must have ${expectedPlots} states`,
      });
    }
    let previous = -1;
    chunk.plots.forEach((plot, index) => {
      const path = ["plots", index, "localIndex"];
      if (plot.localIndex >= chunk.states.length) {
        ctx.addIssue({ code: "custom", path, message: "localIndex is outside the chunk" });
      } else if (plot.localIndex <= previous) {
        ctx.addIssue({ code: "custom", path, message: "plot records must be in strictly ascending localIndex order" });
      } else {
        const state = chunk.states[plot.localIndex];
        if (state !== PlotState.Grimy && state !== PlotState.Opened) {
          ctx.addIssue({ code: "custom", path, message: "only Grimy or Opened plots carry a ledger record" });
        }
      }
      previous = plot.localIndex;
    });
  });
export type DustChunkPayload = z.infer<typeof DustChunkPayloadSchema>;

/**
 * Golden vector of a payload. `texelsPattern` generates the 1,024 texel bytes (zeros; ramp: byte k = k & 0xff;
 * corners: byte 0 = 208, byte 1023 = 80, rest 0). A codec must encode the described payload to `length` bytes with
 * CRC32 `crc32` (IEEE), and to exactly `bytesHex` when that is present.
 */
export interface DustChunkGoldenVector {
  readonly name: string;
  readonly chunkId: number;
  readonly bakeCheck: number;
  readonly states: readonly number[];
  readonly plots: readonly {
    readonly localIndex: number;
    readonly remainingFrac: number;
    readonly ledger: z.infer<typeof LedgerHeaderSchema>;
    readonly texelsPattern: "zeros" | "ramp" | "corners";
    readonly strokeCount: number;
    /** Lower-case hex of the opaque stroke log bytes. */
    readonly strokeLogHex: string;
  }[];
  /** Total payload length in bytes (before deflate). */
  readonly length: number;
  /** CRC32 (IEEE) of the whole payload. */
  readonly crc32: number;
  readonly bytesHex?: string;
}
