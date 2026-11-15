// Pure view-model of the Requisitions Desk, Ops Console, Plot Card and compass. Reads store slice data and returns what
// the screen shows. Unknown catalog ids (item, node, department, terrain) yield `null`: raw ids never reach players.

import type { UiBoardNode, UiDeskItem, UiHolsterState, UiNextRequisitionState } from "@moon-cleanup/shared";
import { STRINGS, formatString } from "../strings";

const M = STRINGS.menus;
const lookup = (table: object, key: string): string | null =>
  (table as Readonly<Record<string, string | undefined>>)[key] ?? null;

export const itemName = (itemId: string): string | null =>
  lookup(STRINGS.tools, itemId) ?? lookup(STRINGS.menus.desk.gearNames, itemId);
export const itemBlurb = (itemId: string): string | null => lookup(M.desk.blurbs, itemId);
export const nodeName = (nodeId: string): string | null => lookup(M.console.nodes, nodeId);
export const departmentName = (id: string): string | null => lookup(M.console.departments, id);

export type RowStatus =
  | { readonly kind: "buy" }
  | { readonly kind: "owned" }
  | { readonly kind: "maxed" }
  | { readonly kind: "processing" }
  | { readonly kind: "locked"; readonly text: string }
  | { readonly kind: "short"; readonly text: string; readonly missingLm: number };

/** Lumens the player can spend right now: the wallet minus purchases still waiting for the server. */
export const availableLm = (wallet: { readonly lm: number; readonly pendingSpendLm: number }): number =>
  Math.max(0, wallet.lm - wallet.pendingSpendLm);

const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const lm = (value: number): string => INTEGER.format(Math.round(value));

function needsText(
  template: string,
  other: string,
  ids: readonly string[],
  name: (id: string) => string | null,
): string {
  const names = ids.map((id) => name(id) ?? other);
  return formatString(template, { names: names.join(", ") });
}

export function deskRowStatus(item: UiDeskItem, available: number, processing: boolean): RowStatus {
  if (item.levelOwned >= item.levelMax) return { kind: item.levelMax <= 1 ? "owned" : "maxed" };
  if (item.requires.length > 0)
    return { kind: "locked", text: needsText(M.desk.needs, M.desk.needsOther, item.requires, itemName) };
  if (processing) return { kind: "processing" };
  if (available < item.priceLm) {
    const missingLm = item.priceLm - available;
    return { kind: "short", missingLm, text: formatString(M.desk.needMore, { amount: lm(missingLm) }) };
  }
  return { kind: "buy" };
}

export function nodeRowStatus(node: UiBoardNode, available: number): RowStatus {
  if (node.nextCostLm === null || node.level >= node.max) return { kind: "maxed" };
  if (!node.prereqMet)
    return { kind: "locked", text: needsText(M.console.needs, M.console.needsOther, node.requires, nodeName) };
  if (available < node.nextCostLm) {
    const missingLm = node.nextCostLm - available;
    return { kind: "short", missingLm, text: formatString(M.console.needMore, { amount: lm(missingLm) }) };
  }
  return { kind: "buy" };
}

/** Name of the tool a purchase of `item` would replace in hand (1-slot Holster, no Rig); `null` otherwise. */
export function replacedToolName(
  item: UiDeskItem,
  holster: Pick<UiHolsterState, "slotCount" | "slots" | "active">,
): string | null {
  if (item.category !== "tool" || item.levelOwned > 0 || holster.slotCount > 1) return null;
  const inHand = holster.slots[holster.active];
  if (inHand === undefined || !inHand.owned || inHand.toolId === null || inHand.toolId === item.itemId) return null;
  return itemName(inHand.toolId);
}

export interface DeskGroup {
  readonly category: UiDeskItem["category"];
  readonly items: readonly UiDeskItem[];
}

/** Items with a known name, grouped by category in Desk order. */
export function groupDesk(items: readonly UiDeskItem[]): DeskGroup[] {
  const order = ["tool", "gear", "vehicle", "other"] as const;
  return order
    .map((category) => ({
      category,
      items: items.filter((item) => item.category === category && itemName(item.itemId) !== null),
    }))
    .filter((group) => group.items.length > 0);
}

export interface BoardGroup {
  readonly departmentId: string;
  readonly nodes: readonly UiBoardNode[];
}

export function groupBoard(nodes: readonly UiBoardNode[]): BoardGroup[] {
  const groups: BoardGroup[] = [];
  for (const node of nodes) {
    if (nodeName(node.nodeId) === null || departmentName(node.departmentId) === null) continue;
    const group = groups.find((candidate) => candidate.departmentId === node.departmentId);
    if (group === undefined) groups.push({ departmentId: node.departmentId, nodes: [node] });
    else (group.nodes as UiBoardNode[]).push(node);
  }
  return groups;
}

/** Display name of the Next Requisition target (tools and gear). */
export const nextRequisitionName = (next: Pick<UiNextRequisitionState, "itemId">): string | null =>
  next.itemId === null ? null : itemName(next.itemId);

// ---- compass --------------------------------------------------------------------------------------------------------

export const COMPASS_PX_PER_DEG = 3;
export const COMPASS_CYCLE_PX = 360 * COMPASS_PX_PER_DEG;

/** Whole-pixel translateX of the compass track (origin at the strip centre; middle copy of three) for a heading. */
export function compassShiftPx(headingDeg: number): number {
  const wrapped = Number.isFinite(headingDeg) ? ((headingDeg % 360) + 360) % 360 : 0;
  return -Math.round((360 + wrapped) * COMPASS_PX_PER_DEG);
}

/** Ping count text; `null` for none. */
export function pingText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? M.compass.ping : formatString(M.compass.pings, { count });
}
