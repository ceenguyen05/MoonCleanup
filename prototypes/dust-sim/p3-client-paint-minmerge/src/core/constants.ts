// P3 constants. Environment-agnostic (no DOM, Node, three.js or Colyseus). Values that mirror the shared contract are
// restated here on purpose: the core imports TYPES only from packages/shared, so it runs without resolving zod.

/** Shared tile: 64 x 64 texels over the 25.6 m plot frame, 0.4 m per texel, 4 bits per texel (WDS 10, P3 column). */
export const TILE_EDGE = 64;
export const TILE_TEXELS = TILE_EDGE * TILE_EDGE;
export const TEXEL_MM = 400;
export const TEXEL_AREA_MM2 = TEXEL_MM * TEXEL_MM;
export const FRAME_HALF_MM = 12_800;
/** Packed server tile: two texels per byte. */
export const TILE_PACKED_BYTES = TILE_TEXELS / 2;

/** Shared value: remaining dust level 0 (clean) .. 15 (untouched). The only thing the server ever sees. */
export const LEVEL_MAX = 15;
/** Client-private sub-level accumulator: 16 fine units per shared level, 240 = untouched. Never leaves the client. */
export const FINE_PER_LEVEL = 16;
export const FINE_MAX = LEVEL_MAX * FINE_PER_LEVEL;

/** Plot states (2-bit wire code of the shared contract). */
export const STATE_GRIMY = 0;
export const STATE_OPENED = 1;
export const STATE_POLISHED = 2;

export const OPENED_DIVISOR = 1000;
export const POLISHED_DIVISOR = 100;

/** Highland dust level (progression 1.1). The harness grid exposes no plot classes, so every plot is Highland. */
export const DEFAULT_DUST_LEVEL = 5;
/** Highland 0.310 kg/m^2 over one 0.16 m^2 texel, per shared level: floor(310_000 * 0.16 / 15) mg. */
export const MG_PER_LEVEL_TEXEL = Math.floor((310_000 * 0.16) / LEVEL_MAX);

/** Interest: Medium dust radius of WDS 5.2 (residency 120 m + 20 m), hysteresis 20 m, blocking snapshot 60 m. */
export const DUST_RADIUS_M = 140;
export const DUST_HYSTERESIS_M = 20;
export const BLOCKING_RADIUS_M = 60;
export const INTEREST_CAP = 1024;

/** Client-side stroke rule mirrored from the contract (WDS 4.4 check 6). In P3 only the client can apply it. */
export const MAX_SEGMENT_MM = 4000;

/** Server bounds: tool reach + slack around the server-side pose, and the removal-rate slack over the legal maximum. */
export const REACH_BASE_MM = 4000;
export const RATE_SLACK_NUM = 5;
export const RATE_SLACK_DEN = 4;
export const HAND_TOOL_MAX_SPEED_MM_S = 6000;
export const VEHICLE_MAX_SPEED_MM_S = 24_000;
/** Tool codes at or above this are vehicle intakes in the harness tool table (9 = Bulldust). */
export const VEHICLE_TOOL_CODE_MIN = 8;

/** Robots are credited to the shift. */
export const SHIFT_ACTOR_SLOT = 63;

/** Message section ids (S -> C). */
export const SEC_TILE_DELTA = 1;
export const SEC_TILE_FULL = 2;
export const SEC_TILE_RESYNC = 3;
export const SEC_PLOTS = 4;
export const SEC_ACK = 5;
export const SEC_INTEREST = 6;
export const SEC_ROBOT = 7;
export const SEC_CHECK = 8;
/** C -> S. */
export const SEC_PAINT = 1;

export const ROBOT_INTENT_BYTES = 20;
export const DUST_CHECK_SECONDS = 5;

/** Reject reasons reported by the server for an uploaded tile region (names of the shared stroke contract). */
export const REJECT_OUT_OF_REACH = 0;
export const REJECT_RATE = 1;
export const REJECT_MALFORMED = 2;
export const REJECT_NAMES = ["out_of_reach", "rate_exceeded", "malformed"] as const;
