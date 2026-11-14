// Display-label catalog: one editable string per game-data id (naming-bible.md). A rename is one row in the bible
// plus one string in display-names.json; ids stay stable. Achievements carry `displayName` in their own table.
import displayNames from "./display-names.json" with { type: "json" };

export const DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({ ...displayNames });

/** Ids that have a label but no row of their own in a table (the Albatross is configured by `robots.albatross`). */
export const LABEL_ONLY_IDS: readonly string[] = Object.freeze(["robot.albatross"]);

/** Label for a game-data id; falls back to the id so a missing label is visible rather than blank. */
export function displayName(id: string): string {
  return DISPLAY_NAMES[id] ?? id;
}
