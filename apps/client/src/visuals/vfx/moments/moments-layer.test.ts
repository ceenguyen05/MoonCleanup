import { describe, expect, it } from "vitest";
import { MOMENT_POUR, MOMENT_RAILSHOT, MOMENT_STAMP, MomentFx, STAMP_OUTLINE_S } from "./moments";
import { FLASH_RADIUS_M, MOMENT_LIFT_M, MomentsLayer, RAILSHOT_RADIUS_M } from "./moments-layer";

describe("MomentsLayer", () => {
  it("builds one draw (hidden, zero instances) that is off while nothing is live", () => {
    const layer = new MomentsLayer();
    const fx = new MomentFx(null);
    layer.update(fx);
    expect(layer.mesh.visible).toBe(false);
    expect(layer.drawn).toBe(0);
    layer.dispose();
  });

  it("packs only live slots (kind, curve values, lifted position) and hides again when they end", () => {
    const layer = new MomentsLayer();
    const fx = new MomentFx(null);
    fx.trigger(MOMENT_STAMP, 1, 2, 3, 6.4);
    fx.trigger(MOMENT_POUR, 4, 0, 5);
    fx.trigger(MOMENT_RAILSHOT, 0, 0, 0);
    fx.update(0.3); // every kind still live (pour flash lasts 0.35 s), Stamp outline well under STAMP_OUTLINE_S
    expect(0.3).toBeLessThan(STAMP_OUTLINE_S);
    layer.update(fx);
    expect(layer.mesh.visible).toBe(true);
    expect(layer.drawn).toBe(3);
    const a = layer.mesh.geometry.getAttribute("aMomA").array as Float32Array;
    const b = layer.mesh.geometry.getAttribute("aMomB").array as Float32Array;
    expect([a[0], a[1], a[2], a[3]]).toEqual([1, Math.fround(2 + MOMENT_LIFT_M), 3, Math.fround(6.4)]);
    expect(b[0]).toBe(MOMENT_STAMP);
    expect(b[1]).toBeGreaterThan(0.5); // outline mostly drawn at half time (ease-out)
    expect(b[2]).toBe(0); // emblem not landed yet
    expect(a[7]).toBeCloseTo(FLASH_RADIUS_M, 5);
    expect(b[4]).toBe(MOMENT_POUR);
    expect(a[11]).toBeCloseTo(RAILSHOT_RADIUS_M, 5);
    fx.update(10);
    layer.update(fx);
    expect(layer.mesh.visible).toBe(false);
    expect(layer.drawn).toBe(0);
    layer.dispose();
  });
});
