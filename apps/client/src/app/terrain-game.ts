// The terrain game launch (M1-W3-T05 round 3, `?ground=terrain`): the Solo host on the baked height cube, the client
// prediction on the very same ground, and a moon-centred render frame (the CDLOD terrain lives in moon-centred metres).
// Nothing here runs per frame except `SharedGround.heightAtXYZ` (one indirection over `GroundHeight`).

import type { RenderMapper } from "../gameplay";
import type { CreateLocalRoomHostOptions } from "../sim-host";
import type { TerrainAsset } from "../terrain";
import { GroundHeight } from "@moon-cleanup/world";

/** Storage prefix of the terrain game's own Solo identity while it is opt-in (its saves never touch the flat game's). */
export const TERRAIN_GAME_STORAGE_PREFIX = "mc.terrainGame.";
/**
 * IndexedDB of the terrain game's Solo saves while it is opt-in (the flat game uses the sim-host default
 * `moon-cleanup-solo`). Defence in depth next to the prefixed identity: no store, row or chunk is shared.
 */
export const TERRAIN_GAME_DB_NAME = "moon-cleanup-solo-terrain";

/**
 * Loads the terrain asset for the terrain game. A failed load (404, bad manifest, decode error) is reported and
 * resolves null, so boot falls back to the flat worksite instead of aborting.
 */
export async function loadTerrainGameAsset(
  load: () => Promise<TerrainAsset>,
  report: (error: unknown) => void,
): Promise<TerrainAsset | null> {
  try {
    return await load();
  } catch (error) {
    report(error);
    return null;
  }
}

/** Render space = moon-centred metres (identity). Float32 at the 2 km radius keeps 0.25 mm. */
export const MOON_CENTRED_MAPPER: RenderMapper = {
  point(src, so, out, o) {
    out[o] = src[so]!;
    out[o + 1] = src[so + 1]!;
    out[o + 2] = src[so + 2]!;
  },
  direction(src, so, out, o) {
    out[o] = src[so]!;
    out[o + 1] = src[so + 1]!;
    out[o + 2] = src[so + 2]!;
  },
};

/**
 * The prediction's ground: the terrain's `GroundHeight` once the asset is in (the host starts only then, so prediction
 * and worker never disagree while a host runs); 0 before.
 */
export class SharedGround {
  ground: GroundHeight | null = null;
  heightAtXYZ(x: number, y: number, z: number): number {
    const g = this.ground;
    return g === null ? 0 : g.heightAtXYZ(x, y, z);
  }
}

/** Ground options shared by the worker and the main thread (must be identical, or every tick corrects). */
export function groundOptionsOf(asset: TerrainAsset): ConstructorParameters<typeof GroundHeight>[1] {
  return { radiusM: asset.radiusM, pads: asset.pads };
}

/** Host options of the terrain game: the cube (copied for the transfer), its layout, ground, own database and bake hash. */
export function terrainHostOptions(asset: TerrainAsset): Partial<CreateLocalRoomHostOptions> {
  const c = asset.cube;
  const bytes = c.data.buffer.slice(c.data.byteOffset, c.data.byteOffset + c.data.byteLength) as ArrayBuffer;
  const bake = /^[0-9a-f]{64}$/.test(asset.bakeHash) ? { bakeHash: asset.bakeHash } : {};
  return {
    world: {
      kind: "cube",
      cube: bytes,
      layout: { faceSize: c.faceSize, offsetM: c.offsetM, scaleM: c.scaleM },
      ground: groundOptionsOf(asset),
    },
    dbName: TERRAIN_GAME_DB_NAME,
    ...bake,
  };
}
