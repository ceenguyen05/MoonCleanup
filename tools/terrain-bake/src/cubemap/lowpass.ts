// Low-pass split of the source heights for the two-band exaggeration (world-and-dust-simulation 3.3).
// Approximate spherical Gaussian: three box passes (central-limit Gaussian) along longitude with a per-row width that
// widens by 1/cos(lat), then three along latitude. Pure +, -, *, / and sqrt: deterministic. The result is one smooth
// field on the source sphere, so the cube seams cannot disagree about the low band.

const PASSES = 3;

/** Box width (odd) whose three-pass convolution has the requested standard deviation (in pixels). */
export function boxWidthForSigma(sigmaPx: number): number {
  const w = Math.round(Math.sqrt((12 * sigmaPx * sigmaPx) / PASSES + 1));
  return w % 2 === 0 ? w + 1 : w;
}

function circularBox(src: Float64Array, dst: Float64Array, n: number, width: number): void {
  const half = (width - 1) / 2;
  let sum = 0;
  for (let k = -half; k <= half; k++) sum += src[((k % n) + n) % n] ?? 0;
  for (let i = 0; i < n; i++) {
    dst[i] = sum / width;
    const add = i + half + 1;
    const sub = i - half;
    sum += (src[add % n] ?? 0) - (src[((sub % n) + n) % n] ?? 0);
  }
}

function clampedBox(src: Float64Array, dst: Float64Array, n: number, width: number): void {
  const half = (width - 1) / 2;
  const last = n - 1;
  let sum = 0;
  for (let k = -half; k <= half; k++) sum += src[k < 0 ? 0 : k > last ? last : k] ?? 0;
  for (let i = 0; i < n; i++) {
    dst[i] = sum / width;
    const add = i + half + 1;
    const sub = i - half;
    sum += (src[add > last ? last : add] ?? 0) - (src[sub < 0 ? 0 : sub > last ? last : sub] ?? 0);
  }
}

export interface LowpassOptions {
  readonly sigmaM: number;
  /** Source pixel size at the equator (metres on the reference sphere). */
  readonly pixelMetresAtEquator: number;
}

export function lowpassEquirect(
  data: Float32Array,
  width: number,
  height: number,
  options: LowpassOptions,
): Float32Array {
  const out = new Float32Array(data.length);
  const rowA = new Float64Array(width);
  const rowB = new Float64Array(width);
  const sigmaEquatorPx = options.sigmaM / options.pixelMetresAtEquator;

  for (let r = 0; r < height; r++) {
    const latRad = (90 - ((r + 0.5) * 180) / height) * (Math.PI / 180);
    const sigmaPx = sigmaEquatorPx / Math.max(Math.cos(latRad), 1e-6);
    let w = boxWidthForSigma(sigmaPx);
    const maxOdd = width % 2 === 0 ? width - 1 : width;
    if (w > maxOdd) w = maxOdd;
    const base = r * width;
    for (let c = 0; c < width; c++) rowA[c] = data[base + c] ?? 0;
    let src = rowA;
    let dst = rowB;
    for (let p = 0; p < PASSES; p++) {
      circularBox(src, dst, width, w);
      const t = src;
      src = dst;
      dst = t;
    }
    for (let c = 0; c < width; c++) out[base + c] = src[c] ?? 0;
  }

  const wLat = boxWidthForSigma(sigmaEquatorPx);
  const colA = new Float64Array(height);
  const colB = new Float64Array(height);
  for (let c = 0; c < width; c++) {
    for (let r = 0; r < height; r++) colA[r] = out[r * width + c] ?? 0;
    let src = colA;
    let dst = colB;
    for (let p = 0; p < PASSES; p++) {
      clampedBox(src, dst, height, wLat);
      const t = src;
      src = dst;
      dst = t;
    }
    for (let r = 0; r < height; r++) out[r * width + c] = src[r] ?? 0;
  }
  return out;
}
