import { describe, expect, it } from "vitest";
import { VoiceManager } from "./voice-manager";

describe("VoiceManager", () => {
  it("enforces per-cue cooldown", () => {
    const m = new VoiceManager(24);
    expect(m.acquire("cell.full", 3, 0, 0).ok).toBe(true);
    const again = m.acquire("cell.full", 3, 500, 1);
    expect(again).toMatchObject({ ok: false, reason: "cooldown" });
    // ui.click has no cooldown
    expect(m.acquire("ui.click", 2, 0, 2).ok).toBe(true);
    expect(m.acquire("ui.click", 2, 0, 3).ok).toBe(true);
  });

  it("limits instances per cue and steals the oldest equal-priority voice", () => {
    const m = new VoiceManager(24);
    // ui.hover maxVoices 2, cooldown 84 ms
    const a = m.acquire("ui.hover", 2, 0, 10);
    expect(a.ok).toBe(true);
    const b = m.acquire("ui.hover", 2, 100, 11);
    expect(b.ok).toBe(true);
    const c = m.acquire("ui.hover", 2, 200, 12);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.stealToken).toBe(10);
    expect(m.countOf("ui.hover")).toBe(2);
  });

  it("steals the lowest-priority voice when the global cap is hit, never a more important one", () => {
    const m = new VoiceManager(3);
    m.acquire("ambience.thermal_tick", 10, 0, 0);
    m.acquire("robot.step", 8, 0, 1);
    m.acquire("avatar.footstep", 3, 0, 2);
    expect(m.activeCount).toBe(3);
    const ui = m.acquire("ui.click", 2, 10, 3);
    expect(ui.ok).toBe(true);
    if (ui.ok) expect(ui.stealToken).toBe(0); // ambience (rank 10) goes first
    const dot = m.acquire("dot.bloop", 1, 20, 4);
    if (dot.ok) expect(dot.stealToken).toBe(1); // then the robot
    // A rank-10 newcomer cannot steal anything more important.
    const m2 = new VoiceManager(1);
    m2.acquire("ui.click", 2, 0, 0);
    expect(m2.acquire("ambience.thermal_tick", 10, 0, 1)).toMatchObject({ ok: false, reason: "budget" });
  });

  it("frees budget on release and tolerates a double release", () => {
    const m = new VoiceManager(1);
    const r = m.acquire("ui.click", 2, 0, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      m.release(r.slot);
      m.release(r.slot);
    }
    expect(m.activeCount).toBe(0);
    expect(m.countOf("ui.click")).toBe(0);
    expect(m.acquire("ui.click", 2, 1, 1).ok).toBe(true);
  });

  it("tier caps hold with a crowd of 16 players worth of events", () => {
    const m = new VoiceManager(24);
    let granted = 0;
    for (let i = 0; i < 200; i++) {
      const id =
        (["robot.peep", "avatar.footstep", "tool.sweep", "robot.peck", "cargo.puck_press"] as const)[i % 5] ??
        "robot.peep";
      const r = m.acquire(id, 8, i * 1000, i);
      if (r.ok) granted++;
      expect(m.activeCount).toBeLessThanOrEqual(24);
    }
    expect(granted).toBeGreaterThan(0);
  });
});
