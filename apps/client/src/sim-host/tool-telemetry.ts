// Solo-only authoritative tool telemetry (W3-T07). The worker writes it into the private trailer of the pooled FRAME
// buffer (messages.ts TOOL_TELEMETRY_OFFSET); the main thread decodes it into one reused snapshot. Nothing here touches
// the shared RoomHost / protocol contract, and nothing allocates per call.
//
// Phase mirrors packages/sim tools/tool.ts: phaseMs = (((inputSeq - seqAtToolDown) mod 65536) * stepMs) mod periodMs.

import {
  TOOL_TELEMETRY_OFFSET,
  TOOL_TELE_DETAILING,
  TOOL_TELE_HEAD_VALID,
  TOOL_TELE_IN_CONTACT,
  TOOL_TELE_PRESENT,
  TOOL_TELE_SWEEPING,
} from "./messages";

/** The slice of the sim the writer reads (structurally satisfied by MoonRoomSim). */
export interface ToolTelemetrySource {
  readonly config: {
    readonly stepMs: number;
    readonly tools: readonly { readonly periodMs: number }[];
  };
  toolState(slot: number): Readonly<{
    toolCode: number;
    wasActive: boolean;
    detailing: boolean;
    sweeping: boolean;
    inContact: boolean;
    headValid: boolean;
    headX: number;
    headY: number;
    headZ: number;
    seqAtToolDown: number;
    detailCooldownMs: number;
  }>;
}

/** Reused decoded snapshot (public, mutated in place). `valid` is false until a telemetry frame has arrived. */
export class ToolAnimSnapshot {
  valid = false;
  sweeping = false;
  detailing = false;
  inContact = false;
  headValid = false;
  toolCode = 0;
  /** 0..1 position in the stroke / detail period. */
  phase01 = 0;
  periodMs = 0;
  inputSeq = 0;
  headX = 0;
  headY = 0;
  headZ = 0;
  /** Frame counter of the decoded trailer (monotonic per host). */
  serial = 0;
}

/** Fills the block for `slot`. `inputSeq` is the seq of the input the sim just stepped with. */
export function writeToolTelemetry(
  u8: Uint8Array,
  scratchF64: Float64Array,
  scratchU8: Uint8Array,
  sim: ToolTelemetrySource,
  slot: number,
  inputSeq: number,
): void {
  const t = sim.toolState(slot);
  const tool = sim.config.tools[t.toolCode];
  const period = tool !== undefined ? tool.periodMs : 0;
  const active = t.wasActive && period > 0;
  const base = TOOL_TELEMETRY_OFFSET;
  let flags = TOOL_TELE_PRESENT;
  let phase01 = 0;
  if (active) {
    if (t.detailing) {
      flags |= TOOL_TELE_DETAILING;
      const cd = t.detailCooldownMs > 0 ? t.detailCooldownMs : 0;
      phase01 = 1 - Math.min(1, cd / period);
    } else {
      flags |= TOOL_TELE_SWEEPING;
      const delta = (inputSeq - t.seqAtToolDown) & 0xffff;
      phase01 = ((delta * sim.config.stepMs) % period) / period;
    }
    if (t.inContact) flags |= TOOL_TELE_IN_CONTACT;
    if (t.headValid) flags |= TOOL_TELE_HEAD_VALID;
  }
  u8[base] = flags;
  u8[base + 1] = t.toolCode & 0xff;
  const q = Math.round(phase01 * 65535);
  u8[base + 2] = q & 0xff;
  u8[base + 3] = q >>> 8;
  const p = period > 0xffff ? 0xffff : period;
  u8[base + 4] = p & 0xff;
  u8[base + 5] = p >>> 8;
  u8[base + 6] = inputSeq & 0xff;
  u8[base + 7] = (inputSeq >>> 8) & 0xff;
  putF64(u8, base + 8, t.headX, scratchF64, scratchU8);
  putF64(u8, base + 16, t.headY, scratchF64, scratchU8);
  putF64(u8, base + 24, t.headZ, scratchF64, scratchU8);
}

function putF64(u8: Uint8Array, at: number, v: number, f: Float64Array, b: Uint8Array): void {
  f[0] = v;
  for (let i = 0; i < 8; i++) u8[at + i] = b[i]!;
}

function getF64(u8: Uint8Array, at: number, f: Float64Array, b: Uint8Array): number {
  for (let i = 0; i < 8; i++) b[i] = u8[at + i]!;
  return f[0]!;
}

/** Decodes the block into `out`. A buffer without the present flag (old worker, short buffer) invalidates `out`. */
export function readToolTelemetry(
  u8: Uint8Array,
  out: ToolAnimSnapshot,
  scratchF64: Float64Array,
  scratchU8: Uint8Array,
): void {
  const base = TOOL_TELEMETRY_OFFSET;
  if (u8.length < base + 32 || ((u8[base] ?? 0) & TOOL_TELE_PRESENT) === 0) {
    out.valid = false;
    out.sweeping = out.detailing = out.inContact = out.headValid = false;
    return;
  }
  const flags = u8[base]!;
  out.valid = true;
  out.sweeping = (flags & TOOL_TELE_SWEEPING) !== 0;
  out.detailing = (flags & TOOL_TELE_DETAILING) !== 0;
  out.inContact = (flags & TOOL_TELE_IN_CONTACT) !== 0;
  out.headValid = (flags & TOOL_TELE_HEAD_VALID) !== 0;
  out.toolCode = u8[base + 1]!;
  out.phase01 = (u8[base + 2]! | (u8[base + 3]! << 8)) / 65535;
  out.periodMs = u8[base + 4]! | (u8[base + 5]! << 8);
  out.inputSeq = u8[base + 6]! | (u8[base + 7]! << 8);
  out.headX = getF64(u8, base + 8, scratchF64, scratchU8);
  out.headY = getF64(u8, base + 16, scratchF64, scratchU8);
  out.headZ = getF64(u8, base + 24, scratchF64, scratchU8);
  out.serial++;
}
