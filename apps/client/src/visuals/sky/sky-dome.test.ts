// Per-pixel sky lookup (M1-W2-T02, sky seam fix): the direction -> bake coordinate map is the exact inverse of the bake
// parametrisation, has no bends between facet rows, and the dome follows the site's up.
import { describe, expect, it } from "vitest";
import { Vector3 } from "three/webgpu";
import { SkyDome, skyBakeCoordOfDirection, skyBakeDirection } from "./sky-dome";

describe("sky dome per-pixel lookup", () => {
  it("inverts the bake parametrisation above the horizon, wrapping u into [0, 1)", () => {
    const d = { x: 0, y: 0, z: 0 };
    const c = { u: 0, t: 0 };
    for (let i = 0; i < 64; i++) {
      for (let j = 0; j <= 16; j++) {
        const u = i / 64;
        const t = (j / 16) * 0.999;
        skyBakeDirection(u, t, d);
        skyBakeCoordOfDirection(d.x, d.y, d.z, c);
        expect(c.t).toBeCloseTo(t, 6);
        if (t < 0.99) expect(Math.abs(((c.u - u + 1.5) % 1) - 0.5)).toBeLessThan(1e-6);
        expect(c.u).toBeGreaterThanOrEqual(0);
        expect(c.u).toBeLessThan(1);
      }
    }
  });

  it("repeats the horizon row below the horizon", () => {
    const c = { u: 0, t: 0 };
    skyBakeCoordOfDirection(0.6, -0.8, 0, c);
    expect(c.t).toBe(0);
  });

  it("elevation is linear in t across a facet row (no seam bend)", () => {
    // Directions 0.1 degree apart in elevation across what used to be one facet row (0..5.6 degrees): the step of t is
    // constant, where the old vertex-uv lookup bent at the row edges.
    const c = { u: 0, t: 0 };
    const steps: number[] = [];
    let last = 0;
    for (let k = 0; k <= 60; k++) {
      const el = (k * 0.1 * Math.PI) / 180;
      skyBakeCoordOfDirection(Math.cos(el), Math.sin(el), 0, c);
      if (k > 0) steps.push(c.t - last);
      last = c.t;
    }
    const first = steps[0] ?? 0;
    for (const s of steps) expect(s).toBeCloseTo(first, 9);
  });

  it("orient() turns the dome onto the site's up and brings the sun into the dome frame", () => {
    const dome = new SkyDome("procedural");
    const up = new Vector3(Math.sin(0.3), Math.cos(0.3), 0);
    dome.orient(up);
    const local = new Vector3(0, 1, 0).applyQuaternion(dome.mesh.quaternion);
    expect(local.distanceTo(up)).toBeLessThan(1e-6);
    // A sun exactly at the site's zenith is the dome's +Y.
    dome.update(up, 1, true);
    const sun = (dome as unknown as { sunDir: { value: Vector3 } }).sunDir.value;
    expect(sun.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    dome.dispose();
  });
});
