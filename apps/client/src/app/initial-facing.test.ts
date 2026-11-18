import { describe, expect, it } from "vitest";
import { InitialFacing, simHeadingBearingDeg } from "./initial-facing";

const stations = [
  { kind: "desk", x: 0, y: 0, z: 1 },
  { kind: "assay_counter", x: 1, y: 0, z: 0 }, // east of the pole-facing spawn at (0,1,0)? use equator spawn below
];

function make(yaw: number, posed = true, list = stations) {
  let y = yaw;
  const f = new InitialFacing({
    stations: () => list,
    samplePos: (out) => {
      if (!posed) return false;
      out.x = 0;
      out.y = 0.2;
      out.z = 0.98;
      return true;
    },
    bearing: simHeadingBearingDeg,
    getYaw: () => y,
    setYaw: (v) => {
      y = v;
    },
  });
  return { f, yaw: () => y };
}

describe("initial camera facing", () => {
  it("uses the sim heading frame near the pole: spawn (43.5, 1999.2, 36.4) m, pad at the pole is NOT bearing 0", () => {
    const n = Math.hypot(43.52, 1999.19, 36.45);
    const deg = simHeadingBearingDeg({ x: 43.52 / n, y: 1999.19 / n, z: 36.45 / n }, { x: 0, y: 1, z: 0 })!;
    // yaw 0 walks toward +x (measured); the pad lies toward -x, -z, so roughly behind (about 180 +- 60 degrees).
    expect(Math.abs(Math.abs(deg) - 180)).toBeLessThan(60);
  });
  it("turns the fresh look toward the Assay Counter once", () => {
    const { f, yaw } = make(0);
    f.pump();
    const want = simHeadingBearingDeg({ x: 0, y: 0.2, z: 0.98 }, stations[1]!)! * (Math.PI / 180);
    expect(want).not.toBe(0);
    expect(yaw()).toBeCloseTo(want, 6);
    expect(f.applied).toBe(true);
  });
  it("waits for a pose and never overrides a player who already looked", () => {
    const a = make(0, false);
    a.f.pump();
    expect(a.f.applied).toBe(false);
    const b = make(1.2);
    b.f.pump();
    expect(b.yaw()).toBe(1.2);
  });
  it("falls back to the Desk", () => {
    const { f, yaw } = make(0, true, [stations[0]!]);
    f.pump();
    expect(yaw()).not.toBe(0);
  });
});
