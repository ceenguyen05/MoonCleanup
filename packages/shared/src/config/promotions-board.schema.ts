// @contract config/promotions-board.schema v1.1
// @consumers packages/game-data (data/promotions-board.json), packages/sim (node effects), apps/client (Ops Console),
//   tools/balance-sim
//
// `promotions-board.json`: hub + 5 departments, 23 nodes (progression-and-economy.md section 21, naming bible
// section 5). Reference mode: nodes are bought with money; the only prerequisites are ordinary tree dependencies
// (`prereqs`), never cleaned-% or Review gates.
//
// v1.1 (additive for data; the inferred prereq type widens): a `prereqs` entry is `{nodeId, level}` or
// `{anyOf: [{nodeId, level}, ...]}` (at least 2 alternatives). All entries are required; an `anyOf` entry is met when
// any one alternative is met. `DUST_CELL_NODE_ID_PREFIX` names the per-tool Dust Cell nodes.

import { z } from "zod";
import {
  CostLevelSchema,
  GameDataSchemaVersionSchema,
  PositiveCountSchema,
  prefixedId,
  uniqueIdArray,
  uniqueStringArray,
} from "./common.schema";

export const NodeIdSchema = prefixedId("node");
export const DepartmentIdSchema = prefixedId("department");

export const PROMOTION_NODE_KINDS = ["root", "secondary", "capstone"] as const;
export type PromotionNodeKind = (typeof PROMOTION_NODE_KINDS)[number];

/** Level count per node kind (locked structure: 3 / 2 / 1). */
export const PROMOTION_NODE_LEVEL_COUNTS: Readonly<Record<PromotionNodeKind, number>> = {
  root: 3,
  secondary: 2,
  capstone: 1,
};

/**
 * Id prefix of the Dust Cell node of a cleaning tool: `tool.<x>` has `node.dust_cell_<x>`, whose level costs equal
 * `dust-cells.costsLm["tool.<x>"]` (checked by the bundle).
 */
export const DUST_CELL_NODE_ID_PREFIX = "node.dust_cell_";

/** One required node level. */
export const NodeLevelPrereqSchema = z.strictObject({
  nodeId: NodeIdSchema,
  /** Required owned level of `nodeId` (1-based). */
  level: PositiveCountSchema,
});
export type NodeLevelPrereq = z.infer<typeof NodeLevelPrereqSchema>;

/** Met when any one alternative is met (Overflow Former: "any Cell line at level III"). */
export const NodeAnyOfPrereqSchema = z.strictObject({
  anyOf: z.array(NodeLevelPrereqSchema).min(2),
});
export type NodeAnyOfPrereq = z.infer<typeof NodeAnyOfPrereqSchema>;

/** A `prereqs` entry: a single node level, or a choice between node levels. */
export const NodePrereqSchema = z.union([NodeLevelPrereqSchema, NodeAnyOfPrereqSchema]);
export type NodePrereq = z.infer<typeof NodePrereqSchema>;

/** Every node level a prereq entry names (one for a plain entry, each alternative for `anyOf`). */
function prereqLevels(prereq: NodePrereq): readonly NodeLevelPrereq[] {
  return "anyOf" in prereq ? prereq.anyOf : [prereq];
}

export const PromotionNodeSchema = z
  .strictObject({
    id: NodeIdSchema,
    departmentId: DepartmentIdSchema,
    kind: z.enum(PROMOTION_NODE_KINDS),
    levels: z.array(CostLevelSchema).min(1),
    prereqs: z.array(NodePrereqSchema),
  })
  .superRefine((node, ctx) => {
    if (node.levels.length !== PROMOTION_NODE_LEVEL_COUNTS[node.kind]) {
      ctx.addIssue({
        code: "custom",
        message: `a ${node.kind} node has ${PROMOTION_NODE_LEVEL_COUNTS[node.kind]} levels`,
        path: ["levels"],
      });
    }
  });
export type PromotionNodeDef = z.infer<typeof PromotionNodeSchema>;

export const DepartmentSchema = z.strictObject({
  id: DepartmentIdSchema,
  nodeIds: uniqueStringArray(NodeIdSchema).min(1),
});
export type DepartmentDef = z.infer<typeof DepartmentSchema>;

export const PromotionsBoardSchema = z
  .strictObject({
    schemaVersion: GameDataSchemaVersionSchema,
    /** Hub node (Employee Badge), owned from the start at level 1; not listed in `nodes`. */
    hubId: NodeIdSchema,
    departments: uniqueIdArray(DepartmentSchema).min(1),
    nodes: uniqueIdArray(PromotionNodeSchema).min(1),
  })
  .superRefine((board, ctx) => {
    const nodes = new Map(board.nodes.map((n) => [n.id, n]));
    const departments = new Map(board.departments.map((d) => [d.id, d]));
    if (nodes.has(board.hubId)) {
      ctx.addIssue({ code: "custom", message: "hubId must not be listed in nodes", path: ["hubId"] });
    }
    const listed = new Map<string, string>();
    board.departments.forEach((dept, d) => {
      dept.nodeIds.forEach((nodeId, i) => {
        const node = nodes.get(nodeId);
        if (node === undefined || node.departmentId !== dept.id || listed.has(nodeId)) {
          ctx.addIssue({
            code: "custom",
            message: `node "${nodeId}" is unknown, in another department or listed twice`,
            path: ["departments", d, "nodeIds", i],
          });
        }
        listed.set(nodeId, dept.id);
      });
    });
    board.nodes.forEach((node, n) => {
      if (!departments.has(node.departmentId) || !listed.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          message: `node "${node.id}" must be listed by its department "${node.departmentId}"`,
          path: ["nodes", n, "departmentId"],
        });
      }
      node.prereqs.forEach((prereq, p) => {
        const isAnyOf = "anyOf" in prereq;
        prereqLevels(prereq).forEach((ref, a) => {
          const target = nodes.get(ref.nodeId);
          const maxLevel = ref.nodeId === board.hubId ? 1 : target?.levels.length;
          if (ref.nodeId === node.id || maxLevel === undefined || ref.level > maxLevel) {
            ctx.addIssue({
              code: "custom",
              message: `prereq "${ref.nodeId}" level ${ref.level} does not exist`,
              path: isAnyOf ? ["nodes", n, "prereqs", p, "anyOf", a] : ["nodes", n, "prereqs", p],
            });
          }
        });
      });
    });
    // Prerequisite graph must be acyclic (iterative three-colour DFS). Every `anyOf` alternative counts as an edge,
    // so no alternative may depend on the node that names it.
    const edges = new Map(
      board.nodes.map((n) => [n.id, n.prereqs.flatMap((p) => prereqLevels(p).map((r) => r.nodeId))]),
    );
    const state = new Map<string, 1 | 2>();
    for (const start of board.nodes) {
      if (state.has(start.id)) continue;
      const stack: { id: string; next: number }[] = [{ id: start.id, next: 0 }];
      state.set(start.id, 1);
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top === undefined) break;
        const targetId = edges.get(top.id)?.[top.next];
        if (targetId === undefined) {
          state.set(top.id, 2);
          stack.pop();
          continue;
        }
        top.next += 1;
        if (!nodes.has(targetId)) continue;
        const seen = state.get(targetId);
        if (seen === 1) {
          ctx.addIssue({ code: "custom", message: `prerequisite cycle through "${targetId}"`, path: ["nodes"] });
          return;
        }
        if (seen === undefined) {
          state.set(targetId, 1);
          stack.push({ id: targetId, next: 0 });
        }
      }
    }
  });
export type PromotionsBoardTable = z.infer<typeof PromotionsBoardSchema>;
