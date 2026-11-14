// @contract config/bundle.schema v1.2
// @consumers packages/game-data (loads every data file and validates the whole set, M1), tools/balance-sim
//
// Maps every baseline table file to its schema and validates cross-table references once all tables are loaded
// (progression-and-economy.md section 21). game-data parses `{ [table]: json }` with `GameDataBundleSchema`.
//
// Cross-table rules: tool traits exist; every cleaning tool has Dust Cell costs and only tools do; vehicle upgrade
// lines exist; recipe materials exist; every flag effect names a registered feature; piece ids used by vehicles,
// logistics, production and power exist in build-pieces at the same price; Bale acceptors are build pieces;
// Probation suggestions name a known id; shared constants (Stamp base, puck/stack/Bale kg) agree across tables.
// v1.1 adds: each cleaning tool `tool.<x>` has a Dust Cell node `node.dust_cell_<x>` (and each such node has a tool)
// whose level costs equal `dust-cells.costsLm`; Roost, Nest and Field Gate build pieces exist at `roost.basePriceLm`,
// `nest.priceLm` and `fieldGate.priceLm`; `trait.charge` exists and its `finishStampMult` equals
// `plot-bonus.chargeFinishMult`.
// v1.2 (no new rules): the bundle type tightens because robots, economy, movement, logistics and pacing-targets
// make their v1.1 fields required (see those files).

import { z } from "zod";
import type { Effect, GameDataTable } from "./common.schema";
import { AchievementsSchema } from "./achievements.schema";
import { BuildPiecesSchema } from "./build-pieces.schema";
import { CapsSchema } from "./caps.schema";
import { CollectiblesSchema } from "./collectibles.schema";
import { DustCellsSchema } from "./dust-cells.schema";
import { EconomySchema } from "./economy.schema";
import { FeaturesSchema } from "./features.schema";
import { FIELD_GATE_PIECE_ID, LogisticsSchema } from "./logistics.schema";
import { ModerationSchema } from "./moderation.schema";
import { MovementSchema } from "./movement.schema";
import { OnboardingSchema } from "./onboarding.schema";
import { PacingTargetsSchema } from "./pacing-targets.schema";
import { PlotBonusSchema } from "./plot-bonus.schema";
import { PowerSchema } from "./power.schema";
import { ProductionSchema } from "./production.schema";
import { DUST_CELL_NODE_ID_PREFIX, PromotionsBoardSchema } from "./promotions-board.schema";
import { NEST_PIECE_ID, ROOST_PIECE_ID, RobotsSchema } from "./robots.schema";
import { SuitGearSchema } from "./suit-gear.schema";
import { BUILD_TOOL_TIER, ToolsSchema } from "./tools.schema";
import { CHARGE_FINISH_STAMP_PARAM, CHARGE_TRAIT_ID, TraitsSchema } from "./traits.schema";
import { VehicleUpgradesSchema } from "./vehicle-upgrades.schema";
import { VehiclesSchema } from "./vehicles.schema";
import { WorldSchema } from "./world.schema";

/** Schema of each baseline table file `packages/game-data/data/<table>.json`. */
export const GAME_DATA_TABLE_SCHEMAS = {
  world: WorldSchema,
  economy: EconomySchema,
  movement: MovementSchema,
  tools: ToolsSchema,
  traits: TraitsSchema,
  "dust-cells": DustCellsSchema,
  "promotions-board": PromotionsBoardSchema,
  "suit-gear": SuitGearSchema,
  vehicles: VehiclesSchema,
  "vehicle-upgrades": VehicleUpgradesSchema,
  robots: RobotsSchema,
  caps: CapsSchema,
  logistics: LogisticsSchema,
  production: ProductionSchema,
  power: PowerSchema,
  "build-pieces": BuildPiecesSchema,
  "plot-bonus": PlotBonusSchema,
  collectibles: CollectiblesSchema,
  onboarding: OnboardingSchema,
  achievements: AchievementsSchema,
  moderation: ModerationSchema,
  features: FeaturesSchema,
  "pacing-targets": PacingTargetsSchema,
} as const satisfies Record<GameDataTable, z.ZodType>;

type Path = (string | number)[];

export const GameDataBundleSchema = z.strictObject(GAME_DATA_TABLE_SCHEMAS).superRefine((data, ctx) => {
  const issue = (path: Path, message: string): void => {
    ctx.addIssue({ code: "custom", message, path });
  };

  // Tools, traits and Dust Cells.
  const traits = new Set(data.traits.traits.map((t) => t.id));
  const toolTier = new Map(data.tools.tools.map((t) => [t.id, t.tier]));
  data.tools.tools.forEach((tool, i) => {
    if (tool.traitId !== null && !traits.has(tool.traitId)) {
      issue(["tools", "tools", i, "traitId"], `unknown trait "${tool.traitId}"`);
    }
    if (tool.tier !== BUILD_TOOL_TIER && data["dust-cells"].costsLm[tool.id] === undefined) {
      issue(["dust-cells", "costsLm", tool.id], `cleaning tool "${tool.id}" has no Dust Cell costs`);
    }
  });
  for (const toolId of Object.keys(data["dust-cells"].costsLm)) {
    const tier = toolTier.get(toolId);
    if (tier === undefined || tier === BUILD_TOOL_TIER) {
      issue(["dust-cells", "costsLm", toolId], `"${toolId}" is not a cleaning tool`);
    }
  }

  // Vehicles and their upgrade lines.
  const upgradeLines = new Set(data["vehicle-upgrades"].lines.map((l) => l.id));
  data.vehicles.vehicles.forEach((vehicle, v) => {
    vehicle.upgradeLineIds.forEach((lineId, l) => {
      if (!upgradeLines.has(lineId))
        issue(["vehicles", "vehicles", v, "upgradeLineIds", l], `unknown line "${lineId}"`);
    });
  });

  // Recipe materials.
  const materials = new Set(data.economy.materials.map((m) => m.id));
  data.production.machines.forEach((machine, m) => {
    for (const side of ["in", "out"] as const) {
      machine.recipe[side].forEach((amount, a) => {
        if (!materials.has(amount.materialId)) {
          issue(
            ["production", "machines", m, "recipe", side, a, "materialId"],
            `unknown material "${amount.materialId}"`,
          );
        }
      });
    }
  });

  // Flag effects name registered features.
  const features = new Set(data.features.features.map((f) => f.id));
  const checkEffects = (effects: readonly Effect[], path: Path): void => {
    effects.forEach((effect, e) => {
      if (effect.op === "flag" && !features.has(effect.featureId)) {
        issue([...path, e, "featureId"], `unknown feature "${effect.featureId}"`);
      }
    });
  };
  data["promotions-board"].nodes.forEach((node, n) => {
    node.levels.forEach((level, l) =>
      checkEffects(level.effects, ["promotions-board", "nodes", n, "levels", l, "effects"]),
    );
  });
  data["suit-gear"].lines.forEach((line, n) => {
    line.levels.forEach((level, l) => checkEffects(level.effects, ["suit-gear", "lines", n, "levels", l, "effects"]));
  });
  data["vehicle-upgrades"].lines.forEach((line, n) => {
    line.levels.forEach((level, l) =>
      checkEffects(level.effects, ["vehicle-upgrades", "lines", n, "levels", l, "effects"]),
    );
  });

  // Placeable pieces exist in build-pieces at the same price.
  const piecePrice = new Map(data["build-pieces"].pieces.map((p) => [p.id, p.priceLm]));
  const checkPieces = (pieces: readonly { id: string; priceLm: number }[], path: Path): void => {
    pieces.forEach((piece, p) => {
      const price = piecePrice.get(piece.id);
      if (price === undefined) issue([...path, p, "id"], `"${piece.id}" is not in build-pieces`);
      else if (price !== piece.priceLm) issue([...path, p, "priceLm"], `priceLm differs from build-pieces (${price})`);
    });
  };
  checkPieces(data.vehicles.motorPoolParts, ["vehicles", "motorPoolParts"]);
  checkPieces(data.logistics.pieces, ["logistics", "pieces"]);
  checkPieces(data.production.machines, ["production", "machines"]);
  checkPieces(data.power.pieces, ["power", "pieces"]);
  data.logistics.baleAcceptors.forEach((id, i) => {
    if (!piecePrice.has(id)) issue(["logistics", "baleAcceptors", i], `"${id}" is not in build-pieces`);
  });
  const checkPiecePrice = (pieceId: string, priceLm: number, path: Path): void => {
    const price = piecePrice.get(pieceId);
    if (price === undefined) issue(path, `"${pieceId}" is not in build-pieces`);
    else if (price !== priceLm) issue(path, `price differs from build-pieces "${pieceId}" (${price})`);
  };
  checkPiecePrice(ROOST_PIECE_ID, data.robots.roost.basePriceLm, ["robots", "roost", "basePriceLm"]);
  checkPiecePrice(NEST_PIECE_ID, data.robots.nest.priceLm, ["robots", "nest", "priceLm"]);
  checkPiecePrice(FIELD_GATE_PIECE_ID, data.logistics.fieldGate.priceLm, ["logistics", "fieldGate", "priceLm"]);

  // Dust Cell nodes: `tool.<x>` <-> `node.dust_cell_<x>`, level costs equal `dust-cells.costsLm`.
  const boardNodes = data["promotions-board"].nodes;
  const nodeIndex = new Map(boardNodes.map((node, n) => [node.id, n]));
  for (const [toolId, costs] of Object.entries(data["dust-cells"].costsLm)) {
    const nodeId = `${DUST_CELL_NODE_ID_PREFIX}${toolId.slice(toolId.indexOf(".") + 1)}`;
    const n = nodeIndex.get(nodeId);
    const node = n === undefined ? undefined : boardNodes[n];
    if (n === undefined || node === undefined) {
      issue(["promotions-board", "nodes"], `cleaning tool "${toolId}" has no Dust Cell node "${nodeId}"`);
      continue;
    }
    if (node.levels.length !== costs.length) {
      issue(["promotions-board", "nodes", n, "levels"], `Dust Cell node has ${costs.length} levels in dust-cells`);
      continue;
    }
    node.levels.forEach((level, l) => {
      if (level.costLm !== costs[l]) {
        issue(["promotions-board", "nodes", n, "levels", l, "costLm"], `costLm differs from dust-cells (${costs[l]})`);
      }
    });
  }
  boardNodes.forEach((node, n) => {
    if (!node.id.startsWith(DUST_CELL_NODE_ID_PREFIX)) return;
    const toolId = `tool.${node.id.slice(DUST_CELL_NODE_ID_PREFIX.length)}`;
    if (data["dust-cells"].costsLm[toolId] === undefined) {
      issue(["promotions-board", "nodes", n, "id"], `Dust Cell node has no dust-cells.costsLm "${toolId}"`);
    }
  });

  // Probation suggestions name a known purchasable or node id.
  const known = new Set<string>([
    ...toolTier.keys(),
    ...piecePrice.keys(),
    ...data.vehicles.vehicles.map((v) => v.id),
    ...data["suit-gear"].lines.map((l) => l.id),
    ...data["promotions-board"].nodes.map((n) => n.id),
    ...upgradeLines,
  ]);
  data.onboarding.probation.forEach((step, s) => {
    if (step.suggestsId !== undefined && !known.has(step.suggestsId)) {
      issue(["onboarding", "probation", s, "suggestsId"], `unknown id "${step.suggestsId}"`);
    }
  });

  // Constants repeated across tables agree.
  if (data.economy.stampBaseLm !== data["plot-bonus"].stampBaseLm) {
    issue(["plot-bonus", "stampBaseLm"], "stampBaseLm differs from economy.stampBaseLm");
  }
  if (data["dust-cells"].puckKg !== data.logistics.puckKg) {
    issue(["dust-cells", "puckKg"], "puckKg differs from logistics.puckKg");
  }
  if (data["dust-cells"].stackMaxKg !== data.logistics.stackMaxKg) {
    issue(["dust-cells", "stackMaxKg"], "stackMaxKg differs from logistics.stackMaxKg");
  }
  if (data.robots.albatross.baleKg !== data.logistics.baleKg) {
    issue(["robots", "albatross", "baleKg"], "baleKg differs from logistics.baleKg");
  }
  const charge = data.traits.traits.findIndex((t) => t.id === CHARGE_TRAIT_ID);
  if (charge < 0) {
    issue(["traits", "traits"], `"${CHARGE_TRAIT_ID}" is missing`);
  } else if (data.traits.traits[charge]?.params[CHARGE_FINISH_STAMP_PARAM] !== data["plot-bonus"].chargeFinishMult) {
    issue(
      ["traits", "traits", charge, "params", CHARGE_FINISH_STAMP_PARAM],
      `${CHARGE_FINISH_STAMP_PARAM} differs from plot-bonus.chargeFinishMult`,
    );
  }
});
export type GameDataBundle = z.infer<typeof GameDataBundleSchema>;
