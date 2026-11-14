import { describe, expect, expectTypeOf, it } from "vitest";
import { AUDIO_CUE_IDS, type AudioCueId } from "./audio";
import { MAX_PLAYERS_PER_ROOM, type RoomSim } from "./sim";
import { INITIAL_UI_STATE, UI_FLUSH_MAX_HZ, type UiState } from "./ui";
import { CHUNK_COUNT, CHUNK_EDGE_PLOTS, POLE_CHUNK_ID, PlotState, STANDARD_GRID_M, STANDARD_PLOT_COUNT } from "./world";

describe("world v0", () => {
  it("has the Standard grid numbers of world-and-dust section 2.4", () => {
    expect(STANDARD_GRID_M).toBe(128);
    expect(STANDARD_PLOT_COUNT).toBe(163_842);
    expect(POLE_CHUNK_ID * CHUNK_EDGE_PLOTS * CHUNK_EDGE_PLOTS + 2).toBe(STANDARD_PLOT_COUNT);
    expect(CHUNK_COUNT).toBe(641);
  });

  it("has the 2-bit plot state codes", () => {
    expect(PlotState).toEqual({ Grimy: 0, Opened: 1, Polished: 2, Empty: 3 });
  });
});

describe("sim, ui, audio v0", () => {
  it("sim placeholder", () => {
    expect(MAX_PLAYERS_PER_ROOM).toBe(6);
    expectTypeOf<RoomSim["step"]>().parameters.toEqualTypeOf<[dt: number]>();
  });

  it("ui initial state", () => {
    expect(UI_FLUSH_MAX_HZ).toBe(15);
    expectTypeOf(INITIAL_UI_STATE).toExtend<UiState>();
    expect(INITIAL_UI_STATE.session.conn).toBe("asleep");
  });

  it("audio cue ids are a closed literal union", () => {
    expect(AUDIO_CUE_IDS.length).toBeGreaterThan(40);
    expectTypeOf<string>().not.toExtend<AudioCueId>();
  });
});
