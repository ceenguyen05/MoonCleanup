// Verifies the committed derivatives against their manifest (skipped when assets/terrain has not been baked).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decodeHeightCube, decodeHorizon } from "./cubemap/codec.js";
import { sampleCubeHeight } from "./cubemap/sample.js";

const terrain = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "assets", "terrain");
const manifestPath = resolve(terrain, "manifest.json");

interface Output {
  file: string;
  bytes: number;
  sha256: string;
}

function outputOf(outputs: Record<string, Output>, key: string): Output {
  const out = outputs[key];
  if (!out) throw new Error(`manifest has no output ${key}`);
  return out;
}

describe.skipIf(!existsSync(manifestPath))("committed terrain derivatives", () => {
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const outputs = manifest.outputs as Record<string, Output>;

  it("match the manifest hashes and carry the content hash in the file name", () => {
    for (const out of Object.values(outputs)) {
      const bytes = readFileSync(resolve(terrain, out.file));
      expect(bytes.byteLength).toBe(out.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(out.sha256);
      expect(out.file).toContain(`.${out.sha256.slice(0, 12)}.`);
      expect(bytes.byteLength).toBeLessThan(10 * 1024 * 1024);
    }
  });

  it("reproduce the golden samples from the shipped cube (JS reference sampler)", () => {
    const cube = decodeHeightCube(readFileSync(resolve(terrain, outputOf(outputs, "height-cube-1024").file)));
    const golden = JSON.parse(readFileSync(resolve(terrain, "fixtures", "golden-height-samples-1024.json"), "utf8"));
    expect(golden.samples.length).toBeGreaterThanOrEqual(20);
    const view = {
      faceSize: cube.faceSize,
      padded: cube.faceSize + 2,
      data: cube.data,
      offsetM: cube.offsetM,
      scaleM: cube.scaleM,
    };
    for (const s of golden.samples) {
      expect(Math.abs(sampleCubeHeight(view, s.dir[0], s.dir[1], s.dir[2]) - s.heightM)).toBeLessThan(1e-9);
    }
  });

  it("decode the horizon map and the fixture cube", () => {
    const horizon = decodeHorizon(readFileSync(resolve(terrain, outputOf(outputs, "horizon-map").file)));
    expect(horizon.azimuths).toBe(8);
    expect(horizon.planes.length).toBe(6 * 8 * horizon.faceSize * horizon.faceSize);
    const meta = JSON.parse(readFileSync(resolve(terrain, "fixtures", "height-cube-fixture-64.json"), "utf8"));
    const fixture = readFileSync(resolve(terrain, "fixtures", meta.file));
    expect(fixture.byteLength).toBe(6 * meta.padded * meta.padded * 2);
    expect(createHash("sha256").update(fixture).digest("hex")).toBe(meta.sha256);
  });
});
