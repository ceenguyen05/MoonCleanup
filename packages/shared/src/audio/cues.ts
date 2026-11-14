// @contract audio/cues v1.1
// @consumers apps/client/src/audio (implements cue playback, the mix buses, voice limits and the event-to-cue wiring),
//   apps/client/src/{gameplay,ui,visuals} (play cues directly for non-event sounds such as Clock In), tools/audio-pack
//   (asset manifest: one entry per cue id), this package's events/gameplay (event names used by AUDIO_EVENT_CUES)
//
// v1.1 (additive, contracts bump 1 of M1, from the M1-W7-T05 audio requests): `AudioPlacement` (listener-relative
// distance and pan of a source) and the optional `AudioCueParams.placement`; `AUDIO_EVENT_CUES_V1_1` wires the two new
// presentation events `avatar.stepped` and `vehicle.motion`. `AUDIO_EVENT_CUES` itself is unchanged on purpose: the
// client's EventRouter types its handler table on that object's keys, so the two rows move into it in the next
// contracts wave, after apps/client/src/audio has handlers for them (add, migrate, remove). `audio.cue` and
// `audio.settings` are not cue-starting events and have no row.
//
// Audio cue ids, parameters, bus routing and voice limits for the MVP SFX set (M1-W0-T03). Specification:
// docs/design/audio-direction.md sections 1 (hearing channels), 2 (palette), 4 (music), 5 (buses), 7 (spatialization),
// and docs/design/game-feel-and-controls.md section 7 (event to audio mapping). Cue ids are dot-namespaced like every
// other id (`<domain>.<name>`); a cue id is the key of the audio manifest, so renaming one renames an asset.
//
// Scope: the MVP set of scope-tiers section 1 (sweep, pour, stamp, Trundle, Sandpiper chirps, day and night beds, DOT
// chime) plus the UI sounds the MVP HUD needs. v0 was a placeholder with no cues; v1 adds the whole catalog. Adding a
// cue is not a breaking change. No numbers here are tuning: loudness targets (-18 LUFS) and asset normalization live
// in the audio manifest, not in the contract.

import type { EventName } from "../events";
import type { Metres } from "../units";

// ---- Buses and channels -------------------------------------------------------------------------------------------

/** Mix buses (audio-direction section 5.1). `master` feeds the limiter; the others feed `master`. */
export const AUDIO_BUSES = [
  "master",
  "voice",
  "ui",
  "tools",
  "vehicles",
  "world",
  "robots",
  "foley",
  "ambience",
  "music",
] as const;
export type AudioBus = (typeof AUDIO_BUSES)[number];

/** Default bus levels in dB relative to master (audio-direction section 5.1). */
export const AUDIO_BUS_DEFAULT_DB = {
  master: 0,
  voice: 0,
  ui: -6,
  tools: -3,
  vehicles: -6,
  world: -8,
  robots: -10,
  foley: -9,
  ambience: -14,
  music: -12,
} as const satisfies Record<AudioBus, number>;

/**
 * How a sound reaches the player (audio-direction section 1.1): inside the helmet, through contact, through the
 * ground, through the suit relay, over the radio, on the UI bus or as music.
 */
export const AUDIO_CHANNELS = ["suit", "contact", "ground", "relay", "radio", "ui", "music"] as const;
export type AudioChannel = (typeof AUDIO_CHANNELS)[number];

/** Default hearing range of a channel in metres; `null` = not distance-limited. Per-cue `maxDistanceM` overrides it. */
export const AUDIO_CHANNEL_MAX_DISTANCE_M = {
  suit: null,
  contact: null,
  ground: 60,
  relay: 25,
  radio: null,
  ui: null,
  music: null,
} as const satisfies Record<AudioChannel, number | null>;

/** How a cue plays. `loop` runs until stopped and is driven by parameters; `bed` is a long ambience loop. */
export const AUDIO_CUE_KINDS = ["oneshot", "loop", "stinger", "bed"] as const;
export type AudioCueKind = (typeof AUDIO_CUE_KINDS)[number];

// ---- Cue parameters -----------------------------------------------------------------------------------------------

/**
 * Where a sound source is relative to the listener (the camera). Computed by the emitter (gameplay, which owns the
 * camera and the predicted positions); the audio module only applies rolloff (`distanceM`) and equal-power pan.
 */
export interface AudioPlacement {
  /** Straight-line distance listener to source in metres, >= 0. */
  readonly distanceM: Metres;
  /** Stereo position in the listener's frame: -1 = full left, 0 = centre, +1 = full right. */
  readonly pan: number;
}

/** Per-trigger parameters every cue accepts. */
export interface AudioCueParams {
  /** Linear gain multiplier, 0 .. 1 (default 1). */
  readonly gain?: number;
  /** Pitch offset in semitones (default 0). */
  readonly pitchSemitones?: number;
  /**
   * Position of another player's, robot's or building's source. Absent = the listener's own sound or a non-spatial
   * one (centred, no distance rolloff beyond the cue's own rules).
   */
  readonly placement?: AudioPlacement;
}

/** Footstep and landing surface (grime thuds soft, clean taps firm, deck plates ring). */
export const AUDIO_SURFACES = ["grime", "clean", "deck"] as const;
export type AudioSurface = (typeof AUDIO_SURFACES)[number];

/** DOT chirp-speak pitch contours (audio-direction section 6.2). */
export const DOT_CONTOURS = ["rise", "fall", "flat"] as const;
export type DotContour = (typeof DOT_CONTOURS)[number];

/** Music sets and their adaptive layer levels (audio-direction section 4). */
export const MUSIC_SETS = ["day", "bridge", "night", "menu", "hold"] as const;
export type MusicSet = (typeof MUSIC_SETS)[number];

/**
 * Cue id -> the parameters it takes beyond `AudioCueParams`. Every name below is a 0..1 float unless its type says
 * otherwise. `unknown` means "no extra parameters". Parameter meaning follows audio-direction section 2.
 */
export interface AudioCueParamMap {
  // Hand tools (bus tools; contact channel for the own tool, suit relay for others').
  /** Sweep loop. `speed01` drives swirl rate and gain, `grime01` the grime/clean timbre, `fill01` the Cell hiss pitch. */
  "tool.sweep": {
    readonly toolId: string;
    readonly speed01: number;
    readonly grime01: number;
    readonly fill01: number;
    readonly dry: boolean;
  };
  /** Granular hiss into the Cell while dust is taken; `fill01` raises the pitch by up to AUDIO_CELL_FILL_PITCH_SEMITONES. */
  "cell.fill_hiss": { readonly fill01: number };
  "cell.near_full": unknown;
  "cell.full": unknown;
  "tool.lane_lock": unknown;
  "tool.lane_unlock": unknown;
  /** Holster Rig clip in or out (latch). */
  "suit.holster_clip": { readonly slot: number; readonly drawing: boolean };
  // Cargo and selling (bus world, ground conduction).
  "cargo.puck_press": unknown;
  "cargo.stack_band": { readonly pucks: number };
  "cargo.pick_up": unknown;
  "cargo.throw": unknown;
  /** Granular pour stream into the Assay Counter. */
  "assay.pour": { readonly rate01: number };
  "assay.scale_tick": unknown;
  /** Bright two-note chime plus register thunk, one per completed pour. `big` selects the larger variant. */
  "assay.ka_ching": { readonly big: boolean };
  /** Scanner blip per puck at the Receiving Gate. */
  "gate.blip": unknown;
  "railshot.charge": unknown;
  /** Deep ground "thoom" and sled release; `distance01` is distance over the 300 m range. */
  "railshot.thoom": { readonly distance01: number };
  "railshot.away": unknown;
  // Plots.
  /** Inspector's Stamp: thunk plus rising chord. `streak` is the Stamps in the last 60 s (pitch +1 semitone each, max +7). */
  "plot.stamp": { readonly streak: number; readonly charged: boolean; readonly own: boolean };
  /** Soft sensor blip when a plot opens (suit relay). */
  "plot.open_blip": unknown;
  // Avatar and suit (bus foley).
  "avatar.footstep": { readonly surface: AudioSurface; readonly speed01: number };
  "avatar.jump": unknown;
  "avatar.land": { readonly impact01: number; readonly surface: AudioSurface };
  "suit.lamp_click": { readonly on: boolean };
  // Vehicles (bus vehicles; the Trundle is the MVP vehicle).
  "vehicle.enter": { readonly kindId: string };
  "vehicle.exit": { readonly kindId: string };
  /** Motor and cart rattle. `speed01` drives pitch, `load01` the rattle. */
  "vehicle.drive_loop": { readonly kindId: string; readonly speed01: number; readonly load01: number };
  /** Brush-drum spin "wsshh". */
  "vehicle.work_loop": { readonly kindId: string; readonly intensity01: number };
  // Robots (bus robots, suit relay <= 25 m; synthetic, never real birdcalls).
  "robot.step": { readonly kindId: string; readonly speed01: number };
  "robot.peep": { readonly kindId: string };
  "robot.peck": { readonly kindId: string };
  "robot.dock": unknown;
  "robot.deploy": { readonly kindId: string };
  /** Amber two-note alert (Bin Full, Roost Full), played on the radio chain with a visual cue. */
  "robot.alert": unknown;
  /** Three rising notes when a plot is finished. */
  "robot.plot_done": unknown;
  // UI (bus ui, never spatialized).
  "ui.hover": unknown;
  "ui.click": unknown;
  "ui.toggle": { readonly on: boolean };
  "ui.panel_open": unknown;
  "ui.panel_close": unknown;
  /** Two-note rise plus soft stamp at 0 / 120 ms. */
  "ui.purchase": unknown;
  /** Soft low double buzz, never harsh. */
  "ui.reject": unknown;
  /** "Lumen shimmer" ticks; pitch rises over a streak. */
  "ui.lumen_tick": { readonly streak01: number };
  "ui.plot_card": unknown;
  "ui.achievement": unknown;
  "ui.unlock": unknown;
  "ui.find": unknown;
  "ui.check": unknown;
  /** Brightside jingle, once per session, on the Clock In click. */
  "ui.clock_in": unknown;
  // DOT (bus voice, radio chain).
  /** Amber two-note "bloop" before each line. */
  "dot.bloop": unknown;
  /** Chirp-speak for one line: syllable count follows word count, contour follows punctuation. */
  "dot.chirp": { readonly syllables: number; readonly contour: DotContour };
  // Ambience (bus ambience).
  /** Suit bed: fan hum, pump cycles, radio hiss floor. `night01` cools it; `farSide01` thins it to near silence. */
  "ambience.suit_bed": { readonly night01: number; readonly farSide01: number };
  "ambience.breathing": { readonly effort01: number };
  "ambience.thermal_tick": unknown;
  "ambience.outpost_hum": unknown;
  // Music (bus music). `pulse01`, `melody01`, `drive01` are the L1..L3 layer levels.
  "music.day": { readonly pulse01: number; readonly melody01: number; readonly drive01: number };
  "music.bridge": unknown;
  "music.night": { readonly pulse01: number; readonly melody01: number; readonly drive01: number };
  "music.menu": unknown;
  /** Brightside hold music while the Requisitions Desk or Ops Console is open. */
  "music.hold": unknown;
  "music.stinger_unlock": unknown;
  /** Shine milestone: a short stinger and the sparse melody layer. */
  "music.stinger_shine": { readonly pct: number };
  "music.stinger_fulfilled": unknown;
}

/** Identifier of an audio cue. */
export type AudioCueId = keyof AudioCueParamMap;

/** What a caller passes to play cue `K`: the common parameters plus the cue's own. */
export type AudioCuePlay<K extends AudioCueId> = AudioCueParams & AudioCueParamMap[K];

// ---- Cue definitions ----------------------------------------------------------------------------------------------

/** Playback rules of one cue. */
export interface AudioCueDef {
  readonly bus: AudioBus;
  readonly channel: AudioChannel;
  readonly kind: AudioCueKind;
  /**
   * Steal order, 1 = highest (audio-direction section 7.2): 1 voice, 2 UI, 3 own tool, 4 own vehicle, 5 stamp and
   * Railshot, 6 nearby vehicles, 7 others' tools, 8 robots, 9 logistics, 10 ambience. Sources of other players demote
   * an own-sound cue to the "others" rank at play time.
   */
  readonly priority: number;
  /** Most simultaneous instances of this cue. */
  readonly maxVoices: number;
  /** Minimum time between two plays in milliseconds; 0 = none. */
  readonly cooldownMs: number;
  /** Hearing range in metres; `null` = not distance-limited. Overrides AUDIO_CHANNEL_MAX_DISTANCE_M. */
  readonly maxDistanceM: number | null;
}

/**
 * The cue table. `satisfies` makes adding a cue id to AudioCueParamMap without a row a compile error, and a row
 * without an id too.
 */
export const AUDIO_CUE_DEFS = {
  "tool.sweep": {
    bus: "tools",
    channel: "contact",
    kind: "loop",
    priority: 3,
    maxVoices: 5,
    cooldownMs: 0,
    maxDistanceM: 25,
  },
  "cell.fill_hiss": {
    bus: "tools",
    channel: "contact",
    kind: "loop",
    priority: 3,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "cell.near_full": {
    bus: "tools",
    channel: "contact",
    kind: "oneshot",
    priority: 3,
    maxVoices: 1,
    cooldownMs: 1000,
    maxDistanceM: null,
  },
  "cell.full": {
    bus: "tools",
    channel: "contact",
    kind: "oneshot",
    priority: 3,
    maxVoices: 1,
    cooldownMs: 1000,
    maxDistanceM: null,
  },
  "tool.lane_lock": {
    bus: "tools",
    channel: "contact",
    kind: "oneshot",
    priority: 3,
    maxVoices: 1,
    cooldownMs: 100,
    maxDistanceM: null,
  },
  "tool.lane_unlock": {
    bus: "tools",
    channel: "contact",
    kind: "oneshot",
    priority: 3,
    maxVoices: 1,
    cooldownMs: 100,
    maxDistanceM: null,
  },
  "suit.holster_clip": {
    bus: "foley",
    channel: "suit",
    kind: "oneshot",
    priority: 3,
    maxVoices: 2,
    cooldownMs: 60,
    maxDistanceM: null,
  },
  "cargo.puck_press": {
    bus: "world",
    channel: "ground",
    kind: "oneshot",
    priority: 9,
    maxVoices: 4,
    cooldownMs: 40,
    maxDistanceM: null,
  },
  "cargo.stack_band": {
    bus: "world",
    channel: "ground",
    kind: "oneshot",
    priority: 9,
    maxVoices: 2,
    cooldownMs: 100,
    maxDistanceM: null,
  },
  "cargo.pick_up": {
    bus: "world",
    channel: "contact",
    kind: "oneshot",
    priority: 9,
    maxVoices: 2,
    cooldownMs: 60,
    maxDistanceM: null,
  },
  "cargo.throw": {
    bus: "world",
    channel: "contact",
    kind: "oneshot",
    priority: 9,
    maxVoices: 2,
    cooldownMs: 60,
    maxDistanceM: null,
  },
  "assay.pour": {
    bus: "world",
    channel: "ground",
    kind: "loop",
    priority: 9,
    maxVoices: 4,
    cooldownMs: 0,
    maxDistanceM: 60,
  },
  "assay.scale_tick": {
    bus: "world",
    channel: "ground",
    kind: "oneshot",
    priority: 9,
    maxVoices: 2,
    cooldownMs: 80,
    maxDistanceM: 60,
  },
  "assay.ka_ching": {
    bus: "world",
    channel: "ground",
    kind: "oneshot",
    priority: 5,
    maxVoices: 3,
    cooldownMs: 120,
    maxDistanceM: 60,
  },
  "gate.blip": {
    bus: "world",
    channel: "ground",
    kind: "oneshot",
    priority: 9,
    maxVoices: 4,
    cooldownMs: 50,
    maxDistanceM: 60,
  },
  "railshot.charge": {
    bus: "world",
    channel: "relay",
    kind: "oneshot",
    priority: 5,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: 300,
  },
  "railshot.thoom": {
    bus: "world",
    channel: "ground",
    kind: "oneshot",
    priority: 5,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: 300,
  },
  "railshot.away": {
    bus: "world",
    channel: "radio",
    kind: "oneshot",
    priority: 5,
    maxVoices: 1,
    cooldownMs: 10_000,
    maxDistanceM: null,
  },
  "plot.stamp": {
    bus: "world",
    channel: "relay",
    kind: "oneshot",
    priority: 5,
    maxVoices: 3,
    cooldownMs: 0,
    maxDistanceM: 25,
  },
  "plot.open_blip": {
    bus: "world",
    channel: "relay",
    kind: "oneshot",
    priority: 9,
    maxVoices: 2,
    cooldownMs: 200,
    maxDistanceM: 25,
  },
  "avatar.footstep": {
    bus: "foley",
    channel: "contact",
    kind: "oneshot",
    priority: 3,
    maxVoices: 6,
    cooldownMs: 0,
    maxDistanceM: 25,
  },
  "avatar.jump": {
    bus: "foley",
    channel: "suit",
    kind: "oneshot",
    priority: 3,
    maxVoices: 2,
    cooldownMs: 100,
    maxDistanceM: null,
  },
  "avatar.land": {
    bus: "foley",
    channel: "contact",
    kind: "oneshot",
    priority: 3,
    maxVoices: 2,
    cooldownMs: 100,
    maxDistanceM: 25,
  },
  "suit.lamp_click": {
    bus: "foley",
    channel: "suit",
    kind: "oneshot",
    priority: 3,
    maxVoices: 1,
    cooldownMs: 100,
    maxDistanceM: null,
  },
  "vehicle.enter": {
    bus: "vehicles",
    channel: "contact",
    kind: "oneshot",
    priority: 4,
    maxVoices: 1,
    cooldownMs: 200,
    maxDistanceM: null,
  },
  "vehicle.exit": {
    bus: "vehicles",
    channel: "contact",
    kind: "oneshot",
    priority: 4,
    maxVoices: 1,
    cooldownMs: 200,
    maxDistanceM: null,
  },
  "vehicle.drive_loop": {
    bus: "vehicles",
    channel: "contact",
    kind: "loop",
    priority: 4,
    maxVoices: 4,
    cooldownMs: 0,
    maxDistanceM: 120,
  },
  "vehicle.work_loop": {
    bus: "vehicles",
    channel: "contact",
    kind: "loop",
    priority: 4,
    maxVoices: 4,
    cooldownMs: 0,
    maxDistanceM: 120,
  },
  "robot.step": {
    bus: "robots",
    channel: "relay",
    kind: "loop",
    priority: 8,
    maxVoices: 6,
    cooldownMs: 0,
    maxDistanceM: 25,
  },
  "robot.peep": {
    bus: "robots",
    channel: "relay",
    kind: "oneshot",
    priority: 8,
    maxVoices: 6,
    cooldownMs: 250,
    maxDistanceM: 25,
  },
  "robot.peck": {
    bus: "robots",
    channel: "relay",
    kind: "oneshot",
    priority: 8,
    maxVoices: 6,
    cooldownMs: 100,
    maxDistanceM: 25,
  },
  "robot.dock": {
    bus: "robots",
    channel: "relay",
    kind: "oneshot",
    priority: 8,
    maxVoices: 2,
    cooldownMs: 200,
    maxDistanceM: 25,
  },
  "robot.deploy": {
    bus: "robots",
    channel: "relay",
    kind: "oneshot",
    priority: 8,
    maxVoices: 2,
    cooldownMs: 200,
    maxDistanceM: 25,
  },
  "robot.alert": {
    bus: "robots",
    channel: "radio",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 2000,
    maxDistanceM: null,
  },
  "robot.plot_done": {
    bus: "robots",
    channel: "relay",
    kind: "oneshot",
    priority: 8,
    maxVoices: 2,
    cooldownMs: 500,
    maxDistanceM: 25,
  },
  "ui.hover": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 2,
    cooldownMs: 84,
    maxDistanceM: null,
  },
  "ui.click": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 3,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "ui.toggle": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 2,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "ui.panel_open": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 100,
    maxDistanceM: null,
  },
  "ui.panel_close": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 100,
    maxDistanceM: null,
  },
  "ui.purchase": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 2,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "ui.reject": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 200,
    maxDistanceM: null,
  },
  "ui.lumen_tick": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 2,
    cooldownMs: 120,
    maxDistanceM: null,
  },
  "ui.plot_card": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 200,
    maxDistanceM: null,
  },
  "ui.achievement": {
    bus: "ui",
    channel: "ui",
    kind: "stinger",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 500,
    maxDistanceM: null,
  },
  "ui.unlock": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 300,
    maxDistanceM: null,
  },
  "ui.find": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 300,
    maxDistanceM: null,
  },
  "ui.check": {
    bus: "ui",
    channel: "ui",
    kind: "oneshot",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 200,
    maxDistanceM: null,
  },
  "ui.clock_in": {
    bus: "ui",
    channel: "ui",
    kind: "stinger",
    priority: 2,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "dot.bloop": {
    bus: "voice",
    channel: "radio",
    kind: "oneshot",
    priority: 1,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "dot.chirp": {
    bus: "voice",
    channel: "radio",
    kind: "oneshot",
    priority: 1,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "ambience.suit_bed": {
    bus: "ambience",
    channel: "suit",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "ambience.breathing": {
    bus: "ambience",
    channel: "suit",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "ambience.thermal_tick": {
    bus: "ambience",
    channel: "ground",
    kind: "oneshot",
    priority: 10,
    maxVoices: 2,
    cooldownMs: 4000,
    maxDistanceM: 60,
  },
  "ambience.outpost_hum": {
    bus: "ambience",
    channel: "ground",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: 40,
  },
  "music.day": {
    bus: "music",
    channel: "music",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "music.bridge": {
    bus: "music",
    channel: "music",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "music.night": {
    bus: "music",
    channel: "music",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "music.menu": {
    bus: "music",
    channel: "music",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "music.hold": {
    bus: "music",
    channel: "music",
    kind: "bed",
    priority: 10,
    maxVoices: 1,
    cooldownMs: 0,
    maxDistanceM: null,
  },
  "music.stinger_unlock": {
    bus: "music",
    channel: "music",
    kind: "stinger",
    priority: 5,
    maxVoices: 1,
    cooldownMs: 500,
    maxDistanceM: null,
  },
  "music.stinger_shine": {
    bus: "music",
    channel: "music",
    kind: "stinger",
    priority: 5,
    maxVoices: 1,
    cooldownMs: 500,
    maxDistanceM: null,
  },
  "music.stinger_fulfilled": {
    bus: "music",
    channel: "music",
    kind: "stinger",
    priority: 5,
    maxVoices: 1,
    cooldownMs: 500,
    maxDistanceM: null,
  },
} as const satisfies Record<AudioCueId, AudioCueDef>;

/** The cue catalog: every cue id exactly once (audio-pack builds one manifest entry per id). */
export const AUDIO_CUE_IDS = [
  "tool.sweep",
  "cell.fill_hiss",
  "cell.near_full",
  "cell.full",
  "tool.lane_lock",
  "tool.lane_unlock",
  "suit.holster_clip",
  "cargo.puck_press",
  "cargo.stack_band",
  "cargo.pick_up",
  "cargo.throw",
  "assay.pour",
  "assay.scale_tick",
  "assay.ka_ching",
  "gate.blip",
  "railshot.charge",
  "railshot.thoom",
  "railshot.away",
  "plot.stamp",
  "plot.open_blip",
  "avatar.footstep",
  "avatar.jump",
  "avatar.land",
  "suit.lamp_click",
  "vehicle.enter",
  "vehicle.exit",
  "vehicle.drive_loop",
  "vehicle.work_loop",
  "robot.step",
  "robot.peep",
  "robot.peck",
  "robot.dock",
  "robot.deploy",
  "robot.alert",
  "robot.plot_done",
  "ui.hover",
  "ui.click",
  "ui.toggle",
  "ui.panel_open",
  "ui.panel_close",
  "ui.purchase",
  "ui.reject",
  "ui.lumen_tick",
  "ui.plot_card",
  "ui.achievement",
  "ui.unlock",
  "ui.find",
  "ui.check",
  "ui.clock_in",
  "dot.bloop",
  "dot.chirp",
  "ambience.suit_bed",
  "ambience.breathing",
  "ambience.thermal_tick",
  "ambience.outpost_hum",
  "music.day",
  "music.bridge",
  "music.night",
  "music.menu",
  "music.hold",
  "music.stinger_unlock",
  "music.stinger_shine",
  "music.stinger_fulfilled",
] as const satisfies readonly AudioCueId[];

// ---- Event wiring -------------------------------------------------------------------------------------------------

/**
 * Catalog events that start cues (game-feel-and-controls.md section 7). The audio module listens to these events and
 * plays the listed candidates, choosing by the payload (for example `cargo.sold` plays `assay.ka_ching` for source
 * `assay_counter` and `gate.blip` for `receiving_gate`; `robot.state_changed` plays `robot.alert` only when `alert` is
 * set; `shine.milestone` adds `music.stinger_fulfilled` at 100 %). `tool.stroke_contact` drives the `tool.sweep` loop
 * parameters instead of starting a cue per stroke. Clock In (`ui.clock_in`) and panel sounds are played by the UI.
 */
export const AUDIO_EVENT_CUES = {
  "tool.stroke_contact": ["tool.sweep"],
  "cell.near_full": ["cell.near_full"],
  "cell.full": ["cell.full"],
  "dust.collected": ["cell.fill_hiss"],
  "lane.locked": ["tool.lane_lock"],
  "lane.unlocked": ["tool.lane_unlock"],
  "plot.opened": ["plot.open_blip"],
  "plot.polished": ["plot.stamp", "ui.lumen_tick"],
  "shine.milestone": ["music.stinger_shine", "music.stinger_fulfilled"],
  "cargo.puck_formed": ["cargo.puck_press"],
  "cargo.stack_banded": ["cargo.stack_band"],
  "cargo.picked_up": ["cargo.pick_up"],
  "cargo.thrown": ["cargo.throw"],
  "cargo.pour_started": ["assay.pour"],
  "cargo.sold": ["assay.ka_ching", "gate.blip", "ui.lumen_tick"],
  "railshot.fired": ["railshot.charge", "railshot.thoom", "railshot.away"],
  "purchase.completed": ["ui.purchase"],
  "purchase.rejected": ["ui.reject"],
  "unlock.granted": ["music.stinger_unlock", "ui.unlock"],
  "robot.deployed": ["robot.deploy"],
  "robot.state_changed": ["robot.alert", "robot.plot_done"],
  "vehicle.entered": ["vehicle.enter"],
  "vehicle.exited": ["vehicle.exit"],
  "avatar.jumped": ["avatar.jump"],
  "avatar.landed": ["avatar.land"],
  "collectible.found": ["ui.find"],
  "onboarding.step_completed": ["ui.check"],
  "achievement.unlocked": ["ui.achievement"],
  "daynight.changed": ["music.day", "music.bridge", "music.night"],
  "dot.message": ["dot.bloop", "dot.chirp"],
} as const satisfies { readonly [E in EventName]?: readonly AudioCueId[] };

/**
 * v1.1 additions to AUDIO_EVENT_CUES (see the header note; merged into it in the next contracts wave).
 * `avatar.stepped` drives `avatar.footstep` (one cue per step, own and others'); `vehicle.motion` updates the
 * `vehicle.drive_loop` (`speed01`, `load01`) and `vehicle.work_loop` (`intensity01` = the event's `workIntensity01`)
 * loops. `audio.cue` plays `payload.id` directly and `audio.settings` sets mono and captions; neither has a row.
 */
export const AUDIO_EVENT_CUES_V1_1 = {
  "avatar.stepped": ["avatar.footstep"],
  "vehicle.motion": ["vehicle.drive_loop", "vehicle.work_loop"],
} as const satisfies { readonly [E in EventName]?: readonly AudioCueId[] };

// ---- Mix and voice limits -----------------------------------------------------------------------------------------

/** Pitch rise of the Cell hiss from empty to full, in semitones (audio-direction section 2.1). */
export const AUDIO_CELL_FILL_PITCH_SEMITONES = 7;

/** Inspector's Stamp streak: +1 semitone per Stamp inside the window, capped (game-feel section 7). */
export const AUDIO_STAMP_STREAK_WINDOW_S = 60;
export const AUDIO_STAMP_STREAK_MAX_SEMITONES = 7;

/** At most one music stinger per this many milliseconds; the higher priority wins. */
export const AUDIO_STINGER_MIN_GAP_MS = 500;

/** Hearing ranges that exceed the channel default (audio-direction section 1.2), in metres. */
export const AUDIO_RANGE_M = { ground: 60, vehicle: 120, behemoth: 200, railshot: 300, relay: 25 } as const;

/** Simultaneous voices by hardware tier (audio-direction section 7.3). Tier C uses the Tier B numbers. */
export const AUDIO_VOICE_CAP = { A: 40, B: 24, C: 24 } as const;

/** Sources panned with HRTF by hardware tier; the rest use equal-power panning (section 7.1). */
export const AUDIO_HRTF_SOURCES = { A: 8, B: 4, C: 4 } as const;

/** Instance caps that replace crowds with an aggregate bed (section 7.3). */
export const AUDIO_OTHERS_TOOLS_INDIVIDUAL_MAX = 4;
export const AUDIO_OTHERS_FOOTSTEPS_MAX = 6;
export const AUDIO_ROBOTS_INDIVIDUAL_MAX = 6;

/** Most live audio nodes; the audio module pools nodes and never creates one per frame. */
export const AUDIO_ACTIVE_NODES_MAX = 150;

/** UI hover ticks are rate-limited to this many per second. */
export const AUDIO_UI_HOVER_MAX_PER_S = 12;
