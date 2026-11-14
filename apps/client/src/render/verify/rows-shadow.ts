// Matrix rows 1-3 (rendering-pipeline.md section 21): CSM custom splits / fade / lightMargin, re-pointing the CSM light
// at runtime, PCF kernel (radius) control. Examples: webgpu_shadowmap_csm, webgpu_shadowmap.

import { DirectionalLight, HemisphereLight, PCFShadowMap, type Mesh, Vector3, type Scene } from "three/webgpu";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import type { QualitySettings } from "@moon-cleanup/shared";
import { cascadeEndsM, CSM_LAMBDA, makeSplitsCallback } from "../bench/csm-splits";
import type { Rect } from "./analysis";
import { addBox, addGround, Checks, find, fmt, missing, Owner, placeCamera, screenRectOfBox, stat } from "./common";
import type { RowContext, RowDef, RowInstance } from "./types";

const SUN_INTENSITY = 3;
/** Direction toward the sun (unit-ish; elevation about 38 degrees), shadows fall toward +x / +z. */
const SUN_DIR: readonly [number, number, number] = [-0.55, 0.62, -0.45];
const SHADOW_DIR: readonly [number, number] = [0.774, 0.633];

export interface Rig {
  readonly owner: Owner;
  readonly sun: DirectionalLight;
  csm: CSMShadowNode | null;
}

export function buildRig(ctx: RowContext, settings: QualitySettings, useCsm: boolean, margin: number): Rig {
  const owner = new Owner();
  const scene: Scene = ctx.roots.scene;
  const renderer = ctx.renderer.renderer;
  if (renderer !== null) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
  }
  const sun = owner.own(new DirectionalLight(0xffffff, SUN_INTENSITY));
  sun.name = "mc:verify-sun";
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(settings.shadows.cascadeSizePx, settings.shadows.cascadeSizePx);
  sun.position.set(SUN_DIR[0] * 500, SUN_DIR[1] * 500, SUN_DIR[2] * 500);
  sun.target.position.set(0, 0, 0);
  owner.add(scene, sun);
  owner.add(scene, sun.target);
  const fill = owner.own(new HemisphereLight(0xdde6ff, 0x6b665e, 0.5));
  owner.add(scene, fill);
  let csm: CSMShadowNode | null = null;
  if (useCsm) {
    csm = new CSMShadowNode(sun, {
      cascades: settings.shadows.cascades,
      maxFar: settings.shadows.maxFarM,
      mode: "custom",
      customSplitsCallback: makeSplitsCallback(settings.shadows.cascade0SplitM, CSM_LAMBDA),
      lightMargin: margin,
    });
    csm.fade = ctx.params.get("fade") !== "0";
    sun.shadow.shadowNode = csm;
    owner.own({
      dispose: () => {
        sun.shadow.shadowNode = undefined;
        csm?.dispose();
      },
    });
  } else {
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(SUN_DIR[0] * 150, SUN_DIR[1] * 150, SUN_DIR[2] * 150);
    sun.position.add(new Vector3(8, 0, 12));
    sun.target.position.set(8, 0, 12);
  }
  return { owner, sun, csm };
}

/** Sets `radius` on every shadow that is actually sampled (the CSM clones the light's shadow per cascade). */
function setRadius(rig: Rig, radius: number): void {
  rig.sun.shadow.radius = radius;
  if (rig.csm !== null)
    for (const light of rig.csm.lights) if (light.shadow !== undefined) light.shadow.radius = radius;
}

const noop = (): void => undefined;

// ---- Row 1: CSM splits, fade, lightMargin -----------------------------------------------------------------------------

const row1: RowDef = {
  id: 1,
  name: "CSM custom splits, fade, lightMargin",
  feature: "`CSMShadowNode` custom splits, `fade`, `lightMargin`",
  settleFrames: 12,
  build(ctx): RowInstance {
    const settings = ctx.quality.current;
    const rig = buildRig(ctx, settings, true, 300);
    const { owner } = rig;
    const ends = cascadeEndsM(
      settings.shadows.cascades,
      settings.shadows.cascade0SplitM,
      settings.shadows.maxFarM,
      CSM_LAMBDA,
    );
    addGround(owner, ctx.roots.world, 800);
    // One box inside every cascade (middle of its distance range), size grown with distance so it reads on screen.
    const boxes: { x: number; z: number; ls: number; w: number }[] = [];
    const casters: Mesh[] = [];
    const bearings = [-0.5, -0.12, 0.2]; // tan of the bearing from the camera: the boxes do not hide each other
    let near = 0;
    let k = 0;
    for (const end of ends) {
      const dist = (near + end) / 2;
      const w = 0.1 * dist + 2;
      const h = 0.14 * dist + 3;
      const x = (bearings[k] ?? 0) * dist;
      casters.push(addBox(owner, ctx.roots.world, x, dist - 14, w, h, w));
      boxes.push({ x, z: dist - 14, ls: h * 1.27, w });
      near = end;
      k++;
    }
    // A tower outside the camera frustum (left of it) whose shadow falls into view: needs the light margin.
    casters.push(addBox(owner, ctx.roots.world, -30, 10, 3, 40, 3));
    placeCamera(ctx.roots.camera, [0, 6, -14], [0, 0, 24]);
    const csm = rig.csm;
    let variant = "base";
    return {
      variants: ["base", "no-casters"],
      ready: Promise.resolve(),
      setVariant(v) {
        variant = v;
        if (csm === null) return;
        for (const caster of casters) caster.visible = v !== "no-casters";
        // `fade` is read when the shader is built, so it is a URL option (`&fade=0`), not a variant.
      },
      update: noop,
      facts() {
        const facts: Record<string, string | number | boolean | null> = {
          variant,
          shadowMapType: ctx.renderer.renderer?.shadowMap.type ?? null,
          cascades: csm?.cascades ?? 0,
          mode: csm?.mode ?? null,
          fade: csm?.fade ?? null,
          lightMargin: csm?.lightMargin ?? null,
          maxFarM: settings.shadows.maxFarM,
          cascadeEndsM: ends.map((e) => e.toFixed(1)).join(","),
          csmBreaks: csm === null ? null : csm.breaks.map((b) => (b * settings.shadows.maxFarM).toFixed(1)).join(","),
          cascadeMapPx: settings.shadows.cascadeSizePx,
        };
        return facts;
      },
      regions() {
        const camera = ctx.roots.camera;
        const regions: Record<string, Rect> = {};
        boxes.forEach((b, i) => {
          const along = 0.6 * b.w + 0.35 * b.ls;
          const hx = Math.max(0.4, 0.12 * b.ls);
          const hz = Math.max(0.4, 0.09 * b.ls);
          regions[`shadow${String(i)}`] = screenRectOfBox(
            camera,
            [b.x + SHADOW_DIR[0] * along, 0, b.z + SHADOW_DIR[1] * along],
            [hx, 0.05, hz],
          );
        });
        const base: [number, number] = [-30, 10];
        const t = 44;
        const p: [number, number, number] = [base[0] + SHADOW_DIR[0] * t, 0, base[1] + SHADOW_DIR[1] * t];
        regions["tower"] = screenRectOfBox(camera, p, [0.9, 0.05, 0.9]);
        return regions;
      },
      dispose() {
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const base = find(measures, "base");
    if (base === undefined) return missing("base variant");
    const n = Number(base.facts["cascades"] ?? 0);
    c.expect(n >= 2, "cascade count", String(n));
    c.expect(base.facts["mode"] === "custom", "custom split mode accepted", String(base.facts["mode"]));
    const clear = find(measures, "no-casters");
    for (let i = 0; i < n; i++) {
      const ref = stat(clear, `shadow${String(i)}`);
      const s0 = stat(base, `shadow${String(i)}`);
      if (s0 !== undefined && ref !== undefined) {
        c.expect(
          s0.luma < 0.85 * ref.luma,
          `cascade ${String(i)} box casts a shadow`,
          `${fmt(s0.luma)} vs unshadowed ${fmt(ref.luma)}`,
        );
      }
    }
    const withMargin = stat(base, "tower");
    const towerRef = stat(clear, "tower");
    if (withMargin !== undefined && towerRef !== undefined) {
      c.expect(
        withMargin.luma < 0.85 * towerRef.luma,
        "lightMargin 300: off-screen caster shadows the view",
        `${fmt(withMargin.luma)} vs ${fmt(towerRef.luma)}`,
      );
    }
    return c.verdict();
  },
};

// ---- Row 2: re-pointing the CSM light ---------------------------------------------------------------------------------

const row2: RowDef = {
  id: 2,
  name: "Re-point the CSM light at runtime",
  feature: "Re-pointing the CSM light direction at runtime (Earth at night)",
  settleFrames: 8,
  build(ctx): RowInstance {
    const settings = ctx.quality.current;
    const rig = buildRig(ctx, settings, true, 300);
    const { owner, sun } = rig;
    addGround(owner, ctx.roots.world, 800);
    addBox(owner, ctx.roots.world, 0, 24, 4, 8, 4);
    // (shadow of the 8 m box reaches about 7 m in x and 6 m in z)
    placeCamera(ctx.roots.camera, [0, 6, 0], [0, 0, 24]);
    let variant = "sun";
    const dirA = SUN_DIR;
    // "Earth at night": other side, lower elevation, dimmer and bluish.
    const dirB: readonly [number, number, number] = [0.7, 0.35, 0.3];
    return {
      variants: ["sun", "earth", "sun-again"],
      ready: Promise.resolve(),
      setVariant(v) {
        variant = v;
        const d = v === "earth" ? dirB : dirA;
        sun.position.set(d[0] * 500, d[1] * 500, d[2] * 500);
        if (v === "earth") sun.color.setRGB(0.5, 0.65, 1);
        else sun.color.setRGB(1, 1, 1);
      },
      update: noop,
      facts() {
        return { variant, sunX: sun.position.x, cascades: rig.csm?.cascades ?? 0, lights: rig.csm?.lights.length ?? 0 };
      },
      regions() {
        const camera = ctx.roots.camera;
        // World +x is screen-left for a camera looking down +z. A: shadow toward (+x, +z). B: toward (-x, -z).
        return {
          shadowA: screenRectOfBox(camera, [5, 0, 28], [1.2, 0.05, 1.2]),
          litA: screenRectOfBox(camera, [-5, 0, 28], [1.2, 0.05, 1.2]),
          shadowB: screenRectOfBox(camera, [-7, 0, 21], [1.2, 0.05, 1.2]),
          litB: screenRectOfBox(camera, [7, 0, 26], [1.2, 0.05, 1.2]),
        };
      },
      dispose() {
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const sunM = find(measures, "sun");
    const earth = find(measures, "earth");
    const again = find(measures, "sun-again");
    const sA = stat(sunM, "shadowA");
    const lA = stat(sunM, "litA");
    const sB = stat(earth, "shadowB");
    const lB = stat(earth, "litB");
    if (sA === undefined || lA === undefined || sB === undefined || lB === undefined)
      return missing("sun / earth regions");
    c.expect(sA.luma < 0.8 * lA.luma, "light A: shadow on the +x/+z side", `${fmt(sA.luma)} vs lit ${fmt(lA.luma)}`);
    c.expect(
      sB.luma < 0.8 * lB.luma,
      "light re-pointed to B: shadow moved to the -x/-z side",
      `${fmt(sB.luma)} vs lit ${fmt(lB.luma)}`,
    );
    const aInB = stat(earth, "shadowA");
    const lAInB = stat(earth, "litA");
    if (aInB !== undefined && lAInB !== undefined) {
      c.expect(
        aInB.luma > 0.9 * lAInB.luma,
        "old shadow side is lit under B",
        `${fmt(aInB.luma)} vs ${fmt(lAInB.luma)}`,
      );
    }
    const sA2 = stat(again, "shadowA");
    const lA2 = stat(again, "litA");
    if (sA2 !== undefined && lA2 !== undefined) {
      c.expect(
        sA2.luma < 0.8 * lA2.luma,
        "re-pointed back to A: shadow returns",
        `${fmt(sA2.luma)} vs lit ${fmt(lA2.luma)}`,
      );
    }
    return c.verdict();
  },
};

// ---- Row 3: PCF kernel / radius ----------------------------------------------------------------------------------------

const row3: RowDef = {
  id: 3,
  name: "PCFShadowMap kernel / radius control",
  feature: "`PCFShadowMap` kernel/radius control",
  settleFrames: 8,
  build(ctx): RowInstance {
    const settings = ctx.quality.current;
    const useCsm = ctx.params.get("shadow") !== "plain";
    const rig = buildRig(ctx, settings, useCsm, 300);
    const { owner } = rig;
    addGround(owner, ctx.roots.world, 800);
    // A wide slab 6 m above the ground: its straight right edge makes a straight shadow edge.
    const slab = addBox(owner, ctx.roots.world, 0, 14, 20, 0.4, 20);
    slab.position.y = 6;
    // Shadow of the slab's right edge (x = 10) lands at 10 + 6 * 0.55 / 0.62.
    const edgeX = 10 + (6 * 0.55) / 0.62;
    placeCamera(ctx.roots.camera, [8, 7, -6], [edgeX, 0, 14]);
    let variant = "r1";
    const radii: Record<string, number> = { r1: 1, r3: 3, r8: 8 };
    setRadius(rig, 1);
    return {
      variants: ["r1", "r3", "r8"],
      ready: Promise.resolve(),
      setVariant(v) {
        variant = v;
        setRadius(rig, radii[v] ?? 1);
      },
      update: noop,
      facts() {
        return {
          variant,
          shadowMapType: ctx.renderer.renderer?.shadowMap.type ?? null,
          pcfConstant: PCFShadowMap,
          radius: rig.sun.shadow.radius,
          mode: useCsm ? "csm" : "plain",
        };
      },
      regions() {
        return { edge: screenRectOfBox(ctx.roots.camera, [edgeX, 0, 14], [2.2, 0.05, 2]) };
      },
      dispose() {
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const r1 = stat(find(measures, "r1"), "edge");
    const r3 = stat(find(measures, "r3"), "edge");
    const r8 = stat(find(measures, "r8"), "edge");
    if (r1 === undefined || r3 === undefined || r8 === undefined) return missing("edge regions");
    c.expect(r1.lumaHi - r1.lumaLo > 25, "shadow edge present", `luma range ${fmt(r1.lumaLo)}..${fmt(r1.lumaHi)}`);
    c.expect(
      r8.transitionFrac > r1.transitionFrac * 1.3,
      "radius 8 gives a wider transition band than radius 1",
      `transition fraction ${fmt(r1.transitionFrac)} / ${fmt(r3.transitionFrac)} / ${fmt(r8.transitionFrac)} for r1 / r3 / r8`,
    );
    c.expect(
      r3.transitionFrac > r1.transitionFrac,
      "band widens monotonically (r1 < r3)",
      `${fmt(r1.transitionFrac)} < ${fmt(r3.transitionFrac)}`,
    );
    return c.verdict();
  },
};

export const SHADOW_ROWS: readonly RowDef[] = [row1, row2, row3];
