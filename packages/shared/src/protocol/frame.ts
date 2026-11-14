// @contract protocol/frame v1
// @consumers packages/protocol (FRAME / Self / entity / slot-change codecs and golden vectors), apps/server/src/net
//   (frame assembly, interest, slot tables), apps/client/src/net and apps/client/src/sim-host (one decode path for
//   both hosts, ADR-0031), apps/client/src/gameplay (reconciler reads Self), tools/bots
//
// The `FRAME` bytes message (id 0x20): header, Self, SlotChanges, Entities and the dust sections. Specification:
// netcode.md section 4.2 and 4.5, 5, 7; world-and-dust-simulation.md section 5.1 (dust section contents and bit widths,
// bound here to FRAME sections; they are NOT redefined: the payload schemas are world/dust.ts and world/stroke.ts).
//
// Section framing (v1 decision [R], not in the netcode tables): after the 9-byte header and the Self section, every
// section present (flag set) is `u16 byteLength (little-endian, excludes the prefix)` + body, in FRAME_SECTIONS order,
// so a decoder can skip a section it does not know. Self has no prefix (always present, size from its moveState).
// Bit packing: see BIT_PACKING in ./channels. A message never exceeds FRAME_MAX_BYTES.
//
// Decoded values: positions are metres (`q * resolution`, QUANT); angles, state ids and gauges stay as the integer
// codes of their wire field (`yawCode`, `pitchCode`, ...) so two hosts compare bit for bit.

import { z } from "zod";
import {
  DustPlotsPayloadSchema,
  DustStrokesPayloadSchema,
  PlotIdWireSchema,
  RobotPlotIntentSchema,
  DUST_ACK_GRAMS_MAX,
} from "../world";
import { AVATAR_ACTION_STATES, ENTITY_KINDS, MOVE_STATES, ROBOT_UI_STATES, VEHICLE_GEARS } from "../sim/components";
import { QUANT } from "./channels";

/** Message type id of FRAME (also in MESSAGE_CATALOG). */
export const FRAME_TYPE_ID = 0x20;
/** Header: type u8, serverTick u32, ackInputSeq u16, inputBufferDepth u8, flags u8. */
export const FRAME_HEADER_BYTES = 9;
/** Largest FRAME in bytes; excess FULL entity records spill to the next frame (netcode.md section 4.2). */
export const FRAME_MAX_BYTES = 1000;
/** Byte length prefix of every section after Self. */
export const FRAME_SECTION_LENGTH_BYTES = 2;

/** Byte offsets of the header fields. */
export const FRAME_HEADER_LAYOUT = {
  type: { offset: 0, type: "u8" },
  serverTick: { offset: 1, type: "u32" },
  ackInputSeq: { offset: 5, type: "u16" },
  inputBufferDepth: { offset: 7, type: "u8" },
  flags: { offset: 8, type: "u8" },
} as const;

/** `flags` bits. Bit 7 is reserved and must be 0. */
export const FRAME_FLAG_BIT = {
  keyframe: 0,
  hasSlotChanges: 1,
  hasEntities: 2,
  hasStrokes: 3,
  hasRobotIntents: 4,
  hasDustPlots: 5,
  hasEvents: 6,
} as const;
export type FrameFlag = keyof typeof FRAME_FLAG_BIT;

/** Sections in wire order; `self` is always present, the others when their flag is set. */
export const FRAME_SECTIONS = [
  { name: "self", flag: null },
  { name: "slotChanges", flag: "hasSlotChanges" },
  { name: "entities", flag: "hasEntities" },
  { name: "dustStrokes", flag: "hasStrokes" },
  { name: "robotIntents", flag: "hasRobotIntents" },
  { name: "dustPlots", flag: "hasDustPlots" },
  { name: "events", flag: "hasEvents" },
] as const;
export type FrameSectionName = (typeof FRAME_SECTIONS)[number]["name"];

// ---- Field tables -------------------------------------------------------------------------------------------------

/** One bit-packed field: width in bits, signedness. Fields are written in table order (BIT_PACKING). */
export interface FieldSpec {
  readonly name: string;
  readonly bits: number;
  readonly signed?: boolean;
}

const pos = (prefix: string, bits: number): readonly FieldSpec[] =>
  (["x", "y", "z"] as const).map((axis) => ({ name: `${prefix}${axis.toUpperCase()}`, bits, signed: true }));

/**
 * Self section, on foot: own avatar for reconciliation. The Dust Cell field is `dust.ack` (WDS section 5.1, u24 grams;
 * [R] netcode.md wrote u16 at 0.1 kg, so Self is 21 B instead of 20 B). 162 bits = 21 B.
 */
export const FRAME_SELF_FIELDS: readonly FieldSpec[] = [
  { name: "moveState", bits: 5 },
  { name: "hopCharges", bits: 3 },
  ...pos("position", QUANT.positionOwn.bits),
  ...pos("velocity", QUANT.velocityOwn.bits),
  { name: "yawCode", bits: QUANT.yaw.bits },
  { name: "cellGrams", bits: 24 },
];

/**
 * Self section, driving (appended to FRAME_SELF_FIELDS in the same bit stream when `moveState` is `seated_driver`):
 * 389 bits in total = 49 B ([R] netcode.md estimates 52 B).
 */
export const FRAME_SELF_VEHICLE_FIELDS: readonly FieldSpec[] = [
  ...pos("vehiclePosition", QUANT.positionOwn.bits),
  { name: "vehicleOrientIndex", bits: QUANT.vehicleOrientationOwn.indexBits },
  { name: "vehicleOrientA", bits: QUANT.vehicleOrientationOwn.componentBits, signed: true },
  { name: "vehicleOrientB", bits: QUANT.vehicleOrientationOwn.componentBits, signed: true },
  { name: "vehicleOrientC", bits: QUANT.vehicleOrientationOwn.componentBits, signed: true },
  ...pos("vehicleLinearVelocity", QUANT.velocityOwn.bits),
  ...pos("vehicleAngularVelocity", QUANT.velocityOwn.bits),
  { name: "steer", bits: 8, signed: true },
  /** gear 2 bits (VEHICLE_GEARS), boost 1, lights 1, packed in this order from the low bit. */
  { name: "gearBoost", bits: 4 },
];

/** Index of `seated_driver` in MOVE_STATES: the Self vehicle block follows when `moveState` equals it. */
export const FRAME_SELF_DRIVER_MOVE_STATE = MOVE_STATES.indexOf("seated_driver");

/** SlotChanges record: `slot u8`, `op 1 bit` (1 assign, 0 release), `entityId u32`, `kind 3 bits` (0 on release). 44 bits = 6 B. */
export const FRAME_SLOT_CHANGE_FIELDS: readonly FieldSpec[] = [
  { name: "slot", bits: 8 },
  { name: "op", bits: 1 },
  { name: "entityId", bits: 32 },
  { name: "kind", bits: 3 },
];

/** Entity record prefix: `slot u8` + `recType 2 bits`. Unlisted slots are unchanged. */
export const FRAME_ENTITY_PREFIX_FIELDS: readonly FieldSpec[] = [
  { name: "slot", bits: 8 },
  { name: "recType", bits: 2 },
];
/** `recType` codes. */
export const ENTITY_REC_TYPES = ["full", "delta", "remove"] as const;
export type EntityRecType = (typeof ENTITY_REC_TYPES)[number];

/** Per-axis position delta: 2-bit class, then (per axis, in x y z order) `QUANT.positionDelta.classAxisBits[class]` bits. */
export const POSITION_DELTA_CLASS_BITS = QUANT.positionDelta.classBits;

/** Avatar record body after the prefix (FULL position = 3 x 20 bits; DELTA replaces it with the delta encoding). */
export const AVATAR_BODY_FIELDS: readonly FieldSpec[] = [
  { name: "yawCode", bits: QUANT.yaw.bits },
  /** 0 = -90 degrees, 63 = +90 degrees. */
  { name: "pitchCode", bits: QUANT.pitch.bits },
  { name: "actionState", bits: 6 },
  { name: "toolIndex", bits: 4 },
  /** AVATAR_FLAG_BIT. */
  { name: "flags", bits: 6 },
];
export const AVATAR_FULL_FIELDS: readonly FieldSpec[] = [
  ...pos("position", QUANT.positionOthers.bits),
  ...AVATAR_BODY_FIELDS,
];

/** Vehicle speed code: 0 .. 255 = 0 .. 63.75 m/s in 0.25 m/s steps. */
export const VEHICLE_SPEED_STEP_MPS = 0.25;
/** `driverSlot` value meaning "no driver". */
export const VEHICLE_NO_DRIVER = 255;
export const VEHICLE_BODY_FIELDS: readonly FieldSpec[] = [
  { name: "orientIndex", bits: QUANT.vehicleOrientation.indexBits },
  { name: "orientA", bits: QUANT.vehicleOrientation.componentBits, signed: true },
  { name: "orientB", bits: QUANT.vehicleOrientation.componentBits, signed: true },
  { name: "orientC", bits: QUANT.vehicleOrientation.componentBits, signed: true },
  { name: "steerCode", bits: 6, signed: true },
  { name: "speedCode", bits: 8 },
  { name: "driverSlot", bits: 8 },
  /** VEHICLE_FLAG_BIT: lights bit 0, boost bit 1, intake bit 2, hopper level bits 3..6. */
  { name: "flags", bits: 8 },
];
export const VEHICLE_FULL_FIELDS: readonly FieldSpec[] = [
  ...pos("position", QUANT.positionOthers.bits),
  ...VEHICLE_BODY_FIELDS,
];

export const ROBOT_BODY_FIELDS: readonly FieldSpec[] = [
  /** 0 .. 255 = 0 .. 2 pi. */
  { name: "headingCode", bits: 8 },
  { name: "state", bits: 4 },
  { name: "cargo", bits: 3 },
];
export const ROBOT_FULL_FIELDS: readonly FieldSpec[] = [
  ...pos("position", QUANT.positionOthers.bits),
  ...ROBOT_BODY_FIELDS,
];

// ---- Frame events (v1.0 compact events; the MVP server never sets hasEvents) --------------------------------------

/**
 * Compact FRAME events of netcode.md section 4.2. MVP sim events cross the wire in the `sim_events` control message
 * instead (see MESSAGE_CATALOG.SIM_EVENTS), so the `plot.polished` compact record of the netcode table is superseded
 * [R]. These kinds are reserved for rails, machines and structures (v1.0).
 */
export const FRAME_EVENT_KINDS = ["rail_puck", "machine_state", "structure"] as const;
export type FrameEventKind = (typeof FRAME_EVENT_KINDS)[number];

// ---- Decoded schemas ----------------------------------------------------------------------------------------------

const U8 = z.int().min(0).max(0xff);
const U16 = z.int().min(0).max(0xffff);
const U32 = z.int().min(0).max(0xffff_ffff);
const posRange = (range: number) => z.number().min(-range).max(range);
const Vec3Own = z.object({
  x: posRange(QUANT.positionOwn.rangeM),
  y: posRange(QUANT.positionOwn.rangeM),
  z: posRange(QUANT.positionOwn.rangeM),
});
const Vec3Others = z.object({
  x: posRange(QUANT.positionOthers.rangeM),
  y: posRange(QUANT.positionOthers.rangeM),
  z: posRange(QUANT.positionOthers.rangeM),
});
const VelocityVec = z.object({
  x: posRange(QUANT.velocityOwn.rangeMps),
  y: posRange(QUANT.velocityOwn.rangeMps),
  z: posRange(QUANT.velocityOwn.rangeMps),
});
const YawCode = z
  .int()
  .min(0)
  .max(QUANT.yaw.steps - 1);
const PitchCode = z
  .int()
  .min(0)
  .max(QUANT.pitch.steps - 1);

/** Vehicle part of Self (present only while driving). Orientation is the smallest-three code (15-bit components). */
export const SelfVehicleSchema = z.object({
  position: Vec3Own,
  orientIndex: z.int().min(0).max(3),
  orient: z.tuple([z.int().min(-16384).max(16383), z.int().min(-16384).max(16383), z.int().min(-16384).max(16383)]),
  linearVelocity: VelocityVec,
  angularVelocity: VelocityVec,
  steer: z.int().min(-128).max(127),
  gear: z.enum(VEHICLE_GEARS),
  boost: z.boolean(),
  lights: z.boolean(),
});

/** Self section: the receiving client's own avatar (and vehicle while driving). `cellGrams` is `dust.ack`. */
export const FrameSelfSchema = z.object({
  moveState: z.enum(MOVE_STATES),
  hopCharges: z.int().min(0).max(7),
  position: Vec3Own,
  velocity: VelocityVec,
  yawCode: YawCode,
  cellGrams: z.int().min(0).max(DUST_ACK_GRAMS_MAX),
  vehicle: SelfVehicleSchema.optional(),
});
export type FrameSelf = z.infer<typeof FrameSelfSchema>;

/** SlotChanges entry: assign a slot to an entity, or release it. */
export const SlotChangeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("assign"), slot: U8.max(254), entityId: U32, kind: z.enum(ENTITY_KINDS) }),
  z.object({ op: z.literal("release"), slot: U8.max(254) }),
]);
export type SlotChange = z.infer<typeof SlotChangeSchema>;

/** One axis of a DELTA position: class 0 unchanged, 1 and 2 relative steps, 3 absolute steps (6.25 mm units). */
export const PositionAxisDeltaSchema = z.discriminatedUnion("cls", [
  z.object({ cls: z.literal(0) }),
  z.object({ cls: z.literal(1), steps: z.int().min(-128).max(127) }),
  z.object({ cls: z.literal(2), steps: z.int().min(-4096).max(4095) }),
  z.object({
    cls: z.literal(3),
    steps: z
      .int()
      .min(-(1 << 19))
      .max((1 << 19) - 1),
  }),
]);
const PositionDeltaSchema = z.object({
  x: PositionAxisDeltaSchema,
  y: PositionAxisDeltaSchema,
  z: PositionAxisDeltaSchema,
});

const AvatarBodySchema = z.object({
  kind: z.literal("avatar"),
  yawCode: YawCode,
  pitchCode: PitchCode,
  actionState: z
    .int()
    .min(0)
    .max(AVATAR_ACTION_STATES.length - 1),
  toolIndex: z.int().min(0).max(15),
  flags: z.int().min(0).max(63),
});
const VehicleBodySchema = z.object({
  kind: z.literal("vehicle"),
  orientIndex: z.int().min(0).max(3),
  orient: z.tuple([z.int().min(-512).max(511), z.int().min(-512).max(511), z.int().min(-512).max(511)]),
  steerCode: z.int().min(-32).max(31),
  speedCode: U8,
  driverSlot: U8,
  flags: U8,
});
const RobotBodySchema = z.object({
  kind: z.literal("robot"),
  headingCode: U8,
  state: z
    .int()
    .min(0)
    .max(ROBOT_UI_STATES.length - 1),
  cargo: z.int().min(0).max(7),
});
const EntityBodySchema = z.discriminatedUnion("kind", [AvatarBodySchema, VehicleBodySchema, RobotBodySchema]);

/**
 * Entities section record. The decoder learns the entity kind from the slot table (SlotChanges); a record whose slot
 * has no kind is dropped. `remove` has no body.
 */
export const EntityRecordSchema = z.union([
  z.object({ slot: U8.max(254), rec: z.literal("full"), position: Vec3Others, body: EntityBodySchema }),
  z.object({ slot: U8.max(254), rec: z.literal("delta"), delta: PositionDeltaSchema, body: EntityBodySchema }),
  z.object({ slot: U8.max(254), rec: z.literal("remove") }),
]);
export type EntityRecord = z.infer<typeof EntityRecordSchema>;

/** Compact FRAME event (v1.0; see FRAME_EVENT_KINDS). */
export const FrameEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rail_puck"),
    railSegmentId: U16,
    spawnTickOffset: U8,
    action: z.enum(["spawn", "despawn"]),
  }),
  z.object({ kind: z.literal("machine_state"), structureId: U32, state: z.int().min(0).max(7) }),
  z.object({
    kind: z.literal("structure"),
    action: z.enum(["placed", "shifted", "reclaimed"]),
    structureId: U32,
    pieceId: U16,
    plotId: PlotIdWireSchema,
    localCm: z.tuple([z.int().min(0).max(4095), z.int().min(0).max(4095)]),
    rotStep: z.int().min(0).max(31),
    finish: z.int().min(0).max(7),
    ownerSlot: z.int().min(0).max(31),
  }),
]);
export type FrameEvent = z.infer<typeof FrameEventSchema>;

/**
 * Decoded FRAME. `flags` are implied by which optional sections are present. The dust sections reuse the world/dust
 * schemas unchanged: `dustStrokes` = `dust.strokes`, `robotIntents` = `robot.plot` records, `dustPlots` = `dust.plots`;
 * `dust.ack` is `self.cellGrams`.
 */
export const FramePayloadSchema = z.object({
  serverTick: U32,
  ackInputSeq: U16,
  inputBufferDepth: U8,
  keyframe: z.boolean(),
  self: FrameSelfSchema,
  slotChanges: z.array(SlotChangeSchema).max(255).optional(),
  entities: z.array(EntityRecordSchema).max(255).optional(),
  dustStrokes: DustStrokesPayloadSchema.optional(),
  robotIntents: z.array(RobotPlotIntentSchema).max(255).optional(),
  dustPlots: DustPlotsPayloadSchema.optional(),
  events: z.array(FrameEventSchema).max(255).optional(),
});
export type FramePayload = z.infer<typeof FramePayloadSchema>;

// ---- Dust payload bindings (WDS section 5.1 names to protocol ids) ------------------------------------------------

/** Where each WDS section 5.1 message lives in this protocol: a FRAME section or a catalog message name. */
export const DUST_PAYLOAD_BINDINGS = {
  "dust.strokes": { frameSection: "dustStrokes" },
  "robot.plot": { frameSection: "robotIntents" },
  "dust.ack": { frameSection: "self" },
  "dust.plots": { frameSection: "dustPlots" },
  "dust.snapshot": { message: "DUST_SNAPSHOT" },
  "dust.ledger": { message: "DUST_LEDGER" },
  "dust.log": { message: "DUST_LOG" },
  "dust.check": { message: "DUST_CHECK" },
  "dust.request": { message: "DUST_REQUEST" },
  dust_interest: { message: "DUST_INTEREST" },
} as const;
