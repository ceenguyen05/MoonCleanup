// Browser-lane only: the 64^2 fixture height cube (the same one packages/sim's golden replay uses).
import cubeDataUrl from "../../../../../assets/terrain/fixtures/height-cube-fixture-64.bin?inline";
import cubeMeta from "../../../../../assets/terrain/fixtures/height-cube-fixture-64.json";
import { GroundHeight, HeightCube } from "@moon-cleanup/world";
import type { SimHostWorldConfig } from "../messages";

const GROUND = { radiusM: 2000 };

export function fixtureCube(): ArrayBuffer {
  const bin = atob(cubeDataUrl.slice(cubeDataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes.buffer;
}

export function fixtureWorld(): SimHostWorldConfig {
  return { kind: "cube", cube: fixtureCube(), layout: cubeMeta, ground: GROUND };
}

export function fixtureGround(): GroundHeight {
  return new GroundHeight(new HeightCube(fixtureCube(), cubeMeta), GROUND);
}
