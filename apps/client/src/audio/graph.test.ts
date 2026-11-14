import { AUDIO_ACTIVE_NODES_MAX, AUDIO_BUS_DEFAULT_DB } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { BufferStore } from "./buffer-store";
import { FakeContext, FakeFilter, FakeGain, FakeNode, FakeSource } from "./fake-audio";
import { AudioGraph, GROUND_MUFFLE_HZ, PANEL_MUFFLE_HZ, dbToLin, distanceGain } from "./graph";
import { CuePlayer } from "./player";
import { VoiceManager } from "./voice-manager";

function setup(cap = 24) {
  const ctx = new FakeContext();
  const graph = new AudioGraph(ctx, cap);
  const store = new BufferStore(ctx);
  const manager = new VoiceManager(cap);
  let nowMs = 0;
  const player = new CuePlayer(ctx, graph, store, manager, () => nowMs);
  return { ctx, graph, store, manager, player, tick: (ms: number) => (nowMs += ms) };
}

const lastSource = (ctx: FakeContext): FakeSource => {
  const s = ctx.sources[ctx.sources.length - 1];
  if (s === undefined) throw new Error("no source");
  return s;
};

describe("AudioGraph routing", () => {
  it("feeds every bus into master, then the limiter and the destination", () => {
    const { ctx, graph } = setup();
    expect((graph.master as unknown as FakeNode).reaches(ctx.destination)).toBe(true);
    const comp = ctx.compressors[0];
    expect(comp?.ratio.value).toBeGreaterThanOrEqual(10);
    for (const [bus, ch] of [
      ["ui", "ui"],
      ["tools", "contact"],
      ["world", "ground"],
      ["robots", "relay"],
      ["voice", "radio"],
      ["music", "music"],
      ["ambience", "suit"],
      ["foley", "suit"],
      ["vehicles", "contact"],
    ] as const) {
      const input = graph.input(bus, ch);
      expect((input as unknown as FakeNode).reaches(ctx.destination), `${bus}/${ch}`).toBe(true);
    }
  });

  it("applies the default bus levels from the contract", () => {
    const { graph, ctx } = setup();
    const ui = graph.input("ui", "ui") as FakeGain;
    const busGain = ui.outputs[0] as FakeGain;
    expect(busGain.gain.value).toBeCloseTo(dbToLin(AUDIO_BUS_DEFAULT_DB.ui), 5);
    void ctx;
  });

  it("puts the helmet-muffle low-pass on ground conduction and band-limits relay and radio", () => {
    const { graph } = setup();
    const ground = graph.input("world", "ground") as FakeGain;
    const filter = ground.outputs[0] as FakeFilter;
    expect(filter.type).toBe("lowpass");
    expect(filter.frequency.value).toBe(GROUND_MUFFLE_HZ);
    expect((graph.input("robots", "relay") as FakeGain).outputs[0]).toMatchObject({ type: "bandpass" });
    expect((graph.input("voice", "radio") as FakeGain).outputs[0]).toMatchObject({ type: "bandpass" });
    expect((graph.input("tools", "contact") as FakeGain).outputs[0]).toMatchObject({ type: "highshelf" });
  });

  it("returns the same node for the same bus and channel", () => {
    const { graph } = setup();
    expect(graph.input("world", "ground")).toBe(graph.input("world", "ground"));
  });

  it("mutes ground conduction when airborne and restores it on landing, including inputs created later", () => {
    const { graph } = setup();
    const ground = graph.input("world", "ground") as FakeGain;
    graph.setAirborne(true);
    expect(ground.gain.value).toBe(0);
    expect(ground.gain.targets[0]?.tc).toBeLessThanOrEqual(0.05);
    const late = graph.input("ambience", "ground") as FakeGain;
    expect(late.gain.value).toBe(0);
    graph.setAirborne(false);
    expect(ground.gain.value).toBe(1);
    expect(late.gain.value).toBe(1);
    const suit = graph.input("foley", "suit") as FakeGain;
    graph.setAirborne(true);
    expect(suit.gain.value).toBe(1); // suit and contact stay
  });

  it("lowers the muffle cutoff while a panel is open", () => {
    const { graph } = setup();
    const filter = (graph.input("world", "ground") as FakeGain).outputs[0] as FakeFilter;
    graph.setMuffleHz(PANEL_MUFFLE_HZ);
    expect(filter.frequency.value).toBe(PANEL_MUFFLE_HZ);
  });

  it("ducks buses with separate attack and release", () => {
    const { graph } = setup();
    const music = graph.input("music", "music") as FakeGain;
    const duck = (music.outputs[0] as FakeGain).outputs[0] as FakeGain;
    graph.setDuck("music", -6, 0.08, 0.4);
    expect(duck.gain.value).toBeCloseTo(dbToLin(-6), 5);
    expect(duck.gain.targets.at(-1)?.tc).toBe(0.08);
    graph.setDuck("music", 0, 0.08, 0.4);
    expect(duck.gain.targets.at(-1)?.tc).toBe(0.4);
  });

  it("scales buses with the player sliders", () => {
    const { graph } = setup();
    graph.setVolumes({ master: 0.5, effects: 0.5, music: 0, ambience: 1, interface: 1, voice: 1, breathing: 1 });
    expect(graph.master.gain.value).toBe(0.5);
    const music = (graph.input("music", "music") as FakeGain).outputs[0] as FakeGain;
    expect(music.gain.value).toBe(0);
    const tools = (graph.input("tools", "suit") as FakeGain).outputs[0] as FakeGain;
    expect(tools.gain.value).toBeCloseTo(dbToLin(AUDIO_BUS_DEFAULT_DB.tools) * 0.5, 5);
  });

  it("distance rolloff follows the inverse model and the hard range cap", () => {
    expect(distanceGain(1, 25)).toBe(1);
    expect(distanceGain(4, null)).toBeCloseTo(0.5, 5);
    expect(distanceGain(26, 25)).toBe(0);
    expect(distanceGain(24.9, 25)).toBeLessThan(0.05);
  });
});

describe("CuePlayer", () => {
  it("routes a UI cue through the ui bus and a robot cue through the relay band-pass", () => {
    const { ctx, player, graph } = setup();
    expect(player.play("ui.click", {})).toBe(true);
    const uiSrc = lastSource(ctx);
    expect(uiSrc.startedAt).toBe(0);
    const kinds = uiSrc.pathKinds(ctx.destination);
    expect(kinds).toContain("compressor");
    expect(player.play("robot.peep", { kindId: "robot.sandpiper" }, { distanceM: 10, pan: 0.5, other: true })).toBe(
      true,
    );
    const robot = lastSource(ctx);
    const path = robot.pathKinds(ctx.destination);
    expect(path).toContain("panner");
    expect(path).toContain("filter");
    void graph;
  });

  it("refuses a cue beyond its hearing range", () => {
    const { player } = setup();
    expect(player.play("robot.peep", { kindId: "k" }, { distanceM: 40, other: true })).toBe(false);
  });

  it("uses the suit-relay channel and a demoted rank for other players' tool sounds", () => {
    const { ctx, player, manager } = setup();
    player.play("tool.sweep", { speed01: 0.5, grime01: 1, fill01: 0, toolId: "t", dry: false }, { other: true });
    const filters = lastSource(ctx).pathKinds(ctx.destination);
    expect(filters).toContain("filter");
    expect(manager.countOf("tool.sweep")).toBe(1);
  });

  it("steals the lowest-priority voice with a fade when the cap is reached", () => {
    const { ctx, player, manager } = setup(2);
    player.play("ambience.thermal_tick", {});
    const thermal = lastSource(ctx);
    player.play("robot.peck", { kindId: "k" });
    expect(manager.activeCount).toBe(2);
    expect(player.play("ui.click", {})).toBe(true);
    expect(manager.activeCount).toBe(2);
    expect(thermal.stoppedAt).toBeCloseTo(0.03, 5);
  });

  it("returns pooled nodes when sources end and never creates nodes per play", () => {
    const { ctx, player } = setup();
    player.play("ui.click", {});
    const created = ctx.created;
    for (let i = 0; i < 20; i++) {
      player.play("ui.click", {});
      lastSource(ctx).end();
    }
    expect(ctx.created).toBe(created); // only buffer sources (not counted) are created per play
  });

  it("loops: update adjusts smoothly and stop frees the voice", () => {
    const { ctx, player, manager } = setup();
    const h = player.startLoop("tool.sweep", { speed01: 0.2, grime01: 1, fill01: 0, toolId: "t", dry: false });
    expect(h).not.toBeNull();
    if (h === null) return;
    const src = lastSource(ctx);
    expect(src.loop).toBe(true);
    player.update(h, "tool.sweep", { speed01: 1, grime01: 0, fill01: 0, toolId: "t", dry: false });
    expect(src.playbackRate.targets.length).toBe(1);
    expect(src.playbackRate.value).toBeGreaterThan(1.1);
    expect(player.isAlive(h)).toBe(true);
    player.stop(h, 0.09);
    expect(player.isAlive(h)).toBe(false);
    expect(manager.countOf("tool.sweep")).toBe(0);
    expect(src.stoppedAt).toBeCloseTo(0.09, 5);
    src.end();
  });

  it("applies per-cue cooldown through the voice manager", () => {
    const { player } = setup();
    expect(player.play("cell.full", {})).toBe(true);
    expect(player.play("cell.full", {})).toBe(false);
  });

  it("stays under the live node budget with a full house of voices", () => {
    const { ctx, player, graph, tick } = setup(24);
    const cues = [
      "avatar.footstep",
      "robot.peep",
      "tool.sweep",
      "cargo.puck_press",
      "assay.pour",
      "vehicle.drive_loop",
    ] as const;
    for (let i = 0; i < 100; i++) {
      tick(300);
      const id = cues[i % cues.length] ?? "ui.click";
      player.play(
        id,
        { speed01: 0.5, grime01: 1, fill01: 0, toolId: "t", dry: false, kindId: "k", load01: 0, rate01: 0.5 },
        { other: i % 2 === 0 },
      );
    }
    const liveSources = ctx.sources.filter(
      (s) => s.startedAt !== null && s.stoppedAt === null && s.onended !== null,
    ).length;
    expect(graph.nodeCount + liveSources).toBeLessThanOrEqual(AUDIO_ACTIVE_NODES_MAX);
    expect(player.activeVoices).toBeLessThanOrEqual(24);
  });
});
