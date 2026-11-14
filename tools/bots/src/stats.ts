export interface Percentiles {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Nearest-rank percentiles of an unsorted sample list (the input is not modified). */
export function percentiles(samples: readonly number[]): Percentiles {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number): number =>
    s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? 0);
  return { n: s.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(s.at(-1) ?? 0) };
}

export { round };
