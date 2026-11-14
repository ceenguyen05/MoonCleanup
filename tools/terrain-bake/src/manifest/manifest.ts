// Step 9: terrain manifest (assets/terrain/manifest.json). Deterministic: no timestamps, no timings. `bakeHash` is the
// SHA-256 of the canonical JSON of everything else; the save header's `bakeHash` must equal it (world-and-dust 3.2/6).

import { createHash } from "node:crypto";

import type { ErrorStats, SlopeReport } from "../cubemap/analysis.js";
import type { BakeParams, PadResult, QuantisedCube, RelaxResult } from "../cubemap/bake.js";
import type { HorizonParams, HorizonStats } from "../cubemap/horizon.js";
import { FACE_NAMES } from "../cubemap/mapping.js";
import type { Ldem } from "../lola/ldem.js";
import { LDEM_16, LDEM_64_BYTES, LDEM_64_URL } from "../lola/sources.js";

export const HASH_LENGTH = 12;

export function hashedName(logical: string, sha256: string, extension: string): string {
  return `${logical}.${sha256.slice(0, HASH_LENGTH)}.${extension}`;
}

export interface ManifestOutput {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly rawBytes: number;
  readonly rawSha256: string;
}

export interface TerrainManifest {
  readonly schema: 1;
  readonly generator: string;
  readonly credit: string;
  readonly bakeHash: string;
  readonly [key: string]: unknown;
}

export interface ManifestInput {
  readonly ldem: Ldem;
  readonly params: BakeParams;
  readonly sizes: { main: number; preview: number; fixture: number; horizon: number };
  readonly quant: QuantisedCube;
  readonly previewQuant: QuantisedCube;
  readonly pads: readonly PadResult[];
  readonly relax: RelaxResult;
  readonly slope: SlopeReport;
  readonly slopePreview: SlopeReport;
  readonly accuracy: ErrorStats;
  readonly seam: ErrorStats & { texelBand: number };
  readonly horizonStats: HorizonStats;
  readonly horizonParams: HorizonParams;
  readonly outputs: Record<string, ManifestOutput>;
  readonly fixture: { dir: string; cube: object; goldenFile: string };
  readonly credit: string;
}

function round(value: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function buildManifest(input: ManifestInput): TerrainManifest {
  const { ldem, params, quant } = input;
  const body = {
    schema: 1 as const,
    generator: "@moon-cleanup/terrain-bake (M0-W2-T05 spike)",
    credit: input.credit,
    sources: [
      {
        id: LDEM_16.id,
        role: "data",
        product: LDEM_16.product,
        url: LDEM_16.imgUrl,
        bytes: ldem.imgBytes,
        sha256: ldem.imgSha256,
      },
      { id: `${LDEM_16.id}-label`, role: "label", url: LDEM_16.lblUrl, bytes: ldem.lblBytes, sha256: ldem.lblSha256 },
    ],
    notDownloaded: [
      {
        product: "LDEM_64",
        url: LDEM_64_URL,
        bytes: LDEM_64_BYTES,
        reason: "531 MB: go/no-go in the M0-W2-T05 report",
      },
    ],
    decode: {
      sampleType: ldem.label.sampleType,
      sampleBits: ldem.label.sampleBits,
      scalingFactor: ldem.label.scalingFactor,
      referenceRadiusM: ldem.label.referenceRadiusM,
      lines: ldem.label.lines,
      lineSamples: ldem.label.lineSamples,
      pixelsPerDegree: ldem.label.pixelsPerDegree,
    },
    parameters: {
      radiusM: params.radiusM,
      verticalScale: round(params.radiusM / ldem.label.referenceRadiusM, 9),
      eLow: params.eLow,
      eHigh: params.eHigh,
      eHighNote:
        "world-and-dust 3.3 starts at E_high 3; stepped down 3 -> 2.5 -> 2 until the slope acceptance (<= 5 % above 30 deg, <= 1 % above 45 deg) passed; see tools/terrain-bake/src/sweep.ts",
      sigmaRealM: params.sigmaRealM,
      lowpass: "3-pass box (Gaussian), longitude width scaled by 1/cos(lat), then latitude; edge-clamped",
      supersample: `${params.supersample}x${params.supersample} bilinear taps per texel`,
      pads: {
        radiusM: params.padRadiusM,
        blendM: params.padBlendM,
        sites: params.sites.map((s) => ({ id: s.id, dir: s.dir })),
        placeholder: true,
        results: input.pads.map((p) => ({ id: p.id, heightM: round(p.padHeightM, 4), texelsInPad: p.texelsInPad })),
      },
      slopeRelaxation: {
        maxSlopeDeg: params.maxSlopeDeg,
        texelsRelaxedFirstPass: input.relax.texelsRelaxedFirstPass,
        iterations: input.relax.iterations,
      },
    },
    cube: {
      layout: "equal-angle spherified cube, layout v1",
      faces: FACE_NAMES,
      mapping:
        "dir = normalize(n + tan(pi/4 a) u + tan(pi/4 b) v); a = 4/pi atan(u.d / n.d); face = major axis (ties X, Y, Z)",
      faceSize: input.sizes.main,
      gutter: 1,
      paddedFaceSize: input.sizes.main + 2,
      format: "CTMH v1: 32-byte header + deflate-raw(row-delta, byte-planar uint16); see src/cubemap/codec.ts",
      quantisation: {
        offsetM: quant.offsetM,
        scaleM: quant.scaleM,
        minM: round(quant.minM, 4),
        maxM: round(quant.maxM, 4),
        maxErrorM: round(quant.scaleM / 2, 6),
      },
      previewQuantisation: {
        faceSize: input.sizes.preview,
        offsetM: input.previewQuant.offsetM,
        scaleM: input.previewQuant.scaleM,
      },
    },
    horizon: {
      faceSize: input.sizes.horizon,
      azimuths: 8,
      azimuthConvention: "k * 45 degrees from local north toward east; poles use east = (0,0,-1)",
      angleRangeDeg: [input.horizonParams.minAngleDeg, input.horizonParams.maxAngleDeg],
      minOccluderM: input.horizonParams.minOccluderM,
      stepRatio: input.horizonParams.stepRatio,
      maxDistanceM: input.horizonParams.maxDistanceM,
      clampedLow: input.horizonStats.clampedLow,
      clampedHigh: input.horizonStats.clampedHigh,
      format: "CTMW v1: 32-byte header + deflate-raw(row-delta uint8 planes: face, azimuth, row-major)",
    },
    validation: {
      slope1024: input.slope,
      slope256: input.slopePreview,
      accuracyVsSourceM: input.accuracy,
      seamAgreementM: input.seam,
    },
    outputs: input.outputs,
    fixtures: input.fixture,
    grid: {
      goldenHash: null,
      status: "deferred: step 8 (per-plot dust class, grid golden hash) needs the M1 plot grid",
    },
  };
  const bakeHash = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return { ...body, bakeHash };
}
