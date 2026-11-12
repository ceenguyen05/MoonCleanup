// three.js legacy-API ban-list, applied to every linted file in the repo.
// Why: agent habits and old tutorials default to WebGLRenderer / EffectComposer / GLSL ShaderMaterial. The renderer
// is WebGPURenderer + TSL + RenderPipeline on three@0.187.0 (ADR-0003; docs/architecture/rendering-pipeline.md
// section 18 "Legacy code from agent habits", API churn row).
//
// Two mechanisms, because `no-restricted-imports` cannot see `THREE.Clock` or `material.onBeforeCompile`:
//   1. import-source bans (this file: bannedImportPaths / bannedImportPatterns), merged into every layer;
//   2. AST selectors (bannedSyntax) for named imports from three*, property access and object/class members.

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

/** Names that are banned as property names everywhere. `Clock` is handled separately (too generic as a bare name). */
const PROPERTY_BANNED = BANNED_THREE_NAMES.filter((n) => n !== "Clock");
const propertyRegex = `/^(${PROPERTY_BANNED.join("|")})$/`;
const importedRegex = `/^(${BANNED_THREE_NAMES.filter((n) => n !== "renderAsync" && n !== "onBeforeCompile").join("|")})$/`;

/** `no-restricted-syntax` entries enforcing the ban-list. */
export const bannedSyntax: { selector: string; message: string }[] = [
  {
    // import { WebGLRenderer, Clock, ... } from "three" | "three/webgpu" | "three/addons/..."
    selector: `ImportDeclaration[source.value=${THREE_SOURCE}] > ImportSpecifier[imported.name=${importedRegex}]`,
    message: `three.js ban-list: this named import from three is banned (${BANNED_THREE_NAMES.filter((n) => n !== "renderAsync" && n !== "onBeforeCompile").join(", ")}). See ${BAN_LIST_DOC}.`,
  },
  {
    // export { Clock } from "three"
    selector: `ExportNamedDeclaration[source.value=${THREE_SOURCE}] > ExportSpecifier[local.name=${importedRegex}]`,
    message: `three.js ban-list: re-exporting a banned three.js name. See ${BAN_LIST_DOC}.`,
  },
  {
    // THREE.WebGLRenderer, renderer.renderAsync(), material.onBeforeCompile = ...
    selector: `MemberExpression[computed=false][property.name=${propertyRegex}]`,
    message: `three.js ban-list: banned member (${PROPERTY_BANNED.join(", ")}). See ${BAN_LIST_DOC}.`,
  },
  {
    // new THREE.Clock()
    selector: `NewExpression > MemberExpression.callee[computed=false][property.name="Clock"]`,
    message: message("Clock"),
  },
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
  {
    group: ["postprocessing/**"],
    message: `The pmndrs "postprocessing" library is banned. See ${BAN_LIST_DOC}.`,
  },
  {
    group: ["@react-three/**", "react-three-fiber"],
    message: `React Three Fiber and its ecosystem are banned. See ${BAN_LIST_DOC}.`,
  },
];
