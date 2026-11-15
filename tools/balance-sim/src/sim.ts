// Deterministic MVP pacing simulation (policy `mvp`, progression-and-economy.md sections 22.1-22.5).
//
// The model plays a scripted solo or small-shift player through the MVP economy in fixed time steps, entirely from the
// game-data tables and MVP_SCOPE. It simulates the player's sweep / carry / pour cycle (not strokes), the Trundle haul cycle
// and the Sandpiper robots as rates. A single run uses no random numbers; the Monte Carlo jitter (monte-carlo.ts) draws
// its multipliers from a seeded PRNG, so every report is reproducible from `--seed`.
import { loadGameData, isDaylight, type DayCycle, type GameData } from "@moon-cleanup/game-data";
import { MVP_SCOPE } from "@moon-cleanup/shared";
import { buildCatalog, ROOST_KEY, type Item, type ItemCategory } from "./catalog";
import {
  buildWorldModel,
  kgPerM2,
  MODEL_CONSTANTS,
  passes,
  type DustMix,
  type ModelConstants,
  type WorldModel,
} from "./model";

export type Archetype = "efficient" | "casual";
export type Opening = "scripted" | "greedy";

export interface SimOptions {
  /** Shift members, 1 to 6. Each member buys personal items at Repeat Requisition prices and sweeps the same way. */
  readonly players: number;
  /** Fraction of contract-active time each member is present (co-op-uneven); 1 for every other archetype. */
  readonly attendanceFrac: number;
  readonly archetype: Archetype;
  /** `scripted` mirrors the Induction path, then greedy; `greedy` lets the score pick from minute 0 (efficient only). */
  readonly opening: Opening;
  /** Player skill multiplier on every sweep rate; the casual archetype defaults to 0.7. */
  readonly skill: number;
  /** Monte Carlo multipliers (1 = nominal). */
  readonly crowdMult: number;
  readonly uptimeMult: number;
  readonly dtS: number;
  readonly horizonH: number;
  /** Stop as soon as this milestone key has been marked (speeds up Monte Carlo); default runs to the horizon. */
  readonly stopAfter?: string | undefined;
  /** What-if tables; default is the shipped bundle. */
  readonly data?: GameData;
  readonly constants?: ModelConstants;
}

export function defaultOptions(partial: Partial<SimOptions> = {}): SimOptions {
  const archetype = partial.archetype ?? "efficient";
  return {
    players: 1,
    attendanceFrac: 1,
    archetype,
    opening: "scripted",
    skill: archetype === "casual" ? 0.7 : 1,
    crowdMult: 1,
    uptimeMult: 1,
    dtS: 2,
    horizonH: 12,
    ...partial,
  };
}

export interface PurchaseRecord {
  readonly tS: number;
  readonly id: string;
  readonly label: string;
  readonly category: ItemCategory;
  readonly costLm: number;
}

export interface CurvePoint {
  readonly tS: number;
  readonly walletLm: number;
  readonly incomePerH: number;
  readonly playerM2ps: number;
  readonly robotM2ps: number;
  readonly mode: string;
  readonly polishedM2: number;
}

export interface RunResult {
  readonly options: SimOptions;
  /** Contract seconds at which each milestone first happened. */
  readonly milestonesS: Readonly<Record<string, number>>;
  readonly purchases: readonly PurchaseRecord[];
  readonly curve: readonly CurvePoint[];
  readonly spendByCategory: Readonly<Record<string, number>>;
  readonly totalEarnedLm: number;
  /** Gaps between consecutive purchases, seconds. */
  readonly gapMedianS: number;
  readonly gapMaxS: number;
  /** Set when every MVP item was bought. */
  readonly completedAtS: number | undefined;
  readonly endedAtS: number;
}

interface Stats {
  widthBonus: number;
  depthAdd: number;
  moveBonus: number;
  pourMult: number;
  payoutBonus: number;
  cellCapBonus: number;
  lampLevel: number;
  cellLevel: Map<string, number>;
}

type Levels = ReadonlyMap<string, number>;

interface Mode {
  readonly id: string;
  readonly vehicle: boolean;
}

interface Ctx {
  data: GameData;
  world: WorldModel;
  k: ModelConstants;
  catalog: Item[];
  byId: Map<string, Item>;
  trundle: GameData["vehicles"]["vehicles"][number] | undefined;
  nodeLevels: Map<string, GameData["promotions-board"]["nodes"][number]["levels"]>;
  laneLockMult: Map<string, number>;
  robotRate: number;
  robotUptime: number;
  pourBaseS: number;
  moonKgPerM2: number;
  cycle: DayCycle;
  opts: SimOptions;
  effPlayers: number;
  crowd: number;
}

function buildCtx(opts: SimOptions): Ctx {
  const data = opts.data ?? loadGameData();
  const catalog = buildCatalog(data);
  const sandpiper = data.robots.units.find((u) => u.id === MVP_SCOPE.robotIds[0]);
  if (!sandpiper) throw new Error("MVP robot missing from robots.json");
  const world = buildWorldModel(data);
  const k = opts.constants ?? MODEL_CONSTANTS;
  const effPlayers = Math.max(1e-9, opts.players * opts.attendanceFrac);
  const laneLockMult = new Map<string, number>();
  for (const tool of data.tools.tools) {
    const trait = data.traits.traits.find((t) => t.id === tool.traitId);
    const mult = trait?.params["sweepSpeedMult"];
    if (typeof mult === "number") laneLockMult.set(tool.id, mult);
  }
  return {
    data,
    world,
    k,
    catalog,
    byId: new Map(catalog.map((i) => [i.id, i])),
    trundle: data.vehicles.vehicles.find((v) => v.id === MVP_SCOPE.vehicleIds[0]),
    nodeLevels: new Map(data["promotions-board"].nodes.map((n) => [n.id, n.levels])),
    laneLockMult,
    robotRate: sandpiper.rateM2ps,
    robotUptime: Math.min(1, sandpiper.uptimeManualFrac * opts.uptimeMult),
    pourBaseS: data.logistics.assayCounter.pourS ?? 6,
    moonKgPerM2: kgPerM2(world, world.moonMix),
    cycle: data.world,
    opts,
    effPlayers,
    crowd: 1 + k.crowding * opts.crowdMult * Math.max(0, effPlayers - 1),
  };
}

function statsOf(ctx: Ctx, levels: Levels): Stats {
  const s: Stats = {
    widthBonus: 0,
    depthAdd: 0,
    moveBonus: 0,
    pourMult: 1,
    payoutBonus: 0,
    cellCapBonus: 0,
    lampLevel: levels.get("gear.crown_lamp") ?? 0,
    cellLevel: new Map(),
  };
  for (const [key, level] of levels) {
    if (!key.startsWith("node.") || level <= 0) continue;
    const lvl = ctx.nodeLevels.get(key)?.[level - 1];
    if (!lvl) continue;
    for (const e of lvl.effects) {
      if (e.op === "flag") continue;
      if (e.stat === "toolWidthBonus") s.widthBonus += e.value;
      else if (e.stat === "toolDepthLevels") s.depthAdd += e.value;
      else if (e.stat === "moveSpeedBonus") s.moveBonus += e.value;
      else if (e.stat === "pourTimeMult") s.pourMult *= e.value;
      else if (e.stat === "payoutBonus") s.payoutBonus += e.value;
      else if (e.stat === "cellCapacityBonus") s.cellCapBonus += e.value;
      else if (e.stat.startsWith("cellLevel.")) s.cellLevel.set(e.stat.slice("cellLevel.".length), e.value);
    }
  }
  return s;
}

function toolOf(ctx: Ctx, id: string): GameData["tools"]["tools"][number] {
  const t = ctx.data.tools.tools.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool ${id}`);
  return t;
}

function rawRate(ctx: Ctx, st: Stats, mode: Mode, mix: DustMix): number {
  const { data, k } = ctx;
  if (mode.vehicle) {
    const v = ctx.trundle;
    if (!v) return 0;
    return (v.widthM * v.cruiseMps * k.vehicleCoverage) / passes(mix, v.depthLevels, k.vehicleCoverage);
  }
  const tool = toolOf(ctx, mode.id);
  const width = tool.widthM * (1 + st.widthBonus);
  const speed = data.movement.sweepWalkMps * (1 + st.moveBonus) * (ctx.laneLockMult.get(mode.id) ?? 1);
  return (width * speed * k.handCoverage) / passes(mix, tool.depthLevels + st.depthAdd, k.handCoverage);
}

function capacityKg(ctx: Ctx, st: Stats, mode: Mode): number {
  if (mode.vehicle) return ctx.trundle?.payloadKg ?? 0;
  const tool = toolOf(ctx, mode.id);
  const lvl = st.cellLevel.get(mode.id) ?? 0;
  const mult = lvl > 0 ? (ctx.data["dust-cells"].levelMult[lvl - 1] ?? 1) : 1;
  return tool.cellBaseKg * mult * (1 + st.cellCapBonus);
}

function tripS(ctx: Ctx, st: Stats, mode: Mode, apron: boolean, outsideM2PerPlayer: number): number {
  if (mode.vehicle) return ctx.k.vehicleTripS;
  const d = apron ? ctx.k.apronTripM : ctx.k.outpostTripBaseM + Math.sqrt(outsideM2PerPlayer / Math.PI);
  return (2 * d) / (ctx.data.movement.walkMps * (1 + st.moveBonus)) + ctx.pourBaseS * st.pourMult;
}

function nightFactor(ctx: Ctx, st: Stats, mode: Mode, lit: boolean): number {
  if (lit) return 1;
  const relief = mode.vehicle ? 0 : ctx.data.movement.lampPenaltyReliefFrac * st.lampLevel;
  return 1 - Math.max(0, ctx.data.movement.nightPenaltyFrac - relief);
}

function ownedModes(ctx: Ctx, levels: Levels): Mode[] {
  const modes: Mode[] = [];
  for (const id of MVP_SCOPE.toolIds) {
    if (toolOf(ctx, id).priceLm === 0 || (levels.get(id) ?? 0) >= 1) modes.push({ id, vehicle: false });
  }
  if (ctx.trundle && (levels.get(ctx.trundle.id) ?? 0) >= 1) modes.push({ id: ctx.trundle.id, vehicle: true });
  return modes;
}

interface Steady {
  mode: Mode;
  netM2ps: number;
}

/** Best owned mode by net rate (rate x night x duty); `lit` null = day average (the greedy score's view). */
function bestMode(
  ctx: Ctx,
  levels: Levels,
  st: Stats,
  mix: DustMix,
  apron: boolean,
  outsideM2PerPlayer: number,
  lit: boolean | null,
): Steady {
  const kg = kgPerM2(ctx.world, mix);
  let best: Steady | undefined;
  for (const mode of ownedModes(ctx, levels)) {
    const raw = rawRate(ctx, st, mode, mix) * ctx.opts.skill;
    const nf = lit === null ? 0.5 + 0.5 * nightFactor(ctx, st, mode, false) : nightFactor(ctx, st, mode, lit);
    const eff = (raw * nf) / ctx.crowd;
    const fill = capacityKg(ctx, st, mode) / (eff * kg);
    const trip = tripS(ctx, st, mode, apron, outsideM2PerPlayer);
    const net = (eff * fill) / (fill + trip);
    if (!best || net > best.netM2ps) best = { mode, netM2ps: net };
  }
  if (!best) throw new Error("no usable tool");
  return best;
}

function robotM2ps(ctx: Ctx, levels: Levels): number {
  return (levels.get(ROOST_KEY) ?? 0) * ctx.robotRate * ctx.robotUptime;
}

/** Steady income in LM/s for a set of owned levels (day-averaged night), as the greedy score sees it. */
function steadyIncomePerS(ctx: Ctx, levels: Levels, apronDone: boolean, outsideM2PerPlayer: number): number {
  const st = statsOf(ctx, levels);
  const mix = apronDone ? ctx.world.outpostMix : ctx.world.apronMix;
  const player = bestMode(ctx, levels, st, mix, !apronDone, outsideM2PerPlayer, null);
  const lmPerKg = ctx.world.dustLmPerKg * (1 + st.payoutBonus);
  const stampPerM2 = apronDone
    ? (ctx.k.polishedFrac * ctx.world.stampLm) / ctx.world.plotM2
    : ctx.world.stampLm / ctx.world.apronPlotM2;
  const playerLm = ctx.effPlayers * player.netM2ps * (kgPerM2(ctx.world, mix) * lmPerKg + stampPerM2);
  const robotLm = robotM2ps(ctx, levels) * (ctx.moonKgPerM2 * lmPerKg + ctx.world.stampLm / ctx.world.plotM2);
  return playerLm + robotLm;
}

function priceOf(ctx: Ctx, item: Item): number {
  const mult = item.personal ? 1 + ctx.data.economy.repeatRequisitionFrac * (ctx.opts.players - 1) : 1;
  return Math.round(item.basePriceLm * mult);
}

/** Induction/Probation-style opening (progression-and-economy section 22.5, minus the Puck Former kit and Assembly Gun). */
const SCRIPTED_OPENING = [
  "tool.crescent_squeegee@1",
  "node.dust_cell_crescent_squeegee@1",
  "tool.bristle_broom@1",
  "node.dust_cell_bristle_broom@1",
  "gear.crown_lamp@1",
  "gear.holster_rig@1",
  "tool.lane_broom@1",
  "vehicle.trundle@1",
  `${ROOST_KEY}@1`,
];

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Runs one deterministic simulation. */
export function runMvp(partial: Partial<SimOptions> = {}): RunResult {
  const opts = defaultOptions(partial);
  const ctx = buildCtx(opts);
  const { world, k } = ctx;
  const dt = opts.dtS;
  const horizonS = opts.horizonH * 3600;

  const levels = new Map<string, number>();
  let stats = statsOf(ctx, levels);
  let wallet = 0;
  let earned = 0;
  let t = 0;
  let apronPlotsDone = 0;
  let apronProgressM2 = 0;
  let outsideM2 = 0;
  let polishedM2 = 0;
  let load = 0;
  let loadMode = "";
  let busyS = k.promptsS;
  let parcelS = 0;
  let pendingKg = 0;
  /** Dust left in the previous tool's Cell when the player switches tools: poured with the next trip (nothing is lost). */
  let carriedKg = 0;
  let nextParcel = 0;
  const milestones: Record<string, number> = {};
  const purchases: PurchaseRecord[] = [];
  const curve: CurvePoint[] = [];
  const spend: Record<string, number> = {};
  const mark = (name: string): void => {
    if (milestones[name] === undefined) milestones[name] = t;
  };
  const earn = (lm: number): void => {
    wallet += lm;
    earned += lm;
  };

  let queue: string[] = [];
  if (opts.archetype === "casual") queue = [...ctx.catalog].sort((a, b) => a.listOrder - b.listOrder).map((i) => i.id);
  else if (opts.opening === "scripted") queue = [...SCRIPTED_OPENING];

  const apronDone = (): boolean => apronPlotsDone >= world.apronPlots;
  const outsidePerPlayer = (): number => outsideM2 / Math.max(1, opts.players);
  const available = (item: Item): boolean =>
    (levels.get(item.key) ?? 0) === item.level - 1 && item.prereqs.every((p) => (levels.get(p.key) ?? 0) >= p.level);

  const buy = (item: Item, cost: number): void => {
    wallet -= cost;
    levels.set(item.key, item.level);
    stats = statsOf(ctx, levels);
    purchases.push({ tS: t, id: item.id, label: item.label, category: item.category, costLm: cost });
    spend[item.category] = (spend[item.category] ?? 0) + cost;
    mark(`buy:${item.id}`);
    if (item.category === "tool") mark("first_tool_upgrade");
    if (item.category === "cell") mark("first_dust_cell");
    if (item.category === "vehicle") mark("first_vehicle");
    if (item.category === "robot") mark(item.level === 1 ? "first_roost" : `roost_${item.level}`);
    if (item.key === "gear.crown_lamp") mark("first_clip_light");
  };

  /** Returns true when something was bought (caller loops until nothing is). */
  const decideOnce = (): boolean => {
    const head = queue[0];
    if (head !== undefined) {
      const item = ctx.byId.get(head);
      if (!item) throw new Error(`unknown queued item ${head}`);
      if ((levels.get(item.key) ?? 0) >= item.level) {
        queue.shift();
        return true;
      }
      if (!available(item)) {
        // Casual list order can reach an item before its prerequisite is queued: skip it for later.
        queue.push(queue.shift() as string);
        return false;
      }
      const cost = priceOf(ctx, item);
      if (wallet + 1e-9 < cost) return false;
      buy(item, cost);
      queue.shift();
      return true;
    }
    if (opts.archetype === "casual") return false;
    const candidates = ctx.catalog.filter(available);
    if (candidates.length === 0) return false;
    const out = outsidePerPlayer();
    const done = apronDone();
    const income = steadyIncomePerS(ctx, levels, done, out);
    const walletMult = t / 3600 >= k.nonRateRelaxAfterH ? k.nonRateWalletMultLate : k.nonRateWalletMult;
    let best: { item: Item; cost: number; score: number } | undefined;
    const nonRate: { item: Item; cost: number }[] = [];
    for (const item of candidates) {
      const cost = priceOf(ctx, item);
      const delta = steadyIncomePerS(ctx, new Map(levels).set(item.key, item.level), done, out) - income;
      if (delta <= 1e-12) {
        nonRate.push({ item, cost });
        continue;
      }
      const score = Math.max(0, cost - wallet) / Math.max(income, 1e-9) + cost / delta;
      if (!best || score < best.score - 1e-12 || (Math.abs(score - best.score) <= 1e-12 && cost < best.cost)) {
        best = { item, cost, score };
      }
    }
    if (best && wallet + 1e-9 >= best.cost) {
      buy(best.item, best.cost);
      return true;
    }
    nonRate.sort((a, b) => a.cost - b.cost);
    const cheap = nonRate.find((n) => wallet >= walletMult * n.cost);
    if (cheap) {
      buy(cheap.item, cheap.cost);
      return true;
    }
    return false;
  };
  const decide = (): void => {
    for (let guard = 0; guard < 64 && decideOnce(); guard += 1);
  };

  const advancePlayer = (): void => {
    let left = dt;
    for (let guard = 0; left > 1e-9 && guard < 64; guard += 1) {
      if (busyS > 0) {
        const c = Math.min(left, busyS);
        busyS -= c;
        left -= c;
        if (busyS <= 1e-9) {
          busyS = 0;
          if (pendingKg > 0) {
            earn(pendingKg * opts.players * opts.attendanceFrac * world.dustLmPerKg * (1 + stats.payoutBonus));
            mark("first_sale");
            pendingKg = 0;
          }
        }
        continue;
      }
      if (parcelS > 0) {
        const c = Math.min(left, parcelS);
        parcelS -= c;
        left -= c;
        continue;
      }
      const apron = !apronDone();
      const mix = apron ? world.apronMix : world.outpostMix;
      const lit = isDaylight(ctx.cycle, t + (dt - left));
      const best = bestMode(ctx, levels, stats, mix, apron, outsidePerPlayer(), lit);
      if (loadMode !== best.mode.id) {
        loadMode = best.mode.id;
        carriedKg += load;
        load = 0;
      }
      const eff =
        (rawRate(ctx, stats, best.mode, mix) * opts.skill * nightFactor(ctx, stats, best.mode, lit)) / ctx.crowd;
      const kg = kgPerM2(world, mix);
      const cap = capacityKg(ctx, stats, best.mode);
      const tFill = (cap - load) / (eff * kg);
      const tPlot = apron ? (world.apronPlotM2 - apronProgressM2) / (eff * ctx.effPlayers) : Infinity;
      const seg = Math.min(left, tFill, tPlot);
      const areaPerPlayer = eff * seg;
      const area = areaPerPlayer * ctx.effPlayers;
      load += areaPerPlayer * kg;
      left -= seg;
      if (apron) {
        apronProgressM2 += area;
        if (apronProgressM2 >= world.apronPlotM2 - 1e-9) {
          apronProgressM2 = 0;
          apronPlotsDone += 1;
          polishedM2 += world.apronPlotM2;
          earn(world.stampLm);
          mark(apronPlotsDone === 1 ? "first_stamp" : `apron_plot_${apronPlotsDone}`);
          if (apronDone()) mark("apron_complete");
        }
      } else {
        outsideM2 += area;
        polishedM2 += area * k.polishedFrac;
        earn((area * k.polishedFrac * world.stampLm) / world.plotM2);
      }
      if (load >= cap - 1e-9) {
        pendingKg = load + carriedKg;
        carriedKg = 0;
        load = 0;
        busyS = tripS(ctx, stats, best.mode, apron, outsidePerPlayer());
      }
    }
  };

  const allDone = (): boolean => ctx.catalog.every((i) => (levels.get(i.key) ?? 0) >= i.level);
  const parcelCount = Math.min(k.parcelTimesMin.length, MVP_SCOPE.nearParcelCount);
  let completedAtS: number | undefined;
  let nextSample = 0;

  while (t < horizonS) {
    while (nextParcel < parcelCount && t >= (k.parcelTimesMin[nextParcel] as number) * 60) {
      parcelS += k.parcelCollectS / Math.max(1, ctx.effPlayers);
      earn(ctx.data.collectibles.strayCargo.find((c) => c.size === "near_parcel")?.lm ?? 0);
      nextParcel += 1;
    }
    // Robots: continuous base rate, independent of players and activity (section 9.3).
    const robotArea = robotM2ps(ctx, levels) * dt;
    if (robotArea > 0) {
      earn(robotArea * (ctx.moonKgPerM2 * world.dustLmPerKg * (1 + stats.payoutBonus) + world.stampLm / world.plotM2));
      polishedM2 += robotArea;
    }
    advancePlayer();
    t += dt;
    decide();
    if (t >= nextSample) {
      const mix = apronDone() ? world.outpostMix : world.apronMix;
      const sel = bestMode(ctx, levels, stats, mix, !apronDone(), outsidePerPlayer(), null);
      curve.push({
        tS: t,
        walletLm: Math.round(wallet),
        incomePerH: Math.round(steadyIncomePerS(ctx, levels, apronDone(), outsidePerPlayer()) * 3600),
        playerM2ps: round3(sel.netM2ps * ctx.effPlayers),
        robotM2ps: round3(robotM2ps(ctx, levels)),
        mode: sel.mode.id,
        polishedM2: Math.round(polishedM2),
      });
      nextSample += 300;
    }
    if (opts.stopAfter !== undefined && milestones[opts.stopAfter] !== undefined) break;
    if (allDone()) {
      completedAtS = t;
      mark("all_mvp_items");
      break;
    }
  }

  const gaps: number[] = [];
  for (let i = 1; i < purchases.length; i += 1) {
    gaps.push((purchases[i] as PurchaseRecord).tS - (purchases[i - 1] as PurchaseRecord).tS);
  }
  gaps.sort((a, b) => a - b);
  return {
    options: opts,
    milestonesS: milestones,
    purchases,
    curve,
    spendByCategory: spend,
    totalEarnedLm: Math.round(earned),
    gapMedianS: gaps.length === 0 ? 0 : (gaps[Math.floor((gaps.length - 1) / 2)] as number),
    gapMaxS: gaps.length === 0 ? 0 : (gaps[gaps.length - 1] as number),
    completedAtS,
    endedAtS: t,
  };
}
