// P2 prototype: the authoritative dust server (WDS 4.3 to 5.5), simulated in-process with its clients.
//   - strokes are queued per tick, optionally coalesced to one stroke per actor per frame interval (WDS 4.4 cadence),
//     applied in ascending actorSlot (4.5a), rewritten into per-actor chains (17 B header / 4 B continuation) and sent
//     only to clients whose interest set holds an overlapped plot (plus the echo to the originator);
//   - robots are intents expanded into 1-second ledger chunks by server and clients alike (4.8);
//   - L0 deltas for the whole moon at 2 Hz, per-client chunk drift checks every 5 s, ledgers on interest entry.
// Every byte charged to a client is a byte of a real encoded buffer that the client decodes.
// Environment-agnostic (the timer and the compression codec are injected). The stroke path allocates nothing.

import {
  MSG_CHECK,
  MSG_LEDGER,
  MSG_LOG,
  MSG_NEAR,
  MSG_PLOT,
  MSG_ROBOT,
  MSG_SNAPSHOT,
  P2Client,
  SEC_ACK,
  SEC_PLOTS,
  SEC_ROBOT,
  SEC_STROKES,
} from "./client";
import {
  DustView,
  LEDGER_BYTES,
  MAX_CONTRIB,
  MG_PER_UNIT,
  STATE_EMPTY,
  STATE_OPENED,
  STATE_POLISHED,
} from "./dust-view";
import { InterestScratch, InterestSet } from "./interest";
import { ROBOT_INTENT_BYTES, RobotPlans } from "./robots";
import { StrokeLog } from "./stroke-log";
import type { PlotTables } from "./tables";
import { applyLogged, ByteWriter, xform, type Codec } from "./util";

export interface P2Options {
  readonly simTickHz: number;
  /** "frame": one stroke per actor per frame interval (spec cadence, 10 Hz). "tick": every submitted stroke as is. */
  readonly cadence: "frame" | "tick";
  /** Tile residency radius of the clients' preset (metres); the dust radius adds 20 m, leaving adds 20 m more. */
  readonly residencyM: number;
  /** Dust Cell capacity in grams; 0 = unlimited (contest bots never empty their cells). */
  readonly dustCellCapacityG: number;
  readonly codec: Codec;
  /** dust.check cadence in seconds (default 5, WDS 5.1). */
  readonly checkIntervalS?: number;
  /** High-resolution clock in ms (performance.now). */
  readonly now: () => number;
}

export const SUBMIT_OK = 0;
export const SUBMIT_TOO_LONG = 1;
export const SUBMIT_EMPTY_PLOT = 2;
export const SUBMIT_CELL_FULL = 3;
export const SUBMIT_MALFORMED = 4;

/** Stroke fields as the harness hands them over (structurally the shared StrokeRecord). */
export interface StrokeLike {
  readonly anchor: number;
  readonly startUMm: number;
  readonly startVMm: number;
  readonly endUMm: number;
  readonly endVMm: number;
  readonly widthCm: number;
  readonly depth16: number;
  readonly toolCode: number;
  readonly tick: number;
  readonly actorSlot: number;
  readonly inputSeq: number;
}

const QW = 12;
const MAX_SEGMENT_MM = 4000;
const REANCHOR_MM = 30_000;
const SNAPSHOT_HZ = 10;
const BLOCKING_RADIUS_M = 60;
const SAMPLE_RING = 1 << 15;

export class Link {
  readonly mirror: InterestSet;
  readonly pos = new Float64Array(3);
  hasPos = false;
  needScan = false;
  actor = -1;
  bytes = 0;
  readonly rec = new ByteWriter(512);
  kinds = new Uint8Array(64);
  nRec = 0;
  readonly robotRec = new ByteWriter(64);
  nRobot = 0;
  readonly seenChain = new Int32Array(64).fill(-1);
  readonly seenIdx = new Int32Array(64);
  knowsRobot = new Int32Array(64);
  ackSent = -1;
  readonly frame = new ByteWriter(1024);
  /** Reused dust.check message (2 + 255 x 6 bytes at most); checkLen is its length this round. */
  readonly checkBuf = new Uint8Array(2 + 255 * 6);
  checkLen = 0;
  readonly outbox: Uint8Array[] = [];

  constructor(
    readonly idx: number,
    readonly clientId: number,
    readonly client: P2Client,
    t: PlotTables,
    scratch: InterestScratch,
    enterM: number,
    leaveM: number,
  ) {
    this.mirror = new InterestSet(t, scratch, enterM, leaveM);
  }
}

export interface JoinResult {
  readonly blockingBytes: number;
  readonly streamedBytes: number;
  readonly ledgersBlocking: number;
  readonly ledgersStreamed: number;
}

export class P2Server {
  readonly view: DustView;
  readonly log: StrokeLog;
  readonly plans = new RobotPlans();
  readonly scratch: InterestScratch;
  tick = 0;
  readonly links: (Link | null)[] = [];
  private readonly byClient = new Map<number, Link>();
  readonly frameTicks: number;
  private readonly merge: boolean;
  private readonly enterM: number;
  private readonly leaveM: number;
  private readonly scanEvery: number;
  private readonly checkEvery: number;
  private readonly plotsEveryFrames: number;
  private frameNo = 0;

  // stroke queue (structure of arrays in one Int32Array)
  private q = new Int32Array(256 * QW);
  private qN = 0;
  private order = new Int32Array(256);
  private readonly bucket = new Int32Array(65);
  private readonly mergeRow = new Int32Array(64).fill(-1);
  private readonly mergeFirstTick = new Int32Array(64);
  private readonly xy = new Int32Array(2);

  // per-actor chain (global, shared by every recipient)
  private chainCounter = 0;
  private readonly chainId = new Int32Array(64);
  private readonly chainIdx = new Int32Array(64);
  private readonly chAnchor = new Int32Array(64);
  private readonly chEndU = new Int32Array(64);
  private readonly chEndV = new Int32Array(64);
  private readonly chWidth = new Int32Array(64);
  private readonly chDepth = new Int32Array(64);
  private readonly chTool = new Int32Array(64);
  private readonly chSeq = new Int32Array(64);

  // Dust Cells: whole grams and the milligram remainder per actor slot
  readonly grams = new Uint32Array(64);
  readonly mgAcc = new Int32Array(64);
  readonly chunkDirty: Uint8Array;

  // most recent stroke end (join position fallback)
  readonly activity = new Float64Array(3);
  hasActivity = false;

  // snapshot cache (states part)
  private snapCache: Uint8Array | null = null;
  private snapVersion = -1;
  snapRawBytes = 0;

  // dust.check scratch
  private readonly chunkAcc: Uint32Array;
  private readonly chunkSeen: Uint8Array;
  private chunkList = new Int32Array(64);
  private readonly plotsBuf = new ByteWriter(1024);

  // statistics
  serverMs = 0;
  private readonly tickSamples = new Float64Array(SAMPLE_RING);
  private tickSampleN = 0;
  strokesSubmitted = 0;
  strokesMerged = 0;
  strokesApplied = 0;
  strokesCellFull = 0;
  unitsRemoved = 0;
  headersSent = 0;
  contsSent = 0;
  bytesStrokes = 0;
  bytesRobot = 0;
  bytesAck = 0;
  bytesPlots = 0;
  bytesLedger = 0;
  bytesLog = 0;
  bytesCheck = 0;
  bytesSnapshot = 0;
  ledgersSent = 0;
  resyncs = 0;
  scanMismatch = 0;

  constructor(
    readonly t: PlotTables,
    readonly opt: P2Options,
  ) {
    this.view = new DustView(t);
    this.log = new StrokeLog(t.count);
    this.scratch = new InterestScratch(t.count);
    this.merge = opt.cadence === "frame";
    this.frameTicks = this.merge ? Math.max(1, Math.round(opt.simTickHz / SNAPSHOT_HZ)) : 1;
    this.enterM = opt.residencyM + 20;
    this.leaveM = opt.residencyM + 40;
    this.scanEvery = Math.max(1, Math.round(opt.simTickHz / 2));
    this.checkEvery = Math.max(1, Math.round(opt.simTickHz * (opt.checkIntervalS ?? 5)));
    this.plotsEveryFrames = Math.max(1, Math.round(opt.simTickHz / this.frameTicks / 2));
    this.chunkDirty = new Uint8Array(t.chunkCount);
    this.chunkAcc = new Uint32Array(t.chunkCount);
    this.chunkSeen = new Uint8Array(t.chunkCount);
  }

  linkOf(clientId: number): Link | undefined {
    return this.byClient.get(clientId);
  }

  // ---- submit -------------------------------------------------------------------------------------------------

  /** Queues a stroke produced by `clientId`'s tool head. Returns a SUBMIT_* code; never throws. */
  submit(clientId: number, s: StrokeLike): number {
    // The clock returns a boxed double (16 B per call), so only every 16th submit is timed and the sample is
    // scaled: no per-stroke allocation, and the submit cost still lands in serverMs.
    if ((this.strokesSubmitted & 15) !== 0) return this.submitInner(clientId, s);
    const t0 = this.opt.now();
    const code = this.submitInner(clientId, s);
    this.serverMs += (this.opt.now() - t0) * 16;
    return code;
  }

  private submitInner(clientId: number, s: StrokeLike): number {
    const anchor = s.anchor;
    const sU = s.startUMm;
    const sV = s.startVMm;
    const eU = s.endUMm;
    const eV = s.endVMm;
    const width = s.widthCm;
    const depth = s.depth16;
    const tool = s.toolCode;
    const actor = s.actorSlot;
    const seq = s.inputSeq;
    const tick = s.tick;
    this.strokesSubmitted++;
    if (
      !(anchor >= 0 && anchor < this.t.count) ||
      !(width >= 1 && width <= 1023) ||
      !(depth >= 0 && depth <= 255) ||
      !(tool >= 0 && tool <= 63) ||
      !(actor >= 0 && actor <= 63) ||
      !(sU >= -32768 && sU <= 32767 && sV >= -32768 && sV <= 32767) ||
      !(eU >= -32768 && eU <= 32767 && eV >= -32768 && eV <= 32767) ||
      (anchor | 0) !== anchor ||
      (sU | 0) !== sU ||
      (sV | 0) !== sV ||
      (eU | 0) !== eU ||
      (eV | 0) !== eV
    ) {
      return SUBMIT_MALFORMED;
    }
    const dx = eU - sU;
    const dy = eV - sV;
    if (dx * dx + dy * dy > MAX_SEGMENT_MM * MAX_SEGMENT_MM) return SUBMIT_TOO_LONG;
    if (this.view.state[anchor] === STATE_EMPTY) return SUBMIT_EMPTY_PLOT;
    const cap = this.opt.dustCellCapacityG;
    if (cap > 0 && this.grams[actor]! >= cap) return SUBMIT_CELL_FULL;
    const link = this.byClient.get(clientId);
    const linkIdx = link === undefined ? -1 : link.idx;
    if (link !== undefined) link.actor = actor;
    const q = this.q;

    // Coalesce with the actor's previous stroke of this frame interval when it continues it.
    const prev = this.mergeRow[actor]!;
    if (this.merge && prev >= 0 && tick - this.mergeFirstTick[actor]! < this.frameTicks) {
      const o = prev * QW;
      if (q[o + 5] === width && q[o + 6] === depth && q[o + 7] === tool && tick > q[o + 8]!) {
        const pa = q[o]!;
        const xy = this.xy;
        if (pa === anchor) {
          xy[0] = q[o + 3]!;
          xy[1] = q[o + 4]!;
        } else xform(this.t, pa, q[o + 3]!, q[o + 4]!, anchor, xy);
        const du = xy[0]! - sU;
        const dv = xy[1]! - sV;
        if (du >= -2 && du <= 2 && dv >= -2 && dv <= 2) {
          if (pa === anchor) {
            xy[0] = q[o + 1]!;
            xy[1] = q[o + 2]!;
          } else xform(this.t, pa, q[o + 1]!, q[o + 2]!, anchor, xy);
          const mu = xy[0]!;
          const mv = xy[1]!;
          const lx = eU - mu;
          const ly = eV - mv;
          if (
            lx * lx + ly * ly <= MAX_SEGMENT_MM * MAX_SEGMENT_MM &&
            mu >= -32768 &&
            mu <= 32767 &&
            mv >= -32768 &&
            mv <= 32767
          ) {
            q[o] = anchor;
            q[o + 1] = mu;
            q[o + 2] = mv;
            q[o + 3] = eU;
            q[o + 4] = eV;
            q[o + 8] = tick;
            q[o + 10] = seq;
            q[o + 11] = linkIdx;
            this.strokesMerged++;
            return SUBMIT_OK;
          }
        }
      }
    }
    if ((this.qN + 1) * QW > q.length) {
      const g = new Int32Array(q.length * 2);
      g.set(q);
      this.q = g;
      this.order = new Int32Array(this.order.length * 2);
    }
    const o = this.qN * QW;
    const qq = this.q;
    qq[o] = anchor;
    qq[o + 1] = sU;
    qq[o + 2] = sV;
    qq[o + 3] = eU;
    qq[o + 4] = eV;
    qq[o + 5] = width;
    qq[o + 6] = depth;
    qq[o + 7] = tool;
    qq[o + 8] = tick;
    qq[o + 9] = actor;
    qq[o + 10] = seq;
    qq[o + 11] = linkIdx;
    this.mergeRow[actor] = this.qN;
    this.mergeFirstTick[actor] = tick;
    this.qN++;
    return SUBMIT_OK;
  }

  // ---- robots -------------------------------------------------------------------------------------------------

  private intentReaches(link: Link, plot: number): boolean {
    const m = link.mirror.member;
    if (m[plot] === 1) return true;
    const nb = plot * 6;
    for (let k = 0; k < 6; k++) {
      const q = this.t.neighbors[nb + k]!;
      if (q >= 0 && m[q] === 1) return true;
    }
    return false;
  }

  private writeIntent(w: ByteWriter, id: number): void {
    const p = this.plans;
    const width = p.widthCm[id]!;
    w.u16(id);
    w.u24(p.plot[id]! | ((width & 0x3f) << 18));
    w.u16((width >>> 6) | (p.speedCmPerS[id]! << 4));
    w.u32(p.startTick[id]!);
    w.u8(p.depth16[id]!);
    w.u32(p.mask0[id]!);
    w.u32(p.mask1[id]!);
  }

  private noteRobotKnown(link: Link, id: number): void {
    if (id >= link.knowsRobot.length) {
      const g = new Int32Array(Math.max(64, (id + 1) * 2));
      g.set(link.knowsRobot);
      link.knowsRobot = g;
    }
    link.knowsRobot[id] = this.plans.serial[id]!;
  }

  /** A robot starts a plot. Returns the wire bytes sent for it now (20 B per interested client). */
  submitRobotIntent(
    robotId: number,
    plot: number,
    startTick: number,
    widthCm: number,
    depth16: number,
    speedCmPerS: number,
    mask0: number,
    mask1: number,
  ): number {
    const t0 = this.opt.now();
    this.plans.set(robotId, plot, startTick, widthCm, depth16, speedCmPerS, mask0 >>> 0, mask1 >>> 0, 0);
    let bytes = 0;
    for (let i = 0; i < this.links.length; i++) {
      const link = this.links[i];
      if (link === null || link === undefined || !this.intentReaches(link, plot)) continue;
      this.writeIntent(link.robotRec, robotId);
      link.nRobot++;
      this.noteRobotKnown(link, robotId);
      bytes += ROBOT_INTENT_BYTES;
    }
    this.serverMs += this.opt.now() - t0;
    return bytes;
  }

  // ---- tick ---------------------------------------------------------------------------------------------------

  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.stepTick();
  }

  private stepTick(): void {
    const now = this.opt.now;
    const hz = this.opt.simTickHz;
    const t0 = now();
    this.tick++;
    const tick = this.tick;
    const frame = tick % this.frameTicks === 0;
    if (frame) this.flushQueue();
    this.unitsRemoved += this.plans.step(tick, hz, this.view, this.log, this.chunkDirty, null);
    const v = this.view;
    for (let i = 0; i < v.polishedN; i++) {
      const p = v.polishedList[i]!;
      this.log.drop(p);
      this.chunkDirty[this.t.chunkOf[p]!] = 1;
    }
    v.polishedN = 0;
    if (frame) this.encodeFrames();
    let spent = now() - t0;

    // Client side of the in-process simulation (not server time).
    const links = this.links;
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (link === null || link === undefined) continue;
      // Robot chunks of this tick first: the FRAME built above already reflects them (its L0 records are compared).
      link.client.robotStep(tick, hz);
      if (frame && link.frame.len > 0) link.client.onFrame(link.frame.buf, link.frame.len);
      link.client.expirePredictions(tick, hz);
    }

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (link === null || link === undefined || !link.hasPos) continue;
      if (link.needScan || (tick + link.idx) % this.scanEvery === 0) {
        const t1 = now();
        this.scanServerSide(link);
        spent += now() - t1;
        this.scanClientSide(link);
      }
    }
    if (tick % this.checkEvery === 0) {
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (link === null || link === undefined || link.mirror.n === 0) continue;
        const t1 = now();
        this.buildCheck(link);
        spent += now() - t1;
        link.client.onMessage(link.checkBuf, tick);
        if (link.client.driftN > 0) {
          const t2 = now();
          this.resync(link);
          spent += now() - t2;
          this.deliverOutbox(link);
        }
      }
    }
    this.serverMs += spent;
    this.tickSamples[this.tickSampleN++ & (SAMPLE_RING - 1)] = spent;
  }

  private flushQueue(): void {
    const n = this.qN;
    if (n === 0) return;
    const q = this.q;
    const bucket = this.bucket;
    bucket.fill(0);
    for (let r = 0; r < n; r++) bucket[q[r * QW + 9]! + 1]!++;
    for (let a = 0; a < 64; a++) bucket[a + 1] = bucket[a + 1]! + bucket[a]!;
    const order = this.order;
    for (let r = 0; r < n; r++) {
      const a = q[r * QW + 9]!;
      order[bucket[a]!] = r;
      bucket[a] = bucket[a]! + 1;
    }
    for (let k = 0; k < n; k++) this.applyRow(order[k]! * QW);
    this.qN = 0;
    this.mergeRow.fill(-1);
  }

  private applyRow(o: number): void {
    const q = this.q;
    const t = this.t;
    let anchor = q[o]!;
    let sU = q[o + 1]!;
    let sV = q[o + 2]!;
    let eU = q[o + 3]!;
    let eV = q[o + 4]!;
    const width = q[o + 5]!;
    const depth = q[o + 6]!;
    const tool = q[o + 7]!;
    const actor = q[o + 9]!;
    const seq = q[o + 10]!;
    const origin = q[o + 11]!;
    const cap = this.opt.dustCellCapacityG;
    if (cap > 0 && this.grams[actor]! >= cap) {
      this.strokesCellFull++;
      return;
    }

    // Canonical form: continue the actor's chain in the chain anchor's frame when the wire format allows it.
    let cont = false;
    if (
      this.chainId[actor]! > 0 &&
      this.chWidth[actor] === width &&
      this.chDepth[actor] === depth &&
      this.chTool[actor] === tool &&
      ((seq - this.chSeq[actor]!) & 0xffff) === this.frameTicks
    ) {
      const h = this.chAnchor[actor]!;
      const xy = this.xy;
      let hsU = sU;
      let hsV = sV;
      let heU = eU;
      let heV = eV;
      if (h !== anchor) {
        xform(t, anchor, sU, sV, h, xy);
        hsU = xy[0]!;
        hsV = xy[1]!;
        xform(t, anchor, eU, eV, h, xy);
        heU = xy[0]!;
        heV = xy[1]!;
      }
      const pu = this.chEndU[actor]!;
      const pv = this.chEndV[actor]!;
      const gu = hsU - pu;
      const gv = hsV - pv;
      const dx = heU - pu;
      const dy = heV - pv;
      if (
        gu >= -2 &&
        gu <= 2 &&
        gv >= -2 &&
        gv <= 2 &&
        dx >= -4096 &&
        dx <= 4095 &&
        dy >= -4096 &&
        dy <= 4095 &&
        heU >= -REANCHOR_MM &&
        heU <= REANCHOR_MM &&
        heV >= -REANCHOR_MM &&
        heV <= REANCHOR_MM
      ) {
        cont = true;
        anchor = h;
        sU = pu;
        sV = pv;
        eU = heU;
        eV = heV;
      }
    }
    if (cont) this.chainIdx[actor] = this.chainIdx[actor]! + 1;
    else {
      this.chainId[actor] = ++this.chainCounter;
      this.chainIdx[actor] = 0;
      this.chAnchor[actor] = anchor;
      this.chWidth[actor] = width;
      this.chDepth[actor] = depth;
      this.chTool[actor] = tool;
    }
    this.chEndU[actor] = eU;
    this.chEndV[actor] = eV;
    this.chSeq[actor] = seq;

    const v = this.view;
    const removed = applyLogged(v, this.log, anchor, sU, sV, eU, eV, width, depth, tool, actor);
    this.strokesApplied++;
    this.unitsRemoved += removed;
    v.copyEndDir(this.activity);
    this.hasActivity = true;
    if (removed > 0) {
      const mg = removed * MG_PER_UNIT + this.mgAcc[actor]!;
      const g = Math.floor(mg / 1000);
      this.mgAcc[actor] = mg - g * 1000;
      let total = this.grams[actor]! + g;
      if (cap > 0 && total > cap) total = cap;
      this.grams[actor] = total;
      for (let i = 0; i < v.outN; i++) {
        if (v.outRemoved[i]! > 0) this.chunkDirty[t.chunkOf[v.outPlots[i]!]!] = 1;
      }
    }

    const links = this.links;
    const cid = this.chainId[actor]!;
    const cix = this.chainIdx[actor]!;
    for (let li = 0; li < links.length; li++) {
      const link = links[li];
      if (link === null || link === undefined) continue;
      let want = li === origin;
      if (want) {
        v.copyEndDir(link.pos);
        if (!link.hasPos) {
          link.hasPos = true;
          link.needScan = true;
        }
      } else {
        const m = link.mirror.member;
        for (let i = 0; i < v.outN; i++) {
          if (m[v.outPlots[i]!] === 1) {
            want = true;
            break;
          }
        }
      }
      if (!want) continue;
      const w = link.rec;
      const k = link.nRec++;
      if (k >> 3 >= link.kinds.length) {
        const g = new Uint8Array(link.kinds.length * 2);
        g.set(link.kinds);
        link.kinds = g;
      }
      if ((k & 7) === 0) link.kinds[k >> 3] = 0;
      if (cont && link.seenChain[actor] === cid && link.seenIdx[actor] === cix - 1) {
        const packed = actor | (((eU - sU) & 0x1fff) << 6) | (((eV - sV) & 0x1fff) << 19);
        w.u16(packed & 0xffff);
        w.u16(packed >>> 16);
        this.contsSent++;
      } else {
        link.kinds[k >> 3] = link.kinds[k >> 3]! | (1 << (k & 7));
        w.u24(anchor | (tool << 18));
        w.u16(sU & 0xffff);
        w.u16(sV & 0xffff);
        w.u16(eU & 0xffff);
        w.u16(eV & 0xffff);
        w.u16(width | (actor << 10));
        w.u8(depth);
        w.u8(0);
        w.u16(seq);
        this.headersSent++;
      }
      link.seenChain[actor] = cid;
      link.seenIdx[actor] = cix;
    }
  }

  /** Builds every client's FRAME dust sections (server side). Delivery happens in stepTick. */
  private encodeFrames(): void {
    this.frameNo++;
    const v = this.view;
    const plotsNow = this.frameNo % this.plotsEveryFrames === 0 && v.dirtyN > 0;
    const pb = this.plotsBuf;
    if (plotsNow) {
      pb.reset();
      pb.u8(SEC_PLOTS);
      pb.u16(v.dirtyN > 0xffff ? 0xffff : v.dirtyN);
      const n = v.dirtyN > 0xffff ? 0xffff : v.dirtyN;
      for (let i = 0; i < n; i++) {
        const p = v.dirtyList[i]!;
        pb.u24(p | (v.state[p]! << 18));
        pb.u8(v.frac[p]!);
      }
    }
    const links = this.links;
    for (let li = 0; li < links.length; li++) {
      const link = links[li];
      if (link === null || link === undefined) continue;
      const f = link.frame;
      f.reset();
      if (link.nRec > 0) {
        const at = f.len;
        f.u8(SEC_STROKES);
        f.u16(link.nRec);
        f.bytes(link.kinds, 0, (link.nRec + 7) >> 3);
        f.bytes(link.rec.buf, 0, link.rec.len);
        this.bytesStrokes += f.len - at;
        link.nRec = 0;
        link.rec.reset();
      }
      if (link.nRobot > 0) {
        const at = f.len;
        let done = 0;
        while (done < link.nRobot) {
          const n = Math.min(255, link.nRobot - done);
          f.u8(SEC_ROBOT);
          f.u8(n);
          f.bytes(link.robotRec.buf, done * ROBOT_INTENT_BYTES, n * ROBOT_INTENT_BYTES);
          done += n;
        }
        this.bytesRobot += f.len - at;
        link.nRobot = 0;
        link.robotRec.reset();
      }
      if (link.actor >= 0) {
        const g = this.grams[link.actor]!;
        if (g !== link.ackSent) {
          f.u8(SEC_ACK);
          f.u24(g > 0xffffff ? 0xffffff : g);
          link.ackSent = g;
          this.bytesAck += 4;
        }
      }
      if (plotsNow) {
        f.bytes(pb.buf, 0, pb.len);
        this.bytesPlots += pb.len;
      }
      link.bytes += f.len;
    }
    if (this.frameNo % this.plotsEveryFrames === 0) v.drainDirty();
  }

  // ---- interest -----------------------------------------------------------------------------------------------

  /** Server-side position of a client that is not stroking (a walking or flying camera), as a unit direction. */
  setPosition(clientId: number, pos: Float64Array): void {
    const link = this.byClient.get(clientId);
    if (link === undefined) return;
    link.pos[0] = pos[0]!;
    link.pos[1] = pos[1]!;
    link.pos[2] = pos[2]!;
    if (!link.hasPos) {
      link.hasPos = true;
      link.needScan = true;
    }
  }

  private ledgerInner(w: ByteWriter, slot: number): void {
    const v = this.view;
    w.u32(v.version[slot]!);
    w.u32(v.initial[slot]!);
    w.u16(v.owned[slot]!);
    let nC = 0;
    for (let k = 0; k < MAX_CONTRIB; k++) if (v.contribActor[slot * MAX_CONTRIB + k] !== 0xff) nC++;
    w.u8(nC);
    for (let k = 0; k < MAX_CONTRIB; k++) {
      const a = v.contribActor[slot * MAX_CONTRIB + k]!;
      if (a === 0xff) continue;
      w.u8(a);
      w.u32(v.contribUnits[slot * MAX_CONTRIB + k]!);
    }
    w.bytes(v.texels, slot * LEDGER_BYTES, LEDGER_BYTES);
  }

  private logInner(w: ByteWriter, plot: number, max: number): number {
    const have = this.log.count(plot);
    const n = have < max ? have : max;
    for (let k = have - n; k < have; k++) {
      for (let j = 0; j < 4; j++) w.u32(this.log.word(plot, k, j) >>> 0);
    }
    return n;
  }

  /** dust.ledger for one plot (deflated header + 1,024 texel bytes). */
  ledgerMessage(plot: number): Uint8Array {
    const inner = new ByteWriter(1100);
    this.ledgerInner(inner, this.view.slotOf[plot]!);
    const z = this.opt.codec.deflate(inner.buf.subarray(0, inner.len));
    const msg = new Uint8Array(4 + z.length);
    msg[0] = MSG_LEDGER;
    msg[1] = plot & 0xff;
    msg[2] = (plot >>> 8) & 0xff;
    msg[3] = plot >>> 16;
    msg.set(z, 4);
    return msg;
  }

  private logMessage(plot: number): Uint8Array {
    const inner = new ByteWriter(4200);
    const n = this.logInner(inner, plot, 256);
    const z = this.opt.codec.deflate(inner.buf.subarray(0, inner.len));
    const msg = new Uint8Array(6 + z.length);
    msg[0] = MSG_LOG;
    msg[1] = plot & 0xff;
    msg[2] = (plot >>> 8) & 0xff;
    msg[3] = plot >>> 16;
    msg[4] = n & 0xff;
    msg[5] = n >>> 8;
    msg.set(z, 6);
    return msg;
  }

  private plotMessage(plot: number): Uint8Array {
    const msg = new Uint8Array(5);
    const w0 = plot | (this.view.state[plot]! << 18);
    msg[0] = MSG_PLOT;
    msg[1] = w0 & 0xff;
    msg[2] = (w0 >>> 8) & 0xff;
    msg[3] = w0 >>> 16;
    msg[4] = this.view.frac[plot]!;
    return msg;
  }

  private withinBlocking(link: Link, plot: number): boolean {
    const c = this.t.centers;
    const a = BLOCKING_RADIUS_M / this.t.radiusM;
    const d = link.pos[0]! * c[plot * 3]! + link.pos[1]! * c[plot * 3 + 1]! + link.pos[2]! * c[plot * 3 + 2]!;
    return d >= 1 - (a * a) / 2;
  }

  /** Queues everything a client needs for the plots that just entered its interest set. */
  private queueEntries(link: Link, withLedgers: boolean): void {
    const v = this.view;
    const m = link.mirror;
    for (let i = 0; i < m.enteredN; i++) {
      const p = m.entered[i]!;
      if (v.slotOf[p]! >= 0) {
        if (!withLedgers) continue;
        const msg = this.ledgerMessage(p);
        link.outbox.push(msg);
        this.bytesLedger += msg.length;
        this.ledgersSent++;
        if (this.withinBlocking(link, p) && this.log.count(p) > 0) {
          const lm = this.logMessage(p);
          link.outbox.push(lm);
          this.bytesLog += lm.length;
        }
      } else if (v.state[p] === STATE_POLISHED && withLedgers) {
        link.outbox.push(this.plotMessage(p));
        this.bytesPlots += 5;
      }
    }
    if (m.enteredN > 0 && this.plans.activeCount > 0) {
      const plans = this.plans;
      for (let id = 0; id < plans.n; id++) {
        if (plans.active[id] === 0) continue;
        if (id < link.knowsRobot.length && link.knowsRobot[id] === plans.serial[id]) continue;
        if (!this.intentReaches(link, plans.plot[id]!)) continue;
        const w = new ByteWriter(1 + ROBOT_INTENT_BYTES);
        w.u8(MSG_ROBOT);
        this.writeIntent(w, id);
        link.outbox.push(w.take());
        this.noteRobotKnown(link, id);
        this.bytesRobot += 1 + ROBOT_INTENT_BYTES;
      }
    }
  }

  private scanServerSide(link: Link): void {
    link.needScan = false;
    link.mirror.scan(link.pos);
    this.queueEntries(link, true);
    for (let i = 0; i < link.outbox.length; i++) link.bytes += link.outbox[i]!.length;
  }

  private scanClientSide(link: Link): void {
    link.client.scan(link.pos);
    if (link.client.set.n !== link.mirror.n) this.scanMismatch++;
    this.deliverOutbox(link);
  }

  private deliverOutbox(link: Link): void {
    for (let i = 0; i < link.outbox.length; i++) link.client.onMessage(link.outbox[i]!, this.tick);
    link.outbox.length = 0;
  }

  /** dust.check: per chunk, the XOR of the plot hashes of this client's interest set (6 B per chunk). */
  private buildCheck(link: Link): void {
    const t = this.t;
    const v = this.view;
    const m = link.mirror;
    let n = 0;
    for (let i = 0; i < m.n; i++) {
      const plot = m.list[i]!;
      const h = v.plotHash(plot);
      if (h === 0) continue;
      const ch = t.chunkOf[plot]!;
      if (this.chunkSeen[ch] === 0) {
        this.chunkSeen[ch] = 1;
        if (n === this.chunkList.length) {
          const g = new Int32Array(n * 2);
          g.set(this.chunkList);
          this.chunkList = g;
        }
        this.chunkList[n++] = ch;
      }
      this.chunkAcc[ch] = (this.chunkAcc[ch]! ^ h) >>> 0;
    }
    const count = n > 255 ? 255 : n;
    const msg = link.checkBuf;
    msg[0] = MSG_CHECK;
    msg[1] = count;
    for (let i = 0; i < n; i++) {
      const ch = this.chunkList[i]!;
      if (i < count) {
        const h = this.chunkAcc[ch]!;
        const o = 2 + i * 6;
        msg[o] = ch & 0xff;
        msg[o + 1] = ch >>> 8;
        msg[o + 2] = h & 0xff;
        msg[o + 3] = (h >>> 8) & 0xff;
        msg[o + 4] = (h >>> 16) & 0xff;
        msg[o + 5] = h >>> 24;
      }
      this.chunkSeen[ch] = 0;
      this.chunkAcc[ch] = 0;
    }
    link.checkLen = 2 + count * 6;
    link.bytes += link.checkLen;
    this.bytesCheck += link.checkLen;
  }

  /** Drift repair: resend the ledgers (or Polished state) of the client's member plots in the mismatching chunks. */
  private resync(link: Link): void {
    const c = link.client;
    const m = link.mirror;
    for (let k = 0; k < c.driftN; k++) {
      const chunk = c.driftList[k]!;
      this.resyncs++;
      for (let i = 0; i < m.n; i++) {
        const p = m.list[i]!;
        if (this.t.chunkOf[p] !== chunk) continue;
        let msg: Uint8Array | null = null;
        if (this.view.slotOf[p]! >= 0) msg = this.ledgerMessage(p);
        else if (this.view.state[p] === STATE_POLISHED) msg = this.plotMessage(p);
        if (msg !== null) {
          link.outbox.push(msg);
          link.bytes += msg.length;
          this.bytesLedger += msg.length;
        }
      }
    }
    c.driftN = 0;
  }

  // ---- join / leave -------------------------------------------------------------------------------------------

  /** States of every plot (2 bits) + the L0 byte of each Opened plot, deflated; cached until L0 changes. */
  private snapshotStates(): Uint8Array {
    const v = this.view;
    if (this.snapCache !== null && this.snapVersion === v.l0Version) return this.snapCache;
    const count = this.t.count;
    const w = new ByteWriter(8 + ((count + 3) >> 2) + 4096);
    w.u32(count);
    const bits = new Uint8Array((count + 3) >> 2);
    for (let p = 0; p < count; p++) bits[p >> 2] = bits[p >> 2]! | (v.state[p]! << ((p & 3) * 2));
    w.bytes(bits, 0, bits.length);
    for (let p = 0; p < count; p++) if (v.state[p] === STATE_OPENED) w.u8(v.frac[p]!);
    this.snapRawBytes = w.len;
    const z = this.opt.codec.deflate(w.buf.subarray(0, w.len));
    const msg = new Uint8Array(1 + z.length);
    msg[0] = MSG_SNAPSHOT;
    msg.set(z, 1);
    this.snapCache = msg;
    this.snapVersion = v.l0Version;
    return msg;
  }

  /**
   * Joins (or re-joins) a client. With a position it gets the blocking snapshot (states + ledgers and logs within
   * 60 m) and then the streamed ledgers of the rest of its dust radius, nearest first (WDS 5.4).
   */
  join(clientId: number, pos: Float64Array | null): JoinResult {
    this.leave(clientId);
    let idx = this.links.indexOf(null);
    if (idx < 0) idx = this.links.length;
    const client = new P2Client(
      clientId,
      this.t,
      this.scratch,
      this.enterM,
      this.leaveM,
      this.frameTicks,
      this.opt.codec,
    );
    const link = new Link(idx, clientId, client, this.t, this.scratch, this.enterM, this.leaveM);
    this.links[idx] = link;
    this.byClient.set(clientId, link);

    const states = this.snapshotStates();
    let blocking = states.length;
    let streamed = 0;
    let nBlocking = 0;
    let nStreamed = 0;
    client.onSnapshot(states);
    if (pos !== null) {
      link.pos.set(pos);
      link.hasPos = true;
      link.mirror.scan(link.pos);
      client.scan(link.pos);
      const v = this.view;
      const m = link.mirror;
      const c = this.t.centers;
      const near: number[] = [];
      const far: number[] = [];
      for (let i = 0; i < m.n; i++) {
        const p = m.list[i]!;
        if (v.slotOf[p]! < 0) continue;
        (this.withinBlocking(link, p) ? near : far).push(p);
      }
      const inner = new ByteWriter(1024 + near.length * 5400);
      inner.u16(near.length);
      for (const p of near) {
        inner.u24(p);
        this.ledgerInner(inner, v.slotOf[p]!);
        const at = inner.len;
        inner.u16(0);
        const n = this.logInner(inner, p, 256);
        inner.buf[at] = n & 0xff;
        inner.buf[at + 1] = n >>> 8;
      }
      const z = this.opt.codec.deflate(inner.buf.subarray(0, inner.len));
      const nearMsg = new Uint8Array(1 + z.length);
      nearMsg[0] = MSG_NEAR;
      nearMsg.set(z, 1);
      blocking += nearMsg.length;
      nBlocking = near.length;
      client.onMessage(nearMsg, this.tick);

      const dist = (p: number): number => -(pos[0]! * c[p * 3]! + pos[1]! * c[p * 3 + 1]! + pos[2]! * c[p * 3 + 2]!);
      far.sort((a, b) => dist(a) - dist(b));
      for (const p of far) {
        const msg = this.ledgerMessage(p);
        streamed += msg.length;
        client.onMessage(msg, this.tick);
      }
      nStreamed = far.length;
      // Active robot intents that reach the set (entered = the whole set on a fresh mirror).
      this.queueEntries(link, false);
      for (let i = 0; i < link.outbox.length; i++) streamed += link.outbox[i]!.length;
      this.deliverOutbox(link);
    }
    this.bytesSnapshot += blocking;
    this.bytesLedger += streamed;
    link.bytes += blocking + streamed;
    return { blockingBytes: blocking, streamedBytes: streamed, ledgersBlocking: nBlocking, ledgersStreamed: nStreamed };
  }

  leave(clientId: number): void {
    const link = this.byClient.get(clientId);
    if (link === undefined) return;
    this.byClient.delete(clientId);
    this.links[link.idx] = null;
  }

  // ---- hashes and probes --------------------------------------------------------------------------------------

  serverHash(): number {
    return this.view.hashWhere(null);
  }

  /**
   * The server hash with this client's interest set swapped for the client's own copy: equal to serverHash() exactly
   * when every ledger and Polished state inside the client's dust radius is identical to the server's.
   */
  clientHash(clientId: number): number {
    const link = this.byClient.get(clientId);
    if (link === undefined) return 0;
    const v = this.view;
    return (v.hashWhere(null) ^ v.hashWhere(link.mirror.member) ^ link.client.hash()) >>> 0;
  }

  /** p-quantile (0 .. 1) of the server-side blocking time per tick, in ms. */
  tickQuantile(p: number): number {
    const n = Math.min(this.tickSampleN, SAMPLE_RING);
    if (n === 0) return 0;
    const s = this.tickSamples.slice(0, n).sort();
    return s[Math.min(n - 1, Math.floor(p * n))]!;
  }
}
