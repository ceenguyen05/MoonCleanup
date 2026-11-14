// three.js legacy-API ban-list, applied to every linted file in the repo.
// Why: agent habits and old tutorials default to WebGLRenderer / EffectComposer / GLSL ShaderMaterial. The renderer
// is WebGPURenderer + TSL + RenderPipeline on three@0.187.0 (ADR-0003; docs/architecture/rendering-pipeline.md
// section 18 "Legacy code from agent habits", API churn row).
//
// Two mechanisms, because `no-restricted-imports` cannot see `THREE.Clock` or `material.onBeforeCompile`:
//   1. import-source bans (this file: bannedImportPaths / bannedImportPatterns), merged into every layer;
//   2. AST selectors: bannedSyntax (every file: named imports, onBeforeCompile members) and bannedThreeMemberSyntax
//      (client/tools/e2e only: THREE.X members, type positions, destructuring).

/** Class, constant and method names that must never appear (see rendering-pipeline.md section 18). */
export const BANNED_THREE_NAMES = [
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
] as const;

/** Replacement hint per banned name, shown in the lint message. */
// (A Map of tuples, not an object literal: this very file is linted and must not contain an `onBeforeCompile:` key.)
const REPLACEMENT = new Map<(typeof BANNED_THREE_NAMES)[number], string>([
  ["WebGLRenderer", "use WebGPURenderer from 'three/webgpu' (it falls back to WebGL2 by itself)"],
  ["EffectComposer", "use RenderPipeline with TSL post-processing nodes"],
  ["ShaderMaterial", "write TSL node materials; GLSL ShaderMaterial does not run on WebGPURenderer"],
  ["RawShaderMaterial", "write TSL node materials; GLSL RawShaderMaterial does not run on WebGPURenderer"],
  ["onBeforeCompile", "compose TSL nodes on a NodeMaterial instead of patching shader strings"],
  ["PCFSoftShadowMap", "removed in r186; use the default shadow map type with the project's filtered cascaded shadows"],
  ["renderAsync", "deprecated since r181; call `await renderer.init()` once, then `renderer.render()`"],
  ["RGBELoader", "renamed to HDRLoader"],
  ["Clock", "deprecated; use Timer"],
  ["PostProcessing", "renamed to RenderPipeline (r183)"],
]);

const BAN_LIST_DOC = "docs/architecture/rendering-pipeline.md section 18";

function message(name: (typeof BANNED_THREE_NAMES)[number]): string {
  return `three.js ban-list: "${name}" is banned (${REPLACEMENT.get(name) ?? "see the doc"}). See ${BAN_LIST_DOC}.`;
}

// esquery regex literals cannot contain "/", so the module-path boundary is written as \x2f.
const THREE_SOURCE = String.raw`/^three($|\x2f)/`;

/** Names that are banned as member / type / destructured names. `Clock` is handled separately (too generic as a bare name). */
const PROPERTY_BANNED = BANNED_THREE_NAMES.filter((n) => n !== "Clock");
/** Names that three.js actually exports (renderAsync and onBeforeCompile are members, not exports). */
const IMPORTED_BANNED = BANNED_THREE_NAMES.filter((n) => n !== "renderAsync" && n !== "onBeforeCompile");
/** Identifiers that conventionally hold the three.js namespace; `Clock` is only banned on these. */
const NAMESPACE = String.raw`/^(THREE|three|Three)$/`;

/**
 * `no-restricted-syntax` entries that apply in EVERY linted file: named imports / re-exports from three*, and
 * object / class members called onBeforeCompile. One selector per name so each fixture fails for its own reason
 * (T02 review finding 12).
 */
export const bannedSyntax: { selector: string; message: string }[] = [
  ...IMPORTED_BANNED.flatMap((name) => [
    {
      // import { WebGLRenderer, Clock, ... } from "three" | "three/webgpu" | "three/addons/..."
      selector: `ImportDeclaration[source.value=${THREE_SOURCE}] > ImportSpecifier[imported.name="${name}"]`,
      message: message(name),
    },
    {
      // export { Clock } from "three"
      selector: `ExportNamedDeclaration[source.value=${THREE_SOURCE}] > ExportSpecifier[local.name="${name}"]`,
      message: message(name),
    },
  ]),
  {
    // { onBeforeCompile() {} } and { onBeforeCompile: fn }
    selector: `Property[computed=false][key.name="onBeforeCompile"]`,
    message: message("onBeforeCompile"),
  },
  {
    // class X { onBeforeCompile() {} } and class X { onBeforeCompile = fn }
    selector: `:matches(MethodDefinition, PropertyDefinition)[computed=false][key.name="onBeforeCompile"]`,
    message: message("onBeforeCompile"),
  },
];

/**
 * Member / type / destructuring forms. Applied only where three.js can be imported (apps/client, tools, tests/e2e):
 * the server and the environment-agnostic packages cannot import three, so a bare member such as
 * `hooks.onBeforeCompile` or `report.renderAsync()` there is not a three.js use (T02 review finding 3).
 */
export const bannedThreeMemberSyntax: { selector: string; message: string }[] = [
  ...PROPERTY_BANNED.flatMap((name) => [
    // THREE.WebGLRenderer, renderer.renderAsync(), material.onBeforeCompile = ...
    { selector: `MemberExpression[computed=false][property.name="${name}"]`, message: message(name) },
    // THREE["WebGLRenderer"]
    { selector: `MemberExpression[computed=true][property.value="${name}"]`, message: message(name) },
    // let r: THREE.WebGLRenderer; type T = typeof THREE.WebGLRenderer
    { selector: `TSQualifiedName[right.name="${name}"]`, message: message(name) },
    // const { WebGLRenderer } = THREE; const { renderAsync } = r
    { selector: `ObjectPattern > Property[key.name="${name}"]`, message: message(name) },
  ]),
  // Clock only on the three namespace (new THREE.Clock(), extends THREE.Clock, THREE.Clock, type positions, destructuring).
  {
    selector: `MemberExpression[computed=false][property.name="Clock"][object.name=${NAMESPACE}]`,
    message: message("Clock"),
  },
  {
    selector: `MemberExpression[computed=true][property.value="Clock"][object.name=${NAMESPACE}]`,
    message: message("Clock"),
  },
  { selector: `TSQualifiedName[left.name=${NAMESPACE}][right.name="Clock"]`, message: message("Clock") },
  {
    selector: `VariableDeclarator[init.name=${NAMESPACE}] > ObjectPattern > Property[key.name="Clock"]`,
    message: message("Clock"),
  },
];

/** `no-restricted-imports` `paths` entries (exact module names). */
export const bannedImportPaths: { name: string; message: string }[] = [
  {
    name: "postprocessing",
    message: `The pmndrs "postprocessing" library targets WebGLRenderer. Use RenderPipeline + TSL nodes. See ${BAN_LIST_DOC}.`,
  },
  {
    name: "@react-three/fiber",
    message: `React Three Fiber is banned: the renderer is created and driven by apps/client directly. See ${BAN_LIST_DOC}.`,
  },
];

/** `no-restricted-imports` `patterns` entries (gitignore-style groups). */
export const bannedImportPatterns: { group: string[]; message: string }[] = [
  {
    group: ["three/examples/jsm/postprocessing/**", "three/addons/postprocessing/**"],
    message: `three.js ban-list: EffectComposer-era post-processing passes are banned; use RenderPipeline + TSL. See ${BAN_LIST_DOC}.`,
  },
  {
    group: ["three/examples/jsm/loaders/RGBELoader*", "three/addons/loaders/RGBELoader*"],
    message: `three.js ban-list: ${message("RGBELoader")}`,
  },
  // default imports of the class file itself: import W from "three/src/renderers/WebGLRenderer.js"
  ...(["WebGLRenderer", "ShaderMaterial", "RawShaderMaterial", "Clock"] as const).map((name) => ({
    group: [`three/src/**/${name}*`],
    message: `three.js ban-list: ${message(name)}`,
  })),
  {
    group: ["postprocessing/**"],
    message: `The pmndrs "postprocessing" library is banned. See ${BAN_LIST_DOC}.`,
  },
  {
    group: ["@react-three/**", "react-three-fiber"],
    message: `React Three Fiber and its ecosystem are banned. See ${BAN_LIST_DOC}.`,
  },
];
