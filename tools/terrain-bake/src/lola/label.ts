// PDS3 label reader for LOLA GDR products. Decode parameters come from the label, never from assumptions
// (world-and-dust-simulation 3.2 step 2).

export interface LdemLabel {
  readonly productId: string;
  readonly lines: number;
  readonly lineSamples: number;
  readonly sampleBits: number;
  readonly sampleType: string;
  /** Height in metres = DN * scalingFactor (label note: HEIGHT = DN * SCALING_FACTOR). */
  readonly scalingFactor: number;
  /** Reference sphere radius in metres (heights are relative to it). */
  readonly referenceRadiusM: number;
  readonly pixelsPerDegree: number;
  readonly centerLongitudeDeg: number;
  readonly lineProjectionOffset: number;
  readonly sampleProjectionOffset: number;
  readonly westernmostLongitudeDeg: number;
  readonly maximumLatitudeDeg: number;
  readonly positiveLongitudeDirection: string;
}

/** Collect `KEY = value` pairs (first occurrence wins; continuation lines of quoted strings never match). */
export function parseLabelPairs(text: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*\^?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined || pairs.has(key)) continue;
    pairs.set(key, value);
  }
  return pairs;
}

function text(pairs: Map<string, string>, key: string): string {
  const value = pairs.get(key);
  if (value === undefined) throw new Error(`LDEM label is missing ${key}`);
  return value.replace(/^["']|["']$/g, "").trim();
}

function num(pairs: Map<string, string>, key: string): number {
  const parsed = Number.parseFloat(text(pairs, key).replace(/<.*>/, ""));
  if (!Number.isFinite(parsed)) throw new Error(`LDEM label ${key} is not numeric`);
  return parsed;
}

export function parseLdemLabel(labelText: string): LdemLabel {
  const pairs = parseLabelPairs(labelText);
  const label: LdemLabel = {
    productId: text(pairs, "PRODUCT_ID"),
    lines: num(pairs, "LINES"),
    lineSamples: num(pairs, "LINE_SAMPLES"),
    sampleBits: num(pairs, "SAMPLE_BITS"),
    sampleType: text(pairs, "SAMPLE_TYPE"),
    scalingFactor: num(pairs, "SCALING_FACTOR"),
    referenceRadiusM: num(pairs, "OFFSET"),
    pixelsPerDegree: num(pairs, "MAP_RESOLUTION"),
    centerLongitudeDeg: num(pairs, "CENTER_LONGITUDE"),
    lineProjectionOffset: num(pairs, "LINE_PROJECTION_OFFSET"),
    sampleProjectionOffset: num(pairs, "SAMPLE_PROJECTION_OFFSET"),
    westernmostLongitudeDeg: num(pairs, "WESTERNMOST_LONGITUDE"),
    maximumLatitudeDeg: num(pairs, "MAXIMUM_LATITUDE"),
    positiveLongitudeDirection: text(pairs, "POSITIVE_LONGITUDE_DIRECTION"),
  };
  if (label.sampleType !== "LSB_INTEGER" || label.sampleBits !== 16) {
    throw new Error(`Unsupported LDEM sample type ${label.sampleType}/${label.sampleBits}`);
  }
  if (label.positiveLongitudeDirection !== "EAST") throw new Error("LDEM longitude must be positive east");
  if (label.westernmostLongitudeDeg !== 0 || label.maximumLatitudeDeg !== 90) {
    throw new Error("LDEM label extents are not the global 0..360E / 90N..90S grid this reader supports");
  }
  if (label.lineSamples !== label.pixelsPerDegree * 360 || label.lines !== label.pixelsPerDegree * 180) {
    throw new Error("LDEM label dimensions disagree with MAP_RESOLUTION");
  }
  return label;
}
