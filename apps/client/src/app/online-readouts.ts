// HUD read-outs of an online (remote) room: Near Parcels, outposts, Plot Card and Hop gauge (online parcel data pass).
// LAZY CHUNK: only online-room.ts imports this file, so Solo never bundles, constructs or pumps it (zero solo cost).
//
// The server sends no read-out message, and the protocol has none (no contract change here). Everything the HUD needs
// is either derived from what the server already sends or deterministic per Contract:
// - Near Parcel directions: `placeNearParcels(seedOfString(contractId))`, exactly as the server's MoonRoomSim places
//   them (same game data, same sim table trig, same moon radius). The server lower-cases the Contract id at the join
//   route (shift-join.ts), so the seed uses the lower-cased id too.
// - Collected flags: authoritative from the Schema field `ShiftState.nearParcelsCollected` (uint8, bit k = Near Parcel
//   k, schema v1.1) on every state change, including the first full state, so late joiners see earlier pickups. Once
//   the field has been seen the mask alone decides. FALLBACK (older server, field absent): the `collectible.found`
//   sim_event (kind `stray_cargo`, id `near_parcel`) carries no parcel index, so the client marks the uncollected parcel
//   nearest to any avatar it knows (own predicted pose, interpolated remote avatars). Parcels are 30-300 m apart and
//   the pickup radius is a few metres, so the nearest one is the collected one; late joiners miss earlier pickups.
// - Outposts: the sim's stand-in list (`BOREAL_STAND_IN_OUTPOSTS`, normalised like MoonRoomSim does).
// - Plot Card: the plot `reticle` metres ahead of the own predicted avatar, read from the dust mirror ledger (state,
//   remaining %, dust level -> terrain id), the same formula as `MoonRoomSim.plotCard`. `creditedSlot` is null (the
//   server sends no per-plot credit).
// - Hop: the predictor's avatar state (`hopCharges` from Self). `hopMaxCharges` is 0 online until the suit gear reaches
//   the client, so the gauge stays hidden like a shift without a Hop Pack.
// - Crown Lamp and price quotes: no source online -> lamp level 0 / off, quotes -1 (list / Rebate price).
//
// Reads write into caller out-buffers and allocate nothing. `noteCollectible` runs on a rare control message only.

import { MVP_SCOPE, PlotState, type PlotGrid, type PlotId } from "@moon-cleanup/shared";
import type { GameData } from "@moon-cleanup/game-data";
import {
  BOREAL_STAND_IN_OUTPOSTS,
  NEAR_PARCEL_SIZE,
  landingApronPlots,
  placeNearParcels,
  seedOfString,
  type SimConfig,
} from "@moon-cleanup/sim";
import type { HostReadoutSource } from "./readout-link";
import type { HopOut, LampOut, PlotCardOut } from "./readout-writer";

/** The own predicted avatar fields the read-outs use (OwnAvatarPredictor.state). */
export interface OnlinePose {
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly fx: number;
  readonly fy: number;
  readonly fz: number;
  readonly heightAboveGround: number;
  readonly hopCharges: number;
  readonly hopMaxCharges: number;
  readonly hopRechargeTicks: number;
}

/** Per-plot arrays of the dust mirror (WorldDustLedger). */
export interface OnlinePlotQuery {
  readonly state: Uint8Array;
  readonly frac: Uint8Array;
  readonly levelOf: Uint8Array;
}

export interface OnlineReadoutDeps {
  readonly contractId: string;
  readonly data: GameData;
  readonly config: SimConfig;
  readonly grid: PlotGrid;
  readonly ledger: OnlinePlotQuery;
  /** Own predicted avatar, or null before the first authoritative Self. */
  readonly pose: () => OnlinePose | null;
  /** Authoritative equipped tool code (Schema), -1 before the first patch. */
  readonly toolCode: () => number;
  /** Last sent input's tool parameter (reticle distance 0..255 of the reach). */
  readonly toolParam: () => number;
}

/** Near Parcel count of a Contract: the same rule as MoonRoomSim (MVP scope, data count, at most 8 mask bits). */
export function nearParcelCountOf(data: GameData): number {
  const near = data.collectibles.strayCargo.find((c) => c.size === NEAR_PARCEL_SIZE);
  return near ? Math.min(MVP_SCOPE.nearParcelCount, near.count, 8) : 0;
}

/** A `sim_events` entry as validated by the session (name + payload object). */
export interface WireEventLike {
  readonly name: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export class OnlineReadouts implements HostReadoutSource {
  readonly parcelDirs: Float64Array;
  private readonly count: number;
  private collected = 0;
  private readonly outposts: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }[];
  /** Landing Apron plot ids of the home outpost (constructor only). */
  private readonly apron: readonly number[];
  private readonly terrainByLevel: (string | null)[] = [];
  private readonly dir = { x: 0, y: 1, z: 0 };
  private pickHint = 0 as PlotId;
  /** True once a state carried `nearParcelsCollected`: the Schema mask is authoritative, event guesses are skipped. */
  private maskFromState = false;
  /**
   * Parcels marked from events; events that matched no uncollected parcel; events skipped because the Schema mask is
   * authoritative; state masks applied (changed value only); invalid mask values ignored.
   */
  readonly stats = { marked: 0, unmatched: 0, skipped: 0, masks: 0, maskInvalid: 0 };

  constructor(private readonly deps: OnlineReadoutDeps) {
    const cfg = deps.config;
    this.count = nearParcelCountOf(deps.data);
    this.parcelDirs = new Float64Array(3 * this.count);
    placeNearParcels(seedOfString(deps.contractId.toLowerCase()), this.count, cfg.moonRadiusM, this.parcelDirs);
    this.outposts = BOREAL_STAND_IN_OUTPOSTS.map((o) => {
      const l = Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z) || 1;
      return { id: o.id, x: o.x / l, y: o.y / l, z: o.z / l };
    });
    // Landing Apron: the same pure selection the server's MoonRoomSim runs (home outpost, same grid and game data).
    const home = this.outposts[0];
    this.apron =
      home === undefined ? [] : landingApronPlots(deps.grid, home, deps.data.world.landingApron.plotsPerOutpost);
    // MoonRoomSim.plotCard takes the first terrain id (object key order) with the plot's dust level.
    for (const id in cfg.terrainDustLevel) {
      const level = cfg.terrainDustLevel[id]!;
      if (this.terrainByLevel[level] === undefined) this.terrainByLevel[level] = id;
    }
  }

  /** Collected Near Parcels bitmask (as the client knows it). */
  get collectedMask(): number {
    return this.collected;
  }

  /** True once the Schema mask has been seen (the server is schema v1.1 or later). */
  get authoritativeMask(): boolean {
    return this.maskFromState;
  }

  /**
   * A decoded `ShiftState` (Colyseus onStateChange, first full state included): copies `nearParcelsCollected` when it
   * is an integer 0..255. Absent (older server) leaves the event fallback in charge. Reads one property, no allocation.
   */
  noteState(state: unknown): void {
    if (state === null || typeof state !== "object") return;
    const v = (state as { nearParcelsCollected?: unknown }).nearParcelsCollected;
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) {
      this.stats.maskInvalid++;
      return;
    }
    this.maskFromState = true;
    const mask = v & ((1 << this.count) - 1);
    if (mask === this.collected) return;
    this.collected = mask;
    this.stats.masks++;
  }

  /**
   * One `sim_events` batch: every Near Parcel `collectible.found` marks the uncollected parcel nearest to any of the
   * `n` avatar positions in `positions` (x, y, z triples from the Moon centre, any scale). Skipped (counted) once the
   * Schema mask is authoritative: the next state patch (frame tick, at most one snapshot interval later) carries it.
   */
  noteEvents(events: readonly WireEventLike[], positions: Float64Array, n: number): void {
    for (const e of events) {
      if (e.name !== "collectible.found") continue;
      const p = e.payload;
      if (p["kind"] !== "stray_cargo" || p["id"] !== NEAR_PARCEL_SIZE) continue;
      if (this.maskFromState) {
        this.stats.skipped++;
        continue;
      }
      this.noteCollectible(positions, n);
    }
  }

  /** Marks the uncollected parcel nearest to any of the positions; returns its index or -1. */
  noteCollectible(positions: Float64Array, n: number): number {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    const d = this.parcelDirs;
    for (let i = 0; i < n; i++) {
      const x = positions[3 * i]!;
      const y = positions[3 * i + 1]!;
      const z = positions[3 * i + 2]!;
      const l = Math.sqrt(x * x + y * y + z * z);
      if (!(l > 0)) continue;
      for (let k = 0; k < this.count; k++) {
        if ((this.collected >>> k) & 1) continue;
        const dx = x / l - d[3 * k]!;
        const dy = y / l - d[3 * k + 1]!;
        const dz = z / l - d[3 * k + 2]!;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < bestD) {
          bestD = dd;
          best = k;
        }
      }
    }
    if (best < 0) {
      this.stats.unmatched++;
      return -1;
    }
    this.collected |= 1 << best;
    this.stats.marked++;
    return best;
  }

  // ---- ParcelReadoutSource -------------------------------------------------------------------------------------------

  get nearParcelCount(): number {
    return this.count;
  }

  nearParcel(k: number, out: { x: number; y: number; z: number }): boolean {
    if (!(k >= 0 && k < this.count)) return false;
    out.x = this.parcelDirs[3 * k]!;
    out.y = this.parcelDirs[3 * k + 1]!;
    out.z = this.parcelDirs[3 * k + 2]!;
    return ((this.collected >>> k) & 1) === 1;
  }

  get outpostCount(): number {
    return this.outposts.length;
  }

  outpost(k: number, out: { id: string; x: number; y: number; z: number }): boolean {
    const o = this.outposts[k];
    if (o === undefined) return false;
    out.id = o.id;
    out.x = o.x;
    out.y = o.y;
    out.z = o.z;
    return true;
  }

  get apronPlotCount(): number {
    return this.apron.length;
  }

  /** Unit direction of Landing Apron plot k (the grid's cached centre direction: no allocation). */
  apronPlot(k: number, out: { x: number; y: number; z: number }): boolean {
    const p = this.apron[k];
    if (p === undefined) return false;
    const d = this.deps.grid.centerDirection(p as PlotId);
    out.x = d.x;
    out.y = d.y;
    out.z = d.z;
    return true;
  }

  // ---- SimReadoutSource (slot ignored: the own avatar only) ----------------------------------------------------------

  hopReadout(_slot: number, out: HopOut): boolean {
    const a = this.deps.pose();
    if (a === null) return false;
    out.bursts = a.hopCharges;
    out.max = a.hopMaxCharges;
    const full = this.deps.config.hopRechargeTicks;
    out.recharge01 = a.hopCharges < a.hopMaxCharges && full > 0 ? Math.min(1, a.hopRechargeTicks / full) : 0;
    return true;
  }

  /** No lamp source online (suit gear and the lamp toggle are not mirrored): level 0, off. */
  lampReadout(_slot: number, out: LampOut): boolean {
    if (this.deps.pose() === null) return false;
    out.level = 0;
    out.switchedOn = false;
    out.lit = false;
    return true;
  }

  pickPlot(_slot: number, out: PlotCardOut, aimM?: number): boolean {
    const a = this.deps.pose();
    if (a === null) return false;
    let dist = aimM;
    if (dist === undefined) {
      const tool = this.deps.config.tools[this.deps.toolCode()] ?? this.deps.config.tools[0];
      dist = tool === undefined ? 0 : (tool.reachM * this.deps.toolParam()) / 255;
      if (tool !== undefined && dist < tool.aimMinM) dist = tool.aimMinM;
      if (tool !== undefined && dist > tool.reachM) dist = tool.reachM;
    }
    if (!(dist >= 0)) dist = 0;
    const l = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz);
    if (!(l > 0)) return false;
    const s = (l - a.heightAboveGround) / l;
    const x = a.px * s + a.fx * dist;
    const y = a.py * s + a.fy * dist;
    const z = a.pz * s + a.fz * dist;
    const m = Math.sqrt(x * x + y * y + z * z);
    if (!(m > 0)) return false;
    const d = this.dir;
    d.x = x / m;
    d.y = y / m;
    d.z = z / m;
    const id = this.deps.grid.plotAt(d, this.pickHint);
    const q = this.deps.ledger;
    if (!(id >= 0 && id < q.state.length)) return false;
    this.pickHint = id;
    out.plotId = id;
    out.state = q.state[id]! as PlotState;
    out.remainingPct = Math.round((q.frac[id]! * 100) / 255);
    out.terrainId = this.terrainByLevel[q.levelOf[id]!] ?? null;
    out.creditedSlot = null;
    out.countsTowardShine = out.state === PlotState.Polished || out.state === PlotState.Empty;
    const plots = this.deps.grid.count;
    out.shinePctPerPlot = plots > 0 ? 100 / plots : 0;
    return true;
  }

  /** No price source online: -1 keeps the Desk / Board list (or Rebate) price. */
  quotePriceLm(slot: number, itemId: string): number {
    void slot;
    void itemId;
    return -1;
  }
}
