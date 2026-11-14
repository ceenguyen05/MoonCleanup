// @contract config/index v1.1
// @consumers the root barrel (../index); packages and apps import from "@moon-cleanup/shared" only
//
// Sub-barrel of the balance config schemas: shared building blocks, one schema per baseline table file
// (`<name>.schema.ts` exports `<Name>Schema` + `<Name>Table`), the whole-set `GameDataBundleSchema`, and the MVP slice of the baseline (`mvp-scope.schema`, v1.1).

export * from "./common.schema";
export * from "./world.schema";
export * from "./economy.schema";
export * from "./movement.schema";
export * from "./tools.schema";
export * from "./traits.schema";
export * from "./dust-cells.schema";
export * from "./promotions-board.schema";
export * from "./suit-gear.schema";
export * from "./vehicles.schema";
export * from "./vehicle-upgrades.schema";
export * from "./robots.schema";
export * from "./caps.schema";
export * from "./logistics.schema";
export * from "./production.schema";
export * from "./power.schema";
export * from "./build-pieces.schema";
export * from "./plot-bonus.schema";
export * from "./collectibles.schema";
export * from "./onboarding.schema";
export * from "./achievements.schema";
export * from "./moderation.schema";
export * from "./features.schema";
export * from "./pacing-targets.schema";
export * from "./bundle.schema";
export * from "./mvp-scope.schema";
