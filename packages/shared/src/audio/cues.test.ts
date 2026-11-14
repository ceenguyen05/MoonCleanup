import { describe, expect, expectTypeOf, it } from "vitest";
import { EVENT_NAMES } from "../events";
import {
  AUDIO_BUSES,
  AUDIO_BUS_DEFAULT_DB,
  AUDIO_CHANNELS,
  AUDIO_CUE_DEFS,
  AUDIO_CUE_IDS,
  AUDIO_EVENT_CUES,
  AUDIO_HRTF_SOURCES,
  AUDIO_VOICE_CAP,
  type AudioCueId,
  type AudioCueParamMap,
  type AudioCuePlay,
} from "./cues";

describe("audio cue catalog v1", () => {
  it("lists every cue id once, in step with the definitions", () => {
    expect(new Set(AUDIO_CUE_IDS).size).toBe(AUDIO_CUE_IDS.length);
    expect([...AUDIO_CUE_IDS].sort()).toEqual(Object.keys(AUDIO_CUE_DEFS).sort());
    expectTypeOf<(typeof AUDIO_CUE_IDS)[number]>().toEqualTypeOf<AudioCueId>();
    expectTypeOf<keyof typeof AUDIO_CUE_DEFS>().toEqualTypeOf<AudioCueId>();
  });

  it("covers the MVP SFX set of scope-tiers section 1", () => {
    for (const id of [
      "tool.sweep",
      "assay.pour",
      "assay.ka_ching",
      "plot.stamp",
      "vehicle.drive_loop",
      "vehicle.work_loop",
      "robot.peep",
      "ambience.suit_bed",
      "music.day",
      "music.night",
      "dot.bloop",
    ] as const) {
      expect(AUDIO_CUE_IDS).toContain(id);
    }
  });

  it("names every cue <domain>.<name> in lower snake case", () => {
    for (const id of AUDIO_CUE_IDS) expect(id).toMatch(/^[a-z]+\.[a-z][a-z_]*$/);
  });

  it("routes every cue to a known bus and channel with sane limits", () => {
    for (const id of AUDIO_CUE_IDS) {
      const def = AUDIO_CUE_DEFS[id];
      expect(AUDIO_BUSES, id).toContain(def.bus);
      expect(AUDIO_CHANNELS, id).toContain(def.channel);
      expect(def.priority, id).toBeGreaterThanOrEqual(1);
      expect(def.priority, id).toBeLessThanOrEqual(10);
      expect(def.maxVoices, id).toBeGreaterThanOrEqual(1);
      expect(def.cooldownMs, id).toBeGreaterThanOrEqual(0);
      if (def.maxDistanceM !== null) expect(def.maxDistanceM, id).toBeGreaterThan(0);
    }
  });

  it("keeps the rules of audio-direction sections 1 and 5", () => {
    expect(AUDIO_BUS_DEFAULT_DB.master).toBe(0);
    expect(AUDIO_BUS_DEFAULT_DB.music).toBe(-12);
    expect(Object.keys(AUDIO_BUS_DEFAULT_DB).sort()).toEqual([...AUDIO_BUSES].sort());
    // Voice cues are on the voice bus at top priority; UI cues never carry a distance limit.
    for (const id of AUDIO_CUE_IDS) {
      const def = AUDIO_CUE_DEFS[id];
      if (def.bus === "voice") expect(def.priority).toBe(1);
      if (def.bus === "ui") expect(def.maxDistanceM).toBeNull();
      // Nothing is heard from far away: relay cues stay within 25 m except the Railshot charge.
      if (def.channel === "relay" && id !== "railshot.charge") expect(def.maxDistanceM).toBeLessThanOrEqual(25);
      if (def.channel === "ground") expect(def.maxDistanceM ?? 60).toBeLessThanOrEqual(300);
      // Loops and beds are never stingers and stingers play once.
      if (def.kind === "stinger") expect(def.maxVoices).toBe(1);
    }
    expect(AUDIO_VOICE_CAP.A).toBe(40);
    expect(AUDIO_VOICE_CAP.B).toBe(24);
    expect(AUDIO_HRTF_SOURCES.A).toBe(8);
  });

  it("wires only real events to real cues", () => {
    const eventNames: readonly string[] = EVENT_NAMES;
    for (const [event, cues] of Object.entries(AUDIO_EVENT_CUES)) {
      expect(eventNames, event).toContain(event);
      for (const cue of cues) expect(AUDIO_CUE_IDS, `${event} -> ${cue}`).toContain(cue);
    }
  });

  it("types cue parameters per cue", () => {
    const stamp: AudioCuePlay<"plot.stamp"> = { streak: 3, charged: false, own: true, gain: 0.8 };
    const click: AudioCuePlay<"ui.click"> = { gain: 1 };
    // @ts-expect-error -- plot.stamp needs its own parameters
    const bad: AudioCuePlay<"plot.stamp"> = { gain: 1 };
    expect([stamp, click, bad].length).toBe(3);
    expectTypeOf<AudioCueParamMap["tool.sweep"]["toolId"]>().toEqualTypeOf<string>();
    expectTypeOf<string>().not.toExtend<AudioCueId>();
  });
});
