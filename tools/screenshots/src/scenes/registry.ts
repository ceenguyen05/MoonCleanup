import type { Tod } from "../naming";

/**
 * Scene registry of the harness (the scene list itself is visual-target 6.2, owned by visual-qa-reviewer). It maps a spec scene
 * id (`S01a`, `S12`) to what the client understands, and each time-of-day (visual-target 6.4) to that scene's own URL
 * knobs. The client does not read `?tod=` (it is sent for the record); the look-dev scenes take `time`, `sun` or `variant`.
 *
 * A scene/tod pair that is not listed is UNSUPPORTED and the harness fails before it opens a page, so two time-of-day names can
 * never silently produce the same picture (the VT-M0-12 finding: S01 dawn == S01 noon).
 */
export interface TodSetup {
  /** URL params the scene reads to start at this time of day. */
  readonly params: Readonly<Record<string, string>>;
  /** Expected key-light elevation in degrees (checked against `__mcLook.info().state` after the page is ready); null = not checked. */
  readonly sunElevationDeg: number | null;
  /** Allowed deviation in degrees. */
  readonly tolDeg: number;
}

export interface SceneEntry {
  /** Spec id without the a/b suffix (`S01`). */
  readonly id: string;
  /** Value of the client's `?scene=`. */
  readonly urlScene: string;
  readonly tods: Readonly<Partial<Record<Tod, TodSetup>>>;
  /** True for DOM pages that have no world sun: tod is recorded, never applied. */
  readonly todAgnostic?: boolean;
}

const t = (params: Record<string, string>, sunElevationDeg: number | null, tolDeg = 0.75): TodSetup => ({
  params,
  sunElevationDeg,
  tolDeg,
});

export const SCENES: Readonly<Record<string, SceneEntry>> = {
  S01: {
    id: "S01",
    urlScene: "s01",
    tods: {
      dawn: t({ time: "dawn" }, 4),
      morning: t({ time: "morning" }, 30),
      noon: t({ time: "noon" }, 60),
      // The client has one 4 degree twilight preset for dawn and dusk; the azimuth (E vs W) is not distinguished by `time`.
      dusk: t({ time: "dusk" }, 4),
    },
  },
  S02: {
    id: "S02",
    urlScene: "s02",
    tods: { noon: t({ variant: "noon" }, 60), dawn: t({ variant: "dawn" }, 4) },
  },
  S03: { id: "S03", urlScene: "s03", tods: { noon: t({}, 60) } },
  S05: {
    id: "S05",
    urlScene: "s05",
    tods: { noon: t({ sun: "60" }, 60), morning: t({ sun: "30" }, 30), dawn: t({ sun: "4" }, 4) },
  },
  S06: { id: "S06", urlScene: "s06", tods: { "night-near": t({}, -20, 6) } },
  /** HUD sheet / test page (`?scene=hud-test` in the client). */
  S12: {
    id: "S12",
    urlScene: "hud-test",
    todAgnostic: true,
    tods: { noon: t({}, null), "night-near": t({}, null) },
  },
};

export interface ResolvedScene {
  readonly entry: SceneEntry;
  /** Extra URL params implied by the scene id suffix (`S01a` -> `view=a`). */
  readonly params: Readonly<Record<string, string>>;
}

/** `S01a` -> S01 view a; `s12` -> S12. Returns null for an id the harness does not know. */
export function resolveScene(id: string): ResolvedScene | null {
  const m = /^s(\d{2})([ab])?$/i.exec(id.trim());
  if (m === null) return null;
  const entry = SCENES[`S${m[1]}`];
  if (entry === undefined) return null;
  return { entry, params: m[2] !== undefined && entry.id === "S01" ? { view: m[2].toLowerCase() } : {} };
}

export class UnsupportedSceneError extends Error {}

/** Looks up the time-of-day setup; throws (loudly) when the scene or tod is not supported. */
export function todSetup(sceneId: string, tod: Tod): { resolved: ResolvedScene; setup: TodSetup } {
  const resolved = resolveScene(sceneId);
  if (resolved === null) {
    throw new UnsupportedSceneError(
      `scene "${sceneId}" is not in the harness registry (${Object.keys(SCENES).join(", ")}); add it to src/scenes/registry.ts or pass --allow-unverified-tod`,
    );
  }
  const setup = resolved.entry.tods[tod];
  if (setup === undefined) {
    throw new UnsupportedSceneError(
      `scene ${resolved.entry.id} does not support tod "${tod}" (supported: ${Object.keys(resolved.entry.tods).join(", ")})`,
    );
  }
  return { resolved, setup };
}

/** Throws when the sun the client actually uses is not the one the time of day asks for. */
export function verifyTodApplied(
  sceneId: string,
  tod: Tod,
  setup: TodSetup,
  actualSunElevationDeg: number | null,
): void {
  if (setup.sunElevationDeg === null) return;
  if (actualSunElevationDeg === null || !Number.isFinite(actualSunElevationDeg)) {
    throw new UnsupportedSceneError(
      `${sceneId} ${tod}: the client exposes no sun state (window.__mcLook.info().state), so the time of day cannot be verified`,
    );
  }
  if (Math.abs(actualSunElevationDeg - setup.sunElevationDeg) > setup.tolDeg) {
    throw new UnsupportedSceneError(
      `${sceneId} ${tod}: sun elevation is ${actualSunElevationDeg.toFixed(2)} deg, expected ${setup.sunElevationDeg} +- ${setup.tolDeg}; the client did not apply the time of day`,
    );
  }
}
