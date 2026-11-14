// M0-W2-T05 bake pipeline: LDEM_16 -> 6-face height cubes (1024, 256, 64 fixture) + horizon map + manifest.
// Steps 1-7, 8b and 9 of world-and-dust-simulation 3.2 (step 8, per-plot dust class, needs the M1 plot grid).

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  accuracyVsSource,
  goldenSamples,
  hillshadeFace,
  seamAgreement,
  slopeReport,
  type ErrorStats,
  type GoldenSample,
  type SlopeReport,
} from "./cubemap/analysis.js";
import {
  applyPads,
  buildSlopeMetric,
  composeGameField,
  DEFAULT_PARAMS,
  paddedSize,
  quantiseCube,
  relaxSteepTexels,
  reprojectToCube,
  slopeFieldDeg,
  type BakeParams,
  type FloatCube,
  type PadResult,
  type QuantisedCube,
  type RelaxResult,
} from "./cubemap/bake.js";
import { encodeHeightCube, encodeHorizon } from "./cubemap/codec.js";
import { bakeHorizon, DEFAULT_HORIZON, type HorizonStats } from "./cubemap/horizon.js";
import { FACE_NAMES } from "./cubemap/mapping.js";
import { loadLdemFiles, sha256Of, type EquirectField } from "./lola/ldem.js";
import { LDEM_16, LOLA_CREDIT } from "./lola/sources.js";
import { buildManifest, hashedName, type TerrainManifest } from "./manifest/manifest.js";
import { encodeGreyPng } from "./png.js";

export interface BakeOptions {
  readonly rawDir: string;
  readonly outDir: string;
  readonly statsDir: string;
  /** Optional folder for per-face hillshade PNGs. */
  readonly previewDir?: string;
  readonly params?: BakeParams;
  readonly mainSize?: number;
  readonly previewSize?: number;
  readonly fixtureSize?: number;
  readonly horizonSize?: number;
}

export interface LevelResult {
  readonly faceSize: number;
  readonly float: FloatCube;
  readonly quant: QuantisedCube;
  readonly pads: PadResult[];
  readonly relax: RelaxResult;
  readonly slope: SlopeReport;
  readonly seconds: { reproject: number; edits: number; quantise: number };
}

export function bakeLevel(field: EquirectField, faceSize: number, params: BakeParams): LevelResult {
  const t0 = performance.now();
  const float = reprojectToCube(field, faceSize, params.supersample);
  const t1 = performance.now();
  const padEdit = applyPads(float, params);
  const pads = padEdit.results;
  const metric = buildSlopeMetric(faceSize, params.radiusM);
  const relax = relaxSteepTexels(float, metric, params.maxSlopeDeg, padEdit.mask);
  const slopes = slopeFieldDeg(float, metric);
  const slope = slopeReport(
    slopes,
    faceSize,
    params.radiusM,
    params.sites,
    params.padRadiusM,
    params.padRadiusM + params.padBlendM,
  );
  const t2 = performance.now();
  const quant = quantiseCube(float);
  const t3 = performance.now();
  return {
    faceSize,
    float,
    quant,
    pads,
    relax,
    slope,
    seconds: { reproject: (t1 - t0) / 1000, edits: (t2 - t1) / 1000, quantise: (t3 - t2) / 1000 },
  };
}

export interface BakeSummary {
  readonly manifest: TerrainManifest;
  readonly timings: Record<string, number>;
  readonly peakRssMiB: number;
  readonly accuracy: ErrorStats;
  readonly seam: ReturnType<typeof seamAgreement>;
  readonly slope1024: SlopeReport;
  readonly slope256: SlopeReport;
  readonly horizonStats: HorizonStats;
  readonly sizes: Record<string, { bytes: number; rawBytes: number; file: string }>;
  readonly golden: readonly GoldenSample[];
  readonly pads: readonly PadResult[];
  readonly relax: RelaxResult;
  readonly heightRangeM: { min: number; max: number; scaleM: number };
  readonly lowBandRangeM: { min: number; max: number };
}

function seconds(from: number): number {
  return Math.round(((performance.now() - from) / 1000) * 100) / 100;
}

export function runBake(options: BakeOptions): BakeSummary {
  const params = options.params ?? DEFAULT_PARAMS;
  const mainSize = options.mainSize ?? 1024;
  const previewSize = options.previewSize ?? 256;
  const fixtureSize = options.fixtureSize ?? 64;
  const horizonSize = options.horizonSize ?? DEFAULT_HORIZON.faceSize;
  const timings: Record<string, number> = {};
  const totalStart = performance.now();

  let t = performance.now();
  const ldem = loadLdemFiles(join(options.rawDir, LDEM_16.imgFile), join(options.rawDir, LDEM_16.lblFile), {
    imgSha256: LDEM_16.imgSha256,
    imgBytes: LDEM_16.imgBytes,
  });
  if (ldem.lblSha256 !== LDEM_16.lblSha256) throw new Error("LDEM_16 label checksum mismatch");
  timings["1-2 fetch-verify-decode"] = seconds(t);

  t = performance.now();
  const { field, lowRealM } = composeGameField(ldem, params);
  timings["4 lowpass+compose"] = seconds(t);
  let lowMin = Infinity;
  let lowMax = -Infinity;
  for (const v of lowRealM) {
    if (v < lowMin) lowMin = v;
    if (v > lowMax) lowMax = v;
  }

  t = performance.now();
  const main = bakeLevel(field, mainSize, params);
  timings[`3-7 cube ${mainSize}`] = seconds(t);
  t = performance.now();
  const preview = bakeLevel(field, previewSize, params);
  timings[`3-7 cube ${previewSize}`] = seconds(t);
  t = performance.now();
  const fixture = bakeLevel(field, fixtureSize, params);
  timings[`3-7 cube ${fixtureSize} (fixture)`] = seconds(t);

  const sampleOf = (q: QuantisedCube) => ({
    faceSize: q.faceSize,
    padded: q.padded,
    data: q.data,
    offsetM: q.offsetM,
    scaleM: q.scaleM,
  });

  t = performance.now();
  const accuracy = accuracyVsSource(sampleOf(main.quant), field, params.sites, params.radiusM, 20_000, 12345);
  const seam = seamAgreement(sampleOf(main.quant), 20_000, 777);
  timings["6 accuracy+seam"] = seconds(t);

  t = performance.now();
  const horizon = bakeHorizon(sampleOf(main.quant), main.quant.maxM, {
    ...DEFAULT_HORIZON,
    faceSize: horizonSize,
    radiusM: params.radiusM,
  });
  timings["8b horizon"] = seconds(t);

  t = performance.now();
  const encMain = encodeHeightCube({
    faceSize: mainSize,
    gutter: 1,
    offsetM: main.quant.offsetM,
    scaleM: main.quant.scaleM,
    data: main.quant.data,
  });
  const encPreview = encodeHeightCube({
    faceSize: previewSize,
    gutter: 1,
    offsetM: preview.quant.offsetM,
    scaleM: preview.quant.scaleM,
    data: preview.quant.data,
  });
  const encHorizon = encodeHorizon(horizon.file);
  timings["7 encode"] = seconds(t);

  const golden = goldenSamples(sampleOf(main.quant), params.sites, 12, 4242);

  mkdirSync(options.outDir, { recursive: true });
  for (const name of readdirSync(options.outDir)) {
    if (/^(height-cube-\d+|horizon-map)\.[0-9a-f]{12}\.bin$/.test(name)) rmSync(join(options.outDir, name));
  }
  const files: Record<string, { file: string; bytes: Uint8Array; rawBytes: number; rawSha256: string }> = {};
  const addFile = (logical: string, bytes: Uint8Array, rawBytes: number, raw: Uint8Array) => {
    const sha = sha256Of(bytes);
    const file = hashedName(logical, sha, "bin");
    writeFileSync(join(options.outDir, file), bytes);
    files[logical] = { file, bytes, rawBytes, rawSha256: sha256Of(raw) };
  };
  addFile(`height-cube-${mainSize}`, encMain.bytes, encMain.rawBytes, encMain.rawTransformed);
  addFile(`height-cube-${previewSize}`, encPreview.bytes, encPreview.rawBytes, encPreview.rawTransformed);
  addFile("horizon-map", encHorizon.bytes, encHorizon.rawBytes, encHorizon.rawTransformed);

  // Unit-test fixture for packages/world: raw uint16 LE cube (padded faces) + meta JSON + golden samples.
  const fixtureDir = join(options.outDir, "fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  const fixtureBytes = new Uint8Array(
    fixture.quant.data.buffer,
    fixture.quant.data.byteOffset,
    fixture.quant.data.byteLength,
  );
  const fixtureName = `height-cube-fixture-${fixtureSize}.bin`;
  writeFileSync(join(fixtureDir, fixtureName), fixtureBytes);
  const fixtureMeta = {
    file: fixtureName,
    format:
      "uint16 little-endian, 6 faces (+X,-X,+Y,-Y,+Z,-Z), each (faceSize+2)^2 row-major with a 1-texel gutter; no header",
    faceSize: fixtureSize,
    padded: paddedSize(fixtureSize),
    gutter: 1,
    offsetM: fixture.quant.offsetM,
    scaleM: fixture.quant.scaleM,
    sha256: sha256Of(fixtureBytes),
    note: "Same pipeline and parameters as height-cube-1024 at 64^2 per face (fixture for packages/world unit tests).",
  };
  writeFileSync(
    join(fixtureDir, `height-cube-fixture-${fixtureSize}.json`),
    `${JSON.stringify(fixtureMeta, null, 2)}\n`,
  );
  const fixtureGolden = goldenSamples(
    {
      faceSize: fixtureSize,
      padded: fixture.quant.padded,
      data: fixture.quant.data,
      offsetM: fixture.quant.offsetM,
      scaleM: fixture.quant.scaleM,
    },
    params.sites,
    8,
    99,
  );
  writeFileSync(
    join(fixtureDir, `golden-height-samples-fixture-${fixtureSize}.json`),
    `${JSON.stringify({ source: fixtureName, toleranceM: 0.02, samples: fixtureGolden }, null, 2)}\n`,
  );

  const manifest = buildManifest({
    ldem,
    params,
    sizes: { main: mainSize, preview: previewSize, fixture: fixtureSize, horizon: horizonSize },
    quant: main.quant,
    previewQuant: preview.quant,
    pads: main.pads,
    relax: main.relax,
    slope: main.slope,
    slopePreview: preview.slope,
    accuracy,
    seam,
    horizonStats: horizon.stats,
    horizonParams: { ...DEFAULT_HORIZON, faceSize: horizonSize },
    outputs: Object.fromEntries(
      Object.entries(files).map(([logical, f]) => [
        logical,
        {
          file: f.file,
          bytes: f.bytes.byteLength,
          sha256: sha256Of(f.bytes),
          rawBytes: f.rawBytes,
          rawSha256: f.rawSha256,
        },
      ]),
    ),
    fixture: { dir: "fixtures", cube: fixtureMeta, goldenFile: `golden-height-samples-${mainSize}.json` },
    credit: LOLA_CREDIT,
  });
  writeFileSync(join(options.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(fixtureDir, `golden-height-samples-${mainSize}.json`),
    `${JSON.stringify({ source: files[`height-cube-${mainSize}`]?.file, bakeHash: manifest.bakeHash, toleranceM: 0.02, samples: golden }, null, 2)}\n`,
  );

  if (options.previewDir) {
    mkdirSync(options.previewDir, { recursive: true });
    for (let face = 0; face < 6; face++) {
      const full = hillshadeFace(main.float, face, 10, (2 * Math.PI * params.radiusM) / 4 / mainSize);
      const half = new Uint8Array((mainSize / 2) * (mainSize / 2));
      for (let y = 0; y < mainSize / 2; y++)
        for (let x = 0; x < mainSize / 2; x++) half[y * (mainSize / 2) + x] = full[y * 2 * mainSize + x * 2] ?? 0;
      writeFileSync(
        join(options.previewDir, `hillshade-${FACE_NAMES[face]}.png`),
        encodeGreyPng(mainSize / 2, mainSize / 2, half),
      );
    }
  }

  timings["total"] = seconds(totalStart);
  const peakRssMiB = Math.round((process.resourceUsage().maxRSS / 1024) * 10) / 10;
  mkdirSync(options.statsDir, { recursive: true });
  const summary: BakeSummary = {
    manifest,
    timings,
    peakRssMiB,
    accuracy,
    seam,
    slope1024: main.slope,
    slope256: preview.slope,
    horizonStats: horizon.stats,
    sizes: Object.fromEntries(
      Object.entries(files).map(([k, f]) => [k, { bytes: f.bytes.byteLength, rawBytes: f.rawBytes, file: f.file }]),
    ),
    golden,
    pads: main.pads,
    relax: main.relax,
    heightRangeM: { min: main.quant.minM, max: main.quant.maxM, scaleM: main.quant.scaleM },
    lowBandRangeM: { min: lowMin, max: lowMax },
  };
  writeFileSync(
    join(options.statsDir, "bake-stats.json"),
    `${JSON.stringify({ ...summary, manifest: undefined, golden: undefined }, null, 2)}\n`,
  );
  return summary;
}
