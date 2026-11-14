// One fixture per three.js ban-list entry proving the rule fires (docs/architecture/rendering-pipeline.md section 18),
// plus allowed-usage fixtures so the ban-list does not over-block the real API (WebGPURenderer, Timer, HDRLoader...).
import { describe, expect, it } from "vitest";
import { BANNED_THREE_NAMES } from "./ban-list.ts";
import { lintFixture, restrictedFindings } from "./lint-fixture.ts";

const FILE = "apps/client/src/render/a.ts";

interface Case {
  entry: (typeof BANNED_THREE_NAMES)[number] | "three/examples/jsm/postprocessing/*" | "R3F" | "postprocessing";
  title: string;
  code: string;
  file?: string;
}

const cases: Case[] = [
  {
    entry: "WebGLRenderer",
    title: "named import",
    code: `import { WebGLRenderer } from "three";\nexport const r = new WebGLRenderer();\n`,
  },
  {
    entry: "WebGLRenderer",
    title: "namespace member",
    code: `import * as THREE from "three";\nexport const r = new THREE.WebGLRenderer();\n`,
  },
  {
    entry: "WebGLRenderer",
    title: "banned in tools too",
    file: "tools/screenshots/src/a.ts",
    code: `import { WebGLRenderer } from "three";\nexport const r = WebGLRenderer;\n`,
  },
  {
    entry: "EffectComposer",
    title: "named import from addons",
    code: `import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";\nexport const c = EffectComposer;\n`,
  },
  {
    entry: "EffectComposer",
    title: "namespace member",
    code: `import * as THREE from "three";\nexport const c = new THREE.EffectComposer();\n`,
  },
  {
    entry: "three/examples/jsm/postprocessing/*",
    title: "examples/jsm path",
    code: `import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";\nexport const p = RenderPass;\n`,
  },
  {
    entry: "three/examples/jsm/postprocessing/*",
    title: "side-effect import",
    code: `import "three/examples/jsm/postprocessing/ShaderPass.js";\n`,
  },
  {
    entry: "three/examples/jsm/postprocessing/*",
    title: "addons path",
    code: `import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";\nexport const p = UnrealBloomPass;\n`,
  },
  {
    entry: "ShaderMaterial",
    title: "named import",
    code: `import { ShaderMaterial } from "three";\nexport const m = new ShaderMaterial();\n`,
  },
  {
    entry: "ShaderMaterial",
    title: "namespace member",
    code: `import * as THREE from "three";\nexport const m = new THREE.ShaderMaterial({});\n`,
  },
  {
    entry: "ShaderMaterial",
    title: "class extends",
    code: `import * as THREE from "three";\nexport class M extends THREE.ShaderMaterial {}\n`,
  },
  {
    entry: "RawShaderMaterial",
    title: "named import",
    code: `import { RawShaderMaterial } from "three";\nexport const m = new RawShaderMaterial();\n`,
  },
  {
    entry: "RawShaderMaterial",
    title: "namespace member",
    code: `import * as THREE from "three";\nexport const m = new THREE.RawShaderMaterial({});\n`,
  },
  {
    entry: "onBeforeCompile",
    title: "member assignment",
    code: `export function patch(material: { onBeforeCompile?: () => void }) {\n  material.onBeforeCompile = () => {};\n}\n`,
  },
  { entry: "onBeforeCompile", title: "object literal method", code: `export const o = { onBeforeCompile() {} };\n` },
  {
    entry: "onBeforeCompile",
    title: "object literal property",
    code: `export const o = { onBeforeCompile: () => {} };\n`,
  },
  { entry: "onBeforeCompile", title: "class method", code: `export class M {\n  onBeforeCompile() {}\n}\n` },
  { entry: "onBeforeCompile", title: "class field", code: `export class M {\n  onBeforeCompile = () => {};\n}\n` },
  {
    entry: "PCFSoftShadowMap",
    title: "named import",
    code: `import { PCFSoftShadowMap } from "three";\nexport const t = PCFSoftShadowMap;\n`,
  },
  {
    entry: "PCFSoftShadowMap",
    title: "namespace member",
    code: `import * as THREE from "three";\nexport const t = THREE.PCFSoftShadowMap;\n`,
  },
  {
    entry: "renderAsync",
    title: "method call",
    code: `export async function f(r: { renderAsync(a: unknown, b: unknown): Promise<void> }) {\n  await r.renderAsync(1, 2);\n}\n`,
  },
  {
    entry: "RGBELoader",
    title: "named import from three",
    code: `import { RGBELoader } from "three";\nexport const l = new RGBELoader();\n`,
  },
  {
    entry: "RGBELoader",
    title: "addons module path",
    code: `import { RGBELoader } from "three/addons/loaders/RGBELoader.js";\nexport const l = RGBELoader;\n`,
  },
  {
    entry: "RGBELoader",
    title: "examples/jsm module path",
    code: `import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";\nexport const l = RGBELoader;\n`,
  },
  {
    entry: "RGBELoader",
    title: "namespace member",
    code: `import * as THREE from "three";\nexport const l = new THREE.RGBELoader();\n`,
  },
  { entry: "Clock", title: "named import", code: `import { Clock } from "three";\nexport const c = new Clock();\n` },
  {
    entry: "Clock",
    title: "named import with alias",
    code: `import { Clock as ThreeClock } from "three";\nexport const c = new ThreeClock();\n`,
  },
  {
    entry: "Clock",
    title: "namespace member",
    code: `import * as THREE from "three";\nexport const c = new THREE.Clock();\n`,
  },
  { entry: "Clock", title: "re-export", code: `export { Clock } from "three";\n` },
  {
    entry: "PostProcessing",
    title: "named import from three/webgpu",
    code: `import { PostProcessing } from "three/webgpu";\nexport const p = PostProcessing;\n`,
  },
  {
    entry: "PostProcessing",
    title: "namespace member",
    code: `import * as THREE from "three/webgpu";\nexport const p = new THREE.PostProcessing({} as never);\n`,
  },
  {
    entry: "R3F",
    title: "@react-three/fiber",
    code: `import { Canvas } from "@react-three/fiber";\nexport const c = Canvas;\n`,
  },
  {
    entry: "R3F",
    title: "@react-three/drei",
    code: `import { OrbitControls } from "@react-three/drei";\nexport const c = OrbitControls;\n`,
  },
  {
    entry: "R3F",
    title: "@react-three/postprocessing",
    code: `import { Bloom } from "@react-three/postprocessing";\nexport const c = Bloom;\n`,
  },
  {
    entry: "postprocessing",
    title: "pmndrs postprocessing package",
    code: `import { EffectComposer } from "postprocessing";\nexport const c = EffectComposer;\n`,
  },
  // --- fix cycle 3: forms that slipped through (T02 review finding 4) ---
  {
    entry: "Clock",
    title: "THREE.Clock without new",
    code: `import * as THREE from "three";
export const C = THREE.Clock;
`,
  },
  {
    entry: "Clock",
    title: "extends THREE.Clock",
    code: `import * as THREE from "three";
export class C extends THREE.Clock {}
`,
  },
  {
    entry: "Clock",
    title: "type position",
    code: `import type * as THREE from "three";
export type C = THREE.Clock;
`,
  },
  {
    entry: "WebGLRenderer",
    title: "type position",
    code: `import type * as THREE from "three";
export let r: THREE.WebGLRenderer | undefined;
`,
  },
  {
    entry: "WebGLRenderer",
    title: "destructuring the namespace",
    code: `import * as THREE from "three";
const { WebGLRenderer } = THREE;
export const r = WebGLRenderer;
`,
  },
  {
    entry: "Clock",
    title: "destructuring the namespace",
    code: `import * as THREE from "three";
const { Clock } = THREE;
export const c = Clock;
`,
  },
  {
    entry: "WebGLRenderer",
    title: "computed member",
    code: `import * as THREE from "three";
export const r = THREE["WebGLRenderer"];
`,
  },
  {
    entry: "renderAsync",
    title: "destructured method",
    code: `export function f(r: { renderAsync: () => void }) {
  const { renderAsync } = r;
  renderAsync();
}
`,
  },
  {
    entry: "WebGLRenderer",
    title: "default import of the class file",
    code: `import W from "three/src/renderers/WebGLRenderer.js";
export const r = W;
`,
  },
  {
    entry: "WebGLRenderer",
    title: "scoped to tools: type position",
    file: "tools/screenshots/src/a.ts",
    code: `import type * as THREE from "three";
export let r: THREE.WebGLRenderer | undefined;
`,
  },
  { entry: "postprocessing", title: "pmndrs postprocessing subpath", code: `import "postprocessing/build/x.js";\n` },
];

describe("three.js ban-list: each entry fires", () => {
  it("covers exactly the ban-list named in rendering-pipeline.md section 18", () => {
    expect([...BANNED_THREE_NAMES]).toEqual([
      "WebGLRenderer",
      "EffectComposer",
      "ShaderMaterial",
      "RawShaderMaterial",
      "onBeforeCompile",
      "PCFSoftShadowMap",
      "renderAsync",
      "RGBELoader",
      "Clock",
      "PostProcessing",
    ]);
  });

  it("has at least one fixture for every ban-list entry", () => {
    const covered = new Set(cases.map((c) => c.entry));
    for (const name of BANNED_THREE_NAMES) {
      expect(covered.has(name), `no fixture for ${name}`).toBe(true);
    }
    for (const extra of ["three/examples/jsm/postprocessing/*", "R3F", "postprocessing"] as const) {
      expect(covered.has(extra), `no fixture for ${extra}`).toBe(true);
    }
  });

  // Each fixture must fail for ITS OWN reason: the message names the banned entry (T02 review finding 12).
  const reasonFor = (entry: Case["entry"]): RegExp => {
    switch (entry) {
      case "three/examples/jsm/postprocessing/*":
        return /post-processing passes are banned/;
      case "R3F":
        return /React Three Fiber/;
      case "postprocessing":
        return /postprocessing/;
      default:
        return new RegExp(`"${entry}" is banned`);
    }
  };

  it.each(cases)("$entry: $title", async ({ entry, code, file }) => {
    const hits = restrictedFindings(await lintFixture(code, file ?? FILE));
    expect(hits.length, "a no-restricted-* rule must fire").toBeGreaterThan(0);
    expect(
      hits.some((h) => reasonFor(entry).test(h.message)),
      JSON.stringify(hits),
    ).toBe(true);
  });
});

describe("three.js ban-list: allowed API stays clean", () => {
  const allowed: { title: string; code: string }[] = [
    {
      title: "WebGPURenderer + RenderPipeline + Timer + HDRLoader",
      code: `import { WebGPURenderer, RenderPipeline, Timer } from "three/webgpu";\nimport { HDRLoader } from "three/addons/loaders/HDRLoader.js";\nexport const all = [WebGPURenderer, RenderPipeline, Timer, HDRLoader];\n`,
    },
    {
      title: "namespace import with the allowed API",
      code: `import * as THREE from "three/webgpu";\nexport const r = new THREE.WebGPURenderer();\nexport const t = new THREE.Timer();\n`,
    },
    {
      title: "an unrelated project class named Clock",
      code: `class Clock {\n  now() {\n    return 0;\n  }\n}\nexport const c = new Clock();\n`,
    },
    {
      title: "type position of an allowed class",
      code: `import type * as THREE from "three/webgpu";
export let r: THREE.WebGPURenderer | undefined;
export let t: THREE.Timer | undefined;
`,
    },
    {
      title: "destructuring allowed names from the namespace",
      code: `import * as THREE from "three/webgpu";
const { WebGPURenderer, Timer } = THREE;
export const all = [WebGPURenderer, Timer];
`,
    },
    {
      title: "a local Clock type and a Clock-named member of another object in the client",
      code: `interface Clock {
  now(): number;
}
export const f = (deps: { Clock: Clock }) => deps.Clock.now();
`,
    },
    {
      title: "awaiting renderer.init() then render()",
      code: `export async function start(r: { init(): Promise<void>; render(a: number): void }) {\n  await r.init();\n  r.render(1);\n}\n`,
    },
  ];

  it.each(allowed)("$title", async ({ code }) => {
    const findings = await lintFixture(code, FILE);
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });
});

// Member / type / destructuring selectors only apply where three.js can be imported (T02 review finding 3).
describe("three.js ban-list: member selectors are scoped to client, tools and e2e", () => {
  const misfires: { title: string; file: string; code: string }[] = [
    {
      title: "hooks.onBeforeCompile in the server",
      file: "apps/server/src/a.ts",
      code: `export const f = (hooks: { onBeforeCompile?: () => void }) => hooks.onBeforeCompile?.();
`,
    },
    {
      title: "renderAsync member in the sim",
      file: "packages/sim/src/a.ts",
      code: `export const f = (o: { renderAsync: () => void }) => o.renderAsync();
`,
    },
    {
      title: "PostProcessing member in a package",
      file: "packages/shared/src/a.ts",
      code: `export const f = (o: { PostProcessing: number }) => o.PostProcessing;
`,
    },
    {
      title: "new deps.Clock() in the sim",
      file: "packages/sim/src/a.ts",
      code: `export const f = (deps: { Clock: new () => object }) => new deps.Clock();
`,
    },
    {
      title: "own namespace import Clock in the server",
      file: "apps/server/src/a.ts",
      code: `import * as net from "@moon-cleanup/protocol";
export const c = (net as unknown as { Clock: new () => object }).Clock;
`,
    },
  ];
  it.each(misfires)("$title stays clean", async ({ file, code }) => {
    const findings = restrictedFindings(await lintFixture(code, file));
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });

  it("a renderAsync member is still caught in the client, where three can be imported", async () => {
    const hits = restrictedFindings(
      await lintFixture(
        `export const f = (o: { renderAsync: () => void }) => o.renderAsync();
`,
        FILE,
      ),
    );
    expect(hits.length).toBeGreaterThan(0);
  });
});
