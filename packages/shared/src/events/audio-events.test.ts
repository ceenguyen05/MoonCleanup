import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AUDIO_CUE_IDS,
  AUDIO_EVENT_CUES,
  AUDIO_EVENT_CUES_V1_1,
  type AudioCueId,
  type AudioPlacement,
  type AudioSurface,
} from "../audio";
import type { EntityId } from "../ids";
import { EVENT_NAMES, type EventBus, type EventMap } from "./catalog";
import {
  DOT_SYLLABLES_MAX,
  DOT_SYLLABLES_MIN,
  PRESENTATION_EVENT_NAMES,
  SIM_EVENT_NAMES,
  type AudioCueEvent,
  type AudioSettingsEvent,
  type AvatarSteppedEvent,
  type DotMessageEvent,
  type VehicleMotionEvent,
} from "./gameplay";

describe("audio presentation events (events/gameplay v1.1)", () => {
  it("registers the four new presentation events once, and none as sim events", () => {
    for (const name of ["avatar.stepped", "vehicle.motion", "audio.cue", "audio.settings"] as const) {
      expect(PRESENTATION_EVENT_NAMES, name).toContain(name);
      expect(
        EVENT_NAMES.filter((n) => n === name),
        name,
      ).toHaveLength(1);
      expect(SIM_EVENT_NAMES as readonly string[], name).not.toContain(name);
    }
    expect(new Set(PRESENTATION_EVENT_NAMES).size).toBe(PRESENTATION_EVENT_NAMES.length);
  });

  it("types audio.cue per cue id", () => {
    const click: AudioCueEvent = { id: "ui.click", params: {} };
    const clockIn: AudioCueEvent = { id: "ui.clock_in", params: { gain: 0.8 } };
    const toggle: AudioCueEvent = { id: "ui.toggle", params: { on: true } };
    const far: AudioCueEvent = {
      id: "avatar.footstep",
      params: { surface: "grime", speed01: 0.5, placement: { distanceM: 12, pan: -0.4 } },
    };
    // @ts-expect-error -- ui.toggle needs `on`
    const bad: AudioCueEvent = { id: "ui.toggle", params: {} };
    // @ts-expect-error -- unknown cue id
    const unknown: AudioCueEvent = { id: "ui.nope", params: {} };
    expect([click, clockIn, toggle, far, bad, unknown]).toHaveLength(6);
    expectTypeOf<AudioCueEvent["id"]>().toEqualTypeOf<AudioCueId>();
    expectTypeOf<EventMap["audio.cue"]>().toEqualTypeOf<AudioCueEvent>();
  });

  it("types avatar.stepped, vehicle.motion and audio.settings", () => {
    const step: AvatarSteppedEvent = { tick: 10, actorSlot: 1, surface: "clean", speed01: 0.7 };
    const otherStep: AvatarSteppedEvent = { ...step, placement: { distanceM: 8, pan: 0.5 } };
    const motion: VehicleMotionEvent = {
      tick: 10,
      vehicleId: 7 as EntityId,
      kindId: "vehicle.trundle",
      actorSlot: null,
      speed01: 0.4,
      load01: 0.2,
      workIntensity01: 1,
    };
    const settings: AudioSettingsEvent = { monoAudio: false, captions: true };
    expect([step, otherStep, motion, settings]).toHaveLength(4);
    expectTypeOf<AvatarSteppedEvent["surface"]>().toEqualTypeOf<AudioSurface>();
    expectTypeOf<AvatarSteppedEvent["placement"]>().toEqualTypeOf<AudioPlacement | undefined>();
    expectTypeOf<VehicleMotionEvent["actorSlot"]>().toEqualTypeOf<number | null>();
    expectTypeOf<EventMap["audio.settings"]>().toEqualTypeOf<AudioSettingsEvent>();
  });

  it("delivers the new events over the typed bus", () => {
    const seen: string[] = [];
    const bus: Pick<EventBus, "emit"> = { emit: (name) => void seen.push(name) };
    bus.emit("audio.cue", { id: "ui.click", params: {} });
    bus.emit("audio.settings", { monoAudio: true, captions: false });
    // @ts-expect-error -- audio.settings has no `id`
    bus.emit("audio.settings", { id: "ui.click", params: {} });
    expect(seen).toEqual(["audio.cue", "audio.settings", "audio.settings"]);
  });

  it("adds optional placement and syllables without breaking old payloads", () => {
    const dot: DotMessageEvent = { textId: "dot.welcome", params: {}, priority: "action", keep: true };
    const dotWithHint: DotMessageEvent = { ...dot, syllables: 9 };
    expect(dotWithHint.syllables).toBeGreaterThanOrEqual(DOT_SYLLABLES_MIN);
    expect(dotWithHint.syllables).toBeLessThanOrEqual(DOT_SYLLABLES_MAX);
    expectTypeOf<EventMap["dot.message"]["syllables"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EventMap["tool.stroke_contact"]["placement"]>().toEqualTypeOf<AudioPlacement | undefined>();
    expectTypeOf<EventMap["avatar.jumped"]["placement"]>().toEqualTypeOf<AudioPlacement | undefined>();
    expectTypeOf<EventMap["avatar.landed"]["placement"]>().toEqualTypeOf<AudioPlacement | undefined>();
  });

  it("wires the new cue-starting events to real cues without touching AUDIO_EVENT_CUES", () => {
    const eventNames: readonly string[] = EVENT_NAMES;
    for (const [event, cues] of Object.entries(AUDIO_EVENT_CUES_V1_1)) {
      expect(eventNames, event).toContain(event);
      expect(Object.keys(AUDIO_EVENT_CUES), event).not.toContain(event);
      for (const cue of cues) expect(AUDIO_CUE_IDS, `${event} -> ${cue}`).toContain(cue);
    }
    expect(AUDIO_EVENT_CUES_V1_1["avatar.stepped"]).toEqual(["avatar.footstep"]);
    expect(AUDIO_EVENT_CUES_V1_1["vehicle.motion"]).toEqual(["vehicle.drive_loop", "vehicle.work_loop"]);
  });
});
