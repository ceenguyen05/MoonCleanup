// @moon-cleanup/game-data public barrel: validated, frozen balance/content tables (progression-and-economy.md §21).
// The sim, server, client and balance-sim read tables only through `loadGameData()`.
//
// Effect semantics (all tables): a level's `effects` are the full effect of owning that level; they replace the lower
// level's effects of the same node/line (Broad Strokes III = toolWidthBonus +0.25, not +0.08+0.16+0.25). Across nodes,
// `add` stats sum (toolWidthBonus, moveSpeedBonus, payoutBonus: base x (1 + sum)) and `mul` stats multiply.
// Stat ids scoped to a record append its id: `cellLevel.tool.desk_duster`.
export { loadGameData, parseGameData, type GameData } from "./load";
export { RAW_GAME_DATA } from "./raw";
export { DISPLAY_NAMES, LABEL_ONLY_IDS, displayName } from "./content/labels";
export { BOREAL_SUN_PATH, dayPhase, isDaylight, sunElevationDeg, type DayCycle, type SunPathParams } from "./sun-path";
