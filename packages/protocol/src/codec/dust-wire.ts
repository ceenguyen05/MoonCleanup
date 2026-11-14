// Record-level bit layouts of the dust payloads (world-and-dust-simulation.md section 5.1; widths: DUST_WIRE and
// STROKE_WIRE_BITS in @moon-cleanup/shared). They ride as FRAME sections (frame-writer / frame-reader) and, for chains,
// inside DUST_LOG and DUST_SNAPSHOT. Every record is byte aligned; the unused high bits of the last byte are zero and a
// reader rejects records whose padding is not zero (BIT_PACKING).
//
// Layouts fixed here (the shared contracts give widths but not section framing; flagged [R] in the report):
//   stroke chain   : header 136 bits (17 B) | continuationCount u8 | continuationCount x 32 bits
//                    header = anchor 18 | startU i16 | startV i16 | endU i16 | endV i16 | widthCm 10 | depth16 8 |
//                             toolCode 6 | actorSlot 6 | tickOffset 8 | inputSeq 16
//                    continuation = actorSlot 6 | dxMm i13 | dyMm i13 (actorSlot must equal the header's)
//                    `tickOffset` = refTick - stroke tick, clamped to 0 .. 255 (see `strokeTickOffset`)
//   robot intent   : robotId 16 | plotId 18 | startTick 32 | widthCm 10 | depth16 8 | speedCmPerS 10 |
//                    laneMaskLow 32 | laneMaskHigh 32 = 158 bits, 20 B
//   dust plot delta: plotId 18 | state 2 | remainingFrac 8 | spare 4 (zero) = 32 bits, 4 B

import {
  DUST_WIRE,
  STROKE_ACTOR_SLOT_BITS,
  STROKE_DELTA_BITS,
  STROKE_TOOL_CODE_BITS,
  STROKE_WIDTH_CM_BITS,
} from "@moon-cleanup/shared";
import type { BitReader, BitWriter } from "./bits";
import {
  FRAME_MAX_DUST_PLOT_DELTAS,
  FRAME_MAX_ROBOT_INTENTS,
  type DustPlotDeltaList,
  type RobotIntentList,
  type StrokeChainBuffer,
} from "./frame-state";

export const STROKE_HEADER_BYTES = 17;
export const STROKE_CONTINUATION_BYTES = 4;
export const STROKE_CHAIN_PREFIX_BYTES = STROKE_HEADER_BYTES + 1;
export const ROBOT_INTENT_BYTES = 20;
export const DUST_PLOT_DELTA_BYTES = 4;
export const PLOT_ID_BITS = DUST_WIRE.plotIdBits;
export const PLOT_ID_MAX = (1 << PLOT_ID_BITS) - 1;

/** Wire bytes of stroke chain `index` of `buf`. */
export function strokeChainBytes(buf: StrokeChainBuffer, index: number): number {
  return STROKE_CHAIN_PREFIX_BYTES + (buf.contCount[index] ?? 0) * STROKE_CONTINUATION_BYTES;
}

/** `refTick - tick` clamped to the 8-bit field (a stroke older than 255 ticks decodes as exactly 255 ticks old). */
export function strokeTickOffset(refTick: number, tick: number): number {
  const d = refTick - tick;
  return d < 0 ? 0 : d > 255 ? 255 : d;
}

/** Writes chain `index` of `buf` (caller has checked it fits). */
export function writeStrokeChain(bw: BitWriter, buf: StrokeChainBuffer, index: number, refTick: number): void {
  const actor = buf.actorSlot[index] ?? 0;
  bw.writeBits(buf.anchor[index] ?? 0, PLOT_ID_BITS);
  bw.writeSigned(buf.startUMm[index] ?? 0, 16);
  bw.writeSigned(buf.startVMm[index] ?? 0, 16);
  bw.writeSigned(buf.endUMm[index] ?? 0, 16);
  bw.writeSigned(buf.endVMm[index] ?? 0, 16);
  bw.writeBits(buf.widthCm[index] ?? 0, STROKE_WIDTH_CM_BITS);
  bw.writeBits(buf.depth16[index] ?? 0, 8);
  bw.writeBits(buf.toolCode[index] ?? 0, STROKE_TOOL_CODE_BITS);
  bw.writeBits(actor, STROKE_ACTOR_SLOT_BITS);
  bw.writeBits(strokeTickOffset(refTick, buf.tick[index] ?? 0), 8);
  bw.writeBits(buf.inputSeq[index] ?? 0, 16);
  const count = buf.contCount[index] ?? 0;
  bw.writeBits(count, 8);
  const start = buf.contStart[index] ?? 0;
  for (let k = 0; k < count; k++) {
    bw.writeBits(actor, STROKE_ACTOR_SLOT_BITS);
    bw.writeSigned(buf.contDxMm[start + k] ?? 0, STROKE_DELTA_BITS);
    bw.writeSigned(buf.contDyMm[start + k] ?? 0, STROKE_DELTA_BITS);
  }
}

/**
 * Reads one chain into `out` (appended). Returns false on truncated input, a plot id >= `plotCount`, a zero width,
 * non-zero padding, a continuation actor that differs from the header's, or when `out` has no room (capacity is the
 * decoder's cap against untrusted counts).
 */
export function readStrokeChain(br: BitReader, out: StrokeChainBuffer, refTick: number, plotCount: number): boolean {
  const anchor = br.readBits(PLOT_ID_BITS);
  const su = br.readSigned(16);
  const sv = br.readSigned(16);
  const eu = br.readSigned(16);
  const ev = br.readSigned(16);
  const width = br.readBits(STROKE_WIDTH_CM_BITS);
  const depth = br.readBits(8);
  const tool = br.readBits(STROKE_TOOL_CODE_BITS);
  const actor = br.readBits(STROKE_ACTOR_SLOT_BITS);
  const off = br.readBits(8);
  const seq = br.readBits(16);
  const count = br.readBits(8);
  if (br.error || anchor >= plotCount || width < 1) return false;
  if (br.remainingBits() < count * 32) return false;
  const idx = out.addChain(anchor, su, sv, eu, ev, width, depth, tool, actor, (refTick - off) >>> 0, seq);
  if (idx < 0) return false;
  for (let k = 0; k < count; k++) {
    const a = br.readBits(STROKE_ACTOR_SLOT_BITS);
    const dx = br.readSigned(STROKE_DELTA_BITS);
    const dy = br.readSigned(STROKE_DELTA_BITS);
    if (br.error || a !== actor || !out.addContinuation(dx, dy)) return false;
  }
  return true;
}

/** Reusable record produced by `expandStrokeChain`. */
export interface StrokeRecordOut {
  anchor: number;
  startUMm: number;
  startVMm: number;
  endUMm: number;
  endVMm: number;
  widthCm: number;
  depth16: number;
  toolCode: number;
  tick: number;
  actorSlot: number;
  inputSeq: number;
}

export function createStrokeRecordOut(): StrokeRecordOut {
  return {
    anchor: 0,
    startUMm: 0,
    startVMm: 0,
    endUMm: 0,
    endVMm: 0,
    widthCm: 0,
    depth16: 0,
    toolCode: 0,
    tick: 0,
    actorSlot: 0,
    inputSeq: 0,
  };
}

/**
 * Expands chain `index` into logical stroke records (world/stroke StrokeChainSchema rule): record k starts at the end of
 * record k-1, ends at that end plus (dx, dy), keeps anchor, width, depth16 and tool, and has
 * `tick = header.tick + k * frameIntervalTicks`, `inputSeq = (header.inputSeq + k * frameIntervalTicks) mod 65536`.
 * `emit` is called with the same `scratch` object for every record (header first); nothing is allocated.
 */
export function expandStrokeChain(
  buf: StrokeChainBuffer,
  index: number,
  frameIntervalTicks: number,
  scratch: StrokeRecordOut,
  emit: (record: StrokeRecordOut) => void,
): void {
  scratch.anchor = buf.anchor[index] ?? 0;
  scratch.startUMm = buf.startUMm[index] ?? 0;
  scratch.startVMm = buf.startVMm[index] ?? 0;
  scratch.endUMm = buf.endUMm[index] ?? 0;
  scratch.endVMm = buf.endVMm[index] ?? 0;
  scratch.widthCm = buf.widthCm[index] ?? 0;
  scratch.depth16 = buf.depth16[index] ?? 0;
  scratch.toolCode = buf.toolCode[index] ?? 0;
  scratch.actorSlot = buf.actorSlot[index] ?? 0;
  const tick0 = buf.tick[index] ?? 0;
  const seq0 = buf.inputSeq[index] ?? 0;
  scratch.tick = tick0;
  scratch.inputSeq = seq0;
  emit(scratch);
  const count = buf.contCount[index] ?? 0;
  const start = buf.contStart[index] ?? 0;
  for (let k = 0; k < count; k++) {
    scratch.startUMm = scratch.endUMm;
    scratch.startVMm = scratch.endVMm;
    scratch.endUMm += buf.contDxMm[start + k] ?? 0;
    scratch.endVMm += buf.contDyMm[start + k] ?? 0;
    scratch.tick = (tick0 + (k + 1) * frameIntervalTicks) >>> 0;
    scratch.inputSeq = (seq0 + (k + 1) * frameIntervalTicks) & 0xffff;
    emit(scratch);
  }
}

// ---- Robot intents and plot deltas ---------------------------------------------------------------------------------

/** Writes robot intent `index` (20 B; caller has checked it fits). */
export function writeRobotIntent(bw: BitWriter, list: RobotIntentList, index: number): void {
  bw.writeBits(list.robotId[index] ?? 0, DUST_WIRE.robotIdBits);
  bw.writeBits(list.plotId[index] ?? 0, PLOT_ID_BITS);
  bw.writeBits(list.startTick[index] ?? 0, 32);
  bw.writeBits(list.widthCm[index] ?? 0, DUST_WIRE.robotWidthCmBits);
  bw.writeBits(list.depth16[index] ?? 0, 8);
  bw.writeBits(list.speedCmPerS[index] ?? 0, DUST_WIRE.robotSpeedCmPerSBits);
  bw.writeBits(list.laneMaskLow[index] ?? 0, 32);
  bw.writeBits(list.laneMaskHigh[index] ?? 0, 32);
  bw.align();
}

/** Reads one robot intent into `list` (appended). False on truncation, bad plot, zero width/speed, bad padding or no room. */
export function readRobotIntent(br: BitReader, list: RobotIntentList, plotCount: number): boolean {
  const i = list.count;
  const robotId = br.readBits(DUST_WIRE.robotIdBits);
  const plotId = br.readBits(PLOT_ID_BITS);
  const startTick = br.readBits(32);
  const widthCm = br.readBits(DUST_WIRE.robotWidthCmBits);
  const depth16 = br.readBits(8);
  const speed = br.readBits(DUST_WIRE.robotSpeedCmPerSBits);
  const low = br.readBits(32);
  const high = br.readBits(32);
  const pad = br.readBits(2);
  if (br.error || pad !== 0 || plotId >= plotCount || widthCm < 1 || speed < 1 || i >= FRAME_MAX_ROBOT_INTENTS) {
    return false;
  }
  list.robotId[i] = robotId;
  list.plotId[i] = plotId;
  list.startTick[i] = startTick;
  list.widthCm[i] = widthCm;
  list.depth16[i] = depth16;
  list.speedCmPerS[i] = speed;
  list.laneMaskLow[i] = low;
  list.laneMaskHigh[i] = high;
  list.count = i + 1;
  return true;
}

/** Writes dust plot delta `index` (4 B). */
export function writeDustPlotDelta(bw: BitWriter, list: DustPlotDeltaList, index: number): void {
  bw.writeBits(list.plotId[index] ?? 0, PLOT_ID_BITS);
  bw.writeBits(list.state[index] ?? 0, DUST_WIRE.plotStateBits);
  bw.writeBits(list.remainingFrac[index] ?? 0, 8);
  bw.writeBits(0, 4);
}

/** Reads one dust plot delta into `list`. False on truncation, bad plot, non-zero spare bits or no room. */
export function readDustPlotDelta(br: BitReader, list: DustPlotDeltaList, plotCount: number): boolean {
  const i = list.count;
  const plotId = br.readBits(PLOT_ID_BITS);
  const state = br.readBits(DUST_WIRE.plotStateBits);
  const frac = br.readBits(8);
  const spare = br.readBits(4);
  if (br.error || spare !== 0 || plotId >= plotCount || i >= FRAME_MAX_DUST_PLOT_DELTAS) return false;
  list.plotId[i] = plotId;
  list.state[i] = state;
  list.remainingFrac[i] = frac;
  list.count = i + 1;
  return true;
}
