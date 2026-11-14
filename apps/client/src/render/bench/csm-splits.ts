// Cascade split distances of the bench's CSM (rendering-pipeline.md section 5.2): `custom` mode, cascade 0 ends at the
// preset's split, the remaining cascades follow the practical scheme with lambda 0.75 (Ultra 0.8). Pure.
//
// `CSMShadowNode` (r187) wants `customSplitsCallback(amount, near, far, target)` to fill `target` with the END of every
// cascade as a fraction of `far` (the last entry is 1), exactly as its built-in `uniformSplit` does.

export const CSM_LAMBDA = 0.75;
export const CSM_LAMBDA_ULTRA = 0.8;

/** Cascade end distances in metres, ascending, the last equal to `far`. */
export function cascadeEndsM(
  cascades: number,
  split0M: number,
  farM: number,
  lambda: number,
  out: number[] = [],
): number[] {
  out.length = 0;
  if (cascades < 1 || !(split0M > 0) || !(farM > split0M)) {
    throw new RangeError(`cascadeEndsM: bad input (${String(cascades)}, ${String(split0M)}, ${String(farM)})`);
  }
  out.push(split0M);
  const rest = cascades - 1;
  for (let k = 1; k <= rest; k++) {
    const t = k / rest;
    const uniform = split0M + (farM - split0M) * t;
    const logarithmic = split0M * Math.pow(farM / split0M, t);
    out.push(uniform + (logarithmic - uniform) * lambda);
  }
  if (rest > 0) out[out.length - 1] = farM;
  else out[0] = farM;
  return out;
}

/** The callback `CSMShadowNode` takes as `customSplitsCallback` (fractions of `far`). */
export function makeSplitsCallback(
  split0M: number,
  lambda: number,
): (amount: number, near: number, far: number, target: number[]) => void {
  const scratch: number[] = [];
  return (amount, _near, far, target) => {
    cascadeEndsM(amount, Math.min(split0M, far * 0.5), far, lambda, scratch);
    for (const end of scratch) target.push(end / far);
  };
}
