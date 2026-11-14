// Earth disk (M0 look-polish r2, VT-M0-14): a screen-space disk of constant pixel size, not a perspective-stretched sphere.

import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { Earth, skyDiskRadiusNdc } from "./earth";
import { pixelsForAngle } from "./sky-math";

const W = 1920;
const H = 1080;

describe("sky disk size", () => {
  it("is a circle in pixels with the on-axis diameter of the angle (4.2 degrees = 68.6 px at 1080p, vFOV 60)", () => {
    const camera = new PerspectiveCamera(60, W / H, 0.1, 30_000);
    const r = { x: 0, y: 0 };
    skyDiskRadiusNdc(Math.tan((2.1 * Math.PI) / 180), camera.projectionMatrix.elements, r);
    const rxPx = (r.x * W) / 2;
    const ryPx = (r.y * H) / 2;
    expect(rxPx).toBeCloseTo(ryPx, 6);
    expect(2 * ryPx).toBeCloseTo(pixelsForAngle(4.2, 60, H), 6);
    expect(2 * ryPx).toBeCloseTo(68.6, 1);
  });

  it("does not depend on a TRAA view offset", () => {
    const camera = new PerspectiveCamera(60, W / H, 0.1, 30_000);
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    skyDiskRadiusNdc(0.03, camera.projectionMatrix.elements, a);
    camera.setViewOffset(W, H, 0.4, -0.3, W, H);
    skyDiskRadiusNdc(0.03, camera.projectionMatrix.elements, b);
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(b.y).toBeCloseTo(a.y, 12);
  });

  it("documents the defect it replaces: a sphere 32 degrees off axis projects 1.18 : 1", () => {
    // Rectilinear projection of a small sphere at angle t off the axis: radial extent ~ 1 / cos^2 t, tangential ~ 1 / cos t.
    const t = (32 * Math.PI) / 180;
    expect(1 / Math.cos(t)).toBeCloseTo(1.18, 2);
  });
});

describe("Earth meshes", () => {
  it("planet and halo are blended quads on one geometry, halo first, neither writes depth", () => {
    const earth = new Earth();
    expect(earth.mesh.geometry).toBe(earth.halo.geometry);
    expect(earth.mesh.geometry.getAttribute("position").count).toBe(4);
    expect(earth.halo.renderOrder).toBeLessThan(earth.mesh.renderOrder);
    for (const mesh of [earth.mesh, earth.halo]) {
      const material = mesh.material as unknown as { transparent: boolean; depthWrite: boolean; vertexNode: unknown };
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.vertexNode).not.toBeNull();
      expect(mesh.frustumCulled).toBe(false);
    }
    earth.dispose();
  });

  it("place and update write uniforms only", () => {
    const earth = new Earth();
    const internals = earth as unknown as {
      direction: { value: Vector3 };
      distance: { value: number };
      tanRadius: { value: number };
      haloStrength: { value: number };
    };
    const direction = internals.direction.value;
    earth.place(new Vector3(0, 0.6, 0.8), 20_000, 4.2);
    earth.update(new Vector3(1, 0, 0), 0.5, 0.25);
    expect(internals.direction.value).toBe(direction);
    expect(direction.toArray()).toEqual([0, 0.6, 0.8]);
    expect(internals.distance.value).toBe(20_000);
    expect(internals.tanRadius.value).toBeCloseTo(Math.tan((2.1 * Math.PI) / 180), 12);
    expect(internals.haloStrength.value).toBeCloseTo(0.15 + 0.85 * 0.25, 12);
    earth.dispose();
  });
});
