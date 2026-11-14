// P1 client: a mirror of the server's L0 table, fed only by `dust.plots` deltas and the join snapshot. There is no
// ledger and no stroke history on the client; trails live in the local detail ring (visual.ts) and are never synced.
import {
  ACK_BYTES,
  L0_DEFAULT,
  L0_VALUE_MASK,
  MSG_ACK,
  MSG_PLOTS,
  MSG_ROBOT,
  MSG_SNAPSHOT_RLE,
  MSG_SNAPSHOT_SPARSE,
  PLOTS_HEADER_BYTES,
  PLOT_RECORD_BYTES,
  ROBOT_MESSAGE_BYTES,
  hashTable,
  xorMix,
} from "./l0";
import { decodeSnapshot } from "./server";

/** Width of the GPU plot table (WDS 7.1: 512 x 321 texels); a changed plot dirties one row for a partial upload. */
export const PLOT_TABLE_WIDTH = 512;

export class P1Client {
  readonly l0: Uint16Array;
  readonly hash = new Uint32Array(1);
  nonDefaultCount = 0;
  bytesReceived = 0;
  /** Authoritative Dust Cell grams from the last `dust.ack`. */
  grams = 0;
  robotIntents = 0;
  plotDeltas = 0;
  private readonly rowDirty: Uint8Array;
  private dirtyRows = 0;

  constructor(plotCount: number) {
    this.l0 = new Uint16Array(plotCount).fill(L0_DEFAULT);
    this.rowDirty = new Uint8Array(Math.ceil(plotCount / PLOT_TABLE_WIDTH));
  }

  /** Remaining fraction 0..255 and 2-bit state of a plot. */
  fracOf(plot: number): number {
    return (this.l0[plot] ?? 0) & 0xff;
  }
  stateOf(plot: number): number {
    return ((this.l0[plot] ?? 0) >>> 8) & 3;
  }

  /** Applies one server message. Returns false for a malformed message (nothing is applied past the fault). */
  receive(b: Uint8Array, length: number): boolean {
    this.bytesReceived += length;
    const type = b[0];
    if (type === MSG_PLOTS) {
      const n = (b[1] ?? 0) | ((b[2] ?? 0) << 8);
      if (PLOTS_HEADER_BYTES + n * PLOT_RECORD_BYTES !== length) return false;
      let at = PLOTS_HEADER_BYTES;
      for (let k = 0; k < n; k++) {
        const lo = (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
        const plot = lo & 0x3ffff;
        const value = ((lo >>> 18) | ((b[at + 3] ?? 0) << 6)) & L0_VALUE_MASK;
        at += PLOT_RECORD_BYTES;
        if (plot >= this.l0.length) return false;
        const old = this.l0[plot] ?? 0;
        if (old === value) continue;
        if (old !== L0_DEFAULT) xorMix(this.hash, plot, old);
        else this.nonDefaultCount++;
        if (value !== L0_DEFAULT) xorMix(this.hash, plot, value);
        else this.nonDefaultCount--;
        this.l0[plot] = value;
        const row = (plot / PLOT_TABLE_WIDTH) | 0;
        if (this.rowDirty[row] === 0) {
          this.rowDirty[row] = 1;
          this.dirtyRows++;
        }
      }
      this.plotDeltas += n;
      return true;
    }
    if (type === MSG_ACK) {
      if (length !== ACK_BYTES) return false;
      this.grams = (b[1] ?? 0) | ((b[2] ?? 0) << 8) | ((b[3] ?? 0) << 16);
      return true;
    }
    if (type === MSG_ROBOT) {
      if (length !== ROBOT_MESSAGE_BYTES) return false;
      this.robotIntents++;
      return true;
    }
    if (type === MSG_SNAPSHOT_SPARSE || type === MSG_SNAPSHOT_RLE) {
      if (!decodeSnapshot(b.subarray(0, length), this.l0)) return false;
      this.nonDefaultCount = hashTable(this.l0, this.hash);
      this.rowDirty.fill(1);
      this.dirtyRows = this.rowDirty.length;
      return true;
    }
    return false;
  }

  /** Plot-table rows changed since the last call (the per-frame GPU upload count); clears the set. */
  takeDirtyRows(): number {
    const n = this.dirtyRows;
    if (n !== 0) {
      this.rowDirty.fill(0);
      this.dirtyRows = 0;
    }
    return n;
  }
}
