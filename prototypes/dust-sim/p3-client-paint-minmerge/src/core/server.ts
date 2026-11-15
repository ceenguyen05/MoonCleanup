// P3 server: stores one opaque 64 x 64 4-bit tile per touched plot and merges client uploads by per-texel MINIMUM.
// It never rasterises player strokes. Its authority is limited to: (1) the merge itself (monotonic, idempotent,
// commutative), (2) bounds on each upload (reach from the server-side pose, removal rate of the server-known tool,
// ownership and range of every texel), (3) everything derived from the merged tiles (plot state, credit, L0).
// Robots are server actors, so the server paints their lanes itself with the shared Painter.
// Environment-agnostic; receive(), tick() and the flush do not allocate except when a tile is first created.
import type { RobotPlotIntent } from "../../../../../packages/shared/src/index";
import { Bag, ByteReader, ByteWriter } from "./bytes";
import {
  decodeFull,
  encodeBlank,
  encodeFull,
  getNib,
  lowBit,
  readGaps,
  readZigzag,
  setNib,
  writeZigzag,
} from "./codec";
import {
  BLOCKING_RADIUS_M,
  DEFAULT_DUST_LEVEL,
  DUST_CHECK_SECONDS,
  DUST_HYSTERESIS_M,
  DUST_RADIUS_M,
  FINE_PER_LEVEL,
  FRAME_HALF_MM,
  HAND_TOOL_MAX_SPEED_MM_S,
  LEVEL_MAX,
  MG_PER_LEVEL_TEXEL,
  OPENED_DIVISOR,
  POLISHED_DIVISOR,
  RATE_SLACK_DEN,
  RATE_SLACK_NUM,
  REACH_BASE_MM,
  REJECT_MALFORMED,
  REJECT_OUT_OF_REACH,
  REJECT_RATE,
  ROBOT_INTENT_BYTES,
  SEC_ACK,
  SEC_CHECK,
  SEC_INTEREST,
  SEC_PAINT,
  SEC_PLOTS,
  SEC_ROBOT,
  SEC_TILE_DELTA,
  SEC_TILE_FULL,
  SEC_TILE_RESYNC,
  SHIFT_ACTOR_SLOT,
  STATE_GRIMY,
  STATE_OPENED,
  STATE_POLISHED,
  TEXEL_AREA_MM2,
  TEXEL_MM,
  TILE_EDGE,
  TILE_PACKED_BYTES,
  TILE_TEXELS,
  VEHICLE_MAX_SPEED_MM_S,
  VEHICLE_TOOL_CODE_MIN,
} from "./constants";
import { GeomCache, LocalMm, PlotGeom, Vec3, cosOfArc, dirToLocal } from "./geom";
import { POLISHED_HASH, crc32, plotMix, texelZ } from "./hash";
import { BRUSH_FLAT, Painter, depthFineOf, removalFine } from "./painter";

export const MAX_SLOTS = 32;
const MAX_ROBOTS = 1024;
const ORIGIN_NONE = -3;
const ORIGIN_MIXED = -2;
const ORIGIN_ROBOT = -1;
const CHECKPOINT_MAGIC = 0x4b433350; // "P3CK"
const CHECKPOINT_VERSION = 1;
/** Process-wide robot chunk cap (WDS 4.8). */
const ROBOT_CHUNKS_PER_SEC = 150;
const POSE_HISTORY = 8;

class ServerTile {
  readonly packed = new Uint8Array(TILE_PACKED_BYTES).fill(0xff);
  readonly outMask = new Uint32Array(TILE_TEXELS / 32);
  outCount = 0;
  /** Sub-level plane of the server's own robot painter; null until a robot works the plot. */
  fine: Uint8Array | null = null;
  remaining: number;
  readonly initial: number;
  hash = 0;
  mix = 0;
  /** Slot bit masks. */
  knownBy = 0;
  wantFor = 0;
  resyncFor = 0;
  fullSent = 0;
  origin = ORIGIN_NONE;
  inDirty = false;
  inFull = false;
  dead = false;
  bodyOff = 0;
  bodyLen = 0;
  fullOff = -1;
  fullLen = 0;
  listIndex = -1;

  constructor(
    readonly plot: number,
    readonly geom: PlotGeom,
  ) {
    this.initial = geom.ownedCount * LEVEL_MAX;
    this.remaining = this.initial;
  }
}

export interface ServerOptions {
  readonly geom: GeomCache;
  readonly simTickHz: number;
  /** Tile deltas are coalesced and flushed every this many ticks (2 = 10 Hz at 20 Hz sim). */
  readonly flushTicks: number;
  /** remaining-fraction L0 deltas go out every this many ticks (10 = 2 Hz); state changes go with the next flush. */
  readonly l0Ticks: number;
  /** Bytes of streamed full tiles per client per flush (interest entry beyond the blocking radius). */
  readonly streamBytesPerFlush: number;
}

export class P3Server {
  tick = 0;
  readonly state: Uint8Array;
  readonly remFrac: Uint8Array;
  private readonly tiles = new Map<number, ServerTile>();
  private readonly tileList: ServerTile[] = [];
  private readonly dirty = new Bag<ServerTile>();
  private readonly fullList = new Bag<ServerTile>();
  private readonly l0Flag: Uint8Array;
  private l0List: Int32Array = new Int32Array(1024);
  private l0Count = 0;
  private l0Urgent = false;
  private tilesHash = 0;
  private polishedHash = 0;
  private dirtyCheckpoint = false;

  // Slots (struct of arrays).
  private readonly active = new Uint8Array(MAX_SLOTS);
  private readonly pose = new Float64Array(MAX_SLOTS * 3);
  private readonly posePlot = new Int32Array(MAX_SLOTS).fill(-1);
  /** Pose of each slot at the last POSE_HISTORY tick boundaries: uploads are coalesced, so paint trails the pose. */
  private readonly poseHist = new Float64Array(MAX_SLOTS * POSE_HISTORY * 3);
  private readonly actor = new Uint8Array(MAX_SLOTS);
  private readonly toolWidthMm = new Int32Array(MAX_SLOTS);
  private readonly toolCode = new Int32Array(MAX_SLOTS).fill(-1);
  private readonly toolDepth16 = new Int32Array(MAX_SLOTS);
  private readonly reach2 = new Float64Array(MAX_SLOTS);
  private readonly bucket = new Float64Array(MAX_SLOTS);
  private readonly bucketRate = new Float64Array(MAX_SLOTS);
  private readonly bucketCap = new Float64Array(MAX_SLOTS);
  private readonly trust = new Uint8Array(MAX_SLOTS);
  private readonly ackDirty = new Uint8Array(MAX_SLOTS);
  private readonly known = new Int32Array(MAX_SLOTS);
  private readonly out: ByteWriter[] = [];
  private readonly drops = new Int32Array(MAX_SLOTS * 256);
  private readonly dropCount = new Int32Array(MAX_SLOTS);
  private readonly blanks = new Int32Array(MAX_SLOTS * 16);
  private readonly blankCount = new Int32Array(MAX_SLOTS);

  // Economy per actor slot (0..63): milligram accumulator and whole grams.
  readonly mg = new Float64Array(64);
  readonly grams = new Float64Array(64);

  // Robots (struct of arrays, index = robotId).
  private readonly jActive = new Uint8Array(MAX_ROBOTS);
  private readonly jPlot = new Int32Array(MAX_ROBOTS);
  private readonly jWidthMm = new Int32Array(MAX_ROBOTS);
  private readonly jDepthFine = new Int32Array(MAX_ROBOTS);
  private readonly jStepMm = new Int32Array(MAX_ROBOTS);
  private readonly jMaskLo = new Uint32Array(MAX_ROBOTS);
  private readonly jMaskHi = new Uint32Array(MAX_ROBOTS);
  private readonly jLane = new Int32Array(MAX_ROBOTS);
  private readonly jPos = new Int32Array(MAX_ROBOTS);
  private readonly jDue = new Int32Array(MAX_ROBOTS);
  private jActiveCount = 0;
  private jCursor = 0;
  private chunkTokens = 0;

  private readonly painter = new Painter();
  private readonly reader = new ByteReader();
  private readonly idx = new Uint16Array(TILE_TEXELS);
  private readonly full = new Uint8Array(TILE_TEXELS);
  private readonly bodies = new ByteWriter(4096);
  private readonly fulls = new ByteWriter(8192);
  private readonly loc = new LocalMm();
  private readonly dir = new Vec3();
  private readonly cosEnter: number;
  private readonly cosLeave: number;
  private readonly cosBlocking: number;
  private readonly radiusM: number;
  private readonly geom: GeomCache;

  // Counters.
  readonly rejects = new Float64Array(3);
  texelsMerged = 0;
  texelsStale = 0;
  levelsMerged = 0;
  uploads = 0;
  uploadBytes = 0;
  robotChunks = 0;
  robotChunksDeferred = 0;
  fullTilesSent = 0;
  fullTileBytes = 0;
  deltaBytes = 0;
  l0Bytes = 0;
  flushes = 0;
  polishedCount = 0;
  openedCount = 0;

  constructor(private readonly o: ServerOptions) {
    this.geom = o.geom;
    this.radiusM = o.geom.radiusM;
    this.state = new Uint8Array(o.geom.plotCount);
    this.remFrac = new Uint8Array(o.geom.plotCount).fill(255);
    this.l0Flag = new Uint8Array(o.geom.plotCount);
    this.cosEnter = cosOfArc(DUST_RADIUS_M, this.radiusM);
    this.cosLeave = cosOfArc(DUST_RADIUS_M + DUST_HYSTERESIS_M, this.radiusM);
    this.cosBlocking = cosOfArc(BLOCKING_RADIUS_M, this.radiusM);
    for (let s = 0; s < MAX_SLOTS; s++) this.out.push(new ByteWriter(2048));
  }

  // ---- Queries --------------------------------------------------------------------------------------------------------

  worldHash(): number {
    return (this.tilesHash ^ this.polishedHash) >>> 0;
  }

  /** What slot `s` must hash to once every message is delivered: its known tiles plus all Polished plots. */
  expectedHash(s: number): number {
    return ((this.known[s] ?? 0) ^ this.polishedHash) >>> 0;
  }

  get tileCount(): number {
    return this.tileList.length;
  }

  /** Bytes of live tile state (packed tiles + robot fine planes + masks), for the RAM estimate. */
  tileStateBytes(): number {
    let b = 0;
    for (let k = 0; k < this.tileList.length; k++) {
      b += TILE_PACKED_BYTES + TILE_TEXELS / 8 + ((this.tileList[k] as ServerTile).fine ? TILE_TEXELS : 0);
    }
    return b;
  }

  levelAt(plot: number, texel: number): number {
    if (this.state[plot] === STATE_POLISHED) return 0;
    const t = this.tiles.get(plot);
    return t ? getNib(t.packed, texel) : LEVEL_MAX;
  }

  outOf(s: number): ByteWriter {
    return this.out[s] as ByteWriter;
  }

  get isDirty(): boolean {
    return this.dirtyCheckpoint;
  }

  // ---- Slots ----------------------------------------------------------------------------------------------------------

  /** Admits a client at a server-side pose and writes the blocking join snapshot into its out buffer. -1 when full. */
  join(actorSlot: number, x: number, y: number, z: number): number {
    let s = 0;
    while (s < MAX_SLOTS && this.active[s] === 1) s++;
    if (s === MAX_SLOTS) return -1;
    this.active[s] = 1;
    this.actor[s] = actorSlot & 63;
    this.pose[s * 3] = x;
    this.pose[s * 3 + 1] = y;
    this.pose[s * 3 + 2] = z;
    const d = this.dir;
    d.x = x;
    d.y = y;
    d.z = z;
    this.posePlot[s] = this.geom.grid.plotAt(d);
    for (let h = 0; h < POSE_HISTORY; h++) {
      const o = (s * POSE_HISTORY + h) * 3;
      this.poseHist[o] = x;
      this.poseHist[o + 1] = y;
      this.poseHist[o + 2] = z;
    }
    this.known[s] = 0;
    this.dropCount[s] = 0;
    this.blankCount[s] = 0;
    this.trust[s] = 0;
    this.ackDirty[s] = 1;
    this.toolCode[s] = -1;
    this.setTool(s, 60, 16, 1);
    const w = this.outOf(s);
    w.reset();
    // L0 for the whole moon: every plot that is not untouched.
    w.u8(SEC_PLOTS);
    const countAt = w.pos;
    w.u24(0);
    let n = 0;
    for (let p = 0; p < this.state.length; p++) {
      const st = this.state[p] ?? 0;
      const fr = this.remFrac[p] ?? 255;
      if (st === STATE_GRIMY && fr === 255) continue;
      w.u24(p | (st << 18));
      w.u8(fr);
      n++;
    }
    w.buf[countAt] = n & 0xff;
    w.buf[countAt + 1] = (n >> 8) & 0xff;
    w.buf[countAt + 2] = (n >> 16) & 0xff;
    // Tiles: inside the blocking radius now, the rest of the dust radius streamed by later flushes.
    const bit = 1 << s;
    for (let k = 0; k < this.tileList.length; k++) {
      const t = this.tileList[k] as ServerTile;
      const f = t.geom.f;
      const c = x * (f[0] ?? 0) + y * (f[1] ?? 0) + z * (f[2] ?? 0);
      if (c >= this.cosBlocking) {
        w.u8(SEC_TILE_FULL);
        w.u24(t.plot);
        const at = w.pos;
        encodeFull(w, t.packed);
        this.fullTilesSent++;
        this.fullTileBytes += w.pos - at + 4;
        t.knownBy |= bit;
        this.known[s] = (this.known[s] ?? 0) ^ t.mix;
      } else if (c >= this.cosEnter) {
        this.want(t, bit);
      }
    }
    return s;
  }

  leave(s: number): void {
    if (this.active[s] !== 1) return;
    this.active[s] = 0;
    const keep = ~(1 << s);
    for (let k = 0; k < this.tileList.length; k++) {
      const t = this.tileList[k] as ServerTile;
      t.knownBy &= keep;
      t.wantFor &= keep;
      t.resyncFor &= keep;
    }
    this.outOf(s).reset();
  }

  /** Server-side pose of the client's tool head (in the game: computed by the sim from inputs, never sent). */
  setPose(s: number, x: number, y: number, z: number): void {
    this.pose[s * 3] = x;
    this.pose[s * 3 + 1] = y;
    this.pose[s * 3 + 2] = z;
    this.poseChanged(s);
  }

  /** As setPose, reading x, y, z from a typed array (no boxed doubles across the call). */
  setPoseFrom(s: number, src: Float64Array, offset: number): void {
    this.pose[s * 3] = src[offset] ?? 0;
    this.pose[s * 3 + 1] = src[offset + 1] ?? 0;
    this.pose[s * 3 + 2] = src[offset + 2] ?? 0;
    this.poseChanged(s);
  }

  private poseChanged(s: number): void {
    const d = this.dir;
    d.x = this.pose[s * 3] ?? 0;
    d.y = this.pose[s * 3 + 1] ?? 0;
    d.z = this.pose[s * 3 + 2] ?? 0;
    const plot = this.geom.grid.plotAt(d, (this.posePlot[s] ?? 0) as never);
    if (plot !== this.posePlot[s]) {
      this.posePlot[s] = plot;
      this.updateInterest(s);
    }
  }

  /** Server-known equipped tool (in the game: server-authoritative inventory). Sets the reach and rate bounds. */
  setTool(s: number, widthCm: number, depth16: number, toolCode: number): void {
    if (this.toolCode[s] === toolCode && this.toolWidthMm[s] === widthCm * 10 && this.toolDepth16[s] === depth16)
      return;
    this.toolCode[s] = toolCode;
    this.toolWidthMm[s] = widthCm * 10;
    this.toolDepth16[s] = depth16;
    const speed = toolCode >= VEHICLE_TOOL_CODE_MIN ? VEHICLE_MAX_SPEED_MM_S : HAND_TOOL_MAX_SPEED_MM_S;
    const flushSec = this.o.flushTicks / this.o.simTickHz;
    const reach = REACH_BASE_MM + widthCm * 5 + 2 * speed * flushSec + 2 * TEXEL_MM;
    this.reach2[s] = reach * reach;
    // Fastest legal removal: the tool at its top sweep speed with full coverage, in shared levels per second.
    const levelsPerPass = Math.min(LEVEL_MAX, Math.ceil(depthFineOf(depth16, DEFAULT_DUST_LEVEL) / FINE_PER_LEVEL));
    const perSec = (((speed * widthCm * 10) / TEXEL_AREA_MM2) * levelsPerPass * RATE_SLACK_NUM) / RATE_SLACK_DEN;
    this.bucketRate[s] = perSec / this.o.simTickHz;
    this.bucketCap[s] = perSec * 2;
    if ((this.bucket[s] ?? 0) > perSec * 2 || this.bucket[s] === 0) this.bucket[s] = perSec * 2;
  }

  /** Harness plumbing only: skip the bounds for the slot's next upload (the scene setup paints 80 m in one tick). */
  trustNextUpload(s: number): void {
    this.trust[s] = 1;
  }

  private want(t: ServerTile, bit: number): void {
    t.wantFor |= bit;
    if (!t.inFull) {
      t.inFull = true;
      this.fullList.push(t);
    }
  }

  private updateInterest(s: number): void {
    const bit = 1 << s;
    const x = this.pose[s * 3] ?? 0;
    const y = this.pose[s * 3 + 1] ?? 0;
    const z = this.pose[s * 3 + 2] ?? 0;
    for (let k = 0; k < this.tileList.length; k++) {
      const t = this.tileList[k] as ServerTile;
      const f = t.geom.f;
      const c = x * (f[0] ?? 0) + y * (f[1] ?? 0) + z * (f[2] ?? 0);
      if (c >= this.cosEnter) {
        if (((t.knownBy | t.wantFor) & bit) === 0) this.want(t, bit);
      } else if (c < this.cosLeave) {
        if ((t.knownBy & bit) !== 0) {
          t.knownBy &= ~bit;
          this.known[s] = (this.known[s] ?? 0) ^ t.mix;
          const n = this.dropCount[s] ?? 0;
          if (n < 256) {
            this.drops[s * 256 + n] = t.plot;
            this.dropCount[s] = n + 1;
          }
        }
        t.wantFor &= ~bit;
      }
    }
  }

  // ---- Tiles ----------------------------------------------------------------------------------------------------------

  private tileFor(plot: number): ServerTile {
    let t = this.tiles.get(plot);
    if (t) return t;
    t = new ServerTile(plot, this.geom.get(plot));
    t.listIndex = this.tileList.length;
    this.tileList.push(t);
    this.tiles.set(plot, t);
    // An untouched tile is implicit on every client: mark it known for the slots in range without sending anything.
    const f = t.geom.f;
    for (let s = 0; s < MAX_SLOTS; s++) {
      if (this.active[s] !== 1) continue;
      const c =
        (this.pose[s * 3] ?? 0) * (f[0] ?? 0) +
        (this.pose[s * 3 + 1] ?? 0) * (f[1] ?? 0) +
        (this.pose[s * 3 + 2] ?? 0) * (f[2] ?? 0);
      if (c >= this.cosEnter) t.knownBy |= 1 << s;
    }
    return t;
  }

  private markOut(t: ServerTile, i: number, origin: number): void {
    const bit = 1 << (i & 31);
    const word = t.outMask[i >>> 5] ?? 0;
    if ((word & bit) === 0) {
      t.outMask[i >>> 5] = word | bit;
      t.outCount++;
    }
    if (t.origin === ORIGIN_NONE) t.origin = origin;
    else if (t.origin !== origin) t.origin = ORIGIN_MIXED;
  }

  private queueL0(plot: number): void {
    if (this.l0Flag[plot] === 1) return;
    this.l0Flag[plot] = 1;
    if (this.l0Count === this.l0List.length) {
      const next = new Int32Array(this.l0List.length * 2);
      next.set(this.l0List);
      this.l0List = next;
    }
    this.l0List[this.l0Count++] = plot;
  }

  /** After a tile changed: hashes, credit, remaining fraction, state thresholds, dirty lists. */
  private commit(t: ServerTile, removedLevels: number, actorSlot: number): void {
    this.dirtyCheckpoint = true;
    this.levelsMerged += removedLevels;
    const mgTotal = (this.mg[actorSlot] ?? 0) + removedLevels * MG_PER_LEVEL_TEXEL;
    const whole = Math.floor(mgTotal / 1000);
    this.mg[actorSlot] = mgTotal - whole * 1000;
    if (whole > 0) {
      this.grams[actorSlot] = (this.grams[actorSlot] ?? 0) + whole;
      for (let s = 0; s < MAX_SLOTS; s++) if (this.active[s] === 1 && this.actor[s] === actorSlot) this.ackDirty[s] = 1;
    }
    const mix = plotMix(t.plot, t.hash);
    const diff = t.mix ^ mix;
    t.mix = mix;
    this.tilesHash ^= diff;
    let bits = t.knownBy;
    while (bits !== 0) {
      const s = lowBit(bits);
      bits &= bits - 1;
      this.known[s] = (this.known[s] ?? 0) ^ diff;
    }
    if (!t.inDirty) {
      t.inDirty = true;
      this.dirty.push(t);
    }
    const plot = t.plot;
    if (t.remaining <= Math.floor(t.initial / POLISHED_DIVISOR)) {
      // Inspector's Stamp: the plot is done, the tile is freed on both sides.
      if (this.state[plot] === STATE_GRIMY) this.openedCount++;
      this.state[plot] = STATE_POLISHED;
      this.remFrac[plot] = 0;
      this.polishedCount++;
      this.l0Urgent = true;
      this.queueL0(plot);
      this.tilesHash ^= t.mix;
      bits = t.knownBy;
      while (bits !== 0) {
        const s = lowBit(bits);
        bits &= bits - 1;
        this.known[s] = (this.known[s] ?? 0) ^ t.mix;
      }
      this.polishedHash ^= plotMix(plot, POLISHED_HASH);
      t.dead = true;
      t.knownBy = 0;
      t.wantFor = 0;
      t.resyncFor = 0;
      this.tiles.delete(plot);
      const last = this.tileList[this.tileList.length - 1] as ServerTile;
      this.tileList[t.listIndex] = last;
      last.listIndex = t.listIndex;
      this.tileList.length--;
      return;
    }
    if (this.state[plot] === STATE_GRIMY && t.initial - t.remaining >= Math.ceil(t.initial / OPENED_DIVISOR)) {
      this.state[plot] = STATE_OPENED;
      this.openedCount++;
      this.l0Urgent = true;
      this.queueL0(plot);
    }
    const frac = Math.ceil((255 * t.remaining) / t.initial);
    if (frac !== this.remFrac[plot]) {
      this.remFrac[plot] = frac;
      this.queueL0(plot);
    }
  }

  // ---- Client uploads -------------------------------------------------------------------------------------------------

  /** One C -> S paint message. Never throws; whatever fails a bound is skipped and the tile is resynced to the sender. */
  receive(s: number, buf: Uint8Array, start: number, end: number): void {
    if (this.active[s] !== 1) return;
    this.uploads++;
    this.uploadBytes += end - start;
    const r = this.reader;
    r.load(buf, start, end);
    const trusted = this.trust[s] === 1;
    this.trust[s] = 0;
    if (r.u8() !== SEC_PAINT) {
      this.rejects[REJECT_MALFORMED] = (this.rejects[REJECT_MALFORMED] ?? 0) + 1;
      return;
    }
    r.u16(); // sequence number (acknowledged implicitly by the relayed tile state)
    const plots = r.varint();
    const bit = 1 << s;
    const px = this.pose[s * 3] ?? 0;
    const py = this.pose[s * 3 + 1] ?? 0;
    const pz = this.pose[s * 3 + 2] ?? 0;
    const reach2 = this.reach2[s] ?? 0;
    const actorSlot = this.actor[s] ?? 0;
    const d = this.dir;
    let plot = 0;
    for (let p = 0; p < plots; p++) {
      plot += readZigzag(r);
      const n = r.varint();
      if (r.bad || plot < 0 || plot >= this.state.length || n < 1 || n > TILE_TEXELS || !readGaps(r, n, this.idx)) {
        this.rejects[REJECT_MALFORMED] = (this.rejects[REJECT_MALFORMED] ?? 0) + 1;
        return;
      }
      const g = this.geom.get(plot);
      const f = g.f;
      // The whole frame must be near the pose before any tile state is created for it.
      const far = !trusted && px * (f[0] ?? 0) + py * (f[1] ?? 0) + pz * (f[2] ?? 0) < this.cosEnter;
      if (far || this.state[plot] === STATE_POLISHED) {
        for (let k = 0; k < n; k++) r.nib();
        r.nibEnd();
        if (far) {
          this.rejects[REJECT_OUT_OF_REACH] = (this.rejects[REJECT_OUT_OF_REACH] ?? 0) + n;
          this.resyncBlank(s, plot);
        }
        continue;
      }
      d.x = px;
      d.y = py;
      d.z = pz;
      dirToLocal(g, d, this.radiusM, this.loc);
      const pu = this.loc.u;
      const pv = this.loc.v;
      const t = this.tileFor(plot);
      const owned = g.owned;
      let removed = 0;
      let resync = false;
      for (let k = 0; k < n; k++) {
        const v = r.nib();
        const i = this.idx[k] ?? 0;
        if (((owned[i >>> 5] ?? 0) & (1 << (i & 31))) === 0) {
          this.rejects[REJECT_MALFORMED] = (this.rejects[REJECT_MALFORMED] ?? 0) + 1;
          resync = true;
          continue;
        }
        const old = getNib(t.packed, i);
        if (v >= old) {
          this.texelsStale++;
          continue;
        }
        if (!trusted) {
          const du = -FRAME_HALF_MM + (i & (TILE_EDGE - 1)) * TEXEL_MM + TEXEL_MM / 2 - pu;
          const dv = -FRAME_HALF_MM + (i >> 6) * TEXEL_MM + TEXEL_MM / 2 - pv;
          if (du * du + dv * dv > reach2 && !this.nearPastPose(s, g, du + pu, dv + pv, reach2)) {
            this.rejects[REJECT_OUT_OF_REACH] = (this.rejects[REJECT_OUT_OF_REACH] ?? 0) + 1;
            resync = true;
            continue;
          }
          const need = old - v;
          const have = this.bucket[s] ?? 0;
          if (have < need) {
            this.rejects[REJECT_RATE] = (this.rejects[REJECT_RATE] ?? 0) + 1;
            resync = true;
            continue;
          }
          this.bucket[s] = have - need;
        }
        setNib(t.packed, i, v);
        t.hash = t.hash ^ texelZ(i, old) ^ texelZ(i, v);
        removed += old - v;
        if (t.fine && (t.fine[i] ?? 0) > v * FINE_PER_LEVEL) t.fine[i] = v * FINE_PER_LEVEL;
        this.markOut(t, i, s);
        this.texelsMerged++;
      }
      r.nibEnd();
      if (resync) {
        t.resyncFor |= bit;
        if (!t.inFull) {
          t.inFull = true;
          this.fullList.push(t);
        }
      }
      if (removed > 0) {
        t.remaining -= removed;
        this.commit(t, removed, actorSlot);
      }
    }
  }

  /** Slow path of the reach bound: is the texel centre (cu, cv) within reach of any recent pose of the slot? */
  private nearPastPose(s: number, g: PlotGeom, cu: number, cv: number, reach2: number): boolean {
    const d = this.dir;
    const f = g.f;
    for (let h = 0; h < POSE_HISTORY; h++) {
      const o = (s * POSE_HISTORY + h) * 3;
      d.x = this.poseHist[o] ?? 0;
      d.y = this.poseHist[o + 1] ?? 0;
      d.z = this.poseHist[o + 2] ?? 0;
      if (d.x * (f[0] ?? 0) + d.y * (f[1] ?? 0) + d.z * (f[2] ?? 0) < 0.5) continue;
      dirToLocal(g, d, this.radiusM, this.loc);
      const du = cu - this.loc.u;
      const dv = cv - this.loc.v;
      if (du * du + dv * dv <= reach2) return true;
    }
    return false;
  }

  private resyncBlank(s: number, plot: number): void {
    const t = this.tiles.get(plot);
    if (t) {
      t.resyncFor |= 1 << s;
      if (!t.inFull) {
        t.inFull = true;
        this.fullList.push(t);
      }
      return;
    }
    const n = this.blankCount[s] ?? 0;
    if (n < 16) {
      this.blanks[s * 16 + n] = plot;
      this.blankCount[s] = n + 1;
    }
  }

  // ---- Robots ---------------------------------------------------------------------------------------------------------

  /** Starts a robot plot job. Returns the intent bytes sent to the clients that have the plot in their dust radius. */
  robotIntent(it: RobotPlotIntent): number {
    const id = it.robotId;
    if (id < 0 || id >= MAX_ROBOTS || it.plotId >= this.state.length) return 0;
    if (this.jActive[id] !== 1) this.jActiveCount++;
    this.jActive[id] = 1;
    this.jPlot[id] = it.plotId;
    this.jWidthMm[id] = it.widthCm * 10;
    this.jDepthFine[id] = depthFineOf(it.depth16, DEFAULT_DUST_LEVEL);
    this.jStepMm[id] = it.speedCmPerS * 10;
    this.jMaskLo[id] = it.laneMask[0] >>> 0;
    this.jMaskHi[id] = it.laneMask[1] >>> 0;
    this.jLane[id] = -1;
    this.jPos[id] = FRAME_HALF_MM; // forces the first lane pick
    this.jDue[id] = Math.max(this.tick + 1, it.startTick);
    const f = this.geom.get(it.plotId).f;
    let bytes = 0;
    for (let s = 0; s < MAX_SLOTS; s++) {
      if (this.active[s] !== 1) continue;
      const c =
        (this.pose[s * 3] ?? 0) * (f[0] ?? 0) +
        (this.pose[s * 3 + 1] ?? 0) * (f[1] ?? 0) +
        (this.pose[s * 3 + 2] ?? 0) * (f[2] ?? 0);
      if (c < this.cosEnter) continue;
      const w = this.outOf(s);
      w.u8(SEC_ROBOT);
      w.u16(id);
      w.u24(it.plotId);
      w.u32(it.startTick);
      w.u16(it.widthCm);
      w.u8(it.depth16);
      w.u16(it.speedCmPerS);
      w.u32(it.laneMask[0]);
      w.u16(it.laneMask[1] & 0xffff);
      bytes += 1 + ROBOT_INTENT_BYTES;
    }
    return bytes;
  }

  private nextLane(id: number): number {
    for (let k = (this.jLane[id] ?? -1) + 1; k < 64; k++) {
      const word = k < 32 ? (this.jMaskLo[id] ?? 0) : (this.jMaskHi[id] ?? 0);
      if ((word >>> (k & 31)) & 1) return k;
    }
    return -1;
  }

  private stopRobot(id: number): void {
    this.jActive[id] = 0;
    this.jActiveCount--;
  }

  private robotChunk(id: number): void {
    const plot = this.jPlot[id] ?? 0;
    if (this.state[plot] === STATE_POLISHED) {
      this.stopRobot(id);
      return;
    }
    const width = this.jWidthMm[id] ?? 0;
    if ((this.jPos[id] ?? 0) >= FRAME_HALF_MM) {
      const lane = this.nextLane(id);
      const v = lane < 0 ? FRAME_HALF_MM : -FRAME_HALF_MM + (width >> 1) + lane * Math.round(0.9 * width);
      if (lane < 0 || v >= FRAME_HALF_MM) {
        this.stopRobot(id);
        return;
      }
      this.jLane[id] = lane;
      this.jPos[id] = -FRAME_HALF_MM;
    }
    const lane = this.jLane[id] ?? 0;
    const v = -FRAME_HALF_MM + (width >> 1) + lane * Math.round(0.9 * width);
    const x0 = this.jPos[id] ?? 0;
    const x1 = Math.min(FRAME_HALF_MM, x0 + (this.jStepMm[id] ?? 0));
    this.jPos[id] = x1;
    this.jDue[id] = this.tick + this.o.simTickHz;
    this.robotChunks++;
    const p = this.painter;
    const n = p.raster(x0, v, x1, v, width, BRUSH_FLAT);
    if (n === 0) return;
    const t = this.tileFor(plot);
    let fine = t.fine;
    if (!fine) {
      fine = new Uint8Array(TILE_TEXELS);
      for (let i = 0; i < TILE_TEXELS; i++) fine[i] = getNib(t.packed, i) * FINE_PER_LEVEL;
      t.fine = fine;
    }
    const owned = t.geom.owned;
    const depthFine = this.jDepthFine[id] ?? 0;
    let removed = 0;
    for (let k = 0; k < n; k++) {
      const i = p.touched[k] ?? 0;
      if (((owned[i >>> 5] ?? 0) & (1 << (i & 31))) === 0) continue;
      const f = fine[i] ?? 0;
      if (f === 0) continue;
      const r = removalFine(p.cov[i] ?? 0, depthFine);
      const nf = f > r ? f - r : 0;
      fine[i] = nf;
      const lvl = (nf + FINE_PER_LEVEL - 1) >> 4;
      const old = getNib(t.packed, i);
      if (lvl < old) {
        setNib(t.packed, i, lvl);
        t.hash = t.hash ^ texelZ(i, old) ^ texelZ(i, lvl);
        removed += old - lvl;
        this.markOut(t, i, ORIGIN_ROBOT);
      }
    }
    p.clear();
    if (removed > 0) {
      t.remaining -= removed;
      this.commit(t, removed, SHIFT_ACTOR_SLOT);
    }
  }

  private stepRobots(): void {
    this.chunkTokens = Math.min(ROBOT_CHUNKS_PER_SEC, this.chunkTokens + ROBOT_CHUNKS_PER_SEC / this.o.simTickHz);
    if (this.jActiveCount === 0) return;
    let id = this.jCursor;
    for (let k = 0; k < MAX_ROBOTS; k++) {
      if (this.jActive[id] === 1 && (this.jDue[id] ?? 0) <= this.tick) {
        if (this.chunkTokens < 1) {
          this.robotChunksDeferred++;
          break;
        }
        this.chunkTokens -= 1;
        this.robotChunk(id);
      }
      id = (id + 1) & (MAX_ROBOTS - 1);
    }
    this.jCursor = id;
  }

  // ---- Tick and flush -------------------------------------------------------------------------------------------------

  /** Advances one sim tick: rate buckets, robots, and (every flushTicks) the per-client messages. */
  step(): void {
    this.tick++;
    for (let s = 0; s < MAX_SLOTS; s++) {
      if (this.active[s] !== 1) continue;
      const b = (this.bucket[s] ?? 0) + (this.bucketRate[s] ?? 0);
      const cap = this.bucketCap[s] ?? 0;
      this.bucket[s] = b > cap ? cap : b;
      const o = (s * POSE_HISTORY + (this.tick & (POSE_HISTORY - 1))) * 3;
      this.poseHist[o] = this.pose[s * 3] ?? 0;
      this.poseHist[o + 1] = this.pose[s * 3 + 1] ?? 0;
      this.poseHist[o + 2] = this.pose[s * 3 + 2] ?? 0;
    }
    this.stepRobots();
    if (this.tick % this.o.flushTicks === 0) this.flush(this.o.streamBytesPerFlush);
  }

  /** Builds the S -> C message of every slot. `streamBudget` caps streamed full tiles per slot (resyncs always go). */
  flush(streamBudget: number): void {
    this.flushes++;
    const dirty = this.dirty.items;
    const dirtyCount = this.dirty.count;
    const fullItems = this.fullList.items;
    const bodies = this.bodies;
    bodies.reset();
    // Delta bodies are identical for every receiver: encode once.
    for (let k = 0; k < dirtyCount; k++) {
      const t = dirty[k] as ServerTile;
      if (t.dead || t.outCount === 0) {
        t.bodyLen = 0;
        continue;
      }
      t.bodyOff = bodies.pos;
      bodies.varint(t.outCount);
      let last = -1;
      for (let wi = 0; wi < t.outMask.length; wi++) {
        let word = t.outMask[wi] ?? 0;
        while (word !== 0) {
          const i = (wi << 5) + lowBit(word);
          word &= word - 1;
          bodies.varint(i - last - 1);
          last = i;
        }
      }
      for (let wi = 0; wi < t.outMask.length; wi++) {
        let word = t.outMask[wi] ?? 0;
        while (word !== 0) {
          const i = (wi << 5) + lowBit(word);
          word &= word - 1;
          bodies.nib(getNib(t.packed, i));
        }
      }
      bodies.nibEnd();
      t.bodyLen = bodies.pos - t.bodyOff;
    }
    const sendL0 = this.l0Count > 0 && (this.l0Urgent || this.tick % this.o.l0Ticks === 0);
    const sendCheck = this.tick % (DUST_CHECK_SECONDS * this.o.simTickHz) === 0;
    const fulls = this.fulls;
    fulls.reset();
    for (let k = 0; k < this.fullList.count; k++) (fullItems[k] as ServerTile).fullOff = -1;

    for (let s = 0; s < MAX_SLOTS; s++) {
      if (this.active[s] !== 1) continue;
      const bit = 1 << s;
      const w = this.outOf(s);
      // Interest drops.
      const nd = this.dropCount[s] ?? 0;
      if (nd > 0) {
        w.u8(SEC_INTEREST);
        w.u16(nd);
        for (let k = 0; k < nd; k++) w.u24(this.drops[s * 256 + k] ?? 0);
        this.dropCount[s] = 0;
      }
      // L0 for the whole moon.
      if (sendL0) {
        const at = w.pos;
        w.u8(SEC_PLOTS);
        w.u24(this.l0Count);
        for (let k = 0; k < this.l0Count; k++) {
          const plot = this.l0List[k] ?? 0;
          w.u24(plot | ((this.state[plot] ?? 0) << 18));
          w.u8(this.remFrac[plot] ?? 0);
        }
        this.l0Bytes += w.pos - at;
      }
      // Resyncs to a blank tile (rejected paint on a plot the server holds no tile for).
      const nb = this.blankCount[s] ?? 0;
      for (let k = 0; k < nb; k++) {
        w.u8(SEC_TILE_RESYNC);
        w.u24(this.blanks[s * 16 + k] ?? 0);
        encodeBlank(w);
      }
      this.blankCount[s] = 0;
      // Full tiles: resyncs first (always), then streamed interest entries within the budget.
      let streamed = 0;
      for (let k = 0; k < this.fullList.count; k++) {
        const t = fullItems[k] as ServerTile;
        if (t.dead) continue;
        const isResync = (t.resyncFor & bit) !== 0;
        if (!isResync && (t.wantFor & bit) === 0) continue;
        if (!isResync && streamed >= streamBudget) continue;
        if (t.fullOff < 0) {
          t.fullOff = fulls.pos;
          encodeFull(fulls, t.packed);
          t.fullLen = fulls.pos - t.fullOff;
        }
        w.u8(isResync ? SEC_TILE_RESYNC : SEC_TILE_FULL);
        w.u24(t.plot);
        w.bytes(fulls.buf, t.fullOff, t.fullOff + t.fullLen);
        this.fullTilesSent++;
        this.fullTileBytes += t.fullLen + 4;
        if (!isResync) streamed += t.fullLen + 4;
        if ((t.knownBy & bit) === 0) {
          t.knownBy |= bit;
          this.known[s] = (this.known[s] ?? 0) ^ t.mix;
        }
        t.wantFor &= ~bit;
        t.resyncFor &= ~bit;
        t.fullSent |= bit;
      }
      // Tile deltas for the tiles this slot holds; skipped when the slot is the only author of the window.
      let count = 0;
      for (let k = 0; k < dirtyCount; k++) {
        const t = dirty[k] as ServerTile;
        if (t.bodyLen > 0 && (t.knownBy & bit) !== 0 && (t.fullSent & bit) === 0 && t.origin !== s) count++;
      }
      if (count > 0) {
        const at = w.pos;
        w.u8(SEC_TILE_DELTA);
        w.u16(count);
        let prev = 0;
        for (let k = 0; k < dirtyCount; k++) {
          const t = dirty[k] as ServerTile;
          if (t.bodyLen > 0 && (t.knownBy & bit) !== 0 && (t.fullSent & bit) === 0 && t.origin !== s) {
            writeZigzag(w, t.plot - prev);
            prev = t.plot;
            w.bytes(bodies.buf, t.bodyOff, t.bodyOff + t.bodyLen);
          }
        }
        this.deltaBytes += w.pos - at;
      }
      if (this.ackDirty[s] === 1) {
        this.ackDirty[s] = 0;
        w.u8(SEC_ACK);
        w.u24(Math.min(0xffffff, this.grams[this.actor[s] ?? 0] ?? 0));
      }
      if (sendCheck) {
        w.u8(SEC_CHECK);
        w.u32(this.expectedHash(s));
      }
    }

    // Reset the window.
    for (let k = 0; k < dirtyCount; k++) {
      const t = dirty[k] as ServerTile;
      t.outMask.fill(0);
      t.outCount = 0;
      t.origin = ORIGIN_NONE;
      t.inDirty = false;
      t.fullSent = 0;
    }
    this.dirty.clear();
    let keep = 0;
    for (let k = 0; k < this.fullList.count; k++) {
      const t = fullItems[k] as ServerTile;
      t.fullSent = 0;
      if (!t.dead && (t.wantFor | t.resyncFor) !== 0) fullItems[keep++] = t;
      else t.inFull = false;
    }
    this.fullList.count = keep;
    if (sendL0) {
      for (let k = 0; k < this.l0Count; k++) this.l0Flag[this.l0List[k] ?? 0] = 0;
      this.l0Count = 0;
      this.l0Urgent = false;
    }
  }

  /** True while slot `s` still waits for streamed full tiles. */
  hasStream(s: number): boolean {
    const bit = 1 << s;
    for (let k = 0; k < this.fullList.count; k++) {
      if (((this.fullList.items[k] as ServerTile).wantFor & bit) !== 0) return true;
    }
    return false;
  }

  /** Test hook: mark every tile the slot holds for a full resync (what a client asks for after a failed dust.check). */
  resyncAll(s: number): void {
    const bit = 1 << s;
    for (let k = 0; k < this.tileList.length; k++) {
      const t = this.tileList[k] as ServerTile;
      if ((t.knownBy & bit) === 0) continue;
      t.resyncFor |= bit;
      if (!t.inFull) {
        t.inFull = true;
        this.fullList.push(t);
      }
    }
  }

  // ---- Checkpoint -----------------------------------------------------------------------------------------------------

  /**
   * Whole-world checkpoint: header, economy, Polished plot list, one RLE (or raw) tile per touched plot, CRC-32.
   * The server's private robot fine planes and robot jobs in flight are not saved.
   */
  serialize(w: ByteWriter): number {
    const start = w.pos;
    w.u32(CHECKPOINT_MAGIC);
    w.u8(CHECKPOINT_VERSION);
    w.u32(this.tick);
    let econ = 0;
    for (let a = 0; a < 64; a++) if ((this.mg[a] ?? 0) !== 0 || (this.grams[a] ?? 0) !== 0) econ++;
    w.u8(econ);
    for (let a = 0; a < 64; a++) {
      if ((this.mg[a] ?? 0) === 0 && (this.grams[a] ?? 0) === 0) continue;
      w.u8(a);
      w.u16(this.mg[a] ?? 0);
      w.u32(this.grams[a] ?? 0);
    }
    w.u32(this.polishedCount);
    let prev = -1;
    for (let p = 0; p < this.state.length; p++) {
      if (this.state[p] !== STATE_POLISHED) continue;
      w.varint(p - prev - 1);
      prev = p;
    }
    w.u32(this.tileList.length);
    let last = 0;
    for (let k = 0; k < this.tileList.length; k++) {
      const t = this.tileList[k] as ServerTile;
      writeZigzag(w, t.plot - last);
      last = t.plot;
      encodeFull(w, t.packed);
    }
    w.u32(crc32(w.buf, start, w.pos));
    this.dirtyCheckpoint = false;
    return w.pos - start;
  }

  /** Rebuilds the world from a checkpoint. All slots are dropped (clients rejoin). False when the blob is invalid. */
  restore(buf: Uint8Array, start: number, end: number): boolean {
    if (end - start < 22) return false;
    const r = this.reader;
    r.load(buf, end - 4, end);
    if (r.u32() !== crc32(buf, start, end - 4)) return false;
    r.load(buf, start, end - 4);
    if (r.u32() !== CHECKPOINT_MAGIC || r.u8() !== CHECKPOINT_VERSION) return false;
    this.clear();
    this.tick = r.u32();
    const econ = r.u8();
    for (let k = 0; k < econ; k++) {
      const a = r.u8() & 63;
      this.mg[a] = r.u16();
      this.grams[a] = r.u32();
    }
    const polished = r.u32();
    let prev = -1;
    for (let k = 0; k < polished; k++) {
      prev += r.varint() + 1;
      if (r.bad || prev >= this.state.length) return false;
      this.state[prev] = STATE_POLISHED;
      this.remFrac[prev] = 0;
      this.polishedHash ^= plotMix(prev, POLISHED_HASH);
    }
    this.polishedCount = polished;
    this.openedCount = polished;
    const count = r.u32();
    let plot = 0;
    for (let k = 0; k < count; k++) {
      plot += readZigzag(r);
      if (r.bad || plot < 0 || plot >= this.state.length || !decodeFull(r, this.full)) return false;
      const t = this.tileFor(plot);
      const owned = t.geom.owned;
      let remaining = 0;
      let hash = 0;
      for (let i = 0; i < TILE_TEXELS; i++) {
        const isOwned = ((owned[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0;
        const v = isOwned ? (this.full[i] ?? LEVEL_MAX) : LEVEL_MAX;
        setNib(t.packed, i, v);
        if (isOwned) {
          remaining += v;
          hash ^= texelZ(i, v);
        }
      }
      t.remaining = remaining;
      t.hash = hash | 0;
      t.mix = plotMix(plot, t.hash);
      this.tilesHash ^= t.mix;
      if (t.initial - remaining >= Math.ceil(t.initial / OPENED_DIVISOR)) {
        this.state[plot] = STATE_OPENED;
        this.openedCount++;
      }
      this.remFrac[plot] = Math.ceil((255 * remaining) / t.initial);
    }
    this.dirtyCheckpoint = false;
    return !r.bad;
  }

  private clear(): void {
    this.state.fill(0);
    this.remFrac.fill(255);
    this.l0Flag.fill(0);
    this.l0Count = 0;
    this.l0Urgent = false;
    this.tiles.clear();
    this.tileList.length = 0;
    this.dirty.clear();
    this.fullList.clear();
    this.tilesHash = 0;
    this.polishedHash = 0;
    this.active.fill(0);
    this.known.fill(0);
    this.mg.fill(0);
    this.grams.fill(0);
    this.jActive.fill(0);
    this.jActiveCount = 0;
    this.polishedCount = 0;
    this.openedCount = 0;
  }
}
