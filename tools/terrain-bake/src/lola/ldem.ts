import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { parseLdemLabel, type LdemLabel } from "./label.js";

export interface Ldem {
  readonly label: LdemLabel;
  /** Heights in metres above the reference sphere, row-major, row 0 = north. */
  readonly heightsM: Float32Array;
  readonly imgSha256: string;
  readonly lblSha256: string;
  readonly imgBytes: number;
  readonly lblBytes: number;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Decode an LDEM `.IMG` according to its label. Throws when the byte count or pinned checksum disagree. */
export function decodeLdem(
  imgBytes: Uint8Array,
  labelBytes: Uint8Array,
  expected?: { readonly imgSha256: string; readonly imgBytes: number },
): Ldem {
  const label = parseLdemLabel(new TextDecoder("latin1").decode(labelBytes));
  const count = label.lines * label.lineSamples;
  if (imgBytes.byteLength !== count * 2) {
    throw new Error(`LDEM image is ${imgBytes.byteLength} bytes, label implies ${count * 2}`);
  }
  const imgSha256 = sha256Of(imgBytes);
  if (expected && (expected.imgSha256 !== imgSha256 || expected.imgBytes !== imgBytes.byteLength)) {
    throw new Error(`LDEM image checksum mismatch: got ${imgSha256}, pinned ${expected.imgSha256}`);
  }
  const view = new DataView(imgBytes.buffer, imgBytes.byteOffset, imgBytes.byteLength);
  const heightsM = new Float32Array(count);
  for (let i = 0; i < count; i++) heightsM[i] = view.getInt16(i * 2, true) * label.scalingFactor;
  return {
    label,
    heightsM,
    imgSha256,
    lblSha256: sha256Of(labelBytes),
    imgBytes: imgBytes.byteLength,
    lblBytes: labelBytes.byteLength,
  };
}

export function loadLdemFiles(
  imgPath: string,
  lblPath: string,
  expected?: { readonly imgSha256: string; readonly imgBytes: number },
): Ldem {
  return decodeLdem(readFileSync(imgPath), readFileSync(lblPath), expected);
}

/** Equirectangular field (any unit) ready for bilinear sampling by direction. */
export interface EquirectField {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  /** col = lonDeg * colPerDeg + colOffset ; row = rowOffset - latDeg * rowPerDeg (pixel centres at integers). */
  readonly colPerDeg: number;
  readonly colOffset: number;
  readonly rowPerDeg: number;
  readonly rowOffset: number;
}

export function equirectFromLdem(ldem: Ldem, data: Float32Array): EquirectField {
  const l = ldem.label;
  return {
    width: l.lineSamples,
    height: l.lines,
    data,
    colPerDeg: l.pixelsPerDegree,
    colOffset: l.sampleProjectionOffset - l.centerLongitudeDeg * l.pixelsPerDegree,
    rowPerDeg: l.pixelsPerDegree,
    rowOffset: l.lineProjectionOffset,
  };
}

const RAD_TO_DEG = 180 / Math.PI;

/** Bilinear sample at a unit direction in the world frame (+Y north, +X lon 0, -Z lon 90E). */
export function sampleEquirect(field: EquirectField, x: number, y: number, z: number): number {
  const latDeg = Math.asin(Math.max(-1, Math.min(1, y))) * RAD_TO_DEG;
  let lonDeg = Math.atan2(-z, x) * RAD_TO_DEG;
  if (lonDeg < 0) lonDeg += 360;
  const col = lonDeg * field.colPerDeg + field.colOffset;
  const row = field.rowOffset - latDeg * field.rowPerDeg;
  const c0f = Math.floor(col);
  const r0f = Math.floor(row);
  const fc = col - c0f;
  const fr = row - r0f;
  const w = field.width;
  const maxRow = field.height - 1;
  const c0 = ((c0f % w) + w) % w;
  const c1 = c0 + 1 === w ? 0 : c0 + 1;
  const r0 = r0f < 0 ? 0 : r0f > maxRow ? maxRow : r0f;
  const r1 = r0f + 1 < 0 ? 0 : r0f + 1 > maxRow ? maxRow : r0f + 1;
  const d = field.data;
  const top = (d[r0 * w + c0] ?? 0) * (1 - fc) + (d[r0 * w + c1] ?? 0) * fc;
  const bottom = (d[r1 * w + c0] ?? 0) * (1 - fc) + (d[r1 * w + c1] ?? 0) * fc;
  return top * (1 - fr) + bottom * fr;
}
