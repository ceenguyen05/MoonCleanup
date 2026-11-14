// Terrain fixture loading for tests, identical in the Node and browser lanes (Vite inlines the .bin as a data URL;
// no node:fs, no fetch). The fixture is the M0-W2-T05 64^2-per-face cube (same pipeline as the shipped 1024^2 cube).
import cubeDataUrl from "../../../../assets/terrain/fixtures/height-cube-fixture-64.bin?inline";
import cubeMeta from "../../../../assets/terrain/fixtures/height-cube-fixture-64.json";
import goldenSamples from "../../../../assets/terrain/fixtures/golden-height-samples-fixture-64.json";
import { HeightCube } from "../../src/index";

export { cubeMeta, goldenSamples };

/** Decodes a base64 data URL into a fresh ArrayBuffer. */
export function dataUrlToArrayBuffer(url: string): ArrayBuffer {
  const comma = url.indexOf(",");
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes.buffer;
}

export function loadFixtureCubeBuffer(): ArrayBuffer {
  return dataUrlToArrayBuffer(cubeDataUrl);
}

export function loadFixtureCube(): HeightCube {
  return new HeightCube(loadFixtureCubeBuffer(), cubeMeta);
}
