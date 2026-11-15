// ShiftDust: dust sync of the multiplayer room from the authoritative WorldDustLedger (WDS section 5, M1-W4-T06).
//
// What it produces (all through the bytes channel, codecs of @moon-cleanup/protocol):
//   - DUST_SNAPSHOT (join, resync, reconnect): plot states of the whole moon, the remaining byte of every Opened plot
//     and the ledgers within JOIN_SNAPSHOT_RADIUS_M of the player (WDS 5.4 blocking part). Deflated (raw deflate,
//     zlib level 6) and sliced to <= 4 KB. Stroke logs are not included yet (cosmetic: tiles rebuild from ledgers).
//   - DUST_LEDGER (streamed part and DUST_REQUEST answers): one plot's ledger, deflated.
//   - DUST_CHECK detail answers to a chunk DUST_REQUEST.
//
// ORDERING RULE (why everything is built and sent synchronously right after the FRAMEs of a frame tick): when a
// snapshot or ledger leaves at frame tick T, every stroke up to T has already been sent in a FRAME (the core's stroke
// buffer is cleared after the frames), and every later stroke travels in a later FRAME. One WebSocket keeps that order,
// so a client that applies messages in arrival order never double-applies or misses a stroke. The snapshot's
// `snapshotVersion` carries T (information for clients and tests).
//
// Not on the per-tick hot path except `noteDirty` (allocation-free). Snapshot building allocates (join-time event).

import { constants as zlibConstants, deflateRawSync } from "node:zlib";
import { DUST_MESSAGE_SLICE_MAX_BYTES, LEDGER_BYTES, LEDGER_MAX_CONTRIBUTIONS, PlotState } from "@moon-cleanup/shared";
import {
  DUST_CHECK_ID,
  DUST_CHECK_MAX_DETAIL_PLOTS,
  DUST_LEDGER_ID,
  DUST_SNAPSHOT_MAX_LEDGERS,
  DUST_SNAPSHOT_MAX_SLICES,
  countOpened,
  encodeDustCheck,
  encodeDustLedger,
  encodeSnapshotRaw,
  snapshotSliceCount,
  writeSnapshotSlice,
  type Deflate,
  type LedgerRawInput,
} from "@moon-cleanup/protocol";
import type { WorldDustLedger } from "@moon-cleanup/world";

/** Ledgers within this distance travel in the blocking join snapshot (WDS 5.2). */
export const JOIN_SNAPSHOT_RADIUS_M = 60;
/** Streamed ledgers per client (WDS 5.4: <= 8 KB/s shared with structures; no structures in the MVP). */
export const DUST_STREAM_BYTES_PER_S = 8 * 1024;
/** Leave hysteresis of the streamed-ledger set (WDS 5.2). */
export const DUST_STREAM_HYSTERESIS_M = 20;
/** Highest contribution actor slot the wire carries (decoder cap; the shift bucket 16 is not sent). */
const WIRE_ACTOR_SLOT_MAX = 15;
/** zlib level of the snapshot (WDS 5.1). */
const DEFLATE_LEVEL = 6;

/** Node zlib raw deflate (the client inflates raw deflate). */
export const nodeDeflateRaw: Deflate = (raw) =>
  deflateRawSync(raw, { level: DEFLATE_LEVEL, strategy: zlibConstants.Z_DEFAULT_STRATEGY });

export interface DustSnapshotBuild {
  /** Slice message bodies WITHOUT the type byte (as `client.sendBytes(DUST_SNAPSHOT_ID, body)` wants them). */
  readonly slices: Uint8Array[];
  readonly rawBytes: number;
  readonly deflatedBytes: number;
  readonly ledgers: number;
  readonly buildMs: number;
}

export class ShiftDust {
  readonly ledger: WorldDustLedger;
  readonly plotCount: number;
  private readonly moonRadiusM: number;
  private readonly deflate: Deflate;
  private readonly dir = { x: 0, y: 0, z: 0 };
  private readonly actors = new Uint8Array(LEDGER_MAX_CONTRIBUTIONS);
  private readonly units = new Uint32Array(LEDGER_MAX_CONTRIBUTIONS);
  /** One DUST_LEDGER message (id byte first); deflate of 1,047 B of mostly-uniform data stays far below this. */
  private readonly ledgerOut = new Uint8Array(4 + 2048);
  private readonly checkOut = new Uint8Array(16 + DUST_CHECK_MAX_DETAIL_PLOTS * 11);
  private readonly sliceOut = new Uint8Array(DUST_MESSAGE_SLICE_MAX_BYTES);
  readonly counters = { snapshots: 0, snapshotFailures: 0, ledgersSent: 0, ledgerEncodeFailures: 0, checksSent: 0 };

  constructor(ledger: WorldDustLedger, moonRadiusM: number, deflate: Deflate = nodeDeflateRaw) {
    this.ledger = ledger;
    this.plotCount = ledger.plotCount;
    this.moonRadiusM = moonRadiusM;
    this.deflate = deflate;
  }

  /** Cosine of the angle a surface distance `m` spans (for the centre-direction dot test). */
  cosOf(m: number): number {
    const a = m / this.moonRadiusM;
    return a >= Math.PI ? -1 : Math.cos(a);
  }

  /** Dot of the plot centre direction with the unit direction (ux, uy, uz). */
  plotDot(plot: number, ux: number, uy: number, uz: number): number {
    const d = this.ledger.grid.centerDirectionInto(plot as never, this.dir as never) as {
      x: number;
      y: number;
      z: number;
    };
    return d.x * ux + d.y * uy + d.z * uz;
  }

  /** LEDGER RAW input of `plot` (a fresh object; event-time). Null when the plot has no ledger. */
  ledgerInput(plot: number): LedgerRawInput | null {
    const l = this.ledger;
    const slot = l.slotOf[plot] ?? -1;
    if (slot < 0) return null;
    const n = l.topContributions(plot, this.actors, this.units);
    const contributions: { actorSlot: number; units: number }[] = [];
    for (let k = 0; k < n; k++) {
      const a = this.actors[k]!;
      if (a <= WIRE_ACTOR_SLOT_MAX) contributions.push({ actorSlot: a, units: this.units[k]! });
    }
    const texels = new Uint8Array(LEDGER_BYTES);
    l.copyTexels(plot, texels, 0);
    return {
      header: {
        version: l.version[slot]!,
        remainingUnits: l.remaining[slot]!,
        initialUnits: l.initial[slot]!,
        ownedTexels: l.owned[slot]!,
        mgPerUnit: l.mgPerUnit[slot]!,
        hash: l.ledgerHash(plot),
        contributions,
      },
      texels,
    };
  }

  /**
   * SNAPSHOT RAW around the moon-centred position (px, py, pz): all plot states, Opened remaining bytes, ledgers within
   * `radiusM` (at most DUST_SNAPSHOT_MAX_LEDGERS, nearest kept). `sent` (optional, one byte per plot) is set to 1 for
   * every included ledger. Null when the encoder refuses the input.
   */
  buildSnapshotRaw(px: number, py: number, pz: number, radiusM: number, sent: Uint8Array | null): Uint8Array | null {
    const l = this.ledger;
    const n = l.plotCount;
    const states = new Uint8Array(Math.ceil(n / 4));
    const st = l.state;
    for (let p = 0; p < n; p++) {
      const s = st[p]! & 3;
      if (s !== 0) states[p >>> 2] = states[p >>> 2]! | (s << ((p & 3) * 2));
    }
    const opened = new Uint8Array(countOpened(states, n));
    let k = 0;
    for (let p = 0; p < n; p++) if (st[p] === PlotState.Opened) opened[k++] = l.frac[p]!;
    const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
    const ux = px / len;
    const uy = py / len;
    const uz = pz / len;
    const cosR = this.cosOf(radiusM);
    const near: { plot: number; dot: number }[] = [];
    for (let s = 0; s < l.slotHigh; s++) {
      const plot = l.plotOfSlot[s]!;
      if (plot < 0) continue;
      const dot = this.plotDot(plot, ux, uy, uz);
      if (dot >= cosR) near.push({ plot, dot });
    }
    near.sort((a, b) => b.dot - a.dot || a.plot - b.plot);
    if (near.length > DUST_SNAPSHOT_MAX_LEDGERS) near.length = DUST_SNAPSHOT_MAX_LEDGERS;
    near.sort((a, b) => a.plot - b.plot);
    const ledgers: { plotId: number; ledger: LedgerRawInput }[] = [];
    for (const e of near) {
      const input = this.ledgerInput(e.plot);
      if (input === null) continue;
      ledgers.push({ plotId: e.plot, ledger: input });
      if (sent !== null) sent[e.plot] = 1;
    }
    return encodeSnapshotRaw({ plotCount: n, plotStates: states, openedRemaining: opened, ledgers, logs: [] });
  }

  /** Builds, deflates and slices a snapshot. `version` is the server tick it reflects. Null on failure (counted). */
  buildSnapshot(
    px: number,
    py: number,
    pz: number,
    version: number,
    sent: Uint8Array | null,
    radiusM: number = JOIN_SNAPSHOT_RADIUS_M,
  ): DustSnapshotBuild | null {
    const start = performance.now();
    const raw = this.buildSnapshotRaw(px, py, pz, radiusM, sent);
    if (raw === null) {
      this.counters.snapshotFailures++;
      return null;
    }
    const deflated = this.deflate(raw);
    const count = snapshotSliceCount(deflated.length);
    if (count > DUST_SNAPSHOT_MAX_SLICES) {
      this.counters.snapshotFailures++;
      return null;
    }
    const slices: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const w = writeSnapshotSlice(deflated, i, version >>> 0, this.sliceOut);
      if (w === 0) {
        this.counters.snapshotFailures++;
        return null;
      }
      slices.push(this.sliceOut.slice(1, w));
    }
    this.counters.snapshots++;
    return {
      slices,
      rawBytes: raw.length,
      deflatedBytes: deflated.length,
      ledgers: countLedgers(raw, this.plotCount),
      buildMs: performance.now() - start,
    };
  }

  /**
   * DUST_LEDGER body of `plot` WITHOUT the type byte (a view into a reused buffer: send or copy at once), or null when
   * the plot has no ledger.
   */
  ledgerBody(plot: number): Uint8Array | null {
    const input = this.ledgerInput(plot);
    if (input === null) return null;
    const n = encodeDustLedger(plot, input, this.deflate, this.ledgerOut);
    if (n === 0 || this.ledgerOut[0] !== DUST_LEDGER_ID) {
      this.counters.ledgerEncodeFailures++;
      return null;
    }
    this.counters.ledgersSent++;
    return this.ledgerOut.subarray(1, n);
  }

  /** DUST_CHECK detail body (no type byte) of one chunk: (plotId, version, hash) per Opened plot with a ledger. */
  checkDetailBody(chunkId: number): Uint8Array | null {
    const l = this.ledger;
    const g = l.grid;
    if (!(chunkId >= 0 && chunkId < l.chunkCount)) return null;
    const plots = chunkId === g.params.poleChunkId ? 2 : 256;
    const list: { plotId: never; ledgerVersion: number; hash: number }[] = [];
    for (let k = 0; k < plots && list.length < DUST_CHECK_MAX_DETAIL_PLOTS; k++) {
      const plot = g.plotAtChunkLocal(chunkId as never, k) as number;
      const slot = l.slotOf[plot] ?? -1;
      if (l.state[plot] !== PlotState.Opened || slot < 0) continue;
      list.push({ plotId: plot as never, ledgerVersion: l.version[slot]!, hash: l.ledgerHash(plot) });
    }
    const n = encodeDustCheck({ mode: "detail", chunkId, plots: list }, this.checkOut);
    if (n === 0 || this.checkOut[0] !== DUST_CHECK_ID) return null;
    this.counters.checksSent++;
    return this.checkOut.subarray(1, n);
  }
}

/** Reads the ledger count of a SNAPSHOT RAW (statistics only). */
function countLedgers(raw: Uint8Array, plotCount: number): number {
  const stateBytes = Math.ceil(plotCount / 4);
  const opened = countOpened(raw.subarray(4, 4 + stateBytes), plotCount);
  const at = 4 + stateBytes + opened;
  return (raw[at] ?? 0) | ((raw[at + 1] ?? 0) << 8);
}
