// P2 prototype: one client's dust model. It keeps the AUTHORITATIVE copy (only server-echoed strokes, robot chunks
// replayed by server tick, and server ledgers are applied), a list of its own unacknowledged predictions keyed by
// inputSeq, the stroke logs for tile rebuilds, and its interest set. It decodes the same bytes the server counts.
// Environment-agnostic. Frame decoding and stroke application allocate nothing.

import { DustView, LEDGER_BYTES, STATE_POLISHED } from "./dust-view";
import { InterestSet, type InterestScratch } from "./interest";
import { RobotPlans } from "./robots";
import { StrokeLog } from "./stroke-log";
import type { PlotTables } from "./tables";
import { applyLogged, ByteReader, type Codec, type StrokeSink } from "./util";

export const SEC_STROKES = 1;
export const SEC_ROBOT = 2;
export const SEC_ACK = 3;
export const SEC_PLOTS = 4;
/** Prototype addition: robots whose plan ends now (re-assigned to a plot outside this client's dust radius). */
export const SEC_ROBOT_STOP = 5;
export const MSG_SNAPSHOT = 0x21;
export const MSG_LEDGER = 0x22;
export const MSG_LOG = 0x23;
export const MSG_CHECK = 0x24;
/** Prototype additions (not in protocol/messages.ts): a robot intent and a Polished plot state sent on interest entry. */
export const MSG_ROBOT = 0x25;
export const MSG_PLOT = 0x26;
/** Second part of the blocking join snapshot: ledgers + logs within 60 m. */
export const MSG_NEAR = 0x27;

export const STROKE_HEADER_BYTES = 17;
export const STROKE_CONT_BYTES = 4;
const PRED_RING = 64;

/** Tile-side hooks of a rendering client (the CPU reference atlas, or nothing on headless bots). */
export interface TileSink extends StrokeSink {
  onLedger(plot: number): void;
  onDrop(plot: number): void;
}

export class P2Client {
  readonly view: DustView;
  readonly set: InterestSet;
  readonly log: StrokeLog;
  readonly plans = new RobotPlans();
  tiles: TileSink | null = null;
  ownActor = -1;
  ackedGrams = 0;

  // chain decode state per actor slot
  private readonly cAnchor = new Int32Array(64).fill(-1);
  private readonly cEndU = new Int32Array(64);
  private readonly cEndV = new Int32Array(64);
  private readonly cWidth = new Int32Array(64);
  private readonly cDepth = new Int32Array(64);
  private readonly cTool = new Int32Array(64);
  private readonly cSeq = new Int32Array(64);

  // unacknowledged own predictions (ring): inputSeq and the tick they were made
  private readonly predSeq = new Int32Array(PRED_RING);
  private readonly predTick = new Int32Array(PRED_RING);
  private predHead = 0;
  predN = 0;

  // counters
  strokesApplied = 0;
  echoes = 0;
  mispredicts = 0;
  l0Mismatch = 0;
  driftChunks = 0;
  strayLedgers = 0;
  ledgersInstalled = 0;
  badContinuations = 0;

  // dust.check scratch
  private readonly chunkAcc: Int32Array;
  private readonly chunkSeen: Uint8Array;
  private chunkList = new Int32Array(64);
  /** Chunks that mismatched in the last check (the caller requests a resync for them). */
  driftList = new Int32Array(16);
  driftN = 0;

  constructor(
    readonly id: number,
    readonly t: PlotTables,
    scratch: InterestScratch,
    enterM: number,
    leaveM: number,
    private readonly frameTicks: number,
    private readonly codec: Codec,
  ) {
    this.view = new DustView(t);
    this.set = new InterestSet(t, scratch, enterM, leaveM);
    this.view.member = this.set.member;
    // Clients keep logs only for their resident ledgers: 1 MB is ~250 full rings.
    this.log = new StrokeLog(t.count, 256, 4 * 1024 * 1024);
    this.chunkAcc = new Int32Array(t.chunkCount);
    this.chunkSeen = new Uint8Array(t.chunkCount);
  }

  // ---- prediction ---------------------------------------------------------------------------------------------

  /** Records an own stroke the client predicted (it is drawn locally at once; the ledger copy waits for the echo). */
  predict(inputSeq: number, tick: number): void {
    const at = (this.predHead + this.predN) % PRED_RING;
    this.predSeq[at] = inputSeq;
    this.predTick[at] = tick;
    if (this.predN < PRED_RING) this.predN++;
    else this.predHead = (this.predHead + 1) % PRED_RING;
  }

  /** An echo with inputSeq `seq` acknowledges every prediction up to it (16-bit wrap-around compare). */
  private ack(seq: number): void {
    this.echoes++;
    while (this.predN > 0 && ((seq - this.predSeq[this.predHead]!) & 0xffff) < 0x8000) {
      this.predHead = (this.predHead + 1) % PRED_RING;
      this.predN--;
    }
  }

  /** Drops predictions with no echo within `maxAgeTicks` (rejected strokes; WDS 4.4: 1 s). */
  expirePredictions(tick: number, maxAgeTicks: number): void {
    while (this.predN > 0 && tick - this.predTick[this.predHead]! > maxAgeTicks) {
      this.predHead = (this.predHead + 1) % PRED_RING;
      this.predN--;
      this.mispredicts++;
    }
  }

  // ---- per-tick input -----------------------------------------------------------------------------------------

  private applyRemote(
    anchor: number,
    sU: number,
    sV: number,
    eU: number,
    eV: number,
    widthCm: number,
    depth16: number,
    toolCode: number,
    actor: number,
  ): void {
    applyLogged(this.view, this.log, anchor, sU, sV, eU, eV, widthCm, depth16, toolCode, actor);
    this.strokesApplied++;
    if (this.tiles !== null) this.tiles.onStroke(anchor, sU, sV, eU, eV, widthCm, depth16);
  }

  /** Decodes the dust sections of one FRAME. */
  onFrame(buf: Uint8Array, len: number): void {
    let pos = 0;
    while (pos < len) {
      const id = buf[pos++]!;
      if (id === SEC_STROKES) {
        const n = buf[pos]! | (buf[pos + 1]! << 8);
        pos += 2;
        const bitmap = pos;
        pos += (n + 7) >> 3;
        for (let k = 0; k < n; k++) {
          if (((buf[bitmap + (k >> 3)]! >> (k & 7)) & 1) === 1) {
            const w0 = buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16);
            const anchor = w0 & 0x3ffff;
            const tool = w0 >>> 18;
            const sU = ((buf[pos + 3]! | (buf[pos + 4]! << 8)) << 16) >> 16;
            const sV = ((buf[pos + 5]! | (buf[pos + 6]! << 8)) << 16) >> 16;
            const eU = ((buf[pos + 7]! | (buf[pos + 8]! << 8)) << 16) >> 16;
            const eV = ((buf[pos + 9]! | (buf[pos + 10]! << 8)) << 16) >> 16;
            const w1 = buf[pos + 11]! | (buf[pos + 12]! << 8);
            const width = w1 & 0x3ff;
            const actor = w1 >>> 10;
            const depth = buf[pos + 13]!;
            const seq = buf[pos + 15]! | (buf[pos + 16]! << 8);
            pos += STROKE_HEADER_BYTES;
            this.cAnchor[actor] = anchor;
            this.cEndU[actor] = eU;
            this.cEndV[actor] = eV;
            this.cWidth[actor] = width;
            this.cDepth[actor] = depth;
            this.cTool[actor] = tool;
            this.cSeq[actor] = seq;
            this.applyRemote(anchor, sU, sV, eU, eV, width, depth, tool, actor);
            if (actor === this.ownActor) this.ack(seq);
          } else {
            const w = buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24);
            pos += STROKE_CONT_BYTES;
            const actor = w & 63;
            const dx = (w << 13) >> 19;
            const dy = w >> 19;
            const anchor = this.cAnchor[actor]!;
            if (anchor < 0) {
              this.badContinuations++;
              continue;
            }
            const sU = this.cEndU[actor]!;
            const sV = this.cEndV[actor]!;
            const eU = sU + dx;
            const eV = sV + dy;
            const seq = (this.cSeq[actor]! + this.frameTicks) & 0xffff;
            this.cEndU[actor] = eU;
            this.cEndV[actor] = eV;
            this.cSeq[actor] = seq;
            this.applyRemote(
              anchor,
              sU,
              sV,
              eU,
              eV,
              this.cWidth[actor]!,
              this.cDepth[actor]!,
              this.cTool[actor]!,
              actor,
            );
            if (actor === this.ownActor) this.ack(seq);
          }
        }
      } else if (id === SEC_ROBOT) {
        const n = buf[pos++]!;
        for (let k = 0; k < n; k++) {
          this.readIntent(buf, pos, 0);
          pos += 20;
        }
      } else if (id === SEC_ROBOT_STOP) {
        const n = buf[pos++]!;
        for (let k = 0; k < n; k++) {
          this.plans.stop(buf[pos]! | (buf[pos + 1]! << 8));
          pos += 2;
        }
      } else if (id === SEC_ACK) {
        this.ackedGrams = buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16);
        pos += 3;
      } else if (id === SEC_PLOTS) {
        const n = buf[pos]! | (buf[pos + 1]! << 8);
        pos += 2;
        for (let k = 0; k < n; k++) {
          const w0 = buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16);
          const frac = buf[pos + 3]!;
          pos += 4;
          this.applyL0(w0 & 0x3ffff, (w0 >>> 18) & 3, frac, false);
        }
      } else {
        throw new Error(`p2 client: unknown FRAME section ${id}`);
      }
    }
  }

  private readIntent(buf: Uint8Array, pos: number, fromTick: number): void {
    const robotId = buf[pos]! | (buf[pos + 1]! << 8);
    const w0 = buf[pos + 2]! | (buf[pos + 3]! << 8) | (buf[pos + 4]! << 16);
    const w1 = buf[pos + 5]! | (buf[pos + 6]! << 8);
    const plot = w0 & 0x3ffff;
    const width = (w0 >>> 18) | ((w1 & 0xf) << 6);
    const speed = (w1 >>> 4) & 0x3ff;
    const startTick = (buf[pos + 7]! | (buf[pos + 8]! << 8) | (buf[pos + 9]! << 16) | (buf[pos + 10]! << 24)) >>> 0;
    const depth = buf[pos + 11]!;
    const m0 = (buf[pos + 12]! | (buf[pos + 13]! << 8) | (buf[pos + 14]! << 16) | (buf[pos + 15]! << 24)) >>> 0;
    const m1 = (buf[pos + 16]! | (buf[pos + 17]! << 8) | (buf[pos + 18]! << 16) | (buf[pos + 19]! << 24)) >>> 0;
    this.plans.set(robotId, plot, startTick, width, depth, speed, m0, m1, fromTick);
  }

  /** L0 record. Member plots are replayed locally, so the record is only compared; others are stored. */
  private applyL0(plot: number, state: number, frac: number, force: boolean): void {
    const v = this.view;
    if (!force && this.set.member[plot] === 1) {
      if (v.state[plot] !== state || v.frac[plot] !== frac) this.l0Mismatch++;
      return;
    }
    if (state === STATE_POLISHED) {
      if (v.state[plot] !== STATE_POLISHED) {
        v.setPolished(plot);
        this.log.drop(plot);
        if (this.tiles !== null) this.tiles.onLedger(plot);
      }
      return;
    }
    v.state[plot] = state;
    v.frac[plot] = frac;
  }

  /** Replays the robot chunks due at server tick `tick`. */
  robotStep(tick: number, hz: number): void {
    this.plans.step(tick, hz, this.view, this.log, null, this.tiles);
  }

  /** Re-evaluates the interest set at the server-acknowledged position; ledgers of plots that left are dropped. */
  scan(pos: Float64Array): void {
    const set = this.set;
    set.scan(pos);
    for (let i = 0; i < set.leftN; i++) {
      const p = set.left[i]!;
      this.view.freeLedger(p);
      this.log.drop(p);
      if (this.tiles !== null) this.tiles.onDrop(p);
    }
  }

  // ---- bytes messages -----------------------------------------------------------------------------------------

  private installFrom(r: ByteReader, plot: number): void {
    const version = r.u32();
    const initial = r.u32();
    const owned = r.u16();
    const nC = r.u8();
    r.pos += nC * 5;
    if (this.set.member[plot] === 0) this.strayLedgers++;
    else {
      this.view.installLedger(plot, r.buf, r.pos, version, initial, owned);
      this.ledgersInstalled++;
    }
    r.pos += LEDGER_BYTES;
  }

  private logFrom(r: ByteReader, plot: number, n: number): void {
    const keep = this.set.member[plot] === 1 && this.view.slotOf[plot]! >= 0;
    if (keep) this.log.drop(plot);
    for (let k = 0; k < n; k++) {
      const w0 = r.u32() | 0;
      const w1 = r.u32() | 0;
      const w2 = r.u32() | 0;
      const w3 = r.u32() | 0;
      if (keep) this.log.pushPacked(plot, w0, w1, w2, w3);
    }
  }

  /** One bytes message (ledger, log, check, entry intent, entry plot state). `tick` is the server tick it was sent at. */
  onMessage(buf: Uint8Array, tick: number): void {
    const id = buf[0]!;
    if (id === MSG_LEDGER) {
      const plot = buf[1]! | (buf[2]! << 8) | (buf[3]! << 16);
      const r = new ByteReader(this.codec.inflate(buf.subarray(4)));
      this.installFrom(r, plot);
      if (this.tiles !== null) this.tiles.onLedger(plot);
    } else if (id === MSG_LOG) {
      const plot = buf[1]! | (buf[2]! << 8) | (buf[3]! << 16);
      const n = buf[4]! | (buf[5]! << 8);
      this.logFrom(new ByteReader(this.codec.inflate(buf.subarray(6))), plot, n);
      if (this.tiles !== null) this.tiles.onLedger(plot);
    } else if (id === MSG_CHECK) {
      this.onCheck(buf);
    } else if (id === MSG_ROBOT) {
      this.readIntent(buf, 1, tick + 1);
    } else if (id === MSG_PLOT) {
      const w0 = buf[1]! | (buf[2]! << 8) | (buf[3]! << 16);
      this.applyL0(w0 & 0x3ffff, (w0 >>> 18) & 3, buf[4]!, true);
    } else if (id === MSG_NEAR) {
      const r = new ByteReader(this.codec.inflate(buf.subarray(1)));
      const n = r.u16();
      for (let k = 0; k < n; k++) {
        const plot = r.u24();
        this.installFrom(r, plot);
        this.logFrom(r, plot, r.u16());
        if (this.tiles !== null) this.tiles.onLedger(plot);
      }
    } else {
      throw new Error(`p2 client: unknown message ${id}`);
    }
  }

  /** First part of the join snapshot: every plot state (2 bits) and the L0 byte of each Opened plot (WDS 5.4). */
  onSnapshot(buf: Uint8Array): void {
    const raw = this.codec.inflate(buf.subarray(1));
    const r = new ByteReader(raw);
    const count = r.u32();
    if (count !== this.t.count) throw new Error("p2 client: snapshot is for another grid");
    const states = r.pos;
    let fracAt = states + ((count + 3) >> 2);
    const v = this.view;
    for (let p = 0; p < count; p++) {
      const st = (raw[states + (p >> 2)]! >> ((p & 3) * 2)) & 3;
      if (st === STATE_POLISHED) v.setPolished(p);
      else {
        v.state[p] = st;
        if (st === 1) v.frac[p] = raw[fracAt++]!;
      }
    }
  }

  /** dust.check: compares the server's per-chunk XOR over this client's interest set with its own. */
  private onCheck(buf: Uint8Array): void {
    const t = this.t;
    const v = this.view;
    const set = this.set;
    let nChunks = 0;
    for (let i = 0; i < set.n; i++) {
      const plot = set.list[i]!;
      const h = v.plotHash(plot);
      if (h === 0) continue;
      const ch = t.chunkOf[plot]!;
      if (this.chunkSeen[ch] === 0) {
        this.chunkSeen[ch] = 1;
        if (nChunks === this.chunkList.length) {
          const g = new Int32Array(nChunks * 2);
          g.set(this.chunkList);
          this.chunkList = g;
        }
        this.chunkList[nChunks++] = ch;
      }
      this.chunkAcc[ch] = this.chunkAcc[ch]! ^ h;
    }
    this.driftN = 0;
    const n = buf[1]!;
    let pos = 2;
    for (let k = 0; k < n; k++) {
      const ch = buf[pos]! | (buf[pos + 1]! << 8);
      const h = buf[pos + 2]! | (buf[pos + 3]! << 8) | (buf[pos + 4]! << 16) | (buf[pos + 5]! << 24);
      pos += 6;
      if (this.chunkAcc[ch] !== h) this.noteDrift(ch);
      this.chunkSeen[ch] = 2;
    }
    for (let i = 0; i < nChunks; i++) {
      const ch = this.chunkList[i]!;
      // A chunk the client has state for but the server did not list.
      if (this.chunkSeen[ch] === 1 && this.chunkAcc[ch] !== 0) this.noteDrift(ch);
      this.chunkSeen[ch] = 0;
      this.chunkAcc[ch] = 0;
    }
    pos = 2;
    for (let k = 0; k < n; k++) {
      this.chunkSeen[buf[pos]! | (buf[pos + 1]! << 8)] = 0;
      pos += 6;
    }
  }

  private noteDrift(chunk: number): void {
    this.driftChunks++;
    if (this.driftN < this.driftList.length) this.driftList[this.driftN++] = chunk;
  }

  /** Hash over this client's interest set (ledgers and Polished markers). */
  hash(): number {
    return this.view.hashWhere(this.set.member);
  }
}
