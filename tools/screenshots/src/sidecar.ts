import type { McInfo, McLookLike } from "./harness";

/** Sidecar fields from visual-target 6.6 that come from the client hooks (`__mcLook.info()` and `__mcInfo()`). */

const DEG = Math.PI / 180;

function dir(azDeg: number, elDeg: number): [number, number, number] {
  // Same convention as the client's directionFromAzEl (azimuth from +x toward +z).
  return [
    Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
    Math.sin(elDeg * DEG),
    Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
  ];
}

/** Lit fraction of the Earth disc as seen from the surface: (1 + cos(phase angle)) / 2 (same formula as the client's litFraction). */
export function earthLitFraction(sunAzDeg: number, sunElDeg: number, earthAzDeg: number, earthElDeg: number): number {
  const s = dir(sunAzDeg, sunElDeg);
  const e = dir(earthAzDeg, earthElDeg);
  const cosPhase = -(s[0] * e[0] + s[1] * e[1] + s[2] * e[2]);
  return (1 + cosPhase) / 2;
}

export type LookInfoLike = NonNullable<ReturnType<NonNullable<McLookLike["info"]>>>;

export interface SidecarExtras {
  readonly knobs: Record<string, unknown>;
  readonly camera: { view: string | null; pose: null; vfovDeg: null; note: string };
  readonly sun: { elevationDeg: number; azimuthDeg: number } | null;
  readonly ev100: number | null;
  readonly evSource: string | null;
  readonly adaptationMultiplier: null;
  readonly earth: { litFraction: number; elevationDeg: number; azimuthDeg: number; diameterDeg: number } | null;
  readonly particlesLive: null;
}

/**
 * Builds the sidecar's lighting / knob fields. Camera pose and vFOV are not exposed by any client hook yet (`LookInfo` has no
 * camera), so they are recorded as null with a note instead of being invented.
 */
export function sidecarExtras(info: McInfo, look: LookInfoLike | null, view: string | null): SidecarExtras {
  const st = look?.state;
  return {
    knobs: {
      renderScale: (info["renderScale"] as number | undefined) ?? null,
      canvasDpr: (info["dpr"] as number | undefined) ?? null,
      aa: parseAa(look?.knobs),
      lookKnobs: look?.knobs ?? null,
      csm: look?.cascades ?? null,
      shadowFilter: look?.shadowFilter ?? null,
      skyDome: look?.skyDome ?? null,
      postPasses: look?.postPasses ?? null,
      dustRingTexelCm: null,
      particlePool: null,
    },
    camera: {
      view,
      pose: null,
      vfovDeg: null,
      note: "not exposed by the client: needs a read-only `camera` field in __mcLook.info() (visuals owner)",
    },
    sun: st ? { elevationDeg: st.sunElevationDeg, azimuthDeg: st.sunAzimuthDeg } : null,
    ev100: look?.ev100 ?? null,
    evSource: look?.keyMode ?? null,
    // The client scripts the exposure from the key state; whether any eye adaptation is active in captures is not reported.
    adaptationMultiplier: null,
    earth: st
      ? {
          litFraction: earthLitFraction(st.sunAzimuthDeg, st.sunElevationDeg, st.earthAzimuthDeg, st.earthElevationDeg),
          elevationDeg: st.earthElevationDeg,
          azimuthDeg: st.earthAzimuthDeg,
          diameterDeg: st.earthDiameterDeg,
        }
      : null,
    particlesLive: null,
  };
}

function parseAa(knobs: string | undefined): string | null {
  const m = knobs === undefined ? null : /\baa[=:]\s*([a-z0-9-]+)/i.exec(knobs);
  return m?.[1] ?? null;
}
