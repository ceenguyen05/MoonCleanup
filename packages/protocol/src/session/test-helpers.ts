// Test-only helpers for the session and interpolation tests: a fake server that writes FRAMEs, snapshot slices and PONGs
// through the real encoders. Not exported from the package barrel.

import { PROTOCOL_VERSION, type HelloPayload } from "@moon-cleanup/shared";
import { encodePong } from "../codec/ping";
import {
  encodeSnapshotRaw,
  snapshotSliceCount,
  writeSnapshotSlice,
  type Deflate,
  type Inflate,
} from "../codec/dust-messages";
import {
  ENTITY_KIND_AVATAR,
  REC_DELTA,
  REC_FULL,
  SlotTable,
  createEntityState,
  createSelfState,
  type EntityState,
} from "../codec/frame-state";
import { FrameWriter } from "../codec/frame-writer";
import type { ConnectMode, ResyncReason, SessionHost, SessionPhase } from "./session";

export const identityDeflate: Deflate = (raw) => raw.slice();
export const identityInflate: Inflate = (data, max) => (data.length > max ? null : data.slice());

export const HELLO: HelloPayload = {
  serverProtocol: PROTOCOL_VERSION,
  serverBuild: "test",
  simTickHz: 20,
  snapshotHz: 10,
};

export interface Ent {
  slot: number;
  kind?: number;
  x: number;
  y?: number;
  z?: number;
  yawCode?: number;
  /** Quantized vehicle orientation (packQuat output). */
  orient?: { index: number; a: number; b: number; c: number };
  assign?: number;
}

/** Writes server-side FRAMEs against its own slot table (like the real encoder). */
export class FakeServer {
  readonly table = new SlotTable();
  private readonly writer = new FrameWriter();

  /** A keyframe: the table starts empty and every entity is assigned and written FULL. */
  keyframe(tick: number, entities: readonly Ent[], ack = 0): Uint8Array {
    this.table.reset();
    return this.build(tick, entities, true, ack, true);
  }

  /** A normal frame: entities with `assign` are assigned first; the rest are DELTA records. */
  frame(tick: number, entities: readonly Ent[], ack = 0): Uint8Array {
    return this.build(tick, entities, false, ack, false);
  }

  private build(tick: number, entities: readonly Ent[], keyframe: boolean, ack: number, allFull: boolean): Uint8Array {
    const w = this.writer;
    w.begin(tick, ack, 1, keyframe);
    w.writeSelf(createSelfState());
    for (const e of entities) {
      if (allFull || e.assign !== undefined) {
        w.slotAssign(this.table, e.slot, e.assign ?? 1000 + e.slot, e.kind ?? ENTITY_KIND_AVATAR);
      }
    }
    for (const e of entities) {
      const s: EntityState = createEntityState();
      s.slot = e.slot;
      s.rec = allFull || e.assign !== undefined ? REC_FULL : REC_DELTA;
      s.px = e.x;
      s.py = e.y ?? 0;
      s.pz = e.z ?? 0;
      s.yawCode = e.yawCode ?? 0;
      if (e.orient) {
        s.orientIndex = e.orient.index;
        s.orientA = e.orient.a;
        s.orientB = e.orient.b;
        s.orientC = e.orient.c;
      }
      w.writeEntity(this.table, s);
    }
    const n = w.finish();
    return w.buffer.slice(0, n);
  }
}

/** DUST_SNAPSHOT slices of an all-Closed world (state 0) of `plotCount` plots. */
export function snapshotSlices(plotCount: number, version: number): Uint8Array[] {
  const raw = encodeSnapshotRaw({
    plotCount,
    plotStates: new Uint8Array(Math.ceil(plotCount / 4)),
    openedRemaining: new Uint8Array(0),
    ledgers: [],
    logs: [],
  });
  if (raw === null) throw new Error("snapshot encode failed");
  const deflated = identityDeflate(raw);
  const count = snapshotSliceCount(deflated.length);
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(4200);
    const n = writeSnapshotSlice(deflated, i, version, buf);
    out.push(buf.slice(0, n));
  }
  return out;
}

export function pongMessage(clientTimeMs: number, serverTick: number): Uint8Array {
  const m = new Uint8Array(9);
  encodePong({ clientTimeMs, serverTick }, m);
  return m;
}

/** Records every host command. */
export class RecordingHost implements SessionHost {
  probes = 0;
  connects: ConnectMode[] = [];
  readies = 0;
  resyncs: ResyncReason[] = [];
  pings = 0;
  visibility: boolean[] = [];
  phases: SessionPhase[] = [];
  framesSeen = 0;
  slotResets = 0;
  snapshots = 0;
  probeHealth(): void {
    this.probes++;
  }
  connect(mode: ConnectMode): void {
    this.connects.push(mode);
  }
  sendReady(): void {
    this.readies++;
  }
  requestResync(reason: ResyncReason): void {
    this.resyncs.push(reason);
  }
  sendPing(): void {
    this.pings++;
  }
  sendVisibility(hidden: boolean): void {
    this.visibility.push(hidden);
  }
  onPhase(phase: SessionPhase): void {
    this.phases.push(phase);
  }
  onFrame(): void {
    this.framesSeen++;
  }
  onSlotsReset(): void {
    this.slotResets++;
  }
  onDustSnapshot(): void {
    this.snapshots++;
  }
}
