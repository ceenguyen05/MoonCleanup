import {
  FRAME_ENTITY_AVATAR_FULL_GOLDEN_VECTORS,
  FRAME_HEADER_BYTES,
  FRAME_HEADER_GOLDEN_VECTORS,
  FRAME_MAX_BYTES,
  FRAME_SELF_DRIVING_GOLDEN_VECTORS,
  FRAME_SELF_ON_FOOT_GOLDEN_VECTORS,
  FRAME_SLOT_CHANGE_GOLDEN_VECTORS,
  FRAME_FLAG_BIT,
  MOVE_STATES,
  VEHICLE_GEARS,
  type FrameSelf,
} from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { FRAME_ERR_TRUNCATED, FRAME_OK, FrameReader } from "./frame-reader";
import {
  DustPlotDeltaList,
  ENTITY_KIND_AVATAR,
  ENTITY_KIND_ROBOT,
  ENTITY_KIND_VEHICLE,
  FrameView,
  REC_DELTA,
  REC_FULL,
  REC_REMOVE,
  RobotIntentList,
  SlotTable,
  StrokeChainBuffer,
  createEntityState,
  createSelfState,
  type EntityState,
  type SelfState,
} from "./frame-state";
import { FrameWriter, SELF_DRIVING_BYTES, SELF_ON_FOOT_BYTES } from "./frame-writer";
import { posOthersFromSteps, posOthersToSteps, posOwnFromSteps, posOwnToSteps } from "./quantize";
import { ALLOC_BUDGET_BYTES, allocatedBytes, randInt, randomEntity, randomSelf, rng } from "./test-util";

const PLOTS = 163_842;

function selfFromVector(v: FrameSelf): SelfState {
  const s = createSelfState();
  s.moveState = MOVE_STATES.indexOf(v.moveState);
  s.hopCharges = v.hopCharges;
  s.px = v.position.x;
  s.py = v.position.y;
  s.pz = v.position.z;
  s.vx = v.velocity.x;
  s.vy = v.velocity.y;
  s.vz = v.velocity.z;
  s.yawCode = v.yawCode;
  s.cellGrams = v.cellGrams;
  if (v.vehicle) {
    const d = v.vehicle;
    s.vpx = d.position.x;
    s.vpy = d.position.y;
    s.vpz = d.position.z;
    s.orientIndex = d.orientIndex;
    [s.orientA, s.orientB, s.orientC] = d.orient;
    s.lvx = d.linearVelocity.x;
    s.lvy = d.linearVelocity.y;
    s.lvz = d.linearVelocity.z;
    s.avx = d.angularVelocity.x;
    s.avy = d.angularVelocity.y;
    s.avz = d.angularVelocity.z;
    s.steer = d.steer;
    s.gear = VEHICLE_GEARS.indexOf(d.gear);
    s.boost = d.boost;
    s.lights = d.lights;
  }
  return s;
}

function bytesOf(w: FrameWriter): number[] {
  return [...w.buffer.subarray(0, w.length)];
}

describe("FRAME golden vectors (shared, byte for byte)", () => {
  it("header", () => {
    const w = new FrameWriter();
    const v = FRAME_HEADER_GOLDEN_VECTORS[0]!;
    w.begin(v.payload.serverTick, v.payload.ackInputSeq, v.payload.inputBufferDepth, true);
    w.writeSelf(createSelfState());
    expect(w.finish()).toBe(FRAME_HEADER_BYTES + SELF_ON_FOOT_BYTES);
    expect(bytesOf(w).slice(0, FRAME_HEADER_BYTES)).toEqual(v.bytes);
  });

  it("header flags of the second vector decode (events skipped by length)", () => {
    // flags of vector 2 minus the sections this test does not build: only hasEvents.
    const msg = new Uint8Array(FRAME_HEADER_BYTES + SELF_ON_FOOT_BYTES + 2 + 3);
    msg.set(FRAME_HEADER_GOLDEN_VECTORS[1]!.bytes.slice(0, 8));
    msg[8] = 1 << FRAME_FLAG_BIT.hasEvents;
    msg[FRAME_HEADER_BYTES + SELF_ON_FOOT_BYTES] = 3;
    const view = new FrameView();
    expect(new FrameReader().decode(msg, view, new SlotTable(), PLOTS)).toBe(FRAME_OK);
    expect(view.skippedEventsBytes).toBe(3);
    expect(view.hasEvents).toBe(true);
  });

  it("Self on foot", () => {
    const v = FRAME_SELF_ON_FOOT_GOLDEN_VECTORS[0]!;
    const w = new FrameWriter();
    w.begin(1, 2, 3, false);
    expect(w.writeSelf(selfFromVector(v.payload))).toBe(true);
    w.finish();
    expect(bytesOf(w).slice(FRAME_HEADER_BYTES)).toEqual(v.bytes);
    expect(v.bytes.length).toBe(SELF_ON_FOOT_BYTES);
    const view = new FrameView();
    expect(new FrameReader().decode(w.buffer.subarray(0, w.length), view, new SlotTable(), PLOTS)).toBe(FRAME_OK);
    expect(view.self.px).toBe(v.payload.position.x);
    expect(view.self.py).toBe(v.payload.position.y);
    expect(view.self.yawCode).toBe(513);
    expect(view.self.cellGrams).toBe(123456);
    expect(view.self.hopCharges).toBe(5);
    expect(MOVE_STATES[view.self.moveState]).toBe("grounded");
  });

  it("Self driving", () => {
    const v = FRAME_SELF_DRIVING_GOLDEN_VECTORS[0]!;
    const w = new FrameWriter();
    w.begin(1, 2, 3, false);
    expect(w.writeSelf(selfFromVector(v.payload))).toBe(true);
    w.finish();
    expect(bytesOf(w).slice(FRAME_HEADER_BYTES)).toEqual(v.bytes);
    expect(v.bytes.length).toBe(SELF_DRIVING_BYTES);
    const view = new FrameView();
    expect(new FrameReader().decode(w.buffer.subarray(0, w.length), view, new SlotTable(), PLOTS)).toBe(FRAME_OK);
    const d = v.payload.vehicle!;
    expect(view.self.vpz).toBe(d.position.z);
    expect([view.self.orientA, view.self.orientB, view.self.orientC]).toEqual([...d.orient]);
    expect(view.self.steer).toBe(-127);
    expect(VEHICLE_GEARS[view.self.gear]).toBe("drive");
    expect(view.self.boost && view.self.lights).toBe(true);
    expect(view.self.avx).toBe(1 / 16);
  });

  it("slot change", () => {
    const v = FRAME_SLOT_CHANGE_GOLDEN_VECTORS[0]!;
    const w = new FrameWriter();
    const table = new SlotTable();
    w.begin(0, 0, 0, false);
    w.writeSelf(createSelfState());
    expect(w.slotAssign(table, 9, 0xdeadbeef, ENTITY_KIND_VEHICLE)).toBe(true);
    w.finish();
    const at = FRAME_HEADER_BYTES + SELF_ON_FOOT_BYTES;
    expect(bytesOf(w).slice(at, at + 2)).toEqual([6, 0]);
    expect(bytesOf(w).slice(at + 2)).toEqual(v.bytes);
    const client = new SlotTable();
    const view = new FrameView();
    expect(new FrameReader().decode(w.buffer.subarray(0, w.length), view, client, PLOTS)).toBe(FRAME_OK);
    expect(client.kind[9]).toBe(ENTITY_KIND_VEHICLE);
    expect(client.entityId[9]).toBe(0xdeadbeef);
  });

  it("FULL avatar record", () => {
    const v = FRAME_ENTITY_AVATAR_FULL_GOLDEN_VECTORS[0]!;
    if (v.payload.rec !== "full" || v.payload.body.kind !== "avatar") throw new Error("vector shape");
    const table = new SlotTable();
    table.assign(7, 1, ENTITY_KIND_AVATAR);
    const e = createEntityState();
    e.slot = 7;
    e.rec = REC_FULL;
    e.px = v.payload.position.x;
    e.py = v.payload.position.y;
    e.pz = v.payload.position.z;
    e.yawCode = v.payload.body.yawCode;
    e.pitchCode = v.payload.body.pitchCode;
    e.actionState = v.payload.body.actionState;
    e.toolIndex = v.payload.body.toolIndex;
    e.flags = v.payload.body.flags;
    const w = new FrameWriter();
    w.begin(0, 0, 0, false);
    w.writeSelf(createSelfState());
    expect(w.writeEntity(table, e)).toBe(true);
    w.finish();
    const at = FRAME_HEADER_BYTES + SELF_ON_FOOT_BYTES;
    expect(bytesOf(w).slice(at, at + 3)).toEqual([14, 0, 1]);
    expect(bytesOf(w).slice(at + 3)).toEqual(v.bytes);
    const client = new SlotTable();
    client.assign(7, 1, ENTITY_KIND_AVATAR);
    const view = new FrameView();
    expect(new FrameReader().decode(w.buffer.subarray(0, w.length), view, client, PLOTS)).toBe(FRAME_OK);
    expect(view.entityCount).toBe(1);
    expect(view.entities[0]!.px).toBe(v.payload.position.x);
    expect(view.entities[0]!.yawCode).toBe(300);
    expect(view.entities[0]!.pitchCode).toBe(40);
  });
});

// ---- random round trip ------------------------------------------------------------------------------------------

function expectEntity(got: EntityState, want: EntityState, kind: number): void {
  expect(got.slot).toBe(want.slot);
  // positions: quantized to the 6.25 mm grid
  expect(got.px).toBe(posOthersFromSteps(posOthersToSteps(want.px)));
  expect(got.py).toBe(posOthersFromSteps(posOthersToSteps(want.py)));
  expect(got.pz).toBe(posOthersFromSteps(posOthersToSteps(want.pz)));
  if (kind === ENTITY_KIND_AVATAR) {
    for (const k of ["yawCode", "pitchCode", "actionState", "toolIndex", "flags"] as const)
      expect(got[k]).toBe(want[k]);
  } else if (kind === ENTITY_KIND_VEHICLE) {
    for (const k of [
      "orientIndex",
      "orientA",
      "orientB",
      "orientC",
      "steerCode",
      "speedCode",
      "driverSlot",
      "flags",
    ] as const) {
      expect(got[k]).toBe(want[k]);
    }
  } else {
    for (const k of ["headingCode", "robotState", "cargo"] as const) expect(got[k]).toBe(want[k]);
  }
}

describe("FRAME round trip (seeded property test)", () => {
  it("encodes then decodes keyframes and delta frames bit-exactly, tables stay in lock-step", () => {
    const writer = new FrameWriter();
    const reader = new FrameReader();
    const view = new FrameView();
    let deltaRecords = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const server = new SlotTable();
      const client = new SlotTable();
      const kinds = [] as number[];
      const nEntities = randInt(r, 1, 20);
      let state: EntityState[] = [];
      // frame 1: keyframe with all assignments and FULL records
      const frameTick = randInt(r, 1000, 0xfffffff0);
      writer.begin(frameTick, randInt(r, 0, 65535), randInt(r, 0, 4), true);
      const self = randomSelf(r);
      expect(writer.writeSelf(self)).toBe(true);
      for (let i = 0; i < nEntities; i++) {
        const kind = randInt(r, 0, 2);
        kinds.push(kind);
        expect(writer.slotAssign(server, i * 3, 1000 + i, kind)).toBe(true);
      }
      for (let i = 0; i < nEntities; i++) {
        const e = randomEntity(r, i * 3, kinds[i]!, REC_FULL);
        state.push(e);
        expect(writer.writeEntity(server, e)).toBe(true);
      }
      const strokes = new StrokeChainBuffer(8, 32);
      const nChains = randInt(r, 0, 4);
      for (let c = 0; c < nChains; c++) {
        strokes.addChain(
          randInt(r, 0, PLOTS - 1),
          randInt(r, -32768, 32767),
          randInt(r, -32768, 32767),
          randInt(r, -32768, 32767),
          randInt(r, -32768, 32767),
          randInt(r, 1, 1023),
          randInt(r, 0, 255),
          randInt(r, 0, 63),
          randInt(r, 0, 15),
          frameTick - randInt(r, 0, 255),
          randInt(r, 0, 65535),
        );
        for (let k = randInt(r, 0, 3); k > 0; k--)
          strokes.addContinuation(randInt(r, -4096, 4095), randInt(r, -4096, 4095));
      }
      const robots = new RobotIntentList();
      for (let k = randInt(r, 0, 2); k > 0; k--) {
        const i = robots.count++;
        robots.robotId[i] = randInt(r, 0, 65535);
        robots.plotId[i] = randInt(r, 0, PLOTS - 1);
        robots.startTick[i] = randInt(r, 0, 0xffffffff);
        robots.widthCm[i] = randInt(r, 1, 1023);
        robots.depth16[i] = randInt(r, 0, 255);
        robots.speedCmPerS[i] = randInt(r, 1, 1023);
        robots.laneMaskLow[i] = randInt(r, 0, 0xffffffff);
        robots.laneMaskHigh[i] = randInt(r, 0, 0xffffffff);
      }
      const plots = new DustPlotDeltaList();
      for (let k = randInt(r, 0, 20); k > 0; k--) {
        const i = plots.count++;
        plots.plotId[i] = randInt(r, 0, PLOTS - 1);
        plots.state[i] = randInt(r, 0, 3);
        plots.remainingFrac[i] = randInt(r, 0, 255);
      }
      expect(writer.writeStrokes(strokes, 0, frameTick)).toBe(nChains);
      expect(writer.writeRobotIntents(robots, 0)).toBe(robots.count);
      expect(writer.writeDustPlots(plots, 0)).toBe(plots.count);
      const len = writer.finish();
      expect(len).toBeGreaterThan(FRAME_HEADER_BYTES);
      expect(len).toBeLessThanOrEqual(FRAME_MAX_BYTES);
      expect(reader.decode(writer.buffer.subarray(0, len), view, client, PLOTS)).toBe(FRAME_OK);
      expect(view.keyframe).toBe(true);
      expect(view.self.cellGrams).toBe(self.cellGrams);
      expect(view.self.px).toBe(posOwnFromSteps(posOwnToSteps(self.px)));
      expect(view.self.yawCode).toBe(self.yawCode);
      expect(view.entityCount).toBe(nEntities);
      for (let i = 0; i < nEntities; i++) expectEntity(view.entities[i]!, state[i]!, kinds[i]!);
      expect(view.strokes.chainCount).toBe(nChains);
      for (let c = 0; c < nChains; c++) {
        expect(view.strokes.anchor[c]).toBe(strokes.anchor[c]);
        expect(view.strokes.endVMm[c]).toBe(strokes.endVMm[c]);
        expect(view.strokes.contCount[c]).toBe(strokes.contCount[c]);
        expect(view.strokes.tick[c]).toBe(strokes.tick[c]);
      }
      expect(view.robotIntents.count).toBe(robots.count);
      for (let k = 0; k < robots.count; k++) {
        expect(view.robotIntents.laneMaskHigh[k]).toBe(robots.laneMaskHigh[k]);
        expect(view.robotIntents.startTick[k]).toBe(robots.startTick[k]);
      }
      expect(view.dustPlots.count).toBe(plots.count);
      for (let k = 0; k < plots.count; k++) {
        expect(view.dustPlots.plotId[k]).toBe(plots.plotId[k]);
        expect(view.dustPlots.remainingFrac[k]).toBe(plots.remainingFrac[k]);
      }
      // frame 2..4: delta records with mixed classes, remove for one slot
      for (let f = 0; f < 3; f++) {
        writer.begin(100 + f, 1, 1, false);
        writer.writeSelf(randomSelf(r));
        const next: EntityState[] = [];
        for (let i = 0; i < nEntities; i++) {
          const e = randomEntity(r, i * 3, kinds[i]!, REC_DELTA, state[i]);
          next.push(e);
          expect(writer.writeEntity(server, e)).toBe(true);
        }
        const n2 = writer.finish();
        expect(reader.decode(writer.buffer.subarray(0, n2), view, client, PLOTS)).toBe(FRAME_OK);
        for (let i = 0; i < nEntities; i++) {
          expectEntity(view.entities[i]!, next[i]!, kinds[i]!);
          if (view.entities[i]!.rec === REC_DELTA) deltaRecords++;
        }
        state = next;
        for (let s = 0; s < 255; s++) {
          expect(client.stepsX[s]).toBe(server.stepsX[s]);
          expect(client.stepsY[s]).toBe(server.stepsY[s]);
          expect(client.stepsZ[s]).toBe(server.stepsZ[s]);
        }
      }
      // remove + release
      writer.begin(200, 1, 1, false);
      writer.writeSelf(randomSelf(r));
      writer.slotRelease(server, 0);
      const rm = createEntityState();
      rm.slot = 3 < nEntities * 3 && nEntities > 1 ? 3 : 0;
      if (nEntities > 1) {
        rm.rec = REC_REMOVE;
        expect(writer.writeEntity(server, rm)).toBe(true);
      }
      const n3 = writer.finish();
      expect(reader.decode(writer.buffer.subarray(0, n3), view, client, PLOTS)).toBe(FRAME_OK);
      expect(client.kind[0]).toBe(-1);
      if (nEntities > 1) expect(view.entities[0]!.rec).toBe(REC_REMOVE);
    }
    expect(deltaRecords).toBeGreaterThan(300);
  });

  it("a delta for a slot that still needs its keyframe is written FULL", () => {
    const table = new SlotTable();
    const w = new FrameWriter();
    w.begin(0, 0, 0, false);
    w.writeSelf(createSelfState());
    w.slotAssign(table, 1, 5, ENTITY_KIND_ROBOT);
    const e = createEntityState();
    e.slot = 1;
    e.rec = REC_DELTA;
    e.px = 1;
    w.writeEntity(table, e);
    w.finish();
    const view = new FrameView();
    const client = new SlotTable();
    expect(new FrameReader().decode(w.buffer.subarray(0, w.length), view, client, PLOTS)).toBe(FRAME_OK);
    expect(view.entities[0]!.rec).toBe(REC_FULL);
    expect(view.entities[0]!.px).toBe(1);
  });

  it("spills whole records when the 1,000 byte cap is reached and writes them next frame", () => {
    const table = new SlotTable();
    const w = new FrameWriter();
    w.begin(0, 0, 0, true);
    w.writeSelf(createSelfState());
    for (let s = 0; s < 60; s++) w.slotAssign(table, s, s + 1, ENTITY_KIND_AVATAR);
    let written = 0;
    const e = createEntityState();
    for (let s = 0; s < 60; s++) {
      e.slot = s;
      e.rec = REC_FULL;
      e.px = s;
      if (w.writeEntity(table, e)) written++;
      else break;
    }
    const len = w.finish();
    expect(len).toBeLessThanOrEqual(FRAME_MAX_BYTES);
    expect(written).toBeGreaterThan(20);
    expect(written).toBeLessThan(60);
    // the rest still needs a FULL record
    expect(table.needsFull[written]).toBe(1);
    expect(table.needsFull[written - 1]).toBe(0);
    const client = new SlotTable();
    const view = new FrameView();
    expect(new FrameReader().decode(w.buffer.subarray(0, len), view, client, PLOTS)).toBe(FRAME_OK);
    expect(view.entityCount).toBe(written);
  });
});

describe("FRAME decoder hardening", () => {
  function sample(): Uint8Array {
    const r = rng(99);
    const w = new FrameWriter();
    const server = new SlotTable();
    w.begin(77, 5, 2, true);
    w.writeSelf(randomSelf(r));
    w.slotAssign(server, 0, 1, ENTITY_KIND_AVATAR);
    w.slotAssign(server, 1, 2, ENTITY_KIND_VEHICLE);
    w.slotAssign(server, 2, 3, ENTITY_KIND_ROBOT);
    for (let i = 0; i < 3; i++) w.writeEntity(server, randomEntity(r, i, i, REC_FULL));
    const strokes = new StrokeChainBuffer(4, 8);
    strokes.addChain(10, 1, 2, 3, 4, 20, 80, 1, 0, 70, 9);
    strokes.addContinuation(5, -5);
    w.writeStrokes(strokes, 0, 77);
    const plots = new DustPlotDeltaList();
    plots.count = 1;
    plots.plotId[0] = 7;
    plots.state[0] = 1;
    plots.remainingFrac[0] = 200;
    w.writeDustPlots(plots, 0);
    w.finish();
    return w.buffer.slice(0, w.length);
  }

  function freshClient(): SlotTable {
    return new SlotTable();
  }

  it("rejects every truncation without throwing", () => {
    const msg = sample();
    const reader = new FrameReader();
    const view = new FrameView();
    expect(reader.decode(msg, view, freshClient(), PLOTS)).toBe(FRAME_OK);
    for (let n = 0; n < msg.length; n++) {
      expect(reader.decode(msg.subarray(0, n), view, freshClient(), PLOTS)).not.toBe(FRAME_OK);
    }
    expect(reader.decode(msg.subarray(0, 3), view, freshClient(), PLOTS)).toBe(FRAME_ERR_TRUNCATED);
  });

  it("rejects trailing bytes, wrong type, reserved flag and oversize", () => {
    const msg = sample();
    const reader = new FrameReader();
    const view = new FrameView();
    const longer = new Uint8Array(msg.length + 1);
    longer.set(msg);
    expect(reader.decode(longer, view, freshClient(), PLOTS)).not.toBe(FRAME_OK);
    const wrong = msg.slice();
    wrong[0] = 0x21;
    expect(reader.decode(wrong, view, freshClient(), PLOTS)).not.toBe(FRAME_OK);
    const flagged = msg.slice();
    flagged[8] = flagged[8]! | 0x80;
    expect(reader.decode(flagged, view, freshClient(), PLOTS)).not.toBe(FRAME_OK);
    expect(reader.decode(new Uint8Array(FRAME_MAX_BYTES + 1), view, freshClient(), PLOTS)).not.toBe(FRAME_OK);
  });

  it("survives 20,000 corrupted frames and random garbage (never throws, counts stay in capacity)", () => {
    const msg = sample();
    const reader = new FrameReader();
    const view = new FrameView();
    const r = rng(1234);
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      const m = msg.slice();
      const flips = randInt(r, 1, 4);
      for (let k = 0; k < flips; k++) m[randInt(r, 0, m.length - 1)] = randInt(r, 0, 255);
      const status = reader.decode(m, view, freshClient(), PLOTS);
      if (status === FRAME_OK) accepted++;
      expect(view.entityCount).toBeLessThanOrEqual(view.entities.length);
      expect(view.strokes.chainCount).toBeLessThanOrEqual(view.strokes.maxChains);
      expect(view.dustPlots.count).toBeLessThanOrEqual(250);
    }
    expect(accepted).toBeLessThan(ALLOC_BUDGET_BYTES);
    for (let i = 0; i < 5000; i++) {
      const g = new Uint8Array(randInt(r, 0, 1100));
      for (let k = 0; k < g.length; k++) g[k] = randInt(r, 0, 255);
      if (g.length > 0 && r() < 0.7) g[0] = 0x20;
      reader.decode(g, view, freshClient(), PLOTS);
    }
  });

  it("rejects plot ids at or above plotCount and a record for an unassigned slot", () => {
    const msg = sample();
    const reader = new FrameReader();
    const view = new FrameView();
    expect(reader.decode(msg, view, freshClient(), 5)).not.toBe(FRAME_OK);
    // entities only, no slot table: slot unknown
    const w = new FrameWriter();
    const server = new SlotTable();
    server.assign(4, 1, ENTITY_KIND_AVATAR);
    w.begin(0, 0, 0, false);
    w.writeSelf(createSelfState());
    w.writeEntity(server, { ...createEntityState(), slot: 4, rec: REC_FULL });
    w.finish();
    expect(reader.decode(w.buffer.subarray(0, w.length), view, freshClient(), PLOTS)).not.toBe(FRAME_OK);
  });
});

describe("FRAME zero allocation", () => {
  it("encodes and decodes a busy frame without allocating", () => {
    const r = rng(7);
    const w = new FrameWriter();
    const server = new SlotTable();
    const client = new SlotTable();
    const reader = new FrameReader();
    const view = new FrameView();
    const self = randomSelf(r);
    self.moveState = 3;
    const ents: EntityState[] = [];
    w.begin(1, 1, 1, true);
    w.writeSelf(self);
    for (let i = 0; i < 12; i++) w.slotAssign(server, i, i + 1, i % 3);
    for (let i = 0; i < 12; i++) {
      const e = randomEntity(r, i, i % 3, REC_FULL);
      ents.push(e);
      w.writeEntity(server, e);
    }
    w.finish();
    expect(reader.decode(w.buffer.subarray(0, w.length), view, client, PLOTS)).toBe(FRAME_OK);
    const strokes = new StrokeChainBuffer(4, 16);
    strokes.addChain(10, 1, 2, 3, 4, 20, 80, 1, 0, 70, 9);
    strokes.addContinuation(5, -5);
    strokes.addContinuation(6, -6);
    const plots = new DustPlotDeltaList();
    plots.count = 5;
    let tick = 2;
    const encode = (): void => {
      w.begin(tick++, 3, 2, false);
      w.writeSelf(self);
      for (let i = 0; i < 12; i++) {
        const e = ents[i]!;
        e.rec = REC_DELTA;
        e.px += 0.01;
        w.writeEntity(server, e);
      }
      w.writeStrokes(strokes, 0, tick);
      w.writeDustPlots(plots, 0);
      w.finish();
    };
    encode();
    const wire = new Uint8Array(w.buffer.subarray(0, w.length)); // a stable exact-length message (copied once)
    expect(reader.decode(wire, view, client, PLOTS)).toBe(FRAME_OK);
    expect(allocatedBytes(encode)).toBeLessThan(ALLOC_BUDGET_BYTES);
    expect(allocatedBytes(() => reader.decode(wire, view, client, PLOTS))).toBeLessThan(ALLOC_BUDGET_BYTES);
    // a non-zero byteOffset view (what a transport may hand over) must not allocate either
    const padded = new Uint8Array(wire.length + 8);
    padded.set(wire, 8);
    const offsetView = padded.subarray(8);
    expect(allocatedBytes(() => reader.decode(offsetView, view, client, PLOTS))).toBeLessThan(ALLOC_BUDGET_BYTES);
  }, 60_000);
});
