/* eslint-disable @typescript-eslint/no-explicit-any */
// Matrix rows 5, 10, 13 (rendering-pipeline.md section 21): specular-only environment probe, clustered lighting,
// compute + storage textures + copyTextureToTexture. TSL values are typed loosely (the node typings are per value type).

import {
  BackSide,
  CubeCamera,
  DataTexture,
  CubeRenderTarget,
  HalfFloatType,
  LightingNode,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PMREMGenerator,
  PointLight,
  Scene,
  SphereGeometry,
  StorageTexture,
} from "three/webgpu";
import {
  Fn,
  cameraWorldMatrix,
  float,
  instanceIndex,
  instancedArray,
  mix,
  normalView,
  pmremTexture,
  positionLocal,
  positionViewDirection,
  roughness,
  smoothstep,
  step,
  texture,
  textureStore,
  uvec2,
  vec3,
  vec4,
} from "three/tsl";
import { ClusteredLighting } from "three/addons/lighting/ClusteredLighting.js";
import type { Rect } from "./analysis";
import {
  addFlatQuad,
  addGround,
  Checks,
  find,
  fmt,
  missing,
  Owner,
  placeCamera,
  screenRectOfBox,
  stat,
} from "./common";
import type { RowDef, RowInstance } from "./types";

const noop = (): void => undefined;

type Facts = Record<string, string | number | boolean | null>;

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

// ---- Row 5: specular-only environment ----------------------------------------------------------------------------------

/** Adds only the radiance (specular) term of a PMREM texture: the irradiance term of `EnvironmentNode` is skipped. */
class SpecularOnlyEnvironment extends LightingNode {
  private readonly envTexture: any;

  constructor(envTexture: any) {
    super();
    this.envTexture = envTexture;
  }

  override setup(builder: any): any {
    // The same reflection vector as EnvironmentNode's radiance context (mixed toward the normal for rough surfaces).
    const reflectVec = positionViewDirection.negate().reflect(normalView);
    const mixed = roughness.pow(4).mix(reflectVec, normalView).normalize().transformDirection(cameraWorldMatrix);
    const radiance = pmremTexture(this.envTexture, mixed, roughness);
    builder.context.radiance.addAssign(radiance);
    return vec3(0, 0, 0);
  }
}

const row5: RowDef = {
  id: 5,
  name: "Specular-only environment (PMREM from a cube render target)",
  feature: "Specular-only environment (PMREM from cube render target, irradiance disabled)",
  settleFrames: 6,
  build(ctx): RowInstance {
    const owner = new Owner();
    const renderer = ctx.renderer.renderer;
    if (renderer === null) throw new Error("no renderer");
    const facts: Facts = {};
    // 1. Capture a small HDR "sky" (red / blue halves, bright zenith) into a half-float cube render target.
    const sky = new Scene();
    const skyMaterial = owner.own(new MeshBasicNodeMaterial({ side: BackSide }));
    const dir = positionLocal.normalize();
    skyMaterial.colorNode = vec4(
      mix(mix(vec3(0.1, 0.2, 3), vec3(3, 0.2, 0.1), step(0, dir.x)), vec3(6, 6, 6), smoothstep(0.5, 0.7, dir.y)),
      1,
    );
    const skyGeometry = owner.own(new SphereGeometry(50, 32, 16));
    sky.add(new Mesh(skyGeometry, skyMaterial));
    const cubeTarget = owner.own(new CubeRenderTarget(128));
    cubeTarget.texture.type = HalfFloatType;
    const cubeCamera = new CubeCamera(0.1, 100, cubeTarget);
    const t0 = performance.now();
    cubeCamera.update(renderer, sky);
    // 2. Prefilter it with PMREM.
    const pmrem = owner.own(new PMREMGenerator(renderer));
    const prefiltered = owner.own(pmrem.fromCubemap(cubeTarget.texture));
    facts["pmremBuildMs"] = Math.round(performance.now() - t0);
    facts["pmremIsCubeUV"] = prefiltered.texture.isRenderTargetTexture === true;

    // 3. Two spheres: glossy metal (reflection) and matte dielectric (irradiance if the term is enabled).
    const glossy = owner.own(new MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.15, metalness: 1 }));
    const matte = owner.own(new MeshStandardNodeMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
    const geometry = owner.own(new SphereGeometry(1, 48, 24));
    owner.add(ctx.roots.world, new Mesh(geometry, glossy)).position.set(1.4, 0, 6);
    owner.add(ctx.roots.world, new Mesh(geometry, matte)).position.set(-1.4, 0, 6);
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 6]);
    const specularOnly = new SpecularOnlyEnvironment(prefiltered.texture);
    let variant = "full-ibl";
    const apply = (v: string): void => {
      variant = v;
      if (v === "full-ibl") {
        ctx.roots.scene.environment = prefiltered.texture;
        glossy.envNode = null;
        matte.envNode = null;
      } else {
        ctx.roots.scene.environment = null;
        glossy.envNode = specularOnly as any;
        matte.envNode = specularOnly as any;
      }
      glossy.needsUpdate = true;
      matte.needsUpdate = true;
    };
    apply("full-ibl");
    return {
      variants: ["full-ibl", "specular-only"],
      ready: Promise.resolve(),
      setVariant: apply,
      update: noop,
      facts() {
        return { ...facts, variant };
      },
      regions(): Record<string, Rect> {
        const camera = ctx.roots.camera;
        return {
          glossy: screenRectOfBox(camera, [1.4, 0, 6], [0.5, 0.5, 0.1]),
          matte: screenRectOfBox(camera, [-1.4, 0, 6], [0.5, 0.5, 0.1]),
        };
      },
      dispose() {
        ctx.roots.scene.environment = null;
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const full = find(measures, "full-ibl");
    const spec = find(measures, "specular-only");
    const fm = stat(full, "matte");
    const sm = stat(spec, "matte");
    const fg = stat(full, "glossy");
    const sg = stat(spec, "glossy");
    if (fm === undefined || sm === undefined || fg === undefined || sg === undefined) return missing("sphere regions");
    c.expect(
      fg.redFrac + fg.blueFrac > 0.2,
      "PMREM from cube render target: glossy sphere reflects the red/blue sky",
      `red+blue fraction ${fmt(fg.redFrac + fg.blueFrac)}`,
    );
    c.expect(fm.luma > 25, "native `scene.environment`: matte sphere receives irradiance", `luma ${fmt(fm.luma)}`);
    c.expect(
      sm.luma < 0.35 * fm.luma,
      "custom specular-only LightingNode: matte sphere loses the irradiance term",
      `${fmt(sm.luma)} vs ${fmt(fm.luma)}`,
    );
    c.expect(
      sg.luma > 0.75 * fg.luma && sg.luma < 1.3 * fg.luma,
      "custom node keeps the glossy reflection",
      `${fmt(sg.luma)} vs ${fmt(fg.luma)}`,
    );
    return c.verdict();
  },
};

// ---- Row 10: clustered lighting ------------------------------------------------------------------------------------------

const GRID = 16;
const SPACING = 4;

const row10: RowDef = {
  id: 10,
  name: "Clustered lighting class and light counts",
  feature: "Clustered lighting class and light counts",
  settleFrames: 8,
  build(ctx): RowInstance {
    const owner = new Owner();
    const renderer = ctx.renderer.renderer;
    if (renderer === null) throw new Error("no renderer");
    const clustered = ctx.params.get("lighting") !== "default";
    if (clustered) (renderer as any).lighting = new ClusteredLighting();
    addGround(owner, ctx.roots.world, 400, 0xb0b0b0);
    // 256 point lights on a grid, nearest the camera first, so "n16" lights only the near block.
    const lights: PointLight[] = [];
    const cells: { x: number; z: number }[] = [];
    for (let ix = 0; ix < GRID; ix++) {
      for (let iz = 0; iz < GRID; iz++) cells.push({ x: (ix - GRID / 2) * SPACING, z: iz * SPACING });
    }
    cells.sort((a, b) => Math.hypot(a.x, a.z - 4) - Math.hypot(b.x, b.z - 4));
    for (const cell of cells) {
      const light = owner.own(new PointLight(0xffffff, 30, 7, 2));
      light.position.set(cell.x, 1.5, cell.z);
      light.visible = false;
      owner.add(ctx.roots.scene, light);
      lights.push(light);
    }
    placeCamera(ctx.roots.camera, [0, 14, -10], [0, 0, 24]);
    let count = 16;
    const show = (n: number): void => {
      count = n;
      lights.forEach((l, i) => {
        l.visible = i < n;
      });
    };
    show(16);
    const farCell = cells[255] ?? { x: 0, z: 0 };
    return {
      variants: ["n16", "n64", "n256"],
      ready: Promise.resolve(),
      setVariant(v) {
        show(Number(v.slice(1)));
      },
      update: noop,
      facts() {
        const info = renderer.info;
        const facts: Facts = {
          lights: count,
          clustered,
          lightingClass: (renderer as any).lighting?.constructor?.name ?? null,
          programs: info.memory.programs,
        };
        return facts;
      },
      regions(): Record<string, Rect> {
        const camera = ctx.roots.camera;
        const near = cells[0] ?? { x: 0, z: 4 };
        return {
          near: screenRectOfBox(camera, [near.x, 0, near.z], [1.2, 0.05, 1.2]),
          far: screenRectOfBox(camera, [farCell.x, 0, farCell.z], [1.2, 0.05, 1.2]),
        };
      },
      dispose() {
        (renderer as any).lighting = undefined;
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const n16 = find(measures, "n16");
    const n256 = find(measures, "n256");
    const near16 = stat(n16, "near");
    const far16 = stat(n16, "far");
    const far256 = stat(n256, "far");
    if (near16 === undefined || far16 === undefined || far256 === undefined) return missing("regions");
    c.expect(
      String(n16?.facts["lightingClass"]) !== "null",
      "lighting class active",
      String(n16?.facts["lightingClass"]),
    );
    c.expect(
      near16.luma > far16.luma + 15,
      "16 lights: lit near block, dark far block",
      `${fmt(near16.luma)} vs ${fmt(far16.luma)}`,
    );
    c.expect(
      far256.luma > far16.luma + 15,
      "256 lights: far block now lit",
      `${fmt(far256.luma)} vs ${fmt(far16.luma)}`,
    );
    return c.verdict();
  },
};

// ---- Row 13: compute + storage textures + copyTextureToTexture ----------------------------------------------------------

const STORE = 64;

const row13: RowDef = {
  id: 13,
  name: "Compute, storage texture, storage buffer, copyTextureToTexture",
  feature: "Compute + storage textures, `copyTextureToTexture`",
  settleFrames: 6,
  build(ctx): RowInstance {
    const owner = new Owner();
    const renderer = ctx.renderer.renderer as any;
    if (renderer === null) throw new Error("no renderer");
    const facts: Facts = {
      computeTexture: "pending",
      copyTexture: "pending",
      copyDataTexture: "pending",
      storageBuffer: "pending",
    };
    const source = owner.own(new StorageTexture(STORE, STORE));
    const copy = owner.own(new StorageTexture(STORE, STORE));
    const fillTexture = Fn(({ target }: any) => {
      const x = instanceIndex.mod(STORE);
      const y = instanceIndex.div(STORE);
      textureStore(target, uvec2(x, y), vec4(float(x).div(STORE), float(y).div(STORE), 0.5, 1)).toWriteOnly();
    });
    const computeTexture = (fillTexture as any)({ target: source }).compute(STORE * STORE);
    const buffer = instancedArray(256, "float");
    const computeBuffer = Fn(() => {
      buffer.element(instanceIndex).assign(float(instanceIndex).mul(2));
    })().compute(256);

    const materialA = owner.own(new MeshBasicNodeMaterial());
    materialA.colorNode = texture(source);
    // Independent copy test (does not depend on compute): 16x16 RGBA8 gradient -> empty DataTexture.
    const gradient = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) gradient.set([x * 16, y * 16, 128, 255], (y * 16 + x) * 4);
    }
    const dataSrc = owner.own(new DataTexture(gradient, 16, 16));
    dataSrc.needsUpdate = true;
    const dataDst = owner.own(new DataTexture(new Uint8Array(16 * 16 * 4), 16, 16));
    dataDst.needsUpdate = true;
    const materialC = owner.own(new MeshBasicNodeMaterial());
    materialC.colorNode = texture(dataDst);
    addFlatQuad(owner, ctx.roots.world, materialC, 0, 2.4, 5, 1.6, 1.6);
    const materialB = owner.own(new MeshBasicNodeMaterial());
    materialB.colorNode = texture(copy);
    addFlatQuad(owner, ctx.roots.world, materialA, -1.3, 0, 5, 2, 2);
    addFlatQuad(owner, ctx.roots.world, materialB, 1.3, 0, 5, 2, 2);
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 5]);
    let frame = 0;
    return {
      variants: ["default"],
      ready: Promise.resolve(),
      setVariant: noop,
      update() {
        frame++;
        if (frame === 2) {
          try {
            renderer.compute(computeTexture);
            facts["computeTexture"] = "dispatched";
          } catch (e) {
            facts["computeTexture"] = `error: ${errorText(e)}`;
          }
          try {
            renderer.compute(computeBuffer);
            renderer
              .getArrayBufferAsync(buffer.value)
              .then((data: ArrayBuffer) => {
                const values = new Float32Array(data);
                facts["storageBuffer"] =
                  values[7] === 14 && values[255] === 510
                    ? "readback ok"
                    : `bad readback ${String(values[7])}/${String(values[255])}`;
              })
              .catch((e: unknown) => {
                facts["storageBuffer"] = `error: ${errorText(e)}`;
              });
          } catch (e) {
            facts["storageBuffer"] = `error: ${errorText(e)}`;
          }
        }
        if (frame === 4) {
          try {
            renderer.copyTextureToTexture(source, copy);
            facts["copyTexture"] = "copied";
          } catch (e) {
            facts["copyTexture"] = `error: ${errorText(e)}`;
          }
          try {
            renderer.initTexture(dataSrc);
            renderer.initTexture(dataDst);
            renderer.copyTextureToTexture(dataSrc, dataDst);
            facts["copyDataTexture"] = "copied";
          } catch (e) {
            facts["copyDataTexture"] = `error: ${errorText(e)}`;
          }
        }
      },
      facts() {
        return { ...facts };
      },
      regions(): Record<string, Rect> {
        const camera = ctx.roots.camera;
        const a = screenRectOfBox(camera, [-1.3, 0, 5], [1, 1, 0.01]);
        const b = screenRectOfBox(camera, [1.3, 0, 5], [1, 1, 0.01]);
        const half = (r: Rect, which: "l" | "r" | "t" | "b"): Rect => {
          const mx = (r.x0 + r.x1) / 2;
          const my = (r.y0 + r.y1) / 2;
          const inset = 0.1 * (r.x1 - r.x0);
          if (which === "l") return { x0: r.x0 + inset, y0: r.y0 + inset, x1: mx - inset, y1: r.y1 - inset };
          if (which === "r") return { x0: mx + inset, y0: r.y0 + inset, x1: r.x1 - inset, y1: r.y1 - inset };
          if (which === "t") return { x0: r.x0 + inset, y0: r.y0 + inset, x1: r.x1 - inset, y1: my - inset };
          return { x0: r.x0 + inset, y0: my + inset, x1: r.x1 - inset, y1: r.y1 - inset };
        };
        const c = screenRectOfBox(camera, [0, 2.4, 5], [0.8, 0.8, 0.01]);
        return {
          cLeft: half(c, "l"),
          cRight: half(c, "r"),
          aLeft: half(a, "l"),
          aRight: half(a, "r"),
          aTop: half(a, "t"),
          aBottom: half(a, "b"),
          bLeft: half(b, "l"),
          bRight: half(b, "r"),
          bTop: half(b, "t"),
          bBottom: half(b, "b"),
        };
      },
      dispose() {
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const m = find(measures, "default");
    if (m === undefined) return missing("default variant");
    c.expect(
      String(m.facts["computeTexture"]) === "dispatched",
      "compute node writes a StorageTexture",
      String(m.facts["computeTexture"]),
    );
    const aL = stat(m, "aLeft");
    const aR = stat(m, "aRight");
    const aT = stat(m, "aTop");
    const aB = stat(m, "aBottom");
    if (aL !== undefined && aR !== undefined && aT !== undefined && aB !== undefined) {
      c.expect(Math.abs(aR.r - aL.r) > 30, "storage texture content: red ramps along x", `${fmt(aL.r)} / ${fmt(aR.r)}`);
      c.expect(
        Math.abs(aT.g - aB.g) > 30,
        "storage texture content: green ramps along y",
        `${fmt(aT.g)} / ${fmt(aB.g)}`,
      );
    } else c.expect(false, "storage texture regions", "missing");
    c.expect(String(m.facts["copyTexture"]) === "copied", "copyTextureToTexture call", String(m.facts["copyTexture"]));
    const bL = stat(m, "bLeft");
    const bR = stat(m, "bRight");
    if (bL !== undefined && bR !== undefined && aL !== undefined && aR !== undefined) {
      c.expect(
        Math.abs(bL.r - aL.r) < 8 && Math.abs(bR.r - aR.r) < 8,
        "copy equals source",
        `copy ${fmt(bL.r)}/${fmt(bR.r)} vs source ${fmt(aL.r)}/${fmt(aR.r)}`,
      );
    }
    c.expect(
      String(m.facts["copyDataTexture"]) === "copied",
      "copyTextureToTexture (DataTexture -> DataTexture) call",
      String(m.facts["copyDataTexture"]),
    );
    const cL = stat(m, "cLeft");
    const cR = stat(m, "cRight");
    if (cL !== undefined && cR !== undefined) {
      c.expect(Math.abs(cR.r - cL.r) > 30, "DataTexture copy carries the gradient", `${fmt(cL.r)} / ${fmt(cR.r)}`);
    }
    c.expect(
      String(m.facts["storageBuffer"]) === "readback ok",
      "storage buffer compute + getArrayBufferAsync",
      String(m.facts["storageBuffer"]),
    );
    return c.verdict();
  },
};

export const GPU_ROWS: readonly RowDef[] = [row5, row10, row13];
