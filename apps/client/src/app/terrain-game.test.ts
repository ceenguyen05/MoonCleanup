import { expect, it } from "vitest";
import { GroundHeight, HeightCube } from "@moon-cleanup/world";
import type { TerrainAsset } from "../terrain";
import { prefixedStore } from "./dust-feed";
import { loadSoloIdentity, type KeyValueStore } from "./solo-host";
import {
  groundOptionsOf,
  loadTerrainGameAsset,
  MOON_CENTRED_MAPPER,
  SharedGround,
  TERRAIN_GAME_DB_NAME,
  TERRAIN_GAME_STORAGE_PREFIX,
  terrainHostOptions,
} from "./terrain-game";

it("copies transferable cube storage and gives worker and predictor identical ground", () => {
  const cube = new HeightCube(new Uint16Array(6 * 4 * 4).fill(123).buffer, { faceSize: 2, offsetM: -20, scaleM: 0.5 });
  const asset: TerrainAsset = {
    cube,
    radiusM: 2000,
    pads: [],
    bakeHash: "a".repeat(64),
    file: "test",
    fetchMs: 0,
    decodeMs: 0,
  };
  const options = terrainHostOptions(asset);
  expect(options.bakeHash).toBe(asset.bakeHash);
  const world = options.world!;
  expect(world.kind).toBe("cube");
  if (world.kind !== "cube") throw new Error("expected cube");
  expect(world.cube).not.toBe(cube.data.buffer);
  const predictor = new SharedGround();
  predictor.ground = new GroundHeight(cube, groundOptionsOf(asset));
  const worker = new GroundHeight(new HeightCube(world.cube, world.layout), world.ground);
  for (const [x, y, z] of [
    [0, 1, 0],
    [1, 0, 0],
    [1, -2, 3],
  ]) {
    expect(predictor.heightAtXYZ(x!, y!, z!)).toBe(worker.heightAtXYZ(x!, y!, z!));
  }
  new Uint16Array(world.cube)[0] = 0;
  expect(cube.data[0]).toBe(123);
});

it("isolates experimental terrain saves: own identity keys, Contract and IndexedDB", () => {
  const backing = new Map<string, string>();
  const storage: KeyValueStore = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, v),
  };
  let n = 0;
  const random = (bytes: Uint8Array<ArrayBuffer>): void => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (n++ * 37 + 11) & 0xff;
  };
  const flat = loadSoloIdentity(storage, 1_700_000_000_000, random);
  const flatRows = new Map(backing);
  const keysAfterFlat = [...flatRows.keys()];
  const terrain = loadSoloIdentity(prefixedStore(storage, TERRAIN_GAME_STORAGE_PREFIX), 1_700_000_000_000, random);
  expect(terrain.contractId).not.toBe(flat.contractId);
  // The flat game's identity rows are untouched; the terrain identity has only prefixed rows.
  for (const [k, v] of flatRows) expect(backing.get(k)).toBe(v);
  expect(loadSoloIdentity(storage, 0, random).contractId).toBe(flat.contractId);
  for (const k of backing.keys()) {
    if (!keysAfterFlat.includes(k)) expect(k.startsWith(TERRAIN_GAME_STORAGE_PREFIX)).toBe(true);
  }
  const cube = new HeightCube(new Uint16Array(6 * 4 * 4).buffer, { faceSize: 2, offsetM: 0, scaleM: 1 });
  const options = terrainHostOptions({
    cube,
    radiusM: 2000,
    pads: [],
    bakeHash: "",
    file: "t",
    fetchMs: 0,
    decodeMs: 0,
  });
  expect(options.dbName).toBe(TERRAIN_GAME_DB_NAME);
  expect(TERRAIN_GAME_DB_NAME).not.toBe("moon-cleanup-solo");
  expect(options.bakeHash).toBeUndefined();
});

it("reports a failed terrain asset load and resolves null (boot falls back to the flat worksite)", async () => {
  const reported: unknown[] = [];
  const failure = new Error("terrain manifest has no height-cube-1024");
  await expect(
    loadTerrainGameAsset(
      () => Promise.reject(failure),
      (e) => reported.push(e),
    ),
  ).resolves.toBeNull();
  expect(reported).toEqual([failure]);
  const asset = { file: "ok" } as TerrainAsset;
  await expect(
    loadTerrainGameAsset(
      () => Promise.resolve(asset),
      (e) => reported.push(e),
    ),
  ).resolves.toBe(asset);
  expect(reported).toHaveLength(1);
});

it("preserves moon-centred points and direction vectors", () => {
  const out = new Float64Array(3);
  const src = new Float64Array([12, 2020, -14]);
  MOON_CENTRED_MAPPER.point(src, 0, out, 0);
  expect(out).toEqual(src);
  MOON_CENTRED_MAPPER.direction(src, 0, out, 0);
  expect(out).toEqual(src);
});
