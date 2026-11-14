// M0 look-polish r2 item 2: the exact PCF tents (pure mirror `tentTaps1d` of the shader maths) against a 1-D shadow edge.
import { describe, expect, it } from "vitest";
import { TENT4_OFFSETS, shadowFilterFor, tentTaps1d } from "./shadow-filter";

/** Per-texel weights (texel index relative to the base texel -> weight) a set of bilinear taps adds up to. */
function texelWeights(size: 3 | 5, s: number): Map<number, number> {
  const { offsets, weights } = tentTaps1d(size, s);
  const out = new Map<number, number>();
  offsets.forEach((offset, i) => {
    const k = Math.floor(offset + 1e-9);
    const f = offset - k;
    const w = weights[i] ?? 0;
    out.set(k, (out.get(k) ?? 0) + w * (1 - f));
    out.set(k + 1, (out.get(k + 1) ?? 0) + w * f);
  });
  return out;
}

/** Lit fraction of a lookup at `x` (texel units, texel k centred on k) over an edge: texels below `edge` are occluded. */
function tentResponse(size: 3 | 5, x: number, edge: number): number {
  const base = Math.floor(x);
  const { norm } = tentTaps1d(size, x - base);
  let lit = 0;
  for (const [k, w] of texelWeights(size, x - base)) if (base + k >= edge) lit += w;
  return lit / norm;
}

/** The same edge through `tent4` along one axis: two hardware comparisons (1-texel boxes) at +-0.5 x radius texels. */
function tent4Response(radius: number, x: number, edge: number): number {
  const box = (centre: number): number => Math.min(1, Math.max(0, centre - (edge - 1)));
  const offsets = [...new Set(TENT4_OFFSETS.map(([ox]) => ox * radius))];
  return offsets.reduce((sum, o) => sum + box(x + o), 0) / offsets.length;
}

/** Longest run of lookups (in texels) over which the response stays inside the open band `lo..hi` without moving. */
function longestPlateau(response: (x: number) => number, lo = 0.1, hi = 0.9): number {
  const stepX = 0.01;
  let longest = 0;
  let run = 0;
  let previous = response(-6);
  for (let x = -6 + stepX; x < 6; x += stepX) {
    const r = response(x);
    if (r > lo && r < hi && Math.abs(r - previous) < 1e-9) run += stepX;
    else run = 0;
    longest = Math.max(longest, run);
    previous = r;
  }
  return longest;
}

/** 10-90 % width of the edge response, in texels. */
function edgeWidth(response: (x: number) => number): number {
  let x10 = NaN;
  let x90 = NaN;
  for (let x = -6; x < 6; x += 0.002) {
    const r = response(x);
    if (Number.isNaN(x10) && r >= 0.1) x10 = x;
    if (Number.isNaN(x90) && r >= 0.9) x90 = x;
  }
  return x90 - x10;
}

describe("exact PCF tents (pcf3 / pcf5)", () => {
  it("pcf3 reproduces the linear tent of half-width 2 texels from 2 taps per axis", () => {
    for (const s of [0, 0.13, 0.5, 0.77, 0.999]) {
      const weights = texelWeights(3, s);
      let sum = 0;
      for (const [k, w] of weights) {
        expect(w).toBeGreaterThanOrEqual(-1e-12);
        expect(w).toBeCloseTo(Math.max(0, 2 - Math.abs(s - k)), 9);
        sum += w;
      }
      expect(sum).toBeCloseTo(tentTaps1d(3, s).norm, 9);
    }
  });

  it("pcf5 weights are non-negative, normalised and mirror with the sub-texel position", () => {
    for (const s of [0, 0.2, 0.5, 0.8]) {
      const weights = texelWeights(5, s);
      const mirrored = texelWeights(5, 1 - s);
      let sum = 0;
      for (const [k, w] of weights) {
        expect(w).toBeGreaterThanOrEqual(-1e-12);
        // Texel k seen from s is texel 1 - k seen from 1 - s.
        expect(w).toBeCloseTo(mirrored.get(1 - k) ?? 0, 9);
        sum += w;
      }
      expect(sum).toBeCloseTo(12, 9);
    }
  });

  it("both are continuous where the base texel changes (no seam on the texel grid)", () => {
    for (const size of [3, 5] as const) {
      for (const edge of [0, 1, 2]) {
        for (const x of [-2, -1, 0, 1, 2, 3]) {
          expect(tentResponse(size, x - 1e-7, edge)).toBeCloseTo(tentResponse(size, x + 1e-7, edge), 5);
        }
      }
    }
  });

  it("an edge through pcf3 / pcf5 is one monotonic ramp with no flat step inside it", () => {
    for (const size of [3, 5] as const) {
      const response = (x: number): number => tentResponse(size, x, 0);
      let previous = response(-6);
      for (let x = -6; x < 6; x += 0.01) {
        const r = response(x);
        expect(r).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = r;
      }
      expect(response(-6)).toBe(0);
      expect(response(6)).toBeCloseTo(1, 9);
      expect(longestPlateau(response)).toBeLessThan(0.02);
    }
  });

  it("tent4 at the Low / Medium radius of 2 has a one-texel flat step at 50 % (the stair steps); at radius 1 it has none", () => {
    expect(longestPlateau((x) => tent4Response(2, x, 0))).toBeGreaterThan(0.9);
    expect(tent4Response(2, -0.5, 0)).toBeCloseTo(0.5, 9);
    expect(longestPlateau((x) => tent4Response(1, x, 0))).toBeLessThan(0.02);
  });

  it("10-90 % edge widths: pcf3 2.2 texels, pcf5 2.9; pcf3 is narrower than the doubled tent4 edge (2.6)", () => {
    const w3 = edgeWidth((x) => tentResponse(3, x, 0));
    const w5 = edgeWidth((x) => tentResponse(5, x, 0));
    const w4 = edgeWidth((x) => tent4Response(2, x, 0));
    expect(w3).toBeCloseTo(2.2, 1);
    expect(w5).toBeCloseTo(2.87, 1);
    expect(w4).toBeCloseTo(2.6, 1);
    expect(w4).toBeGreaterThan(w3);
  });

  it("every kernel id but vogel5 supplies its own filter", () => {
    const filters = (["pcf3", "pcf5", "tent4", "hard"] as const).map((id) => shadowFilterFor(id));
    for (const f of filters) expect(typeof f).toBe("function");
    expect(new Set(filters).size).toBe(4);
    expect(shadowFilterFor("vogel5")).toBeNull();
  });
});

describe("staircase rejection (why far cascades run pcf5)", () => {
  /** Magnitude of a kernel's response to a staircase of `period` texels along one axis (1 = passes it unchanged). */
  function response(size: 3 | 5, period: number, s: number): number {
    const { norm } = tentTaps1d(size, s);
    let re = 0;
    let im = 0;
    for (const [k, w] of texelWeights(size, s)) {
      const phase = (2 * Math.PI * (k - s)) / period;
      re += w * Math.cos(phase);
      im += w * Math.sin(phase);
    }
    return Math.hypot(re, im) / norm;
  }
  const worst = (size: 3 | 5, period: number): number =>
    Math.max(...[0, 0.25, 0.5, 0.75].map((s) => response(size, period, s)));

  it("an edge 20 degrees off the texel grid (2.75-texel staircase): pcf3 leaves about 17 %, pcf5 under 4 %", () => {
    const period = 1 / Math.tan((20 * Math.PI) / 180);
    expect(period).toBeCloseTo(2.75, 2);
    expect(worst(3, period)).toBeGreaterThan(0.14);
    expect(worst(3, period)).toBeLessThan(0.22);
    expect(worst(5, period)).toBeLessThan(0.04);
  });

  it("pcf5 rejects every staircase period better than pcf3, and both cancel the 2-texel one", () => {
    for (const period of [2, 2.5, 3, 4, 5, 8]) expect(worst(5, period)).toBeLessThanOrEqual(worst(3, period) + 1e-9);
    expect(worst(3, 2)).toBeLessThan(1e-9);
    expect(worst(5, 2)).toBeLessThan(1e-9);
    // A long staircase passes both: an edge nearly aligned with the grid still wobbles by a texel, slowly.
    expect(worst(5, 8)).toBeGreaterThan(0.6);
  });
});
