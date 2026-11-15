import { describe, expect, it } from "vitest";
import { RAW_GAME_DATA } from "@moon-cleanup/game-data";
import { fnv1a32Hex, gameDataVersionOf } from "./game-data-version";

describe("gameDataVersionOf", () => {
  it("derives a stable 1..32 char version from the real game data, independent of key order", () => {
    const v = gameDataVersionOf(RAW_GAME_DATA);
    expect(v).toMatch(/^gd1-[0-9a-f]{8}$/);
    expect(v.length).toBeLessThanOrEqual(32);
    expect(gameDataVersionOf(structuredClone(RAW_GAME_DATA))).toBe(v);
    expect(gameDataVersionOf({ b: 1, a: [1, 2] })).toBe(gameDataVersionOf({ a: [1, 2], b: 1 }));
    expect(gameDataVersionOf({ a: [1, 2], b: 2 })).not.toBe(gameDataVersionOf({ a: [1, 2], b: 1 }));
  });

  it("FNV-1a 32 matches the reference vectors", () => {
    expect(fnv1a32Hex("")).toBe("811c9dc5");
    expect(fnv1a32Hex("a")).toBe("e40c292c");
  });
});
