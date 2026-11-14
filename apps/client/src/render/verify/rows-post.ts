/* eslint-disable @typescript-eslint/no-explicit-any */
// Matrix rows 4, 6, 7, 8, 9, 14 (rendering-pipeline.md section 21): GTAO prepass pattern, renderOutput, TRAA velocity for
// instanced / batched / skinned meshes, FSR1 / TAAU upscaling, per-pass setResolutionScale, bloom threshold / knee.
// Every row installs its own `PipelineStages` on the render module's pipeline; TSL values are typed loosely.

import {
  BatchedMesh,
  BoxGeometry,
  Bone,
  BufferAttribute,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  Skeleton,
  SkinnedMesh,
  Vector2,
  type Object3D,
} from "three/webgpu";
import {
  builtinAOContext,
  floor,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  positionWorld,
  sample,
  screenUV,
  unpackRGBToNormal,
  velocity,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fsr1 } from "three/addons/tsl/display/FSR1Node.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { taau } from "three/addons/tsl/display/TAAUNode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import type { PipelineStages } from "../pipeline";
import { linearToSrgbByte, type Rect } from "./analysis";
import {
  addBox,
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
import { buildRig } from "./rows-shadow";
import type { FrameInfo, RowContext, RowDef, RowInstance } from "./types";

const noop = (): void => undefined;

interface Disposable {
  dispose(): void;
}

function disposeAll(items: Disposable[]): void {
  for (const item of items.splice(0)) {
    try {
      item.dispose();
    } catch {
      // Targets that were never created have nothing to free.
    }
  }
}

/** Renders without the renderer's tone mapper for the duration of a row; restored on dispose. */
function pinToneMapping(ctx: RowContext, owner: Owner, mode: number): void {
  const renderer = ctx.renderer.renderer;
  if (renderer === null) return;
  const previous = renderer.toneMapping;
  renderer.toneMapping = mode as typeof renderer.toneMapping;
  owner.own({
    dispose: () => {
      renderer.toneMapping = previous;
    },
  });
}

// ---- Row 4: GTAO prepass, AO on indirect light only -----------------------------------------------------------------

function aoStages(mode: "indirect" | "multiply"): PipelineStages {
  const owned: Disposable[] = [];
  return {
    hdr(color: any, ctx) {
      const material = new MeshBasicNodeMaterial();
      material.name = "mc:verify-prepass";
      owned.push(material);
      const pre = pass(ctx.scene, ctx.camera);
      pre.overrideMaterial = material;
      pre.transparent = false;
      pre.setMRT(mrt({ output: packNormalToRGB(normalView) }));
      owned.push(pre);
      const depth = pre.getTextureNode("depth");
      const normal = sample((uv: any) => unpackRGBToNormal(pre.getTextureNode().sample(uv)));
      const gtao: any = ao(depth, normal, ctx.camera);
      gtao.samples.value = 16;
      gtao.radius.value = 1.5;
      gtao.useTemporalFiltering = false;
      owned.push(gtao);
      const occlusion = gtao.getTextureNode().sample(screenUV).r;
      if (mode === "indirect") {
        ctx.scenePass.contextNode = builtinAOContext(occlusion);
        return color;
      }
      return color.mul(occlusion);
    },
    dispose() {
      disposeAll(owned);
    },
  };
}

const row4: RowDef = {
  id: 4,
  name: "GTAO prepass pattern (AO on indirect light only)",
  feature: "GTAO prepass pattern (AO on indirect only)",
  settleFrames: 12,
  build(ctx): RowInstance {
    const rig = buildRig(ctx, ctx.quality.current, false, 300);
    const { owner } = rig;
    addGround(owner, ctx.roots.world, 400);
    addBox(owner, ctx.roots.world, 0, 0, 4, 4, 4);
    placeCamera(ctx.roots.camera, [-9, 5, 12], [1, 0, 2]);
    let variant = "off";
    const apply = (v: string): void => {
      variant = v;
      ctx.renderer.setPipelineStages(v === "off" ? null : aoStages(v === "indirect" ? "indirect" : "multiply"));
    };
    apply("off");
    return {
      variants: ["off", "indirect", "multiply"],
      ready: Promise.resolve(),
      setVariant: apply,
      update: noop,
      facts() {
        return { variant };
      },
      regions(): Record<string, Rect> {
        const camera = ctx.roots.camera;
        return {
          litCrevice: screenRectOfBox(camera, [-2.35, 0, 0], [0.2, 0.05, 1]),
          litOpen: screenRectOfBox(camera, [-6, 0, 0], [0.2, 0.05, 1]),
          shadowCrevice: screenRectOfBox(camera, [0, 0, 2.35], [1, 0.05, 0.2]),
          shadowOpen: screenRectOfBox(camera, [2.5, 0, 3.8], [1, 0.05, 0.3]),
        };
      },
      dispose() {
        ctx.renderer.setPipelineStages(null);
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const ratio = (variant: string, a: string, b: string): number | undefined => {
      const m = find(measures, variant);
      const x = stat(m, a);
      const y = stat(m, b);
      return x === undefined || y === undefined || y.luma < 1 ? undefined : x.luma / y.luma;
    };
    const shOff = ratio("off", "shadowCrevice", "shadowOpen");
    const shInd = ratio("indirect", "shadowCrevice", "shadowOpen");
    const litOff = ratio("off", "litCrevice", "litOpen");
    const litInd = ratio("indirect", "litCrevice", "litOpen");
    const litMul = ratio("multiply", "litCrevice", "litOpen");
    if (
      shOff === undefined ||
      shInd === undefined ||
      litOff === undefined ||
      litInd === undefined ||
      litMul === undefined
    ) {
      return missing("crevice / open ratios");
    }
    c.expect(
      shInd < 0.93 * shOff,
      "indirect AO darkens the shadowed crevice",
      `crevice/open ${fmt(shInd)} vs ${fmt(shOff)} without AO`,
    );
    c.expect(
      litInd > 0.93 * litOff,
      "indirect AO leaves the sunlit crevice (direct light) alone",
      `${fmt(litInd)} vs ${fmt(litOff)} without AO`,
    );
    c.expect(
      litMul < 0.88 * litOff,
      "fallback (multiply composite) darkens the sunlit crevice too",
      `${fmt(litMul)} vs ${fmt(litOff)}`,
    );
    return c.verdict();
  },
};

// ---- Row 6: renderOutput / outputColorTransform ----------------------------------------------------------------------------

const STRIPS = [0.05, 0.18, 1, 4, 16] as const;

const row6: RowDef = {
  id: 6,
  name: "renderOutput() with outputColorTransform = false",
  feature: "`RenderPipeline.outputColorTransform` / `renderOutput()`",
  settleFrames: 4,
  build(ctx): RowInstance {
    const owner = new Owner();
    const materials = STRIPS.map((value) => {
      const m = owner.own(new MeshBasicNodeMaterial());
      m.colorNode = vec4(value, value, value, 1);
      return m;
    });
    STRIPS.forEach((_, i) =>
      addFlatQuad(owner, ctx.roots.world, materials[i] as MeshBasicNodeMaterial, 4 - i * 2, 0, 6, 1.8, 3),
    );
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 6]);
    const renderer = ctx.renderer.renderer;
    const previous = renderer?.toneMapping;
    owner.own({
      dispose: () => {
        if (renderer !== null && previous !== undefined) renderer.toneMapping = previous;
      },
    });
    let variant = "none";
    return {
      variants: ["none", "agx"],
      ready: Promise.resolve(),
      setVariant(v) {
        variant = v;
        if (renderer === null) return;
        renderer.toneMapping = (
          v === "none" ? NoToneMapping : (previous ?? NoToneMapping)
        ) as typeof renderer.toneMapping;
      },
      update: noop,
      facts() {
        return { variant, toneMapping: renderer?.toneMapping ?? null, expectedSrgbOf018: linearToSrgbByte(0.18) };
      },
      regions(): Record<string, Rect> {
        const out: Record<string, Rect> = {};
        STRIPS.forEach((_, i) => {
          out[`s${String(i)}`] = screenRectOfBox(ctx.roots.camera, [4 - i * 2, 0, 6], [0.6, 1, 0.01]);
        });
        return out;
      },
      dispose() {
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const none = find(measures, "none");
    const agx = find(measures, "agx");
    if (none === undefined || agx === undefined) return missing("variants");
    STRIPS.forEach((value, i) => {
      const s = stat(none, `s${String(i)}`);
      if (s === undefined) return;
      const expected = linearToSrgbByte(value);
      c.expect(
        Math.abs(s.g - expected) <= 3,
        `no tone mapping: linear ${String(value)} encodes once to sRGB`,
        `${fmt(s.g)} vs ${String(expected)}`,
      );
    });
    const a = STRIPS.map((_, i) => stat(agx, `s${String(i)}`)?.g ?? -1);
    c.expect(
      a.every((v, i) => i === 0 || v > (a[i - 1] ?? 0)),
      "AgX: strips strictly increasing",
      a.map((v) => v.toFixed(0)).join(" < "),
    );
    c.expect(
      (a[3] ?? 255) < 250,
      "AgX: a linear 4.0 is compressed below white",
      `4.0 -> ${fmt(a[3])}, 16 -> ${fmt(a[4])}`,
    );
    return c.verdict();
  },
};

// ---- Row 7: velocity (TRAA) for static, instanced, batched, skinned ---------------------------------------------------------

const VEL_GAIN = 300;
const SLOTS = [6, 4, 2, 0, -2, -5] as const; // x positions, in the order A, B0, B1, C0, C1, D

function velocityStages(kind: "velocity" | "traa"): PipelineStages {
  const owned: Disposable[] = [];
  return {
    hdr(color: any, ctx) {
      const pre: any = kind === "velocity" ? pass(ctx.scene, ctx.camera) : ctx.scenePass;
      pre.setMRT(mrt({ output, velocity }));
      if (kind === "velocity") owned.push(pre);
      const v = pre.getTextureNode("velocity");
      if (kind === "velocity") return vec3(v.x.abs(), v.y.abs(), 0).mul(VEL_GAIN);
      const resolve: any = traa(pre.getTextureNode("output"), pre.getTextureNode("depth"), v, ctx.camera);
      owned.push(resolve);
      return resolve;
    },
    dispose() {
      disposeAll(owned);
    },
  };
}

const row7: RowDef = {
  id: 7,
  name: "Velocity for static, instanced, batched and skinned meshes (TRAA)",
  feature: "TRAA velocity for static (camera-only), instanced, batched, skinned meshes",
  settleFrames: 6,
  build(ctx): RowInstance {
    const owner = new Owner();
    pinToneMapping(ctx, owner, NoToneMapping);
    const material = owner.own(new MeshBasicNodeMaterial({ color: 0xffa040 }));
    const box = owner.own(new BoxGeometry(1, 1, 1));
    const world = ctx.roots.world;
    // A: static mesh.
    owner.add(world, new Mesh(box, material)).position.set(SLOTS[0], 0, 8);
    // B: InstancedMesh with two instances (0 static, 1 animated).
    const instanced = owner.add(world, new InstancedMesh(box, material, 2));
    instanced.frustumCulled = false;
    // C: BatchedMesh with two instances (0 static, 1 animated).
    const batched = owner.add(world, new BatchedMesh(2, 24, 36, material));
    batched.frustumCulled = false;
    const geometryId = batched.addGeometry(box);
    const batchA = batched.addInstance(geometryId);
    const batchB = batched.addInstance(geometryId);
    // D: SkinnedMesh with two bones; the upper half follows bone 1, which is animated.
    const tube = owner.own(new CylinderGeometry(0.5, 0.5, 2, 8, 4));
    const position = tube.getAttribute("position");
    const skinIndex = new Uint16Array(position.count * 4);
    const skinWeight = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      skinIndex[i * 4] = position.getY(i) > 0 ? 1 : 0;
      skinWeight[i * 4] = 1;
    }
    tube.setAttribute("skinIndex", new BufferAttribute(skinIndex, 4));
    tube.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
    const bone0 = new Bone();
    const bone1 = new Bone();
    bone0.add(bone1);
    const skinned = owner.add(world, new SkinnedMesh(tube, material));
    skinned.add(bone0);
    skinned.bind(owner.own(new Skeleton([bone0, bone1])));
    skinned.position.set(SLOTS[5], 0, 8);
    skinned.frustumCulled = false;

    const m = new Matrix4();
    const place = (target: { setMatrixAt(i: number, m: Matrix4): unknown }, i: number, x: number): void => {
      m.makeTranslation(x, 0, 8);
      target.setMatrixAt(i, m);
    };
    place(instanced, 0, SLOTS[1]);
    place(instanced, 1, SLOTS[2]);
    place(batched, batchA, SLOTS[3]);
    place(batched, batchB, SLOTS[4]);
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 8]);

    let variant = "static-camera";
    const apply = (v: string): void => {
      variant = v;
      ctx.renderer.setPipelineStages(velocityStages(v === "traa" ? "traa" : "velocity"));
    };
    apply("static-camera");
    return {
      variants: ["static-camera", "camera-move", "traa"],
      ready: Promise.resolve(),
      setVariant: apply,
      update(frame: FrameInfo) {
        const wobble = 0.6 * Math.sin(3 * frame.time);
        place(instanced, 1, (SLOTS[2] ?? 0) + wobble);
        instanced.instanceMatrix.needsUpdate = true;
        place(batched, batchB, (SLOTS[4] ?? 0) + wobble);
        bone1.position.x = wobble;
        ctx.roots.camera.position.x = variant === "camera-move" ? wobble : 0;
        ctx.roots.camera.updateMatrixWorld();
      },
      facts() {
        return { variant, velocityGain: VEL_GAIN };
      },
      regions(): Record<string, Rect> {
        const camera = ctx.roots.camera;
        const names = ["A", "B0", "B1", "C0", "C1", "D"];
        const out: Record<string, Rect> = {};
        names.forEach((name, i) => {
          const x = SLOTS[i] ?? 0;
          out[name] = screenRectOfBox(camera, [x, 0, 8], [i === 2 || i === 4 ? 1 : 0.4, 0.4, 0.01]);
        });
        return out;
      },
      dispose() {
        ctx.renderer.setPipelineStages(null);
        ctx.roots.camera.position.x = 0;
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const still = find(measures, "static-camera");
    const move = find(measures, "camera-move");
    const resolved = find(measures, "traa");
    if (still === undefined || move === undefined) return missing("velocity variants");
    const luma = (m: typeof still, name: string): number => stat(m, name)?.luma ?? -1;
    c.expect(luma(still, "A") < 6, "static mesh, static camera: velocity 0", fmt(luma(still, "A")));
    c.expect(luma(still, "B0") < 6, "instanced mesh, still instance: velocity 0", fmt(luma(still, "B0")));
    c.expect(luma(still, "B1") > 12, "instanced mesh, animated instance: velocity > 0", fmt(luma(still, "B1")));
    c.expect(luma(still, "C0") < 6, "batched mesh, still instance: velocity 0", fmt(luma(still, "C0")));
    c.expect(luma(still, "C1") > 12, "batched mesh, animated instance: velocity > 0", fmt(luma(still, "C1")));
    c.expect(luma(still, "D") > 12, "skinned mesh, animated bone: velocity > 0", fmt(luma(still, "D")));
    c.expect(luma(move, "A") > 12, "static mesh, moving camera: camera-only velocity > 0", fmt(luma(move, "A")));
    c.expect(
      luma(move, "B0") > 12 && luma(move, "C0") > 12,
      "still instanced / batched instances follow the camera",
      `${fmt(luma(move, "B0"))} / ${fmt(luma(move, "C0"))}`,
    );
    if (resolved !== undefined)
      c.expect(luma(resolved, "A") > 20, "TRAA chain renders the scene (object visible)", fmt(luma(resolved, "A")));
    return c.verdict();
  },
};

// ---- Row 8: TAAU and FSR1 ------------------------------------------------------------------------------------------------------

function addDetailGround(owner: Owner, parent: Object3D): void {
  const material = owner.own(new MeshBasicNodeMaterial());
  const p = positionWorld.xz.mul(0.7);
  const checker = floor(p.x).add(floor(p.y)).mod(2);
  material.colorNode = vec4(mix(vec3(0.05, 0.05, 0.05), vec3(0.9, 0.9, 0.9), checker), 1);
  const geometry = owner.own(new BoxGeometry(160, 0.1, 160));
  const mesh = owner.add(parent, new Mesh(geometry, material));
  mesh.position.y = -0.05;
}

const DETAIL: Rect = { x0: 0.3, y0: 0.62, x1: 0.7, y1: 0.95 };

function upscaleStages(kind: string): PipelineStages {
  const owned: Disposable[] = [];
  return {
    hdr(color: any, ctx) {
      const sp: any = ctx.scenePass;
      if (kind === "native") {
        sp.setResolutionScale(1);
        return color;
      }
      sp.setResolutionScale(0.5);
      if (kind === "bilinear") return color;
      if (kind === "fsr1") {
        const n: any = fsr1(color);
        owned.push(n);
        return n;
      }
      sp.setMRT(mrt({ output, velocity }));
      const n: any = taau(
        sp.getTextureNode("output"),
        sp.getTextureNode("depth"),
        sp.getTextureNode("velocity"),
        ctx.camera,
      );
      owned.push(n);
      return n;
    },
    dispose() {
      disposeAll(owned);
    },
  };
}

const row8: RowDef = {
  id: 8,
  name: "TAAU and FSR1 upscaling at render scale 0.5",
  feature: "TAAU and FSR1-style upscaling",
  settleFrames: 30,
  build(ctx): RowInstance {
    const owner = new Owner();
    pinToneMapping(ctx, owner, NoToneMapping);
    addDetailGround(owner, ctx.roots.world);
    placeCamera(ctx.roots.camera, [0, 2, 0], [0, 0, 14]);
    let variant = "native";
    const apply = (v: string): void => {
      variant = v;
      ctx.renderer.setPipelineStages(upscaleStages(v));
    };
    apply("native");
    return {
      variants: ["native", "bilinear", "fsr1", "taau"],
      ready: Promise.resolve(),
      setVariant: apply,
      update: noop,
      facts() {
        return { variant, renderScale: variant === "native" ? 1 : 0.5 };
      },
      regions: () => ({ detail: DETAIL }),
      dispose() {
        ctx.renderer.setPipelineStages(null);
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const edge = (v: string): number => stat(find(measures, v), "detail")?.edgeSq ?? -1;
    const native = edge("native");
    const bilinear = edge("bilinear");
    const fsr = edge("fsr1");
    const t = edge("taau");
    if (native < 0 || bilinear < 0 || fsr < 0 || t < 0) return missing("detail edge energy");
    c.expect(
      native > bilinear * 1.1,
      "reference: native has more detail than plain bilinear upscale",
      `${fmt(native)} vs ${fmt(bilinear)}`,
    );
    c.expect(fsr > bilinear * 1.05, "FSR1 recovers detail over bilinear", `${fmt(fsr)} vs ${fmt(bilinear)}`);
    c.expect(
      t > bilinear * 0.8,
      "TAAU output is not softer than bilinear (it also anti-aliases, so its gradient energy is not expected to rise)",
      `${fmt(t)} vs ${fmt(bilinear)}`,
    );
    c.expect(
      fsr < native * 1.8 && t < native * 1.8,
      "no runaway ringing (edge energy under 1.8x native)",
      `fsr1 ${fmt(fsr)} taau ${fmt(t)} native ${fmt(native)}`,
    );
    return c.verdict();
  },
};

// ---- Row 9: per-pass setResolutionScale -------------------------------------------------------------------------------------------

const row9: RowDef = {
  id: 9,
  name: "Per-pass setResolutionScale",
  feature: "Per-pass `setResolutionScale` (r181+)",
  settleFrames: 6,
  build(ctx): RowInstance {
    const owner = new Owner();
    pinToneMapping(ctx, owner, NoToneMapping);
    addDetailGround(owner, ctx.roots.world);
    placeCamera(ctx.roots.camera, [0, 2, 0], [0, 0, 14]);
    const owned: Disposable[] = [];
    let scenePass: any = null;
    let glow: any = null;
    ctx.renderer.setPipelineStages({
      hdr(color: any, c) {
        scenePass = c.scenePass;
        glow = bloom(color, 0.2, 0.4, 1);
        owned.push(glow);
        return color.add(glow);
      },
      dispose() {
        disposeAll(owned);
      },
    });
    let variant = "s1";
    const size = new Vector2();
    const table: Record<string, [number, number]> = {
      s1: [1, 0.5],
      s075: [0.75, 0.5],
      s05: [0.5, 0.5],
      "s05-b025": [0.5, 0.25],
    };
    return {
      variants: ["s1", "s075", "s05", "s05-b025", "s1-again"],
      ready: Promise.resolve(),
      setVariant(v) {
        variant = v;
        const [s, b] = table[v === "s1-again" ? "s1" : v] ?? [1, 0.5];
        scenePass?.setResolutionScale(s);
        glow?.setResolutionScale(b);
      },
      update: noop,
      facts() {
        ctx.renderer.renderer?.getDrawingBufferSize(size);
        return {
          variant,
          canvasWidth: size.x,
          canvasHeight: size.y,
          scenePassScale: scenePass?.getResolutionScale() ?? null,
          scenePassTargetWidth: scenePass?.renderTarget?.width ?? null,
          scenePassTargetHeight: scenePass?.renderTarget?.height ?? null,
          bloomScale: glow?._resolutionScale ?? null,
        };
      },
      regions: () => ({ detail: DETAIL }),
      dispose() {
        ctx.renderer.setPipelineStages(null);
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const expectScale = (variant: string, scale: number): void => {
      const m = find(measures, variant);
      if (m === undefined) return;
      const w = Number(m.facts["canvasWidth"]);
      const target = Number(m.facts["scenePassTargetWidth"]);
      c.expect(
        Math.abs(target - Math.round(w * scale)) <= 1,
        `${variant}: scene pass target is ${String(scale)} x the canvas`,
        `${String(target)} px of ${String(w)} px`,
      );
    };
    expectScale("s1", 1);
    expectScale("s075", 0.75);
    expectScale("s05", 0.5);
    expectScale("s05-b025", 0.5);
    expectScale("s1-again", 1);
    const e1 = stat(find(measures, "s1"), "detail")?.edgeSq ?? -1;
    const e05 = stat(find(measures, "s05"), "detail")?.edgeSq ?? -1;
    c.expect(
      e1 > e05 * 1.05,
      "lower scale gives a softer image of the same canvas size",
      `edge ${fmt(e1)} vs ${fmt(e05)}`,
    );
    return c.verdict();
  },
};

// ---- Row 14: BloomNode threshold / knee ---------------------------------------------------------------------------------------------

const EMITTERS = [0.5, 2, 4, 8, 16] as const;

const row14: RowDef = {
  id: 14,
  name: "BloomNode threshold and knee",
  feature: "`BloomNode` threshold/knee",
  settleFrames: 4,
  build(ctx): RowInstance {
    const owner = new Owner();
    pinToneMapping(ctx, owner, NoToneMapping);
    const materials = EMITTERS.map((value) => {
      const m = owner.own(new MeshBasicNodeMaterial());
      m.colorNode = vec4(value, value, value, 1);
      return m;
    });
    EMITTERS.forEach((_, i) =>
      addFlatQuad(owner, ctx.roots.world, materials[i] as MeshBasicNodeMaterial, 4 - i * 2, 0, 8, 0.8, 0.8),
    );
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 8]);
    const owned: Disposable[] = [];
    let glow: any = null;
    ctx.renderer.setPipelineStages({
      hdr(color: any) {
        glow = bloom(color, 0.25, 0.5, 4);
        glow.smoothWidth.value = 0.5;
        owned.push(glow);
        return color.add(glow);
      },
      dispose() {
        disposeAll(owned);
      },
    });
    const quads = ctx.roots.world.children.filter((o) => o.type === "Mesh");
    const table: Record<string, [number, number]> = {
      thr4: [4, 0.5],
      thr1: [1, 0.5],
      thr7k0: [7, 0.001],
      thr7k3: [7, 3],
    };
    // Variant ids: `<config>-e<i>`: only emitter i is visible, so halos of the others cannot leak into the measurement.
    const variants: string[] = [];
    for (let i = 0; i < EMITTERS.length; i++) variants.push(`thr4-e${String(i)}`);
    variants.push("thr1-e1", "thr7k0-e3", "thr7k3-e3");
    let variant = variants[0] ?? "";
    return {
      variants,
      ready: Promise.resolve(),
      setVariant(v) {
        variant = v;
        const [config = "thr4", e = "e0"] = v.split("-");
        const [threshold, knee] = table[config] ?? [4, 0.5];
        quads.forEach((q, i) => {
          q.visible = `e${String(i)}` === e;
        });
        if (glow !== null) {
          glow.threshold.value = threshold;
          glow.smoothWidth.value = knee;
        }
      },
      update: noop,
      facts() {
        return { variant, threshold: glow?.threshold.value ?? null, knee: glow?.smoothWidth.value ?? null };
      },
      regions(): Record<string, Rect> {
        const out: Record<string, Rect> = {};
        EMITTERS.forEach((_, i) => {
          // Halo: just outside the emitter's edge (world +x is screen left).
          out[`halo${String(i)}`] = screenRectOfBox(ctx.roots.camera, [4 - i * 2 - 0.6, 0, 8], [0.12, 0.35, 0.01]);
        });
        return out;
      },
      dispose() {
        ctx.renderer.setPipelineStages(null);
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const halo = (variant: string, i: number): number => stat(find(measures, variant), `halo${String(i)}`)?.luma ?? -1;
    const h = (i: number): number => halo(`thr4-e${String(i)}`, i);
    c.expect(h(0) < 3 && h(1) < 3, "threshold 4: emitters 0.5 and 2 do not bloom", `${fmt(h(0))} / ${fmt(h(1))}`);
    c.expect(
      h(3) > 6 && h(4) > h(3),
      "threshold 4: emitters 8 and 16 bloom, 16 more than 8",
      `${fmt(h(3))} < ${fmt(h(4))}`,
    );
    c.expect(
      halo("thr1-e1", 1) > h(1) + 5,
      "threshold 1: emitter 2 now blooms",
      `${fmt(halo("thr1-e1", 1))} vs ${fmt(h(1))}`,
    );
    const hard = halo("thr7k0-e3", 3);
    const soft = halo("thr7k3-e3", 3);
    c.expect(
      soft > 1 && soft < 0.8 * hard,
      "knee: a wide knee softens the ramp above the threshold (emitter 8, threshold 7)",
      `knee 3 ${fmt(soft)} vs knee ~0 ${fmt(hard)}`,
    );
    return c.verdict();
  },
};

export const POST_ROWS: readonly RowDef[] = [row4, row6, row7, row8, row9, row14];
