// `gameDataVersion` of this build (save sync metadata, 1..32 chars): derived from the real game data, not the build
// string, so two builds with identical balance data report the same version and any data change gives a new one.
// Computed once, off the first-frame path (the checkpoint-sync chunk calls it after the Solo host started).
//
// Proposal for the game-data owner: export this as a build-time constant from @moon-cleanup/game-data so the server can
// list accepted versions (`knownGameDataVersions`) from the same source.

/** Prefix of the version scheme (FNV-1a 32 over the canonical JSON of the raw game data). */
export const GAME_DATA_VERSION_PREFIX = "gd1-";

let cached: { raw: unknown; version: string } | null = null;

/** FNV-1a 32-bit over the UTF-16 code units of `text`, as 8 lower-case hex digits. */
export function fnv1a32Hex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical JSON: object keys sorted, so key order in the source files never changes the version. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `gd1-xxxxxxxx` for the given raw game data (`RAW_GAME_DATA`). Memoised per object. */
export function gameDataVersionOf(raw: unknown): string {
  if (cached !== null && cached.raw === raw) return cached.version;
  const version = `${GAME_DATA_VERSION_PREFIX}${fnv1a32Hex(canonical(raw))}`;
  cached = { raw, version };
  return version;
}
