import { describe, expect, it } from "vitest";
import { aaFromPasses, sidecarExtras } from "./sidecar";
import { makeImage, type Img } from "./measure/image";
import { captureWithGuard, detectWrappedBand, WrappedFrameError } from "./wrap-guard";

const W = 64;
const H = 300;
/** Every row distinct (row-dependent colour). */
const scene = (): Img => makeImage(W, H, (x, y) => [(y * 7 + x) % 251, (y * 3) % 241, (x * 5 + y * 11) % 239]);

function wrap(img: Img, k: number): Img {
  const data = new Uint8Array(img.data);
  data.set(img.data.subarray(0, k * W * 4), (H - k) * W * 4);
  return { width: W, height: H, data };
}

describe("wrapped-band guard", () => {
  it("passes a normal frame", () => {
    expect(detectWrappedBand(scene()).wrapped).toBe(false);
  });
  it("detects the reviewer's case (bottom band == top band)", () => {
    const r = detectWrappedBand(wrap(scene(), 56));
    expect(r.wrapped).toBe(true);
    expect(r.bandRows).toBe(56);
  });
  it("does not trigger on a flat image or a flat sky band", () => {
    expect(detectWrappedBand(makeImage(W, H, () => [10, 10, 10])).wrapped).toBe(false);
    expect(
      detectWrappedBand(makeImage(W, H, (_x, y) => (y < 40 || y > 260 ? [5, 5, 5] : [y & 255, 9, 9]))).wrapped,
    ).toBe(false);
  });
  it("retries a wrapped shot and records it in the report", async () => {
    const good = scene();
    const bad = wrap(good, 60);
    const seq = [bad, good];
    const hows: string[] = [];
    const r = await captureWithGuard(async (how) => {
      hows.push(how);
      return { png: new Uint8Array(1), img: seq.shift()!, readbackMs: 1 };
    }, 1);
    expect(r.report.result).toBe("recovered");
    expect(hows).toEqual(["first", "re-screenshot"]);
    expect(r.report.attempts[0]).toMatchObject({ wrapped: true, bandRows: 60 });
  });
  it("fails clearly when every attempt is wrapped", async () => {
    const bad = wrap(scene(), 60);
    await expect(
      captureWithGuard(async () => ({ png: new Uint8Array(1), img: bad, readbackMs: 1 }), 2),
    ).rejects.toThrow(WrappedFrameError);
  });
});

describe("sidecar aa", () => {
  it("derives aa from the post chain", () => {
    expect(aaFromPasses(["scene", "grade", "bloom", "smaa"])).toBe("smaa");
    expect(aaFromPasses(["scene"])).toBeNull();
    expect(sidecarExtras({}, { postPasses: ["scene", "fxaa"] }, null).knobs).toMatchObject({
      aa: "fxaa",
      notReported: expect.arrayContaining(["shadowMapSize"]),
    });
  });
});
