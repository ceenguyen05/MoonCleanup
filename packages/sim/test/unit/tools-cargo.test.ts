// M1-W6-T01: tool traits (Steep / Sure Footing, Lane Lock), Dust Cells I-III from the board, Dust Pucks and Puck
// Stacks (form, band, carry, drop, throw, pour back, caps, merge, despawn), Plot Card data, determinism.
import { describe, expect, test } from "vitest";
import {
  INPUT_BUTTON_MASK as M,
  type PlotId,
  type RequestId,
  type RoomSimEvent,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  CARGO_CARRIED,
  CARGO_FREE,
  CARGO_RESTING,
  CargoStore,
  cellCapGrams,
  createSimConfig,
  formPuck,
  PlotCardData,
  stepCargo,
  toolCodeOf,
  type MoonRoomSim,
  type SimConfig,
  type SimGround,
  type SimWorld,
} from "../../src/index";
import { flatWorld, makeSim, makeWorldLedger, PLAYER } from "../support/world";

const data = loadGameData();
const cfg = createSimConfig(data);
const DUSTER = toolCodeOf(cfg, "tool.desk_duster");
const SQUEEGEE = toolCodeOf(cfg, "tool.crescent_squeegee");
const BRISTLE = toolCodeOf(cfg, "tool.bristle_broom");
const LANE = toolCodeOf(cfg, "tool.lane_broom");
const RAKE = toolCodeOf(cfg, "tool.static_rake");

function input(seq: number, over: Partial<SimInputCommand> = {}): SimInputCommand {
  return { seq: seq & 0xffff, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 255, ...over };
}

class Driver {
  seq = 1;
  constructor(readonly sim: MoonRoomSim) {}
  run(ticks: number, f: (k: number) => Partial<SimInputCommand> = () => ({})): void {
    for (let k = 0; k < ticks; k++) {
      this.sim.applyInput(0, input(this.seq++, f(k)));
      this.sim.step(cfg.dt);
    }
  }
}

function soloSim(world: SimWorld = flatWorld(), extra = {}): { sim: MoonRoomSim; d: Driver } {
  const sim = makeSim(world, { walletLm: 100_000, ...extra });
  sim.addActor(0, PLAYER);
  return { sim, d: new Driver(sim) };
}

function buyAndEquip(sim: MoonRoomSim, id: string): void {
  sim.applyIntent(0, { kind: "purchase", requestId: "r1" as RequestId, itemId: id });
  const code = toolCodeOf(cfg, id);
  const owned = sim.toolState(0).owned;
  let slot = 0;
  for (const t of [...cfg.tools].filter((x) => x.cleans).sort((p, q) => p.tier - q.tier)) {
    if (t.code === code) break;
    if ((owned >> t.code) & 1) slot++;
  }
  sim.applyIntent(0, { kind: "select_tool", slot });
}

/** Ground tilted about one horizontal axis: tan(slope) = s near the +Y spawn. */
function tiltedWorld(s: number): SimWorld {
  const R = cfg.moonRadiusM;
  const ground: SimGround = { heightAtXYZ: (x) => s * R * x };
  return { grid: flatWorld().grid, ground };
}

function tangentialSpeed(sim: MoonRoomSim): number {
  const a = sim.avatar(0);
  const l = Math.hypot(a.px, a.py, a.pz);
  const vr = (a.vx * a.px + a.vy * a.py + a.vz * a.pz) / l;
  return Math.sqrt(Math.max(0, a.vx * a.vx + a.vy * a.vy + a.vz * a.vz - vr * vr));
}

function cellOf(sim: MoonRoomSim): number {
  const t = sim.toolState(0);
  return t.cellGrams[t.toolCode]!;
}

function setCell(sim: MoonRoomSim, grams: number): void {
  const t = sim.toolState(0);
  (t.cellGrams as Int32Array)[t.toolCode] = grams;
}

function totalDust(sim: MoonRoomSim): number {
  return cellOf(sim) + sim.cargo.totalGrams();
}

describe("tool table and traits (T1-T4)", () => {
  test("T1-T4 rows: Detailing, Flick, Sure Footing, Lane Lock wired from traits.json", () => {
    expect(cfg.tools[DUSTER]!.detailing).toBe(true);
    expect(cfg.tools[SQUEEGEE]!.flick).toBe(true);
    expect(cfg.tools[LANE]!.laneLockBonus).toBeCloseTo(1.15, 9);
    expect(cfg.tools[BRISTLE]!.laneLockBonus).toBe(1);
    // Steep: x0.6 without a trait, 1.0 with Sure Footing (T3) or Charge (T5).
    expect(cfg.tools[DUSTER]!.steepSweepMult).toBeCloseTo(data.world.steepSweepMult, 9);
    expect(cfg.tools[SQUEEGEE]!.steepSweepMult).toBeCloseTo(0.6, 9);
    expect(cfg.tools[LANE]!.steepSweepMult).toBeCloseTo(0.6, 9);
    expect(cfg.tools[BRISTLE]!.steepSweepMult).toBe(1);
    expect(cfg.tools[RAKE]!.steepSweepMult).toBe(1);
  });

  function steadySweepSpeed(world: SimWorld, toolId: string | null, buttons = M.toolPrimary): number {
    const { sim, d } = soloSim(world);
    if (toolId) buyAndEquip(sim, toolId);
    d.run(20); // swap settles
    // Strafe across the fall line (moveX) so uphill / downhill does not enter.
    d.run(60, () => ({ moveX: 127, buttons }));
    return tangentialSpeed(sim);
  }

  test("Steep (> 25 degrees): sweep-walk x0.6 without a trait, full speed with Sure Footing", () => {
    const steep = tiltedWorld(Math.tan((32 * Math.PI) / 180));
    const duster = steadySweepSpeed(steep, null);
    const bristle = steadySweepSpeed(steep, "tool.bristle_broom");
    expect(bristle).toBeGreaterThan(cfg.sweepWalkMps * 0.9);
    expect(duster / bristle).toBeGreaterThan(0.55);
    expect(duster / bristle).toBeLessThan(0.66);
    // Gentle ground (20 degrees): no Steep rule, both at sweep-walk speed.
    const gentle = tiltedWorld(Math.tan((20 * Math.PI) / 180));
    expect(steadySweepSpeed(gentle, null) / steadySweepSpeed(gentle, "tool.bristle_broom")).toBeGreaterThan(0.97);
  });

  test("Lane Lock: +15% sweep-walk with the Lane Broom only while the laneLock bit is set", () => {
    const flat = flatWorld();
    const locked = steadySweepSpeed(flat, "tool.lane_broom", M.toolPrimary | M.laneLock);
    const free = steadySweepSpeed(flat, "tool.lane_broom");
    expect(locked / free).toBeCloseTo(1.15, 2);
    const bristleLocked = steadySweepSpeed(flat, "tool.bristle_broom", M.toolPrimary | M.laneLock);
    expect(bristleLocked / free).toBeCloseTo(1, 2);
  });
});

describe("Dust Cells I-III", () => {
  test("capacity = base x 1.75 / 2.75 / 4.0, Densifier adds +20% / +40%", () => {
    const d = cfg.tools[DUSTER]!;
    expect([0, 1, 2, 3].map((l) => cellCapGrams(cfg, d, l))).toEqual([4000, 7000, 11000, 16000]);
    expect(cellCapGrams(cfg, cfg.tools[BRISTLE]!, 1)).toBe(26250);
    expect(cellCapGrams(cfg, d, 3, 0.4)).toBe(22400);
  });

  test("board Cell nodes and the Densifier set the actor Cell capacity (restore path)", () => {
    const { sim } = soloSim(flatWorld(), {
      sharedUpgrades: { "node.dust_cell_desk_duster": 2, "node.densifier": 1 },
    });
    expect(sim.snapshot().actors[0]!.tool.cellCapGrams).toBe(Math.round(4000 * 2.75 * 1.2));
  });

  test("a full Cell refuses strokes until a puck is formed", () => {
    const { sim, d } = soloSim();
    setCell(sim, 4000);
    // Sweep: every stroke is refused while the Cell is full.
    d.run(20, () => ({ buttons: M.toolPrimary }));
    expect(sim.counters.strokesCellFull).toBeGreaterThan(0);
    expect(cellOf(sim)).toBe(4000);
    d.run(1, () => ({ buttons: M.puckForm }));
    d.run(1);
    expect(cellOf(sim)).toBe(3000);
    expect(sim.toolState(0).fullLatched).toBe(false);
  });
});

describe("Dust Pucks and Puck Stacks", () => {
  test("F tap forms one 1-kg puck at the feet and emits cargo.puck_formed", () => {
    const { sim, d } = soloSim();
    const events: RoomSimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    setCell(sim, 2500);
    d.run(1, () => ({ buttons: M.puckForm }));
    d.run(1);
    expect(cellOf(sim)).toBe(1500);
    const cargo = sim.snapshot().cargo;
    expect(cargo).toHaveLength(1);
    expect(cargo[0]).toMatchObject({ kind: "puck", count: 1, grams: 1000, carriedBy: null });
    expect(events.filter((e) => e.name === "cargo.puck_formed")).toHaveLength(1);
    // A second tap lands on the first: they touch and merge into a 2-puck stack.
    d.run(1, () => ({ buttons: M.puckForm }));
    d.run(1);
    expect(sim.snapshot().cargo).toEqual([expect.objectContaining({ kind: "stack", count: 2, grams: 2000 })]);
    expect(totalDust(sim)).toBe(2500);
  });

  test("F hold 0.30 s bands the whole Cell into stacks of at most 20 kg, once per press", () => {
    const { sim, d } = soloSim();
    const events: RoomSimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    setCell(sim, 45_500);
    d.run(cfg.cargo.formHoldTicks + 3, () => ({ buttons: M.puckForm }));
    d.run(1);
    expect(cellOf(sim)).toBe(0);
    const grams = sim
      .snapshot()
      .cargo.map((c) => c.grams)
      .sort((a, b) => b - a);
    expect(grams).toEqual([20_000, 20_000, 5_500]);
    const banded = events.filter((e) => e.name === "cargo.stack_banded");
    expect(banded).toHaveLength(1);
    expect((banded[0]!.payload as { pucks: number }).pucks).toBe(20 + 20 + 6);
    expect(events.some((e) => e.name === "cargo.puck_formed")).toBe(false);
  });

  test("Q tap picks up within 1.5 m, carry limit 1, Q tap drops; E pours back into the Cell", () => {
    const { sim, d } = soloSim();
    setCell(sim, 3000);
    d.run(1, () => ({ buttons: M.puckForm }));
    d.run(1);
    d.run(1, () => ({ buttons: M.pickupDrop }));
    d.run(1);
    const snap = sim.snapshot();
    expect(snap.actors[0]!.carrying).toHaveLength(1);
    expect(snap.cargo[0]!.carriedBy).toBe(0);
    expect(sim.cargo.loose).toBe(0);
    // Drop it again.
    d.run(1, () => ({ buttons: M.pickupDrop }));
    d.run(1);
    expect(sim.snapshot().actors[0]!.carrying).toHaveLength(0);
    expect(sim.cargo.loose).toBe(1);
    // Pick up and pour back.
    d.run(1, () => ({ buttons: M.pickupDrop }));
    d.run(1);
    d.run(1, () => ({ buttons: M.interact }));
    expect(cellOf(sim)).toBe(3000);
    expect(sim.snapshot().cargo).toHaveLength(0);
  });

  test("pour back stops at Cell capacity and leaves the rest in the puck", () => {
    const { sim, d } = soloSim();
    setCell(sim, 4000);
    d.run(cfg.cargo.formHoldTicks + 1, () => ({ buttons: M.puckForm })); // one 4 kg stack
    d.run(1);
    d.run(1, () => ({ buttons: M.pickupDrop }));
    d.run(1);
    setCell(sim, 2500);
    d.run(1, () => ({ buttons: M.interact }));
    expect(cellOf(sim)).toBe(4000);
    expect(sim.snapshot().cargo).toEqual([expect.objectContaining({ grams: 2500, count: 3, carriedBy: 0 })]);
  });

  test("Q hold and release throws on a lunar parabola; it lands on the ground, skids and rests (no tunnelling)", () => {
    const { sim, d } = soloSim();
    const events: RoomSimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    setCell(sim, 1000);
    d.run(1, () => ({ buttons: M.puckForm }));
    d.run(1);
    d.run(1, () => ({ buttons: M.pickupDrop }));
    d.run(1);
    const a = sim.avatar(0);
    const start = { x: a.px, y: a.py, z: a.pz };
    d.run(cfg.cargo.throwChargeTicks + 2, () => ({ buttons: M.pickupDrop }));
    d.run(1);
    expect(events.filter((e) => e.name === "cargo.thrown")).toHaveLength(1);
    const R = cfg.moonRadiusM;
    let minR = Infinity;
    for (let k = 0; k < 400; k++) {
      d.run(1);
      const c = sim.cargo;
      for (let i = 0; i < c.capacity; i++)
        if (c.state[i] !== CARGO_FREE) minR = Math.min(minR, Math.hypot(c.px[i]!, c.py[i]!, c.pz[i]!));
    }
    expect(minR).toBeGreaterThanOrEqual(R - 1e-6);
    const p = sim.snapshot().cargo[0]!;
    const i = sim.cargo.state.indexOf(CARGO_RESTING);
    expect(i).toBeGreaterThanOrEqual(0);
    const dist = Math.hypot(p.position.x - start.x, p.position.y - start.y, p.position.z - start.z);
    // 8 m/s at 30 degrees from 1.2 m: about 35 m of flight, then 3 m/s^2 skid of about 8 m.
    expect(dist).toBeGreaterThan(38);
    expect(dist).toBeLessThan(50);
    expect(Math.hypot(p.position.x, p.position.y, p.position.z)).toBeCloseTo(R, 6);
  });

  test("caps: forming beyond the per-player cap merges into the newest unit; drop beyond it is refused", () => {
    const small: SimConfig = { ...cfg, cargo: { ...cfg.cargo, loosePerPlayer: 2, mergeRadiusM: 0 } };
    const { sim } = soloSim();
    const store = new CargoStore(small);
    const a = sim.avatar(0) as never;
    const t = sim.toolState(0) as never;
    setCell(sim, 4000);
    expect(formPuck(small, store, a, t, flatWorld().ground, 0, 1)).not.toBe(0);
    expect(formPuck(small, store, a, t, flatWorld().ground, 0, 2)).not.toBe(0);
    expect(store.loose).toBe(2);
    formPuck(small, store, a, t, flatWorld().ground, 0, 3);
    expect(store.loose).toBe(2);
    expect(store.counters.merged).toBe(1);
    expect(store.totalGrams() + cellOf(sim)).toBe(4000);
  });

  test("a loose unit untouched for despawnS is auto-collected at despawnValueFrac", () => {
    const quick: SimConfig = { ...cfg, cargo: { ...cfg.cargo, despawnTicks: 10 } };
    const { sim } = soloSim();
    const store = new CargoStore(quick);
    setCell(sim, 1000);
    formPuck(quick, store, sim.avatar(0) as never, sim.toolState(0) as never, flatWorld().ground, 0, 0);
    for (let k = 0; k < 9; k++) stepCargo(quick, store, [sim.avatar(0) as never], flatWorld().ground, k);
    expect(store.loose).toBe(1);
    stepCargo(quick, store, [sim.avatar(0) as never], flatWorld().ground, 10);
    expect(store.loose).toBe(0);
    expect(store.despawnedGrams).toBe(1000);
    expect(store.pendingGateGrams).toBe(Math.floor(1000 * data["dust-cells"].loosePuckCap.despawnValueFrac));
  });

  test("leaving drops what the actor carried; dust is conserved through every action", () => {
    const { sim, d } = soloSim();
    setCell(sim, 3000);
    d.run(1, () => ({ buttons: M.puckForm }));
    d.run(1);
    d.run(1, () => ({ buttons: M.pickupDrop }));
    d.run(1);
    expect(sim.cargo.state.includes(CARGO_CARRIED)).toBe(true);
    expect(totalDust(sim)).toBe(3000);
    sim.removeActor(0);
    expect(sim.cargo.loose).toBe(1);
    expect(sim.cargo.totalGrams()).toBe(1000);
  });
});

describe("Plot Card data", () => {
  test("state, % remaining, terrain and credit from the real ledger; false on the stand-in ledger", () => {
    const ledger = makeWorldLedger();
    const { sim } = soloSim(flatWorld(), { ledger });
    const out = new PlotCardData();
    let plot = 0;
    while (ledger.levelOf[plot] === 0) plot++;
    expect(sim.plotCard(plot as PlotId, out)).toBe(true);
    expect(out).toMatchObject({ plotId: plot, state: 0, remainingPct: 100, creditedSlot: null, escorted: false });
    expect(out.terrainId).toMatch(/^terrain\./);
    expect(sim.plotCard(-1 as PlotId, out)).toBe(false);
    const { sim: approx } = soloSim();
    expect(approx.plotCard(0 as PlotId, out)).toBe(false);
  });
});

describe("determinism", () => {
  test("a scripted puck session gives the same state hash twice", () => {
    const script = (k: number): Partial<SimInputCommand> => {
      const phase = k % 60;
      let buttons = 0;
      if (phase < 30) buttons |= M.toolPrimary;
      if (phase === 31) buttons |= M.puckForm;
      if (phase >= 35 && phase < 44) buttons |= M.puckForm;
      if (phase === 46 || (phase >= 50 && phase < 58)) buttons |= M.pickupDrop;
      return { moveY: 90, moveX: (k * 7) % 60, yaw: (k * 331) & 0xffff, buttons };
    };
    const hashes: number[] = [];
    for (let r = 0; r < 2; r++) {
      const { sim, d } = soloSim();
      setCell(sim, 3500);
      d.run(600, script);
      hashes.push(sim.stateHash());
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});

describe("pucks in the checkpoint (PUCKS v3)", () => {
  // No sweeping: the stand-in ledger is not part of the checkpoint, pucks and Cells are.
  const script = (k: number): Partial<SimInputCommand> => {
    const phase = k % 40;
    let buttons = 0;
    if (phase === 1) buttons |= M.puckForm;
    if (phase >= 5 && phase < 13) buttons |= M.puckForm;
    if (phase === 16 || (phase >= 20 && phase < 36)) buttons |= M.pickupDrop;
    return { moveY: phase < 20 ? 60 : 0, yaw: (k * 977) & 0xffff, buttons };
  };

  function busy(): { sim: MoonRoomSim; d: Driver } {
    const r = soloSim();
    setCell(r.sim, 3900);
    r.d.run(67, script); // mid-throw / mid-hold states included
    return r;
  }

  test("save -> restore -> continue gives the same hash as the uninterrupted run", () => {
    const a = busy();
    expect(a.sim.cargo.totalGrams()).toBeGreaterThan(0);
    const ck = a.sim.captureCheckpoint();
    expect(ck.pucksVersion).toBe(3);
    const b = soloSim();
    const res = b.sim.restoreCheckpoint(ck);
    expect(res.ok).toBe(true);
    b.d.seq = a.d.seq;
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
    const shift = (d: Driver) => d.run(200, (k) => script(k + 67));
    shift(a.d);
    shift(b.d);
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
    expect(b.sim.cargo.totalGrams()).toBe(a.sim.cargo.totalGrams());
  });

  test("checkpoints without a PUCKS body still load (no pucks); a wrong version or bad bytes are rejected", () => {
    const ck = busy().sim.captureCheckpoint();
    const old = { metaVersion: ck.metaVersion, meta: ck.meta, playersVersion: ck.playersVersion, players: ck.players };
    const b = soloSim();
    expect(b.sim.restoreCheckpoint(old).ok).toBe(true);
    expect(b.sim.cargo.loose + b.sim.cargo.carriedCount(0)).toBe(0);
    const c = soloSim();
    expect(c.sim.restoreCheckpoint({ ...ck, pucksVersion: 2 }).code).toBe("unsupported_version");
    const bad = ck.pucks!.slice();
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff;
    bad[80] = 9; // first record state
    expect(c.sim.restoreCheckpoint({ ...ck, pucks: bad }).ok).toBe(false);
    expect(c.sim.restoreCheckpoint({ ...ck, pucks: ck.pucks!.subarray(0, 10) }).code).toBe("malformed");
  });
});
