// Plot events and the Inspector's Stamp (M1-W3-T01d): the sim reads the dust ledger's Opened / Polished queues after
// every stroke it applies, pays the Stamp into the shift wallet and emits `plot.opened` / `plot.polished`.
//
// Real-ledger cases use `WorldDustLedger` of packages/world. A plot is brought to the edge of Polished without
// guessing the rasteriser: run A records which texels of plot P a fixed sweep script empties and by how much; run B
// installs exactly that dust on those texels, plus the Polished threshold's worth of untouched dust elsewhere on P.
// Removal per texel is `max(0, u - r)` with r independent of u, so the same strokes empty the same texels again, and
// P becomes Polished exactly when the last of them is gone.
import { describe, expect, test } from "vitest";
import {
  INPUT_BUTTON_MASK as M,
  SHINE_MILESTONE_PCTS,
  type PlotId,
  type RoomSimEvent,
  type SimEventMap,
  type StrokeRecord,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { polishedThresholdUnits } from "@moon-cleanup/world";
import {
  ApproxDustLedger,
  createSimConfig,
  FLAG_GOLDEN_HANDSHAKE_CREDIT,
  plotEventsOf,
  PromotionsBoard,
  STAT_STAMP_PREMIUM_LEVEL,
  stampIsCharged,
  stampPayoutLm,
  type DustLedgerPlotEvents,
  type DustLedgerPort,
  type MoonRoomSim,
  type MoonRoomSimOptions,
  type StrokeApplyResult,
} from "../../src/index";
import { makeSim, makeWorldLedger, PLAYER, testWorld } from "../support/world";

const TEXELS = 1024;
const SCRIPT_TICKS = 300;
const START_WALLET = 500;

type Ev<K extends keyof SimEventMap> = SimEventMap[K];

function collect(sim: MoonRoomSim): RoomSimEvent[] {
  const list: RoomSimEvent[] = [];
  sim.onEvent((e) => list.push(e));
  return list;
}

function payloads<K extends keyof SimEventMap>(list: readonly RoomSimEvent[], name: K): Ev<K>[] {
  return list.filter((e) => e.name === name).map((e) => e.payload as Ev<K>);
}

/**
 * One actor sweeping the Desk Duster on a slow circle; the Cell is emptied every tick so no stroke is ever rejected.
 * The input is a function of the sim tick only, so a run can be continued in pieces.
 */
function runSweep(sim: MoonRoomSim, ticks = SCRIPT_TICKS, onStroke?: (anchor: number) => void): void {
  for (let k = 0; k < ticks; k++) {
    const n = sim.tick + 1;
    const yaw = (n * 300) % 65536;
    sim.applyInput(0, {
      seq: n & 0xffff,
      moveX: 0,
      moveY: 60,
      yaw,
      pitch: -20,
      buttons: M.toolPrimary,
      toolParam: 200,
    });
    sim.step(sim.config.dt);
    if (onStroke) for (let k = 0; k < sim.strokeCount; k++) onStroke(sim.strokeAt(k).anchor);
    sim.drainCell(0);
  }
}

function sweepSim(ledger: DustLedgerPort, extra: Partial<MoonRoomSimOptions> = {}): MoonRoomSim {
  const sim = makeSim(testWorld(), { ledger, walletLm: START_WALLET, ...extra });
  sim.addActor(0, PLAYER);
  return sim;
}

interface EdgeOfPolished {
  readonly plot: number;
  /** Texel bytes for `installLedger`: run A's removal on the swept texels, the Polished threshold elsewhere. */
  readonly texels: Uint8Array;
  readonly initialUnits: number;
  /** Units run A removed from the plot. */
  readonly sweptUnits: number;
}

function edgeOfPolished(): EdgeOfPolished {
  // Run A on a fresh ledger: the plot most strokes anchored on, and what the script removed from each of its texels.
  const ledgerA = makeWorldLedger();
  const hits = new Map<number, number>();
  runSweep(sweepSim(ledgerA), SCRIPT_TICKS, (a) => hits.set(a, (hits.get(a) ?? 0) + 1));
  let plot = -1;
  let best = 0;
  for (const [p, n] of hits) if (n > best || (n === best && p < plot)) [plot, best] = [p, n];
  const after = new Uint8Array(TEXELS);
  expect(ledgerA.copyTexels(plot, after, 0)).toBe(true);

  // Ownership and the starting level of every texel of the plot: install a full ledger on a scratch ledger.
  const scratch = makeWorldLedger();
  expect(scratch.installLedger(plot, new Uint8Array(TEXELS).fill(255), 0, 0)).toBeGreaterThan(0);
  const fresh = new Uint8Array(TEXELS);
  scratch.copyTexels(plot, fresh, 0);
  let initialUnits = 0;
  for (let i = 0; i < TEXELS; i++) initialUnits += fresh[i]!;

  const texels = new Uint8Array(TEXELS);
  let sweptUnits = 0;
  for (let i = 0; i < TEXELS; i++) {
    texels[i] = fresh[i]! - after[i]!;
    sweptUnits += texels[i]!;
  }
  let residue = polishedThresholdUnits(initialUnits);
  for (let i = 0; i < TEXELS && residue > 0; i++) {
    if (fresh[i] === 0 || texels[i] !== 0) continue;
    const u = Math.min(fresh[i]!, residue);
    texels[i] = u;
    residue -= u;
  }
  expect(residue).toBe(0);
  expect(sweptUnits).toBeGreaterThan(0);
  return { plot, texels, initialUnits, sweptUnits };
}

/** Run B: plot P one sweep away from Polished; `playerShare` credits the player with earlier removal first. */
function runToPolished(edge: EdgeOfPolished, playerShare: boolean, extra: Partial<MoonRoomSimOptions> = {}) {
  const ledger = makeWorldLedger();
  expect(ledger.installLedger(edge.plot, edge.texels, 0, 1)).toBe(0);
  if (playerShare) ledger.addContribution(edge.plot, 0, edge.initialUnits);
  // Recounting the thresholds queues P as Opened; the sim built afterwards must not report it.
  ledger.refreshPlot(edge.plot);
  expect(ledger.openedQueueCount).toBeGreaterThan(0);
  const sim = sweepSim(ledger, extra);
  const events = collect(sim);
  let polishedAtTick = -1;
  for (let t = 0; t < SCRIPT_TICKS; t++) {
    const stepped = sim.tick; // events carry the tick being stepped
    runSweep(sim, 1);
    if (polishedAtTick < 0 && ledger.polishedTotal > 0) polishedAtTick = stepped;
  }
  return { ledger, sim, events, polishedAtTick };
}

describe("Inspector's Stamp payout (plot-bonus.json)", () => {
  const cfg = createSimConfig(loadGameData());
  const base = { playerCredited: true, chargeFinish: false, premiumLevel: 0, premiumOnFlock: false };

  test("reads every number from game-data", () => {
    const pb = loadGameData()["plot-bonus"];
    expect(cfg.stampBaseLm).toBe(pb.stampBaseLm);
    expect(cfg.stampPremiumMult).toEqual(pb.stampPremiumMult);
    expect(cfg.chargeFinishMult).toBe(pb.chargeFinishMult);
  });

  test("base, Stamp Premium levels, Charge finish; rounded to whole Lumens", () => {
    const b = cfg.stampBaseLm;
    const [p1, p2] = cfg.stampPremiumMult as [number, number];
    expect(stampPayoutLm(cfg, base)).toBe(Math.round(b));
    expect(stampPayoutLm(cfg, { ...base, premiumLevel: 1 })).toBe(Math.round(b * p1));
    expect(stampPayoutLm(cfg, { ...base, premiumLevel: 2 })).toBe(Math.round(b * p2));
    expect(stampPayoutLm(cfg, { ...base, premiumLevel: 99 })).toBe(Math.round(b * p2)); // clamped to the top level
    expect(stampPayoutLm(cfg, { ...base, premiumLevel: 1, chargeFinish: true })).toBe(
      Math.round(b * p1 * cfg.chargeFinishMult),
    );
    for (const lvl of [0, 1, 2]) {
      for (const charge of [false, true]) {
        const lm = stampPayoutLm(cfg, { ...base, premiumLevel: lvl, chargeFinish: charge });
        expect(Number.isInteger(lm)).toBe(true);
      }
    }
  });

  test("Flock plots: base only, no Charge finish; Golden Handshake adds the premium", () => {
    const flock = { ...base, playerCredited: false, premiumLevel: 2, chargeFinish: true };
    expect(stampPayoutLm(cfg, flock)).toBe(Math.round(cfg.stampBaseLm));
    expect(stampIsCharged(flock)).toBe(false);
    expect(stampPayoutLm(cfg, { ...flock, premiumOnFlock: true })).toBe(
      Math.round(cfg.stampBaseLm * cfg.stampPremiumMult[1]!),
    );
  });

  test("never negative", () => {
    expect(stampPayoutLm({ ...cfg, stampBaseLm: -10 }, base)).toBe(0);
    expect(stampPayoutLm(cfg, { ...base, premiumLevel: -3 })).toBe(Math.round(cfg.stampBaseLm));
  });
});

/**
 * A scripted ledger with plot states: every applied stroke removes 1 g and releases the next queued batch. `emptyPlots`
 * Empty plots count toward Shine (not toward polishedCount), like the real ledger's outpost pads.
 */
class ScriptedLedger implements DustLedgerPort, DustLedgerPlotEvents {
  private polished: [number, number][] = [];
  private opened: number[] = [];
  polishedTotal = 0;
  applied = 0;
  constructor(
    private readonly batches: { opened?: number[]; polished?: [number, number][] }[],
    readonly emptyPlots = 0,
  ) {}
  get shinePlots(): number {
    return this.polishedTotal + this.emptyPlots;
  }
  queue(opened: number[], polished: [number, number][]): void {
    this.opened.push(...opened);
    this.polished.push(...polished);
    this.polishedTotal += polished.length;
  }
  isEmptyPlot(): boolean {
    return false;
  }
  applyStroke(stroke: StrokeRecord, out: StrokeApplyResult): void {
    out.milligrams += 1000;
    out.removedUnits += 16;
    out.plotIds[out.plotCount++] = stroke.anchor;
    const b = this.batches[this.applied++];
    if (b) this.queue(b.opened ?? [], b.polished ?? []);
  }
  get polishedQueueCount(): number {
    return this.polished.length;
  }
  polishedPlotAt(k: number): number {
    return this.polished[k]![0];
  }
  polishedCreditAt(k: number): number {
    return this.polished[k]![1];
  }
  clearPolishedQueue(): void {
    this.polished = [];
  }
  get openedQueueCount(): number {
    return this.opened.length;
  }
  openedPlotAt(k: number): number {
    return this.opened[k]!;
  }
  clearOpenedQueue(): void {
    this.opened = [];
  }
  contributionOf(_plot: number, actorSlot: number): number {
    return actorSlot === 0 ? 10 : 0;
  }
}

describe("MoonRoomSim drains the plot-event queues", () => {
  const cfg = createSimConfig(loadGameData());

  test("the real ledger exposes the queues; the stand-in does not", () => {
    expect(plotEventsOf(makeWorldLedger())).not.toBeNull();
    const approx = new ApproxDustLedger({
      plotAreaM2: 300,
      defaultDustLevel: 5,
      detailingDiameterMm: 100,
      kgPerM2PerLevel: cfg.dustKgPerM2PerLevel,
    });
    expect(plotEventsOf(approx)).toBeNull();
  });

  test("the stand-in ledger: no plot events, no Stamp, Shine 0", () => {
    const sim = sweepSim(
      new ApproxDustLedger({
        plotAreaM2: 300,
        defaultDustLevel: 5,
        detailingDiameterMm: 100,
        kgPerM2PerLevel: cfg.dustKgPerM2PerLevel,
      }),
    );
    const events = collect(sim);
    runSweep(sim, 100);
    expect(events.some((e) => e.name === "plot.opened" || e.name === "plot.polished")).toBe(false);
    expect(sim.shinePolished).toBe(0);
    expect(sim.wallet).toBe(START_WALLET);
  });

  test("order, credit, Shine count and wallet for two Stamps in one stroke; queues are emptied", () => {
    const ledger = new ScriptedLedger([
      {
        opened: [7],
        polished: [
          [11, 0],
          [12, -1],
        ],
      },
    ]);
    const sim = sweepSim(ledger);
    const events = collect(sim);
    runSweep(sim, 40);
    expect(ledger.applied).toBeGreaterThan(1);
    const names = events.filter((e) => e.name.startsWith("plot.")).map((e) => e.name);
    expect(names).toEqual(["plot.opened", "plot.polished", "plot.polished"]);
    const [opened] = payloads(events, "plot.opened");
    expect(opened).toMatchObject({ plotId: 7, creditedSlot: 0 });
    const [p1, p2] = payloads(events, "plot.polished");
    const player = stampPayoutLm(cfg, {
      playerCredited: true,
      chargeFinish: false,
      premiumLevel: 0,
      premiumOnFlock: false,
    });
    const flock = stampPayoutLm(cfg, {
      playerCredited: false,
      chargeFinish: false,
      premiumLevel: 0,
      premiumOnFlock: false,
    });
    expect(p1).toMatchObject({
      plotId: 11,
      credit: "player",
      creditedSlot: 0,
      stampLm: player,
      charged: false,
      polishedCount: 1,
    });
    expect(p2).toMatchObject({
      plotId: 12,
      credit: "flock",
      creditedSlot: null,
      stampLm: flock,
      charged: false,
      polishedCount: 2,
    });
    expect(p1!.tick).toBe(opened!.tick);
    expect(sim.wallet).toBe(START_WALLET + player + flock);
    expect(sim.counters).toMatchObject({ plotsOpened: 1, plotsPolished: 2 });
    expect(sim.shinePolished).toBe(2);
    expect(ledger.polishedQueueCount).toBe(0);
    expect(ledger.openedQueueCount).toBe(0);
  });

  test("the Stamp is paid without listeners (only the event objects depend on them)", () => {
    const ledger = new ScriptedLedger([{ polished: [[11, 0]] }]);
    const sim = sweepSim(ledger);
    runSweep(sim, 40);
    expect(sim.wallet).toBe(START_WALLET + cfg.stampBaseLm);
    expect(sim.counters.plotsPolished).toBe(1);
  });

  test("events queued before the sim took the ledger are not news: no event, no payout", () => {
    const ledger = new ScriptedLedger([]);
    ledger.queue([3], [[4, 0]]);
    const sim = sweepSim(ledger);
    const events = collect(sim);
    runSweep(sim, 40);
    expect(events.some((e) => e.name.startsWith("plot."))).toBe(false);
    expect(sim.wallet).toBe(START_WALLET);
    expect(sim.counters).toMatchObject({ plotsOpened: 0, plotsPolished: 0 });
  });
});

const TOTAL_PLOTS = testWorld().grid.count;
const DATA = loadGameData();

/** Plots needed for a Shine milestone fraction (smallest whole number of plots reaching it). */
function shinePlotsFor(frac: number): number {
  return Math.ceil((Math.round(frac * 1_000_000) * TOTAL_PLOTS) / 1_000_000);
}

describe("Promotions Board drives the Stamp", () => {
  const cfg = createSimConfig(DATA);
  const board = new PromotionsBoard(DATA);
  const premiumNode = board.nodeIds.find((id) =>
    DATA["promotions-board"].nodes
      .find((n) => n.id === id)!
      .levels.some((l) => l.effects.some((e) => "stat" in e && e.stat === STAT_STAMP_PREMIUM_LEVEL)),
  )!;
  const handshakeNode = board.nodeIds.find((id) =>
    DATA["promotions-board"].nodes
      .find((n) => n.id === id)!
      .levels.some((l) => l.effects.some((e) => e.op === "flag" && e.featureId === FLAG_GOLDEN_HANDSHAKE_CREDIT)),
  )!;
  const lv = (rec: Record<string, number>): Uint8Array => {
    const out = new Uint8Array(board.count);
    for (const [id, level] of Object.entries(rec)) out[board.indexOf(id)] = level;
    return out;
  };

  test("effects resolve from game-data: the highest owned level replaces the lower ones", () => {
    expect(premiumNode).toBe("node.stamp_premium");
    expect(handshakeNode).toBe("node.golden_handshake");
    expect(board.stat(lv({}), STAT_STAMP_PREMIUM_LEVEL, 0)).toBe(0);
    expect(board.stat(lv({ [premiumNode]: 1 }), STAT_STAMP_PREMIUM_LEVEL, 0)).toBe(1);
    expect(board.stat(lv({ [premiumNode]: 2 }), STAT_STAMP_PREMIUM_LEVEL, 0)).toBe(2);
    expect(board.flag(lv({ [premiumNode]: 2 }), FLAG_GOLDEN_HANDSHAKE_CREDIT)).toBe(false);
    expect(board.flag(lv({ [handshakeNode]: 1 }), FLAG_GOLDEN_HANDSHAKE_CREDIT)).toBe(true);
    // add stats sum across nodes: Rate Review III (+15 %) and Golden Handshake (+8 %) on payoutBonus.
    expect(board.stat(lv({ "node.rate_review": 3, [handshakeNode]: 1 }), "payoutBonus", 0)).toBeCloseTo(0.23, 12);
  });

  const stampsWith = (sharedUpgrades: Record<string, number>) => {
    const ledger = new ScriptedLedger([
      {
        polished: [
          [11, 0],
          [12, -1],
        ],
      },
    ]);
    const sim = sweepSim(ledger, { sharedUpgrades });
    const events = collect(sim);
    runSweep(sim, 40);
    const [player, flock] = payloads(events, "plot.polished");
    return { sim, player: player!, flock: flock! };
  };

  test("Stamp Premium I / II multiply player-credited Stamps only", () => {
    const [m1, m2] = cfg.stampPremiumMult as [number, number];
    const base = cfg.stampBaseLm;
    const none = stampsWith({});
    expect([none.player.stampLm, none.flock.stampLm]).toEqual([base, base]);
    const one = stampsWith({ [premiumNode]: 1 });
    expect([one.player.stampLm, one.flock.stampLm]).toEqual([Math.round(base * m1), base]);
    const two = stampsWith({ [premiumNode]: 2 });
    expect([two.player.stampLm, two.flock.stampLm]).toEqual([Math.round(base * m2), base]);
    expect(two.sim.wallet).toBe(START_WALLET + Math.round(base * m2) + base);
  });

  test("Golden Handshake extends the Premium multiplier to Flock plots", () => {
    const [, m2] = cfg.stampPremiumMult as [number, number];
    const r = stampsWith({ [premiumNode]: 2, [handshakeNode]: 1 });
    expect(r.flock).toMatchObject({ credit: "flock", stampLm: Math.round(cfg.stampBaseLm * m2), charged: false });
    expect(r.player.stampLm).toBe(Math.round(cfg.stampBaseLm * m2));
  });

  test("unknown node ids are ignored, levels clamp to the node's top level; ShiftState mirrors the board", () => {
    const r = stampsWith({ [premiumNode]: 9, "node.not_a_node": 3, "node.rebate": 0 });
    expect(r.player.stampLm).toBe(Math.round(cfg.stampBaseLm * cfg.stampPremiumMult[1]!));
    expect(r.sim.snapshot().shift.sharedUpgrades).toEqual({ [premiumNode]: 2 });
    expect(stampsWith({}).sim.snapshot().shift.sharedUpgrades).toEqual({});
  });

  test("board levels survive a checkpoint and keep paying the Premium", () => {
    const src = sweepSim(new ScriptedLedger([]), { sharedUpgrades: { [premiumNode]: 1, "node.cadence": 2 } });
    runSweep(src, 10);
    const ck = src.captureCheckpoint();
    const ledger = new ScriptedLedger([{ polished: [[5, 0]] }]);
    const dst = makeSim(testWorld(), { ledger });
    dst.addActor(0, PLAYER);
    const events = collect(dst);
    expect(dst.restoreCheckpoint(ck)).toMatchObject({ ok: true, ignoredGearKeys: 0 });
    expect(dst.stateHash()).toBe(src.stateHash());
    expect(dst.snapshot().shift.sharedUpgrades).toEqual({ [premiumNode]: 1, "node.cadence": 2 });
    expect(dst.captureCheckpoint().meta).toEqual(ck.meta);
    runSweep(dst, 20);
    expect(payloads(events, "plot.polished")[0]!.stampLm).toBe(Math.round(cfg.stampBaseLm * cfg.stampPremiumMult[0]!));
  });

  test("board levels are part of the state hash; an empty board hashes like before", () => {
    const a = sweepSim(new ScriptedLedger([]));
    const b = sweepSim(new ScriptedLedger([]), { sharedUpgrades: {} });
    const c = sweepSim(new ScriptedLedger([]), { sharedUpgrades: { [premiumNode]: 1 } });
    expect(b.stateHash()).toBe(a.stateHash());
    expect(c.stateHash()).not.toBe(a.stateHash());
  });
});

describe("polishedCount and Shine milestones", () => {
  test("polishedCount counts Polished plots only, not Empty plots", () => {
    const ledger = new ScriptedLedger([{ polished: [[11, 0]] }, { polished: [[12, 0]] }], 40);
    const sim = sweepSim(ledger);
    const events = collect(sim);
    runSweep(sim, 40);
    expect(payloads(events, "plot.polished").map((p) => p.polishedCount)).toEqual([1, 2]);
    expect(sim.shinePolished).toBe(42); // Shine numerator: Polished + Empty
  });

  test("shine.milestone fires once when a Stamp crosses a plot-bonus.json fraction", () => {
    const fracs = createSimConfig(DATA).shineMilestonesFrac;
    const first = shinePlotsFor(fracs[0]!);
    const ledger = new ScriptedLedger([{ polished: [[11, 0]] }, { polished: [[12, 0]] }], first - 1);
    const sim = sweepSim(ledger);
    const events = collect(sim);
    runSweep(sim, 40);
    const ms = payloads(events, "shine.milestone");
    expect(ms).toEqual([
      {
        tick: payloads(events, "plot.polished")[0]!.tick,
        pct: Math.round(fracs[0]! * 100),
        polishedCount: 1,
        totalPlots: TOTAL_PLOTS,
      },
    ]);
    // Order: the Stamp, then the milestone it caused.
    const names = events.filter((e) => e.name === "plot.polished" || e.name === "shine.milestone").map((e) => e.name);
    expect(names).toEqual(["plot.polished", "shine.milestone", "plot.polished"]);
  });

  test("milestones reached before the sim took the ledger are not announced again", () => {
    const fracs = createSimConfig(DATA).shineMilestonesFrac;
    const ledger = new ScriptedLedger([{ polished: [[11, 0]] }], shinePlotsFor(fracs[1]!) - 1);
    const sim = sweepSim(ledger);
    const events = collect(sim);
    runSweep(sim, 40);
    expect(payloads(events, "shine.milestone").map((m) => m.pct)).toEqual([Math.round(fracs[1]! * 100)]);
  });

  test("the last plot announces 100 % (Contract Fulfilled)", () => {
    const ledger = new ScriptedLedger([{ polished: [[11, 0]] }], TOTAL_PLOTS - 1);
    const sim = sweepSim(ledger);
    const events = collect(sim);
    runSweep(sim, 40);
    expect(payloads(events, "shine.milestone")).toEqual([
      expect.objectContaining({ pct: 100, polishedCount: 1, totalPlots: TOTAL_PLOTS }),
    ]);
  });

  test("a checkpoint restore re-derives the next milestone from the restored dust", () => {
    // The host restores dust chunks next to the sim checkpoint: Shine can jump past a milestone without a Stamp.
    const fracs = createSimConfig(DATA).shineMilestonesFrac;
    const fresh = () => new ScriptedLedger([{ polished: [[91, 0]] }], shinePlotsFor(fracs[0]!) - 1);
    // Control: without the restore, the first Stamp crosses the first milestone and announces it.
    const control = sweepSim(fresh());
    const controlEvents = collect(control);
    runSweep(control, 5);
    expect(payloads(controlEvents, "shine.milestone")).toHaveLength(1);

    const ledger = fresh();
    const sim = sweepSim(ledger);
    const ck = sim.captureCheckpoint();
    const events = collect(sim);
    ledger.queue([], [[90, 0]]); // a restored Polished plot: crosses the first milestone without a Stamp
    ledger.clearPolishedQueue();
    expect(sim.restoreCheckpoint(ck).ok).toBe(true);
    runSweep(sim, 5);
    expect(payloads(events, "plot.polished")).toHaveLength(1);
    expect(payloads(events, "shine.milestone")).toEqual([]);
  });

  test("every plot-bonus.json fraction maps to a pct of the shine.milestone contract", () => {
    for (const f of createSimConfig(DATA).shineMilestonesFrac) {
      expect(SHINE_MILESTONE_PCTS as readonly number[]).toContain(Math.round(f * 100));
    }
  });
});

describe("plot events on the real dust ledger", () => {
  test("a fresh moon: the sweep opens plots credited to the sweeper, nothing is Polished or paid", () => {
    const sim = sweepSim(makeWorldLedger());
    const events = collect(sim);
    runSweep(sim);
    const opened = payloads(events, "plot.opened");
    expect(opened.length).toBeGreaterThan(0);
    expect(new Set(opened.map((o) => o.plotId)).size).toBe(opened.length); // each plot opens once
    for (const o of opened) expect(o.creditedSlot).toBe(0);
    expect(sim.counters.plotsOpened).toBe(opened.length);
    expect(payloads(events, "plot.polished")).toEqual([]);
    expect(sim.wallet).toBe(START_WALLET);
  });

  const edge = edgeOfPolished();

  test("finishing a plot the player cleaned: one player Stamp, paid into the wallet", () => {
    expect(edge.sweptUnits * 2).toBeLessThan(edge.initialUnits); // run B's sweep alone could not earn the credit
    const { ledger, sim, events, polishedAtTick } = runToPolished(edge, true);
    expect(polishedAtTick).toBeGreaterThan(0);
    const polished = payloads(events, "plot.polished");
    const stampLm = stampPayoutLm(sim.config, {
      playerCredited: true,
      chargeFinish: false,
      premiumLevel: 0,
      premiumOnFlock: false,
    });
    expect(polished).toEqual([
      {
        tick: polishedAtTick,
        plotId: edge.plot as PlotId,
        credit: "player",
        creditedSlot: 0,
        stampLm,
        charged: false,
        polishedCount: 1,
      },
    ]);
    expect(stampLm).toBe(sim.config.stampBaseLm);
    expect(sim.wallet).toBe(START_WALLET + stampLm);
    expect(sim.counters.plotsPolished).toBe(1);
    expect(sim.shinePolished).toBe(1);
    expect(ledger.polishedTotal).toBe(1);
    expect(ledger.polishedQueueCount).toBe(0);
    expect(ledger.openedQueueCount).toBe(0);
    // P's Opened state came from the install, before the sim took the ledger: never reported.
    expect(payloads(events, "plot.opened").some((o) => o.plotId === edge.plot)).toBe(false);
  });

  test("Stamp Premium II on the real ledger: the finished plot pays base x 2", () => {
    const { sim, events } = runToPolished(edge, true, { sharedUpgrades: { "node.stamp_premium": 2 } });
    const polished = payloads(events, "plot.polished");
    const lm = Math.round(sim.config.stampBaseLm * sim.config.stampPremiumMult[1]!);
    expect(polished).toEqual([expect.objectContaining({ credit: "player", stampLm: lm, polishedCount: 1 })]);
    expect(sim.wallet).toBe(START_WALLET + lm);
  });

  test("finishing a plot nobody holds the credit for: Flock Stamp at the base rate", () => {
    const { sim, events } = runToPolished(edge, false);
    const polished = payloads(events, "plot.polished");
    expect(polished).toHaveLength(1);
    expect(polished[0]).toMatchObject({ plotId: edge.plot, credit: "flock", creditedSlot: null, charged: false });
    expect(polished[0]!.stampLm).toBe(sim.config.stampBaseLm);
    expect(sim.wallet).toBe(START_WALLET + sim.config.stampBaseLm);
  });

  test("deterministic: the same run gives the same state hash, dust hash and Stamp tick", () => {
    const a = runToPolished(edge, true);
    const b = runToPolished(edge, true);
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
    expect(b.ledger.worldHash()).toBe(a.ledger.worldHash());
    expect(b.polishedAtTick).toBe(a.polishedAtTick);
  });
});

describe("Stamped achievement (M1-W6-T02)", () => {
  const stamped = (events: readonly RoomSimEvent[]) =>
    events
      .filter((e) => e.name === "achievement.unlocked" && e.payload.achievementId === "achievement.stamped")
      .map((e) => (e.name === "achievement.unlocked" ? e.payload.actorSlot : -1));

  test("a player-credited Stamp unlocks Stamped for that player, once", () => {
    const { events, ledger } = runToPolished(edgeOfPolished(), true);
    expect(ledger.polishedTotal).toBeGreaterThan(0);
    expect(stamped(events)).toEqual([0]);
  });

  test("a Flock-credited Stamp unlocks nothing", () => {
    const { events, ledger } = runToPolished(edgeOfPolished(), false);
    expect(ledger.polishedTotal).toBeGreaterThan(0);
    expect(stamped(events)).toEqual([]);
  });
});
