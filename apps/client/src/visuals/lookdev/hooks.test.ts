// `__mcLook.info()`: the camera (VT-M0-12 sidecar: pose + vertical FOV as a read-only snapshot), the sidecar knobs the
// harness copies by name (`shadowMapSize`, `adaptationMultiplier`), and `probes()` leaving out a probe that does not exist.

import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera } from "three/webgpu";
import { installLookHooks, readLookCamera, type HookSources, type LookHookHost } from "./hooks";
import { createLookState, type LookScene } from "./scene-base";

function sources(camera: PerspectiveCamera, scene: LookScene | null = null): HookSources {
  return {
    sceneId: "s01",
    scene: () => scene,
    state: createLookState(),
    camera,
    viewport: () => ({ widthCssPx: 1280, heightCssPx: 720 }),
    info: () => ({
      keyMode: "sun",
      ev100: 14,
      cascades: [],
      shadowMapSize: 1024,
      adaptationMultiplier: 0,
      preset: "low",
      backend: "webgpu",
      postPasses: ["scene", "grade", "bloom", "fxaa"],
      knobs: "default",
      skyDome: "baked",
      shadowFilter: "pcf3",
      dustAtlas: null,
      notBuilt: ["dustRing", "particles"],
    }),
    setGrade: () => undefined,
    setBump: () => undefined,
  };
}

describe("readLookCamera", () => {
  it("reports world position, orientation, view direction and the vertical FOV", () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 20_000);
    camera.position.set(3, 1.7, -4);
    camera.lookAt(3, 1.7, -14);
    const info = readLookCamera(camera);
    expect(info.position).toEqual([3, 1.7, -4]);
    expect(info.forward[0]).toBeCloseTo(0, 6);
    expect(info.forward[1]).toBeCloseTo(0, 6);
    expect(info.forward[2]).toBeCloseTo(-1, 6);
    expect(Math.hypot(...info.quaternion)).toBeCloseTo(1, 6);
    expect(info.vfovDeg).toBeCloseTo(50, 6);
    expect(info.aspect).toBeCloseTo(16 / 9, 6);
    expect(info.nearM).toBe(0.1);
    expect(info.farM).toBe(20_000);
  });

  it("is in world space under a moved parent and applies the zoom to the FOV", () => {
    const parent = new Group();
    parent.position.set(100, 0, 50);
    parent.rotation.y = Math.PI / 2;
    const camera = new PerspectiveCamera(60, 1, 0.5, 100);
    camera.position.set(0, 2, 10);
    camera.zoom = 2;
    parent.add(camera);
    const info = readLookCamera(camera);
    // +Z of the parent maps to +X of the world after a +90 degree yaw; the camera's -Z view direction maps to -X.
    expect(info.position[0]).toBeCloseTo(110, 5);
    expect(info.position[1]).toBeCloseTo(2, 5);
    expect(info.position[2]).toBeCloseTo(50, 5);
    expect(info.forward[0]).toBeCloseTo(-1, 5);
    expect(info.forward[2]).toBeCloseTo(0, 5);
    const zoomed = (2 * Math.atan(Math.tan((60 * Math.PI) / 360) / 2) * 180) / Math.PI;
    expect(info.vfovDeg).toBeCloseTo(zoomed, 5);
    expect(info.vfovDeg).toBeLessThan(60);
  });

  it("does not change the camera's own transform or projection", () => {
    const camera = new PerspectiveCamera(42, 2, 0.2, 500);
    camera.position.set(-5, 3, 8);
    camera.lookAt(0, 0, 0);
    const position = camera.position.toArray();
    const quaternion = camera.quaternion.toArray();
    const projection = camera.projectionMatrix.toArray();
    readLookCamera(camera);
    expect(camera.position.toArray()).toEqual(position);
    expect(camera.quaternion.toArray()).toEqual(quaternion);
    expect(camera.projectionMatrix.toArray()).toEqual(projection);
    expect(camera.fov).toBe(42);
  });
});

describe("__mcLook.info().camera", () => {
  it("is part of info(), tracks the live camera per call and cannot move it", () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    camera.position.set(1, 2, 3);
    const host: LookHookHost = {};
    const remove = installLookHooks(host, sources(camera));
    const first = host.__mcLook?.info();
    expect(first?.camera.position).toEqual([1, 2, 3]);
    expect(first?.camera.vfovDeg).toBeCloseTo(50, 6);
    // The other fields are still there.
    expect(first?.scene).toBe("s01");
    expect(first?.postPasses).toContain("fxaa");

    // A snapshot: writing into it leaves the camera alone, and a later call reads the camera again.
    (first?.camera.position as [number, number, number])[0] = 999;
    expect(camera.position.x).toBe(1);
    camera.position.set(7, 8, 9);
    camera.fov = 35;
    camera.updateProjectionMatrix();
    const second = host.__mcLook?.info();
    expect(second?.camera.position).toEqual([7, 8, 9]);
    expect(second?.camera.vfovDeg).toBeCloseTo(35, 6);
    expect(first?.camera.position[1]).toBe(2);

    remove();
    expect(host.__mcLook).toBeUndefined();
  });
});

describe("__mcLook.info() sidecar knobs", () => {
  it("reports the fields the screenshot harness copies by name as finite numbers, and no knob of a feature that is not built", () => {
    const host: LookHookHost = {};
    const remove = installLookHooks(host, sources(new PerspectiveCamera()));
    const info = host.__mcLook?.info() as unknown as Record<string, unknown>;
    // tools/screenshots `sidecar.ts` reads these keys from `__mcLook.info()` when they are finite numbers.
    expect(info["shadowMapSize"]).toBe(1024);
    expect(info["adaptationMultiplier"]).toBe(0);
    expect(info["preset"]).toBe("low");
    expect(info["dustAtlas"]).toBeNull();
    expect(info["notBuilt"]).toEqual(["dustRing", "particles"]);
    for (const absent of ["dustRingTexelCm", "particlePool", "particlesLive"]) expect(absent in info).toBe(false);
    remove();
  });
});

describe("__mcLook.probes()", () => {
  it("projects the scene's probes and leaves out one that does not exist at this sun", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    camera.position.set(0, 2, -10);
    camera.lookAt(0, 0, 0);
    const scene: LookScene = {
      id: "t",
      views: [],
      probes: {
        ahead: () => [0, 0, 0],
        gone: () => null,
        onlyAtNoon: (s) => (s.sunElevationDeg >= 60 ? [1, 0, 0] : null),
      },
      setView: () => undefined,
      update: () => undefined,
      dispose: () => undefined,
    };
    const host: LookHookHost = {};
    const remove = installLookHooks(host, sources(camera, scene));
    const noon = host.__mcLook?.probes() ?? {};
    expect(Object.keys(noon).sort()).toEqual(["ahead", "onlyAtNoon"]);
    expect(noon["ahead"]?.world).toEqual([0, 0, 0]);
    expect(noon["ahead"]?.px.visible).toBe(true);
    expect(noon["ahead"]?.px.x).toBeCloseTo(640, 3);

    host.__mcLook?.set({ sunElevationDeg: 15 });
    expect(Object.keys(host.__mcLook?.probes() ?? {})).toEqual(["ahead"]);
    remove();
  });
});
