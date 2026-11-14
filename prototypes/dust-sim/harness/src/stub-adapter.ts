// Stub prototype adapter: a trivial CPU ledger (32 x 32 saturating subtraction per plot, 0.8 m texels) with immediate
// echoes. Order-independent by construction, so hashes match. It proves the harness plumbing; its numbers are never
// scored (isStub = true). Real prototypes replace it by exporting createAdapter() from their own folder.
import type { RobotPlotIntent, StrokeRecord } from "@moon-cleanup/shared";
import type {
  AdapterStartContext,
  CameraPose,
  CleaningState,
  DustPrototypeAdapter,
  FrameSample,
  LateJoinResult,
} from "./types";

const EDGE = 32;
const TEXEL_MM = 800;
const START_UNITS = 255;
const STROKE_ECHO_BYTES = 12;
const INTENT_BYTES = 20;

type Ledger = Uint8Array;
type World = Map<number, Ledger>;

function fnv(h: number, v: number): number {
  let x = h;
  for (let i = 0; i < 4; i++) {
    x ^= (v >>> (8 * i)) & 0xff;
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x;
}

function applyStroke(world: World, s: StrokeRecord): void {
  let l = world.get(s.anchor);
  if (!l) {
    l = new Uint8Array(EDGE * EDGE).fill(START_UNITS);
    world.set(s.anchor, l);
  }
  const rMm = (s.widthCm * 10) / 2;
  const steps = Math.max(1, Math.ceil(Math.hypot(s.endUMm - s.startUMm, s.endVMm - s.startVMm) / (TEXEL_MM / 2)));
  for (let k = 0; k <= steps; k++) {
    const u = s.startUMm + ((s.endUMm - s.startUMm) * k) / steps;
    const v = s.startVMm + ((s.endVMm - s.startVMm) * k) / steps;
    const x0 = Math.floor((u - rMm + 12_800) / TEXEL_MM);
    const x1 = Math.floor((u + rMm + 12_800) / TEXEL_MM);
    const y0 = Math.floor((v - rMm + 12_800) / TEXEL_MM);
    const y1 = Math.floor((v + rMm + 12_800) / TEXEL_MM);
    for (let y = Math.max(0, y0); y <= Math.min(EDGE - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(EDGE - 1, x1); x++) {
        const i = y * EDGE + x;
        // One removal per stroke per texel: mark with the stroke depth once (min with the new level, commutative).
        l[i] = Math.min(l[i] ?? START_UNITS, Math.max(0, START_UNITS - s.depth16 * 4));
      }
    }
  }
}

function hashWorld(world: World): number {
  let acc = 0;
  for (const [plot, l] of world) {
    let h = 0x811c9dc5;
    let clean = true;
    for (let i = 0; i < l.length; i++) {
      if ((l[i] ?? START_UNITS) !== START_UNITS) clean = false;
      h = Math.imul(h ^ (l[i] ?? 0), 0x01000193) >>> 0;
    }
    if (!clean) acc = (acc ^ fnv(fnv(0x811c9dc5, plot), h)) >>> 0;
  }
  return acc;
}

const copyWorld = (w: World): World => new Map([...w].map(([k, v]) => [k, new Uint8Array(v)]));

export function createStubAdapter(): DustPrototypeAdapter {
  let server: World = new Map();
  let durable: { tick: number; world: World } = { tick: 0, world: new Map() };
  const clients = new Map<number, World>();
  const bytes = new Map<number, number>();
  const pending: StrokeRecord[] = [];
  let tick = 0;
  let hz = 20;
  let uploads = 0;

  const adapter: DustPrototypeAdapter = {
    approach: "stub",
    isStub: true,
    get simTickHz() {
      return hz;
    },
    start(ctx: AdapterStartContext) {
      hz = ctx.simTickHz;
      server = new Map();
      clients.clear();
      bytes.clear();
      pending.length = 0;
      tick = 0;
      durable = { tick: 0, world: new Map() };
      return Promise.resolve();
    },
    stop() {
      return Promise.resolve();
    },
    joinClient(id) {
      // Late join and rejoin: the client starts from a copy of the authoritative state.
      clients.set(id, copyWorld(server));
      bytes.set(id, bytes.get(id) ?? 0);
    },
    leaveClient(id) {
      clients.delete(id);
    },
    submitStroke(_id, stroke) {
      if (stroke.widthCm < 1) return { ok: false, reason: "empty_plot" };
      applyStroke(server, stroke);
      pending.push(stroke);
      return { ok: true };
    },
    submitRobotIntent(_intent: RobotPlotIntent) {
      return INTENT_BYTES;
    },
    advance(n) {
      tick += n;
      for (const s of pending) {
        for (const [id, w] of clients) {
          applyStroke(w, s);
          bytes.set(id, (bytes.get(id) ?? 0) + STROKE_ECHO_BYTES);
        }
      }
      uploads += pending.length;
      pending.length = 0;
    },
    serverHash: () => hashWorld(server),
    clientHash: (id) => hashWorld(clients.get(id) ?? new Map()),
    clientBytesSent: (id) => bytes.get(id) ?? 0,
    persist() {
      durable = { tick, world: copyWorld(server) };
      return { tick, hash: hashWorld(durable.world) };
    },
    crash() {
      server = new Map();
      clients.clear();
      pending.length = 0;
    },
    restore() {
      server = copyWorld(durable.world);
      tick = durable.tick;
      return { tick: durable.tick, hash: hashWorld(server), restoreMs: 0 };
    },
    view(_pose: CameraPose, _cleaning: CleaningState | null): FrameSample {
      const u = uploads;
      uploads = 0;
      return { cpuMs: 0, tileUploads: u, replayMs: 0, tileRebuildMs: 0 };
    },
    lateJoin(id): LateJoinResult {
      adapter.joinClient(id);
      const w = clients.get(id);
      return { blockingBytes: (w?.size ?? 0) * (EDGE * EDGE + 8), streamedBytes: 0, playableMs: 0, tileRebuildMs: 0 };
    },
    exportMetrics: () => ({ serverPlots: server.size }),
  };
  return adapter;
}
