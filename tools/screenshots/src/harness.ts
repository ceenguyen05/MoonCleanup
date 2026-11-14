import type { Backend, Preset, Tier, Tod } from "./naming";
import { normalizeOutPath, type PathContext } from "./paths";
import { resolveScene, todSetup } from "./scenes/registry";

/**
 * Client-side contract the harness relies on (documented for the integrator, M0-W1-T06).
 * URL params: scene, backend, preset, dpr, plus seed, tod, hud, tier, view, capture.
 * Window hooks: see McHooks.
 */
export interface McInfo {
  readonly backend?: Backend;
  readonly gpu?: string;
  readonly frameTimeAvgMs?: number;
  readonly frameTimeP95Ms?: number;
  readonly drawCalls?: number;
  readonly triangles?: number;
  readonly texPoolMB?: number;
  readonly placeholderAssets?: readonly string[];
  readonly [k: string]: unknown;
}

/** Subset of `window.__mcLook` (visuals module) the harness reads. */
export interface McLookLike {
  info?: () => {
    readonly keyMode?: string;
    readonly ev100?: number;
    readonly knobs?: string;
    readonly skyDome?: string;
    readonly shadowFilter?: string;
    readonly postPasses?: readonly string[];
    readonly cascades?: readonly { index: number; texelM: number; endM: number }[];
    readonly preset?: string;
    readonly backend?: string;
    readonly state?: {
      readonly sunElevationDeg: number;
      readonly sunAzimuthDeg: number;
      readonly earthElevationDeg: number;
      readonly earthAzimuthDeg: number;
      readonly earthDiameterDeg: number;
    };
  };
  probes?: () => Record<string, { px: { x: number; y: number; visible: boolean } }>;
  setView?: (name: string) => void;
}

/** Subset of `window.__mcLookdev` (S02 / S03). Rects and lines are CSS pixels of the canvas. */
export interface McLookdevLike {
  probes?: () => {
    readonly chips: Readonly<Record<string, { x: number; y: number; w: number; h: number }>>;
    readonly lines: Readonly<Record<string, { x0: number; y0: number; x1: number; y1: number }>>;
    readonly facts: Readonly<Record<string, string | number | boolean>>;
  };
}

export interface McHooks {
  __mcLook?: McLookLike;
  __mcLookdev?: McLookdevLike;
  /** `true` once the pipelines are compiled, streaming is idle and the scene has rendered a stable frame. */
  __mcReady?: boolean;
  /** Frame-stepped capture mode (`?capture=1`): advance exactly `n` fixed-dt frames, resolve after the last is presented. */
  __mcStep?: (n: number, dtSeconds: number) => Promise<void>;
  /** Runtime stats for the sidecar (frame-time sample, backend actually used, draw calls...). */
  __mcInfo?: McInfo | (() => McInfo);
}

export type Lane = "ci" | "gpu";

export interface SceneRequest {
  readonly scene: string;
  readonly tod: Tod;
  readonly tier: Tier;
  readonly preset: Preset;
  readonly backend: Backend;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly hud: "hud" | "nohud" | "dbg";
  readonly seed: string;
  readonly scale?: "floor" | "ceil";
  readonly variant?: string;
  /** Turntable view index 0..7 (45 deg steps), when capturing a turntable. */
  readonly view?: number;
  /** Frame-stepped deterministic mode: frames to advance before the shot (fixed dt 1/60). */
  readonly stepFrames?: number;
  /** Scenes outside the registry are passed through and their time of day is not verified (recorded in the sidecar). */
  readonly allowUnverifiedTod?: boolean;
}

export const FIXED_DT = 1 / 60;
export const DEFAULT_SEED = "vt-standard-01";
export const TURNTABLE_VIEWS = 8;
export const TURNTABLE_TODS: readonly Tod[] = ["noon", "night-near"];

export function sceneUrl(baseUrl: string, r: SceneRequest): string {
  const u = new URL(baseUrl);
  const q = u.searchParams;
  const known = resolveScene(r.scene);
  if (known === null && !r.allowUnverifiedTod) todSetup(r.scene, r.tod); // throws UnsupportedSceneError
  if (known !== null) {
    // Throws for a tod the scene does not support; the params make the client start at that time of day.
    const { resolved, setup } = todSetup(r.scene, r.tod);
    q.set("scene", resolved.entry.urlScene);
    for (const [k, v] of Object.entries({ ...resolved.params, ...setup.params })) q.set(k, v);
  } else {
    q.set("scene", r.scene);
  }
  q.set("backend", r.backend === "webgpu-compat" ? "webgpu" : r.backend);
  q.set("preset", r.preset);
  q.set("dpr", String(r.dpr));
  q.set("tier", r.tier);
  q.set("tod", r.tod);
  q.set("seed", r.seed);
  q.set("hud", r.hud === "nohud" ? "0" : r.hud === "dbg" ? "dbg" : "1");
  if (r.scale) q.set("scale", r.scale);
  if (r.view !== undefined) q.set("view", String(r.view));
  if (r.stepFrames !== undefined) q.set("capture", "1");
  return u.toString();
}

/** Chromium launch options per lane (ADR-0019). CI = software WebGL2; gpu = real Chrome with WebGPU. */
export function laneLaunch(lane: Lane): {
  headless: boolean;
  channel?: "chrome";
  args: string[];
  forcedBackend?: Backend;
} {
  if (lane === "ci") {
    return {
      headless: true,
      forcedBackend: "webgl2",
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    };
  }
  return {
    headless: false,
    channel: "chrome",
    args: [
      "--enable-unsafe-webgpu",
      "--enable-features=Vulkan,WebGPU",
      "--ignore-gpu-blocklist",
      "--disable-frame-rate-limit",
    ],
  };
}

/** Port scheme from module-boundaries 6: client 5173+N, server 2567+N. */
export function portsFor(offset: number): { client: number; server: number } {
  return { client: 5173 + offset, server: 2567 + offset };
}

export interface CliArgs {
  readonly lane: Lane;
  readonly out: string;
  readonly baseUrl: string;
  readonly scenes: readonly string[];
  readonly mode: "single" | "stepped" | "turntable";
  readonly flags: Readonly<Record<string, string>>;
}

export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
  pathCtx?: PathContext,
): CliArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) flags[a.slice(2)] = argv[++i]!;
      else flags[a.slice(2)] = "true";
    } else positional.push(a);
  }
  const offset = Number(flags["port-offset"] ?? env["MC_PORT_OFFSET"] ?? 0);
  const lane: Lane = flags["lane"] === "gpu" ? "gpu" : "ci";
  const mode = flags["turntable"] ? "turntable" : flags["step"] ? "stepped" : "single";
  return {
    lane,
    out: normalizeOutPath(flags["out"] ?? "tools/screenshots/output", pathCtx),
    baseUrl: flags["url"] ?? env["MC_CLIENT_URL"] ?? `http://localhost:${portsFor(offset).client}/`,
    scenes: (flags["scene"] ?? positional.join(",")).split(",").filter(Boolean),
    mode,
    flags,
  };
}
