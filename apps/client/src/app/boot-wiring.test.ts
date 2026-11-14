import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BENCH_DEFAULT_TERRAIN_BASE, parseBenchOptions } from "../render/bench/options";
import { launchSearch } from "./launch-policy";

// N8: boot.ts hands RenderModule and VisualsModule `launchSearch(location.search, import.meta.env.PROD)`.
const crafted = "?scene=bench&terrain=https://attacker.example/t/&terrainBase=https://attacker.example/t/";

describe("terrain URL params in production vs dev (security review N8)", () => {
  it("a production build ignores terrainBase and terrain: the bench falls back to the same-origin default", () => {
    const options = parseBenchOptions(launchSearch(crafted, true));
    expect(options.terrainBase).toBe(BENCH_DEFAULT_TERRAIN_BASE);
    expect(options.terrain).toBe("real");
    expect(new URLSearchParams(launchSearch(crafted, true)).get("terrain")).toBeNull();
  });

  it("a dev build honours them", () => {
    const options = parseBenchOptions(launchSearch(crafted, false));
    expect(options.terrainBase).toBe("https://attacker.example/t/");
    expect(new URLSearchParams(launchSearch(crafted, false)).get("terrain")).toBe("https://attacker.example/t/");
  });

  it("boot.ts feeds both modules the filtered search and never the raw location.search", () => {
    const source = readFileSync(new URL("./boot.ts", import.meta.url), "utf8");
    expect(source).toContain("launchSearch(win.location.search, import.meta.env.PROD)");
    expect(source).toMatch(/new RenderModule\(\{[^}]*search: moduleSearch/s);
    expect(source).toContain("new VisualsModule({ search: moduleSearch })");
    expect(source).not.toMatch(/new (RenderModule|VisualsModule)\(\{[^}]*search: win\.location\.search/s);
  });
});
