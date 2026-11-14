// Cascade split distances (rendering-pipeline.md section 5.2): cascade 0 ends at the preset's split, the others follow the
// practical scheme with lambda 0.75 (Ultra 0.8). Pure. The last entry is `farM`.

/** Cascade end distances in metres, ascending. Writes `out`. */
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
