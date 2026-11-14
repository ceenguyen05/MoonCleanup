// MVP purchase catalog: every item the MVP build sells (MVP_SCOPE) as (key, level) pairs with a base price and its
// prerequisites, read from the game-data tables. One item = one level of one key, bought in order.
import { MVP_SCOPE } from "@moon-cleanup/shared";
import { displayName, type GameData } from "@moon-cleanup/game-data";

export type ItemCategory = "tool" | "cell" | "board" | "gear" | "vehicle" | "robot";

export interface Item {
  /** `key@level`, e.g. `node.broad_strokes@2`. */
  readonly id: string;
  readonly key: string;
  readonly level: number;
  readonly label: string;
  readonly category: ItemCategory;
  /** List price for one buyer before the Repeat Requisition scaling of `personal` items. */
  readonly basePriceLm: number;
  /** Personal items (tier >= 4 tools, vehicles) cost list x (1 + 0.4 (N - 1)) for N members (economy section 19.4). */
  readonly personal: boolean;
  readonly prereqs: readonly { readonly key: string; readonly level: number }[];
  /** Position in the Requisitions-style list used by the casual archetype. */
  readonly listOrder: number;
}

export const itemId = (key: string, level: number): string => `${key}@${level}`;
export const ROOST_KEY = "robot.roost";

export function buildCatalog(data: GameData): Item[] {
  const items: Item[] = [];
  const push = (it: Omit<Item, "id" | "listOrder">): void => {
    items.push({ ...it, id: itemId(it.key, it.level), listOrder: items.length });
  };
  const board = data["promotions-board"];
  const badge = board.hubId;
  const nodeById = new Map(board.nodes.map((n) => [n.id, n]));

  // Requisitions Desk: tools T2..T4 (T1 is free and owned), then suit gear.
  for (const toolId of MVP_SCOPE.toolIds) {
    const tool = data.tools.tools.find((t) => t.id === toolId);
    if (!tool || tool.priceLm === 0) continue;
    push({
      key: toolId,
      level: 1,
      label: displayName(toolId),
      category: "tool",
      basePriceLm: tool.priceLm,
      personal: tool.tier >= data.economy.repeatRequisitionMinTier,
      prereqs: [],
    });
  }
  for (const [gearId, maxLevel] of Object.entries(MVP_SCOPE.suitGearMaxLevel)) {
    const line = data["suit-gear"].lines.find((l) => l.id === gearId);
    if (!line) continue;
    line.levels.slice(0, maxLevel).forEach((lvl, i) => {
      push({
        key: gearId,
        level: i + 1,
        label: `${displayName(gearId)} ${i + 1}`,
        category: "gear",
        basePriceLm: lvl.costLm,
        personal: false,
        prereqs: i === 0 ? [] : [{ key: gearId, level: i }],
      });
    });
  }

  // Motor Pool (pre-built): the Trundle. Equipment Card: the Roost.
  for (const vehicleId of MVP_SCOPE.vehicleIds) {
    const vehicle = data.vehicles.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) continue;
    push({
      key: vehicleId,
      level: 1,
      label: displayName(vehicleId),
      category: "vehicle",
      basePriceLm: vehicle.priceLm,
      personal: true,
      prereqs: [],
    });
  }
  const roost = data.robots.roost;
  for (let n = 1; n <= MVP_SCOPE.roostCap; n += 1) {
    push({
      key: ROOST_KEY,
      level: n,
      label: `Roost #${n}`,
      category: "robot",
      // MVP has no rails: no `railAllowanceLm` (the Roost Uplink stands in for the rail run).
      basePriceLm: Math.round(roost.basePriceLm * roost.priceGrowthMult ** (n - 1)),
      personal: false,
      prereqs: n === 1 ? [] : [{ key: ROOST_KEY, level: n - 1 }],
    });
  }

  // Ops Console: the 10 MVP board nodes, every level (Cell nodes capped at the MVP Cell level).
  for (const nodeId of MVP_SCOPE.boardNodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error(`MVP_SCOPE node missing: ${nodeId}`);
    const isCell = nodeId.startsWith("node.dust_cell_");
    const maxLevel = isCell ? MVP_SCOPE.dustCellMaxLevel : node.levels.length;
    node.levels.slice(0, maxLevel).forEach((lvl, i) => {
      const prereqs: { key: string; level: number }[] = [];
      if (i > 0) prereqs.push({ key: nodeId, level: i });
      for (const p of node.prereqs) {
        if ("anyOf" in p) throw new Error(`anyOf prereq on MVP node ${nodeId} is not modelled`);
        if (p.nodeId !== badge) prereqs.push({ key: p.nodeId, level: p.level });
      }
      push({
        key: nodeId,
        level: i + 1,
        label: `${displayName(nodeId)} ${i + 1}`,
        category: isCell ? "cell" : "board",
        basePriceLm: lvl.costLm,
        personal: false,
        prereqs,
      });
    });
  }
  return items;
}
