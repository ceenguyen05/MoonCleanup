import { describe, expect, it } from "vitest";
import { linearToSrgbByte, pixelBounds, rectFromNdc, regionStats, shrinkRect } from "./analysis";
import { findRow, VERIFY_ROWS } from "./rows";

function image(width: number, height: number, fill: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

describe("verify analysis", () => {
  it("measures luma, dominance and transition bands", () => {
    const img = image(20, 10, (x) => (x < 10 ? [200, 20, 20] : [20, 20, 20]));
    const left = regionStats(img, { x0: 0, y0: 0, x1: 0.5, y1: 1 });
    expect(left.redFrac).toBe(1);
    expect(left.luma).toBeGreaterThan(50);
    const edge = regionStats(img, { x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(edge.edge).toBeGreaterThan(0);
    expect(edge.lumaHi).toBeGreaterThan(edge.lumaLo);
  });

  it("encodes linear values as sRGB bytes", () => {
    expect(linearToSrgbByte(0)).toBe(0);
    expect(linearToSrgbByte(1)).toBe(255);
    expect(linearToSrgbByte(0.18)).toBe(118);
  });

  it("clamps rectangles and converts NDC corners", () => {
    expect(pixelBounds({ width: 10, height: 10 }, { x0: -1, y0: 0.5, x1: 2, y1: 0.5 })).toEqual({
      x0: 0,
      y0: 5,
      x1: 10,
      y1: 6,
    });
    const r = rectFromNdc([
      { x: -1, y: 1 },
      { x: 0, y: 0 },
    ]);
    expect(r).toEqual({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 });
    expect(shrinkRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0.5)).toEqual({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
  });

  it("registers unique rows with variants and an evaluator", () => {
    const ids = VERIFY_ROWS.map((r) => r.id);
    expect(ids).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(findRow(99)).toBeNull();
    expect(findRow(1)?.evaluate([], "webgpu").verdict).toBe("FAIL");
  });
});
