// Validation + freezing of the game-data bundle (progression-and-economy.md section 21).
import { GameDataBundleSchema, type GameDataBundle } from "@moon-cleanup/shared";
import { RAW_GAME_DATA } from "./raw";

export type GameData = GameDataBundle;

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Parses `{ [table]: json }` with `GameDataBundleSchema`; throws one error listing every issue path. */
export function parseGameData(raw: unknown): GameData {
  const result = GameDataBundleSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`game-data failed validation:\n${lines.join("\n")}`);
  }
  return deepFreeze(result.data);
}

let cached: GameData | undefined;

/** The validated, deeply frozen tables shipped in `packages/game-data/data`. Parsed once, on first call. */
export function loadGameData(): GameData {
  cached ??= parseGameData(RAW_GAME_DATA);
  return cached;
}
