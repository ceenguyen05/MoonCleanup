// Star field (M0 look-polish r2): jitter cancellation, sub-pixel peak compensation and the scene / layer switch.

import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three/webgpu";
import { PEAK_COMPENSATION, STAR_SIGMA_PER_RADIUS, StarField, sampledPeak, viewOffsetCancelNdc } from "./star-field";
import { generateStars, starRadiusPx } from "./star-catalog";

describe("view-offset (TRAA jitter) cancellation", () => {
  it("is zero without an enabled view offset", () => {
    const out = { x: 9, y: 9 };
    viewOffsetCancelNdc(null, out);
    expect(out).toEqual({ x: 0, y: 0 });
    viewOffsetCancelNdc({ enabled: false, fullWidth: 1920, fullHeight: 1080, offsetX: 0.3, offsetY: -0.2 }, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it("is the exact opposite of what three's setViewOffset does to a projected point", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 30_000);
    camera.position.set(3, 2, -5);
    camera.lookAt(10, 6, 40);
    camera.updateMatrixWorld();
    const point = new Vector3(-40, 55, 300);
    const plain = point.clone().project(camera);

    for (const [jx, jy] of [
      [0.5, 0.5],
      [-0.25, 0.4],
      [0.31, -0.47],
    ] as const) {
      camera.setViewOffset(1920, 1080, jx, jy, 1920, 1080);
      const jittered = point.clone().project(camera);
      const cancel = { x: 0, y: 0 };
      viewOffsetCancelNdc(camera.view, cancel);
      expect(jittered.x + cancel.x).toBeCloseTo(plain.x, 6);
      expect(jittered.y + cancel.y).toBeCloseTo(plain.y, 6);
      // One pixel of jitter is 2 / size in NDC.
      expect(Math.abs(cancel.x)).toBeCloseTo((2 * Math.abs(jx)) / 1920, 9);
      expect(Math.abs(cancel.y)).toBeCloseTo((2 * Math.abs(jy)) / 1080, 9);
      camera.clearViewOffset();
    }
  });
});

describe("sub-pixel peak compensation", () => {
  it("keeps the peak of the faintest star within 10 % along one axis (VT-M0-13)", () => {
    const sigma = starRadiusPx(6.5) * STAR_SIGMA_PER_RADIUS;
    expect(sigma).toBeGreaterThanOrEqual(0.79);
    const worst = sampledPeak(sigma, 0.5);
    expect(worst).toBeGreaterThan(0.9);
    // Without the compensation the same star loses about twice as much.
    expect(sampledPeak(sigma, 0.5, 0)).toBeLessThan(worst);
    expect(sampledPeak(sigma, 0, 0)).toBe(1);
  });

  it("splits the loss between peak and flux", () => {
    expect(PEAK_COMPENSATION).toBeGreaterThan(0);
    expect(PEAK_COMPENSATION).toBeLessThan(1);
    const sigma = 0.9;
    const raw = sampledPeak(sigma, 0.5, 0);
    expect(sampledPeak(sigma, 0.5)).toBeCloseTo(Math.pow(raw, 1 - PEAK_COMPENSATION), 9);
  });
});

describe("scene / layer mode", () => {
  it("moves the one mesh between the sky group and the layer scene", () => {
    const stars = new StarField(generateStars(1, [[1, 2, 5]]));
    const sky = new Group();
    expect(stars.mesh.geometry.getAttribute("position").count).toBe(5 * 4);
    stars.setLayerMode(false, sky);
    expect(stars.mesh.parent).toBe(sky);
    expect(stars.layerMode).toBe(false);
    stars.setLayerMode(true, sky);
    expect(stars.mesh.parent).toBe(stars.layerScene);
    expect(sky.children).toHaveLength(0);
    expect(stars.layerMode).toBe(true);
    stars.setLayerMode(false, null);
    expect(stars.mesh.parent).toBeNull();
    stars.dispose();
  });

  it("update writes the Earth disk only when there is an Earth", () => {
    const stars = new StarField(generateStars(1, [[1, 2, 3]]));
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 30_000);
    const internals = stars as unknown as { earthTan: { value: number }; distance: { value: number } };
    stars.update(camera, 6.5);
    expect(internals.earthTan.value).toBeLessThan(0);
    expect(internals.distance.value).toBeCloseTo(21_000, 6);
    stars.update(camera, 6.5, 1, new Vector3(0, 0, 1), 4.2);
    expect(internals.earthTan.value).toBeCloseTo(Math.tan((2.1 * Math.PI) / 180), 9);
    stars.dispose();
  });
});
