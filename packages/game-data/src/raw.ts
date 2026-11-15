// Unvalidated JSON tables from ../data, keyed by table name (`GAME_DATA_TABLES`). Bundler/Node JSON imports only:
// no DOM, no Node APIs. Consumers use `loadGameData()` instead of these raw objects.
import type { GameDataTable } from "@moon-cleanup/shared";
import achievements from "../data/achievements.json" with { type: "json" };
import buildPieces from "../data/build-pieces.json" with { type: "json" };
import caps from "../data/caps.json" with { type: "json" };
import collectibles from "../data/collectibles.json" with { type: "json" };
import dustCells from "../data/dust-cells.json" with { type: "json" };
import economy from "../data/economy.json" with { type: "json" };
import features from "../data/features.json" with { type: "json" };
import logistics from "../data/logistics.json" with { type: "json" };
import moderation from "../data/moderation.json" with { type: "json" };
import movement from "../data/movement.json" with { type: "json" };
import onboarding from "../data/onboarding.json" with { type: "json" };
import pacingTargets from "../data/pacing-targets.json" with { type: "json" };
import plotBonus from "../data/plot-bonus.json" with { type: "json" };
import power from "../data/power.json" with { type: "json" };
import production from "../data/production.json" with { type: "json" };
import promotionsBoard from "../data/promotions-board.json" with { type: "json" };
import robots from "../data/robots.json" with { type: "json" };
import suitGear from "../data/suit-gear.json" with { type: "json" };
import toolFeel from "../data/tool-feel.json" with { type: "json" };
import tools from "../data/tools.json" with { type: "json" };
import traits from "../data/traits.json" with { type: "json" };
import vehicleUpgrades from "../data/vehicle-upgrades.json" with { type: "json" };
import vehicles from "../data/vehicles.json" with { type: "json" };
import world from "../data/world.json" with { type: "json" };

export const RAW_GAME_DATA: Readonly<Record<GameDataTable, unknown>> = {
  world,
  economy,
  movement,
  tools,
  traits,
  "dust-cells": dustCells,
  "promotions-board": promotionsBoard,
  "suit-gear": suitGear,
  vehicles,
  "vehicle-upgrades": vehicleUpgrades,
  robots,
  caps,
  logistics,
  production,
  power,
  "build-pieces": buildPieces,
  "plot-bonus": plotBonus,
  collectibles,
  onboarding,
  achievements,
  moderation,
  features,
  "pacing-targets": pacingTargets,
  "tool-feel": toolFeel,
};
