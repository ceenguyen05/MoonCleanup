import { describe, expect, it } from "vitest";
import { evaluateDprCheck, expectedDprText } from "./dpr-check.js";

describe("DPR readout check", () => {
  it("formats like the client readout", () => {
    expect(expectedDprText(1)).toBe("1");
    expect(expectedDprText(1.0000000298)).toBe("1");
    expect(expectedDprText(1.5)).toBe("1.5");
    expect(expectedDprText(2)).toBe("2");
  });
  it("passes when page DPR and readout equal the request", () => {
    expect(evaluateDprCheck(1, 1.0000000298, "1").ok).toBe(true);
    expect(evaluateDprCheck(2, 2, "2").ok).toBe(true);
    expect(evaluateDprCheck(1.5, 1.5, null).ok).toBe(true);
  });
  it("fails the S12 symptom: DPR 1 or 2 frame reading 1.5", () => {
    expect(evaluateDprCheck(1, 1.5, "1.5").ok).toBe(false);
    expect(evaluateDprCheck(2, 2, "1.5").ok).toBe(false);
  });
});

import { rowsOverHalfPeak } from "./hud-measure.js";
describe("hud measure", () => {
  it("counts hairline rows over half peak", () => {
    expect(rowsOverHalfPeak([20, 20, 247, 20, 20])).toBe(1);
    expect(rowsOverHalfPeak([20, 20, 150, 150, 20, 20])).toBe(2);
  });
});
