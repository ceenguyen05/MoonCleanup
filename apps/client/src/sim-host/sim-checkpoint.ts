// Local checkpoint body of a Solo Shift: wraps the MoonRoomSim checkpoint sections in a save envelope v1 and splits a
// decoded envelope back into what the worker restores from.
//
// Format: packages/sim owns the META (id 1) and PLAYERS (id 2) section bodies and versions
// (`MoonRoomSim.captureCheckpoint()` / `restoreCheckpoint()`, META v1 + PLAYERS v1). A restore brings back tick, day
// phase, wallet, Standard Issue / Repeat Requisition, suit gear, and per actor the full avatar, owned tools, Holster,
// Dust Cell grams, tool-head and input state. The dust ledger is not part of these sections (data-model section 3.7:
// the header holds no per-plot dust): the worker stores it as dust chunk rows in the same transaction as this
// envelope (checkpoint-store.ts) and restores those rows before it restores these sections.
//
// PUCKS (id 8): packages/sim owns the body and version (cargo/checkpoint.ts, PUCKS v3: every Dust Puck / Puck Stack
// and the per-actor carry state). Written whenever the sim returns it; a save without it (written before M1-W6-T01)
// restores with no pucks. Version 2 with an empty body is the shared vectors' interim body and also means "no pucks".
//
// Old saves: version 0 of both sections is the sim-host interim layout written before the sim codec existed. It is
// still read (tick, wallet and pose only; tools and Cells were saved but never restorable) so no existing save is lost.
//
// LEGACY META v0:    f64 walletLm
// LEGACY PLAYERS v0: u8 count; per player: u8 slot, 9 x f64 (px py pz vx vy vz fx fy fz), u32 owned, u8 toolCode,
//                    u8 holsterSlot, u8 toolCount, toolCount x i32 cellGrams

import {
  DUST_MODEL_VERSION,
  MAX_PLAYERS_PER_ROOM,
  SAVE_FORMAT_VERSION,
  SAVE_SECTION_ID,
  type PlotGridParams,
  type SaveHeader,
} from "@moon-cleanup/shared";
import type { MoonRoomSim, SimCheckpoint } from "@moon-cleanup/sim";
import { decodeSaveEnvelope, encodeSaveEnvelope } from "./save-envelope";

/** Section version of the sim-host interim layout (read only, never written). */
export const LEGACY_SECTION_VERSION = 0;
/** PUCKS version of the shared save vectors' empty interim body (cargo/checkpoint.ts); read as "no pucks". */
const INTERIM_PUCKS_VERSION = 2;
/** Mirrors MoonRoomSim's SPAWN_SPACING_M (2 m between slots); a restore test catches a change. */
const SPAWN_SPACING_M = 2;

export interface LegacyCheckpointPlayer {
  readonly slot: number;
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly owned: number;
  readonly toolCode: number;
  readonly holsterSlot: number;
  readonly cellGrams: readonly number[];
}

export interface LegacyCheckpoint {
  readonly walletLm: number;
  readonly players: readonly LegacyCheckpointPlayer[];
}

export interface DecodedSimCheckpoint {
  readonly header: SaveHeader;
  /** The sim sections (versions as stored); null when the save is a legacy v0 save. */
  readonly sim: SimCheckpoint | null;
  /** The legacy interim data; null unless both sections are version 0. */
  readonly legacy: LegacyCheckpoint | null;
}

export interface CheckpointHeaderInfo {
  readonly grid: PlotGridParams;
  readonly bakeHash: string;
  readonly originId: string;
  readonly generation: number;
  readonly parentGeneration: number;
}

/** Captures the sim state and wraps it in a (not yet compressed) save envelope v1. Runs in the worker, never per tick. */
export function encodeSimCheckpoint(sim: MoonRoomSim, info: CheckpointHeaderInfo): Uint8Array {
  const ck = sim.captureCheckpoint();
  const header: SaveHeader = {
    saveFormatVersion: SAVE_FORMAT_VERSION,
    gridM: info.grid.gridM,
    radiusM: info.grid.radiusM,
    plotCount: info.grid.plotCount,
    bakeHash: info.bakeHash,
    dustModelVersion: DUST_MODEL_VERSION,
    simTick: sim.tick,
    generation: info.generation,
    parentGeneration: info.parentGeneration,
    originKind: "solo",
    originId: info.originId,
    sections: [
      { id: SAVE_SECTION_ID.META, version: ck.metaVersion, length: ck.meta.length },
      { id: SAVE_SECTION_ID.PLAYERS, version: ck.playersVersion, length: ck.players.length },
      ...(ck.pucks !== undefined && ck.pucksVersion !== undefined
        ? [{ id: SAVE_SECTION_ID.PUCKS, version: ck.pucksVersion, length: ck.pucks.length }]
        : []),
    ],
  };
  const bodies =
    ck.pucks !== undefined && ck.pucksVersion !== undefined ? [ck.meta, ck.players, ck.pucks] : [ck.meta, ck.players];
  return encodeSaveEnvelope(header, bodies);
}

/** Thrown for a structurally valid envelope that lacks the sim sections. */
export class MissingSectionError extends Error {
  override readonly name = "MissingSectionError";
}

/**
 * Verifies the envelope (magic, CRC, lengths: throws SaveEnvelopeError) and picks the META / PLAYERS sections.
 * Both version 0: legacy interim data. Anything else is handed to the sim, which validates and may reject it.
 */
export function decodeSimCheckpoint(bytes: Uint8Array): DecodedSimCheckpoint {
  const { header, bodies } = decodeSaveEnvelope(bytes);
  let metaIdx = -1;
  let playersIdx = -1;
  let pucksIdx = -1;
  header.sections.forEach((s, i) => {
    if (s.id === SAVE_SECTION_ID.META && metaIdx < 0) metaIdx = i;
    if (s.id === SAVE_SECTION_ID.PLAYERS && playersIdx < 0) playersIdx = i;
    if (s.id === SAVE_SECTION_ID.PUCKS && pucksIdx < 0) pucksIdx = i;
  });
  if (metaIdx < 0 || playersIdx < 0) throw new MissingSectionError("save has no META or PLAYERS section");
  const metaVersion = header.sections[metaIdx]!.version;
  const playersVersion = header.sections[playersIdx]!.version;
  const meta = bodies[metaIdx]!;
  const players = bodies[playersIdx]!;
  if (metaVersion === LEGACY_SECTION_VERSION && playersVersion === LEGACY_SECTION_VERSION) {
    return { header, sim: null, legacy: decodeLegacy(meta, players) };
  }
  const pucksVersion = pucksIdx < 0 ? -1 : header.sections[pucksIdx]!.version;
  const pucks = pucksIdx < 0 ? undefined : bodies[pucksIdx]!;
  // No section, or the empty interim body: no pucks. Any other version goes to the sim, which validates or rejects it.
  if (pucks === undefined || (pucksVersion === INTERIM_PUCKS_VERSION && pucks.length === 0)) {
    return { header, sim: { metaVersion, meta, playersVersion, players }, legacy: null };
  }
  return { header, sim: { metaVersion, meta, playersVersion, players, pucksVersion, pucks }, legacy: null };
}

function decodeLegacy(meta: Uint8Array, body: Uint8Array): LegacyCheckpoint {
  let walletLm = 0;
  const players: LegacyCheckpointPlayer[] = [];
  if (meta.length >= 8) walletLm = new DataView(meta.buffer, meta.byteOffset, meta.byteLength).getFloat64(0, true);
  if (body.length >= 1) {
    const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
    let at = 1;
    for (let p = 0; p < (body[0] ?? 0); p++) {
      const slot = body[at++] ?? 0;
      const px = v.getFloat64(at, true);
      const py = v.getFloat64(at + 8, true);
      const pz = v.getFloat64(at + 16, true);
      at += 72;
      const owned = v.getUint32(at, true);
      at += 4;
      const toolCode = body[at++] ?? 0;
      const holsterSlot = body[at++] ?? 0;
      const n = body[at++] ?? 0;
      const cellGrams: number[] = [];
      for (let k = 0; k < n; k++, at += 4) cellGrams.push(v.getInt32(at, true));
      players.push({ slot, px, py, pz, owned, toolCode, holsterSlot, cellGrams });
    }
  }
  return { walletLm, players };
}

/**
 * spawnDirection that makes MoonRoomSim.addActor(slot) land on `target` (it offsets each slot along a tangent).
 * Two fixed-point iterations bring the error far below a centimetre on a 2 km moon. Used only for legacy v0 saves.
 */
export function spawnDirectionFor(
  slot: number,
  target: { readonly x: number; readonly y: number; readonly z: number },
  moonRadiusM: number,
): { x: number; y: number; z: number } {
  const tl = Math.hypot(target.x, target.y, target.z) || 1;
  const tx = target.x / tl;
  const ty = target.y / tl;
  const tz = target.z / tl;
  const off = ((slot - (MAX_PLAYERS_PER_ROOM - 1) / 2) * SPAWN_SPACING_M) / moonRadiusM;
  let dx = tx;
  let dy = ty;
  let dz = tz;
  for (let it = 0; it < 3; it++) {
    const el = Math.hypot(dz, dx) || 1;
    const ex = -dz / el;
    const ez = dx / el;
    dx = tx - ex * off;
    dy = ty;
    dz = tz - ez * off;
    const l = Math.hypot(dx, dy, dz);
    dx /= l;
    dy /= l;
    dz /= l;
  }
  return { x: dx, y: dy, z: dz };
}
