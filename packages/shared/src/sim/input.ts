// @contract sim/input v1
// @consumers packages/sim (consumes inputs, derives edges), packages/protocol (INPUT codec), apps/server/src/net
//   (sequencer, rate limits), apps/client/src/{gameplay,net,sim-host} (input sampling, prediction, intents), tools/bots
//
// Per-tick player input, sequencing rules, ControlIntent and IntentResult. Specification: netcode.md sections 4.1
// (INPUT row), 5 and 5.1; game-feel-and-controls.md section 6; GDD section 9.
//
// Buttons are LEVELS on the wire (1 = held during this input's tick). The sim derives presses and releases by
// comparing with the previous consumed input of the same actor, so a repeated input never produces a phantom edge.
// This clarifies netcode.md section 5.1 ("edge-triggered buttons cleared on substitution"): a substituted input
// repeats the last input verbatim (levels kept) and, because the level is unchanged, fires no edge. The client latches
// a press for at least one input so a tap shorter than one tick is never lost.
//
// The 16 bits are LOGICAL buttons. The input layer maps device bindings per context (game-feel section 6.1: on foot,
// driver, passenger, build) onto them, and the sim resolves the meaning from the actor's state (INPUT_BUTTON_MEANING).

import { z } from "zod";
import { GameDataIdSchema } from "../config/common.schema";
import { RequestIdSchema } from "../ids";
import type { RequestId } from "../ids";
import type { Lumens } from "../units";
import type { PurchaseRejectReason } from "../events/gameplay";

// ---- Buttons ------------------------------------------------------------------------------------------------------

/** The 16 logical buttons, in bit order (bit 0 first). Names 0..12 are netcode.md section 4.1; 13..15 added in v1. */
export const INPUT_BUTTONS = [
  "jump",
  "hopPack",
  "lope",
  "toolPrimary",
  "toolSecondary",
  "interact",
  "descend",
  "boost",
  "ballast",
  "lampCycle",
  "holsterNext",
  "holsterPrev",
  "seatSwitch",
  "laneLock",
  "puckForm",
  "pickupDrop",
] as const;
export type InputButton = (typeof INPUT_BUTTONS)[number];

/** Bit index of each button inside `buttons` (u16, little-endian on the wire). */
export const INPUT_BUTTON_BIT = {
  jump: 0,
  hopPack: 1,
  lope: 2,
  toolPrimary: 3,
  toolSecondary: 4,
  interact: 5,
  descend: 6,
  boost: 7,
  ballast: 8,
  lampCycle: 9,
  holsterNext: 10,
  holsterPrev: 11,
  seatSwitch: 12,
  laneLock: 13,
  puckForm: 14,
  pickupDrop: 15,
} as const satisfies Record<InputButton, number>;

/** `1 << bit` of each button. */
export const INPUT_BUTTON_MASK = {
  jump: 1 << 0,
  hopPack: 1 << 1,
  lope: 1 << 2,
  toolPrimary: 1 << 3,
  toolSecondary: 1 << 4,
  interact: 1 << 5,
  descend: 1 << 6,
  boost: 1 << 7,
  ballast: 1 << 8,
  lampCycle: 1 << 9,
  holsterNext: 1 << 10,
  holsterPrev: 1 << 11,
  seatSwitch: 1 << 12,
  laneLock: 1 << 13,
  puckForm: 1 << 14,
  pickupDrop: 1 << 15,
} as const satisfies Record<InputButton, number>;

/** Contexts of game-feel section 6.1 that give a button its meaning. `null` = unused in that context. */
export interface InputButtonMeaning {
  readonly onFoot: string | null;
  readonly driver: string | null;
  readonly passenger: string | null;
  readonly build: string | null;
}

/** What each logical button does per context (game-feel section 6.2 / 6.3; hold durations are sim rules, not wire). */
export const INPUT_BUTTON_MEANING = {
  jump: { onFoot: "jump (release = jump cut)", driver: "handbrake", passenger: null, build: null },
  hopPack: {
    onFoot: "Hop Pack burst (client sets it on a jump press while airborne)",
    driver: null,
    passenger: null,
    build: null,
  },
  lope: { onFoot: "lope (hold)", driver: null, passenger: null, build: null },
  toolPrimary: { onFoot: "sweep (hold)", driver: null, passenger: null, build: "place (hold to Settle)" },
  toolSecondary: { onFoot: "tool trait / precision aim (hold)", driver: null, passenger: null, build: "cancel" },
  interact: { onFoot: "interact; hold to pour", driver: "exit (hold on gamepad)", passenger: "exit", build: null },
  descend: { onFoot: "Touchdown while airborne (brake/descend)", driver: null, passenger: null, build: null },
  boost: { onFoot: null, driver: "Afterburner (hold)", passenger: null, build: null },
  ballast: { onFoot: "Ballast Soles toggle", driver: null, passenger: null, build: null },
  lampCycle: { onFoot: "Crown Lamp / Lowlight Visor / off", driver: "Running Lamps", passenger: null, build: null },
  holsterNext: { onFoot: "next tool slot", driver: "Wide Mouth cycle", passenger: null, build: "mode cycle" },
  holsterPrev: { onFoot: "previous tool slot", driver: null, passenger: null, build: null },
  seatSwitch: { onFoot: null, driver: "load / unload pucks and stacks", passenger: "next seat", build: null },
  laneLock: {
    onFoot: "Lane Lock toggle (locks the sweep angle)",
    driver: "Throttle Lock toggle",
    passenger: null,
    build: null,
  },
  puckForm: {
    onFoot: "form Dust Puck (tap) / band into a stack (hold 0.30 s)",
    driver: null,
    passenger: null,
    build: null,
  },
  pickupDrop: {
    onFoot: "pick up / drop (tap); throw (hold, release)",
    driver: null,
    passenger: null,
    build: null,
  },
} as const satisfies Record<InputButton, InputButtonMeaning>;

// ---- Per-tick input -----------------------------------------------------------------------------------------------

/**
 * One decoded input, valid for exactly one sim tick. All fields are integers, so NaN is impossible.
 * Wire (INPUT_WIRE): seq u16 | moveX i8 | moveY i8 | yaw u16 | pitch i8 | buttons u16 | toolParam u8, little-endian.
 */
export interface SimInputCommand {
  /** Per-client sequence number, u16, wraps (INPUT_SEQUENCING). Acked in every FRAME header. */
  readonly seq: number;
  /** Strafe / steer, -127 .. 127 (stick x 127). The sim normalises (moveX, moveY) to length <= 1. */
  readonly moveX: number;
  /** Forward / throttle, -127 .. 127. Driving: throttle and brake/reverse. */
  readonly moveY: number;
  /** Camera yaw about local up, 0 .. 65535 = 0 .. 2 pi. */
  readonly yaw: number;
  /** Look / tool pitch, -127 .. 127 = -90 .. +90 degrees. */
  readonly pitch: number;
  /** Bitfield of INPUT_BUTTON_MASK levels. */
  readonly buttons: number;
  /** Aim distance 0 .. 255 = 0 .. reach of the equipped tool (game-feel section 3.1). */
  readonly toolParam: number;
}

export const INPUT_AXIS_MAX = 127;
export const INPUT_YAW_STEPS = 65536;
export const INPUT_PITCH_MAX = 127;
export const INPUT_TOOL_PARAM_MAX = 255;

export const SimInputCommandSchema = z.object({
  seq: z.int().min(0).max(0xffff),
  moveX: z.int().min(-INPUT_AXIS_MAX).max(INPUT_AXIS_MAX),
  moveY: z.int().min(-INPUT_AXIS_MAX).max(INPUT_AXIS_MAX),
  yaw: z
    .int()
    .min(0)
    .max(INPUT_YAW_STEPS - 1),
  pitch: z.int().min(-INPUT_PITCH_MAX).max(INPUT_PITCH_MAX),
  buttons: z.int().min(0).max(0xffff),
  toolParam: z.int().min(0).max(INPUT_TOOL_PARAM_MAX),
});

/** A neutral input: no movement, no buttons (AFK detection and starvation, netcode.md sections 5.1 and 10). */
export const NEUTRAL_INPUT_FIELDS = { moveX: 0, moveY: 0, buttons: 0 } as const;

/** `INPUT` message layout: byte 0 = 0x01, byte 1 = count n (1..2), then n inputs of `bytesPerInput` bytes. */
export const INPUT_WIRE = {
  typeId: 0x01,
  headerBytes: 2,
  bytesPerInput: 10,
  maxInputsPerMessage: 2,
  /** Field offsets inside one input record. */
  fields: {
    seq: { offset: 0, bytes: 2, type: "u16" },
    moveX: { offset: 2, bytes: 1, type: "i8" },
    moveY: { offset: 3, bytes: 1, type: "i8" },
    yaw: { offset: 4, bytes: 2, type: "u16" },
    pitch: { offset: 6, bytes: 1, type: "i8" },
    buttons: { offset: 7, bytes: 2, type: "u16" },
    toolParam: { offset: 9, bytes: 1, type: "u8" },
  },
} as const;

/** Decoded `INPUT` message: one or two inputs, oldest first. */
export const InputMessageSchema = z.object({
  inputs: z.array(SimInputCommandSchema).min(1).max(INPUT_WIRE.maxInputsPerMessage),
});
export interface InputMessage {
  readonly inputs: readonly SimInputCommand[];
}

/** Sequencing constants of netcode.md sections 5 and 5.1. */
export const INPUT_SEQUENCING = {
  seqModulus: 65536,
  /** A seq within this window behind `lastConsumedSeq` is "late" (dropped, counted `late_input`). */
  lateWindow: 1024,
  /** The server buffers inputs up to this many seqs ahead of `lastConsumedSeq`. */
  bufferAhead: 16,
  /** With a backlog above this the server consumes two seqs per tick. */
  backlogDoubleStep: 4,
  /** Consecutive missing inputs substituted (consuming the seq) before a neutral input without consuming. */
  maxSubstitutions: 3,
  /** Client reconciler ring: last N inputs plus predicted states. */
  clientRing: 64,
} as const;

// ---- Control intents ----------------------------------------------------------------------------------------------

/** Holster slots 1 to 6 as indexes 0 .. 5 (GDD section 9 tool slots). */
export const HOLSTER_SLOT_COUNT = 6;

/** `purchase` payload (control channel). Idempotent by `requestId`; `quantity` is always 1 in v1. */
export const PurchasePayloadSchema = z.object({
  requestId: RequestIdSchema,
  /** Game-data id: tool, board node, gear line, vehicle, robot (Roost). */
  itemId: GameDataIdSchema,
  quantity: z.literal(1).optional(),
});

/** `select_tool` payload: direct holster selection (wheel or 1 to 6). Idempotent, so it has no requestId. */
export const SelectToolPayloadSchema = z.object({
  slot: z
    .int()
    .min(0)
    .max(HOLSTER_SLOT_COUNT - 1),
});

/** Intent kinds the sim consumes. Same names as their control message ids. */
export const CONTROL_INTENT_KINDS = ["purchase", "select_tool"] as const;
export type ControlIntentKind = (typeof CONTROL_INTENT_KINDS)[number];

/** A rare, validated request from a player to the sim (`RoomHost.sendIntent`, `RoomSim.applyIntent`). */
export const ControlIntentSchema = z.discriminatedUnion("kind", [
  PurchasePayloadSchema.extend({ kind: z.literal("purchase") }),
  SelectToolPayloadSchema.extend({ kind: z.literal("select_tool") }),
]);
export interface PurchaseIntent {
  readonly kind: "purchase";
  readonly requestId: RequestId;
  readonly itemId: string;
  readonly quantity?: 1;
}
export interface SelectToolIntent {
  readonly kind: "select_tool";
  readonly slot: number;
}
export type ControlIntent = PurchaseIntent | SelectToolIntent;

/**
 * Synchronous outcome of `RoomSim.applyIntent` for a purchase. A server room turns it into `purchase_result`; both
 * hosts also get the `purchase.completed` / `purchase.rejected` sim events.
 */
export type PurchaseOutcome =
  | { readonly requestId: RequestId; readonly ok: true; readonly walletAfter: Lumens }
  | { readonly requestId: RequestId; readonly ok: false; readonly code: PurchaseRejectReason };

/** `applyIntent` result: the purchase outcome, or `null` for intents without a reply (`select_tool`). */
export type IntentResult = PurchaseOutcome | null;
