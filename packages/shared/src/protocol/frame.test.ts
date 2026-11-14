import { describe, expect, it } from "vitest";
import {
  AVATAR_BODY_FIELDS,
  AVATAR_FULL_FIELDS,
  DUST_PAYLOAD_BINDINGS,
  EntityRecordSchema,
  FRAME_ENTITY_PREFIX_FIELDS,
  FRAME_FLAG_BIT,
  FRAME_HEADER_BYTES,
  FRAME_HEADER_LAYOUT,
  FRAME_SECTIONS,
  FRAME_SELF_DRIVER_MOVE_STATE,
  FRAME_SELF_FIELDS,
  FRAME_SELF_VEHICLE_FIELDS,
  FRAME_SLOT_CHANGE_FIELDS,
  FRAME_TYPE_ID,
  FrameEventSchema,
  FramePayloadSchema,
  FrameSelfSchema,
  ROBOT_FULL_FIELDS,
  SlotChangeSchema,
  VEHICLE_FULL_FIELDS,
  type FieldSpec,
} from "./frame";
import { QUANT } from "./channels";
import {
  FRAME_ENTITY_AVATAR_FULL_GOLDEN_VECTORS,
  FRAME_HEADER_GOLDEN_VECTORS,
  FRAME_SELF_DRIVING_GOLDEN_VECTORS,
  FRAME_SELF_ON_FOOT_GOLDEN_VECTORS,
  FRAME_SLOT_CHANGE_GOLDEN_VECTORS,
} from "./vectors";
import { MESSAGE_CATALOG } from "./messages";
import { ENTITY_KINDS, MOVE_STATES } from "../sim/components";

const bits = (fields: readonly FieldSpec[]) => fields.reduce((sum, f) => sum + f.bits, 0);
const bytes = (nbits: number) => Math.ceil(nbits / 8);

/** Reference writer of BIT_PACKING (LSB-first little-endian bit stream). Test-only; the real codec is packages/protocol. */
function pack(fields: readonly FieldSpec[], values: readonly number[]): number[] {
  expect(values).toHaveLength(fields.length);
  let acc = 0n;
  let pos = 0n;
  fields.forEach((field, i) => {
    const raw = BigInt(values[i] ?? 0);
    const mask = (1n << BigInt(field.bits)) - 1n;
    if (field.signed === true) {
      expect(raw >= -(1n << BigInt(field.bits - 1)) && raw < 1n << BigInt(field.bits - 1), field.name).toBe(true);
    } else {
      expect(raw >= 0n && raw <= mask, field.name).toBe(true);
    }
    acc |= (raw & mask) << pos;
    pos += BigInt(field.bits);
  });
  const out: number[] = [];
  for (let i = 0; i < bytes(Number(pos)); i++) out.push(Number((acc >> BigInt(8 * i)) & 0xffn));
  return out;
}

/** Reference reader: returns the field values in table order. Rejects non-zero padding. */
function unpack(fields: readonly FieldSpec[], data: readonly number[]): number[] {
  let acc = 0n;
  data.forEach((byte, i) => {
    acc |= BigInt(byte) << BigInt(8 * i);
  });
  const total = bits(fields);
  expect(data).toHaveLength(bytes(total));
  expect(acc >> BigInt(total), "padding bits are zero").toBe(0n);
  let pos = 0n;
  return fields.map((field) => {
    const width = BigInt(field.bits);
    let value = (acc >> pos) & ((1n << width) - 1n);
    pos += width;
    if (field.signed === true && value >= 1n << (width - 1n)) value -= 1n << width;
    return Number(value);
  });
}

const q = (value: number, resolution: number) => Math.round(value / resolution);

describe("FRAME header and sections", () => {
  it("is 9 bytes with the netcode field offsets", () => {
    expect(FRAME_TYPE_ID).toBe(MESSAGE_CATALOG.FRAME.id);
    expect(FRAME_HEADER_BYTES).toBe(9);
    expect(FRAME_HEADER_LAYOUT.flags.offset).toBe(8);
    expect(FRAME_HEADER_LAYOUT.serverTick.offset).toBe(1);
  });

  it("has seven distinct flag bits in the netcode order and a reserved bit 7", () => {
    expect(Object.keys(FRAME_FLAG_BIT)).toEqual([
      "keyframe",
      "hasSlotChanges",
      "hasEntities",
      "hasStrokes",
      "hasRobotIntents",
      "hasDustPlots",
      "hasEvents",
    ]);
    expect(Object.values(FRAME_FLAG_BIT)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("orders sections as netcode 4.2 and ties each to a flag", () => {
    expect(FRAME_SECTIONS.map((s) => s.name)).toEqual([
      "self",
      "slotChanges",
      "entities",
      "dustStrokes",
      "robotIntents",
      "dustPlots",
      "events",
    ]);
    for (const section of FRAME_SECTIONS) {
      if (section.flag !== null) expect(Object.keys(FRAME_FLAG_BIT)).toContain(section.flag);
    }
  });

  it("matches the header golden vectors", () => {
    for (const vector of FRAME_HEADER_GOLDEN_VECTORS) {
      expect(vector.bytes).toHaveLength(FRAME_HEADER_BYTES);
      expect(vector.bytes[0]).toBe(FRAME_TYPE_ID);
      const flags = vector.bytes[8] ?? 0;
      const names = (Object.keys(FRAME_FLAG_BIT) as (keyof typeof FRAME_FLAG_BIT)[]).filter(
        (name) => (flags & (1 << FRAME_FLAG_BIT[name])) !== 0,
      );
      expect(names).toEqual(vector.payload.flags.slice().sort((a, b) => FRAME_FLAG_BIT[a] - FRAME_FLAG_BIT[b]));
      expect(flags & 0x80).toBe(0);
      const tick =
        (vector.bytes[1] ?? 0) |
        ((vector.bytes[2] ?? 0) << 8) |
        ((vector.bytes[3] ?? 0) << 16) |
        ((vector.bytes[4] ?? 0) * 2 ** 24);
      expect(tick).toBe(vector.payload.serverTick);
      expect((vector.bytes[5] ?? 0) | ((vector.bytes[6] ?? 0) << 8)).toBe(vector.payload.ackInputSeq);
      expect(vector.bytes[7]).toBe(vector.payload.inputBufferDepth);
    }
  });
});

describe("record sizes", () => {
  it("Self on foot is 162 bits, 21 B; driving is 389 bits, 49 B", () => {
    expect(bits(FRAME_SELF_FIELDS)).toBe(162);
    expect(bytes(bits(FRAME_SELF_FIELDS))).toBe(21);
    const driving = bits(FRAME_SELF_FIELDS) + bits(FRAME_SELF_VEHICLE_FIELDS);
    expect(driving).toBe(389);
    expect(bytes(driving)).toBe(49);
  });

  it("Self driver move state is seated_driver", () => {
    expect(MOVE_STATES[FRAME_SELF_DRIVER_MOVE_STATE]).toBe("seated_driver");
  });

  it("entity records with prefix: avatar 13 B, vehicle 17 B, robot 11 B; slot change 6 B", () => {
    const prefix = bits(FRAME_ENTITY_PREFIX_FIELDS);
    expect(bytes(prefix + bits(AVATAR_FULL_FIELDS))).toBe(13);
    expect(bytes(prefix + bits(VEHICLE_FULL_FIELDS))).toBe(17);
    expect(bytes(prefix + bits(ROBOT_FULL_FIELDS))).toBe(11);
    expect(bytes(bits(FRAME_SLOT_CHANGE_FIELDS))).toBe(6);
    expect(bits(AVATAR_BODY_FIELDS)).toBe(32);
  });

  it("position-others quantization covers its stated range", () => {
    const { bits: b, resolutionM, rangeM } = QUANT.positionOthers;
    expect(2 ** (b - 1) * resolutionM).toBeCloseTo(rangeM, 6);
    const own = QUANT.positionOwn;
    expect(2 ** (own.bits - 1) * own.resolutionM).toBe(own.rangeM);
    expect(2 ** (QUANT.velocityOwn.bits - 1) * QUANT.velocityOwn.resolutionMps).toBe(QUANT.velocityOwn.rangeMps);
    expect(QUANT.yaw.steps).toBe(2 ** QUANT.yaw.bits);
    expect(QUANT.pitch.steps).toBe(2 ** QUANT.pitch.bits);
  });
});

describe("golden vectors reproduce through the reference bit packer", () => {
  it("Self on foot", () => {
    for (const { payload: p, bytes: expected } of FRAME_SELF_ON_FOOT_GOLDEN_VECTORS) {
      const values = [
        MOVE_STATES.indexOf(p.moveState),
        p.hopCharges,
        q(p.position.x, QUANT.positionOwn.resolutionM),
        q(p.position.y, QUANT.positionOwn.resolutionM),
        q(p.position.z, QUANT.positionOwn.resolutionM),
        q(p.velocity.x, QUANT.velocityOwn.resolutionMps),
        q(p.velocity.y, QUANT.velocityOwn.resolutionMps),
        q(p.velocity.z, QUANT.velocityOwn.resolutionMps),
        p.yawCode,
        p.cellGrams,
      ];
      expect(pack(FRAME_SELF_FIELDS, values)).toEqual(expected);
      expect(unpack(FRAME_SELF_FIELDS, expected)).toEqual(values);
      expect(FrameSelfSchema.parse(p)).toEqual(p);
      expect(expected).toHaveLength(21);
    }
  });

  it("Self driving", () => {
    const fields = [...FRAME_SELF_FIELDS, ...FRAME_SELF_VEHICLE_FIELDS];
    for (const { payload: p, bytes: expected } of FRAME_SELF_DRIVING_GOLDEN_VECTORS) {
      const v = p.vehicle;
      expect(v).toBeDefined();
      if (v === undefined) continue;
      const own = QUANT.positionOwn.resolutionM;
      const vel = QUANT.velocityOwn.resolutionMps;
      const gear = ["neutral", "drive", "reverse", "locked"].indexOf(v.gear);
      const values = [
        MOVE_STATES.indexOf(p.moveState),
        p.hopCharges,
        q(p.position.x, own),
        q(p.position.y, own),
        q(p.position.z, own),
        q(p.velocity.x, vel),
        q(p.velocity.y, vel),
        q(p.velocity.z, vel),
        p.yawCode,
        p.cellGrams,
        q(v.position.x, own),
        q(v.position.y, own),
        q(v.position.z, own),
        v.orientIndex,
        ...v.orient,
        q(v.linearVelocity.x, vel),
        q(v.linearVelocity.y, vel),
        q(v.linearVelocity.z, vel),
        q(v.angularVelocity.x, vel),
        q(v.angularVelocity.y, vel),
        q(v.angularVelocity.z, vel),
        v.steer,
        gear | ((v.boost ? 1 : 0) << 2) | ((v.lights ? 1 : 0) << 3),
      ];
      expect(pack(fields, values)).toEqual(expected);
      expect(unpack(fields, expected)).toEqual(values);
      expect(FrameSelfSchema.parse(p)).toEqual(p);
      expect(MOVE_STATES.indexOf(p.moveState)).toBe(FRAME_SELF_DRIVER_MOVE_STATE);
      expect(expected).toHaveLength(49);
    }
  });

  it("FULL avatar record with prefix", () => {
    const fields = [...FRAME_ENTITY_PREFIX_FIELDS, ...AVATAR_FULL_FIELDS];
    for (const { payload: p, bytes: expected } of FRAME_ENTITY_AVATAR_FULL_GOLDEN_VECTORS) {
      if (p.rec !== "full" || p.body.kind !== "avatar") throw new Error("vector shape");
      const r = QUANT.positionOthers.resolutionM;
      const values = [
        p.slot,
        0,
        q(p.position.x, r),
        q(p.position.y, r),
        q(p.position.z, r),
        p.body.yawCode,
        p.body.pitchCode,
        p.body.actionState,
        p.body.toolIndex,
        p.body.flags,
      ];
      expect(pack(fields, values)).toEqual(expected);
      expect(unpack(fields, expected)).toEqual(values);
      expect(EntityRecordSchema.parse(p)).toEqual(p);
      expect(expected).toHaveLength(13);
    }
  });

  it("slot change", () => {
    for (const { payload: p, bytes: expected } of FRAME_SLOT_CHANGE_GOLDEN_VECTORS) {
      if (p.op !== "assign") throw new Error("vector shape");
      const values = [p.slot, 1, p.entityId, ENTITY_KINDS.indexOf(p.kind)];
      expect(pack(FRAME_SLOT_CHANGE_FIELDS, values)).toEqual(expected);
      expect(unpack(FRAME_SLOT_CHANGE_FIELDS, expected)).toEqual(values);
      expect(SlotChangeSchema.parse(p)).toEqual(p);
    }
  });

  it("the reference reader rejects non-zero padding", () => {
    const bad = [...(FRAME_SELF_ON_FOOT_GOLDEN_VECTORS[0]?.bytes ?? [])];
    bad[20] = 0xff;
    expect(() => unpack(FRAME_SELF_FIELDS, bad)).toThrow();
  });
});

describe("decoded schemas", () => {
  const self = FRAME_SELF_ON_FOOT_GOLDEN_VECTORS[0]?.payload;
  if (self === undefined) throw new Error("vector");

  it("accepts a minimal frame and a frame with every section", () => {
    const minimal = { serverTick: 10, ackInputSeq: 3, inputBufferDepth: 1, keyframe: true, self };
    expect(FramePayloadSchema.parse(minimal)).toEqual(minimal);
    const full = {
      ...minimal,
      slotChanges: [FRAME_SLOT_CHANGE_GOLDEN_VECTORS[0]?.payload],
      entities: [FRAME_ENTITY_AVATAR_FULL_GOLDEN_VECTORS[0]?.payload, { slot: 9, rec: "remove" }],
      dustStrokes: { chains: [] },
      robotIntents: [],
      dustPlots: { deltas: [] },
      events: [{ kind: "machine_state", structureId: 1, state: 2 }],
    };
    expect(FramePayloadSchema.safeParse(full).success).toBe(true);
  });

  it("rejects out-of-range fields", () => {
    expect(FrameSelfSchema.safeParse({ ...self, hopCharges: 8 }).success).toBe(false);
    expect(FrameSelfSchema.safeParse({ ...self, yawCode: 1024 }).success).toBe(false);
    expect(FrameSelfSchema.safeParse({ ...self, cellGrams: 2 ** 24 }).success).toBe(false);
    expect(FrameSelfSchema.safeParse({ ...self, position: { x: 5000, y: 0, z: 0 } }).success).toBe(false);
    expect(SlotChangeSchema.safeParse({ op: "assign", slot: 255, entityId: 1, kind: "avatar" }).success).toBe(false);
    expect(EntityRecordSchema.safeParse({ slot: 1, rec: "bogus" }).success).toBe(false);
    expect(FrameEventSchema.safeParse({ kind: "machine_state", structureId: 1, state: 9 }).success).toBe(false);
    expect(
      FramePayloadSchema.safeParse({ serverTick: -1, ackInputSeq: 0, inputBufferDepth: 0, keyframe: false, self })
        .success,
    ).toBe(false);
  });
});

describe("dust bindings", () => {
  it("point at existing FRAME sections or catalog messages", () => {
    const sections = FRAME_SECTIONS.map((s) => s.name) as string[];
    for (const [, binding] of Object.entries(DUST_PAYLOAD_BINDINGS)) {
      if ("frameSection" in binding) expect(sections).toContain(binding.frameSection);
      else expect(Object.keys(MESSAGE_CATALOG)).toContain(binding.message);
    }
    expect(Object.keys(DUST_PAYLOAD_BINDINGS)).toHaveLength(10);
  });
});
