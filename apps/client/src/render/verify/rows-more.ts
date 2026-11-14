/* eslint-disable @typescript-eslint/no-explicit-any */
// Matrix rows 11, 12, 15 (rendering-pipeline.md section 21): compatibility-mode adapter, reversed depth, integer
// textures read with textureLoad.

import {
  DataTexture,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NoToneMapping,
  RGBAIntegerFormat,
  RedIntegerFormat,
  UnsignedIntType,
} from "three/webgpu";
import { float, ivec2, texture, uv, vec3, vec4 } from "three/tsl";
import { linearToSrgbByte, type Rect } from "./analysis";
import { addFlatQuad, Checks, find, fmt, missing, Owner, placeCamera, screenRectOfBox } from "./common";
import type { RowDef, RowInstance } from "./types";

const noop = (): void => undefined;

type Facts = Record<string, string | number | boolean | null>;

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

// ---- Row 11: compatibility-mode adapter ----------------------------------------------------------------------------------

const row11: RowDef = {
  id: 11,
  name: "Compatibility-mode adapter",
  feature: "Compatibility-mode adapter (renderer init options)",
  settleFrames: 2,
  build(ctx): RowInstance {
    const facts: Facts = { backendReported: ctx.backend, adapterProbe: "pending" };
    const gpu = (navigator as unknown as { gpu?: any }).gpu;
    const ready = (async (): Promise<void> => {
      const backend = (ctx.renderer.renderer as any)?.backend;
      facts["compatibilityModeFlag"] = backend?.compatibilityMode ?? null;
      facts["isWebGPUBackend"] = backend?.isWebGPUBackend === true;
      if (gpu === undefined) {
        facts["adapterProbe"] = "navigator.gpu missing";
        return;
      }
      try {
        const compat = await gpu.requestAdapter({ featureLevel: "compatibility", powerPreference: "high-performance" });
        const core = await gpu.requestAdapter({ powerPreference: "high-performance" });
        facts["compatAdapter"] = compat !== null;
        facts["compatAdapterHasCoreFeatures"] = compat?.features?.has("core-features-and-limits") ?? null;
        facts["coreAdapter"] = core !== null;
        facts["adapterProbe"] = "done";
      } catch (e) {
        facts["adapterProbe"] = `error: ${errorText(e)}`;
      }
    })();
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 5]);
    return {
      variants: ["probe"],
      ready,
      setVariant: noop,
      update: noop,
      facts() {
        return { ...facts };
      },
      regions: () => ({}),
      dispose: noop,
    };
  },
  evaluate(measures, backend) {
    const c = new Checks();
    const m = find(measures, "probe");
    if (m === undefined) return missing("probe");
    if (backend !== "webgpu") {
      return {
        verdict: "N/A",
        notes: [`N/A the renderer runs on ${backend}: there is no WebGPU adapter to put into compatibility mode`],
      };
    }
    c.expect(m.facts["adapterProbe"] === "done", "adapter probe ran", String(m.facts["adapterProbe"]));
    c.expect(
      m.facts["compatAdapter"] === true,
      "requestAdapter with featureLevel compatibility returns an adapter",
      String(m.facts["compatAdapter"]),
    );
    c.expect(
      typeof m.facts["compatibilityModeFlag"] === "boolean",
      "three r187 exposes backend.compatibilityMode",
      String(m.facts["compatibilityModeFlag"]),
    );
    c.notes.push(
      `info compatAdapterHasCoreFeatures=${String(m.facts["compatAdapterHasCoreFeatures"])} compatibilityMode=${String(m.facts["compatibilityModeFlag"])}`,
    );
    return c.verdict();
  },
};

// ---- Row 12: reversed depth -----------------------------------------------------------------------------------------------

const row12: RowDef = {
  id: 12,
  name: "Reversed depth (two planes a few metres apart at distance)",
  feature: "Reversed depth on `webgl2` (clip-control extension)",
  settleFrames: 4,
  build(ctx): RowInstance {
    const owner = new Owner();
    const planes: Mesh[] = [];
    const colours: [number, number, number][] = [
      [0.8, 0.12, 0.1],
      [0.1, 0.8, 0.12],
    ];
    for (let i = 0; i < 2; i++) {
      const material = owner.own(new MeshBasicNodeMaterial());
      const col = colours[i] ?? [1, 1, 1];
      material.colorNode = vec4(vec3(col[0], col[1], col[2]), 1);
      planes.push(addFlatQuad(owner, ctx.roots.world, material, 0, 0, 15_000 + i * 3, 90_000, 60_000));
    }
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 1]);
    let variant = "15km-3m";
    const place = (v: string): void => {
      variant = v;
      const [z = 15_000, gap = 3] = v === "15km-3m" ? [15_000, 3] : v === "5km-1m" ? [5000, 1] : [25_000, 8];
      planes.forEach((p, i) => p.position.set(0, 0, z + i * gap));
    };
    place("15km-3m");
    return {
      variants: ["15km-3m", "5km-1m", "25km-8m"],
      ready: Promise.resolve(),
      setVariant: place,
      update: noop,
      facts() {
        const r = ctx.renderer.renderer;
        return {
          variant,
          reversedDepthBuffer: r?.reversedDepthBuffer ?? null,
          cameraNear: ctx.roots.camera.near,
          cameraFar: ctx.roots.camera.far,
        };
      },
      regions: () => ({ centre: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 } }),
      dispose() {
        owner.dispose();
      },
    };
  },
  evaluate(measures) {
    const c = new Checks();
    const first = measures[0];
    c.expect(
      first?.facts["reversedDepthBuffer"] === true,
      "renderer reports reversedDepthBuffer",
      String(first?.facts["reversedDepthBuffer"]),
    );
    for (const m of measures) {
      const s = m.stats["centre"];
      if (s === undefined) continue;
      c.expect(
        s.redFrac > 0.95 && s.greenFrac < 0.01,
        `${m.variant}: nearer (red) plane wins every pixel, no z-fighting`,
        `red ${fmt(s.redFrac)} green ${fmt(s.greenFrac)}`,
      );
    }
    return c.verdict();
  },
};

// ---- Row 15: integer textures with textureLoad ----------------------------------------------------------------------------

const GRID_N = 8;
const CELLS: readonly (readonly [number, number])[] = [
  [1, 1],
  [6, 1],
  [1, 6],
  [6, 6],
  [3, 4],
];

const row15: RowDef = {
  id: 15,
  name: "Integer texture textureLoad (RGBA32UI and R32UI)",
  feature: "Integer texture `textureLoad` on both backends",
  settleFrames: 4,
  build(ctx): RowInstance {
    const owner = new Owner();
    const renderer = ctx.renderer.renderer;
    const previousTone = renderer?.toneMapping;
    if (renderer !== null) renderer.toneMapping = NoToneMapping;
    owner.own({
      dispose: () => {
        if (renderer !== null && previousTone !== undefined) renderer.toneMapping = previousTone;
      },
    });
    const rgba = new Uint32Array(GRID_N * GRID_N * 4);
    const red = new Uint32Array(GRID_N * GRID_N);
    for (let y = 0; y < GRID_N; y++) {
      for (let x = 0; x < GRID_N; x++) {
        rgba.set([x * 32, y * 32, (x + y) * 16, 255], (y * GRID_N + x) * 4);
        red[y * GRID_N + x] = (x + GRID_N * y) * 4;
      }
    }
    const texRgba = owner.own(new DataTexture(rgba, GRID_N, GRID_N, RGBAIntegerFormat, UnsignedIntType));
    const texRed = owner.own(new DataTexture(red, GRID_N, GRID_N, RedIntegerFormat, UnsignedIntType));
    for (const t of [texRgba, texRed]) {
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    }
    const cell = ivec2(uv().mul(GRID_N).floor());
    const materialA = owner.own(new MeshBasicNodeMaterial());
    const a: any = texture(texRgba).load(cell);
    materialA.colorNode = vec4(float(a.r).div(255), float(a.g).div(255), float(a.b).div(255), 1);
    const materialB = owner.own(new MeshBasicNodeMaterial());
    const b: any = texture(texRed).load(cell);
    const grey = float(b.r).div(255);
    materialB.colorNode = vec4(grey, grey, grey, 1);
    addFlatQuad(owner, ctx.roots.world, materialA, 1.8, 0, 6, 3, 3);
    addFlatQuad(owner, ctx.roots.world, materialB, -1.8, 0, 6, 3, 3);
    placeCamera(ctx.roots.camera, [0, 0, 0], [0, 0, 6]);
    const rect = (qx: number, cx: number, cy: number): Rect => {
      const w = 3;
      const x = qx + w / 2 - (cx + 0.5) * (w / GRID_N);
      const y = -w / 2 + (cy + 0.5) * (w / GRID_N);
      return screenRectOfBox(ctx.roots.camera, [x, y, 6], [0.08, 0.08, 0.01]);
    };
    return {
      variants: ["default"],
      ready: Promise.resolve(),
      setVariant: noop,
      update: noop,
      facts(): Facts {
        return { cells: CELLS.length };
      },
      regions(): Record<string, Rect> {
        const out: Record<string, Rect> = {};
        for (const [cx, cy] of CELLS) {
          out[`rgba-${String(cx)}-${String(cy)}`] = rect(1.8, cx, cy);
          out[`r-${String(cx)}-${String(cy)}`] = rect(-1.8, cx, cy);
        }
        return out;
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
    const enc = (v: number): number => linearToSrgbByte(v / 255);
    let worstRgba = 0;
    let worstR = 0;
    for (const [x, y] of CELLS) {
      const s = m.stats[`rgba-${String(x)}-${String(y)}`];
      const r = m.stats[`r-${String(x)}-${String(y)}`];
      if (s === undefined || r === undefined) return missing("cell regions");
      worstRgba = Math.max(
        worstRgba,
        Math.abs(s.r - enc(x * 32)),
        Math.abs(s.g - enc(y * 32)),
        Math.abs(s.b - enc((x + y) * 16)),
      );
      worstR = Math.max(worstR, Math.abs(r.r - enc((x + GRID_N * y) * 4)));
    }
    c.expect(
      worstRgba <= 4,
      "RGBA32UI: every sampled texel matches its integer (max error in sRGB bytes)",
      fmt(worstRgba),
    );
    c.expect(worstR <= 4, "R32UI: every sampled texel matches its integer (max error in sRGB bytes)", fmt(worstR));
    return c.verdict();
  },
};

export const MORE_ROWS: readonly RowDef[] = [row11, row12, row15];
