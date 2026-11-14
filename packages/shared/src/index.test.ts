import { describe, expect, expectTypeOf, it } from "vitest";
import * as shared from "./index";

// Vite's import.meta.glob (handled by Vitest's transform) reads the sources as text without Node APIs.
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}

/** The folders of module-boundaries.md section 2, in the root barrel's order. */
const FOLDERS = [
  "ids",
  "units",
  "protocol",
  "sim",
  "world",
  "events",
  "client",
  "ui",
  "audio",
  "render",
  "config",
  "api",
  "save",
] as const;

const SOURCES = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("contract file headers", () => {
  it("finds the sources", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(FOLDERS.length * 2);
  });

  // Version is `v<major>[.<minor>[.<patch>]]`; a minor bump marks an additive change (contract wave v1.1), a patch
  // bump a small correction (api/rest v0.1.1).
  it.each(Object.entries(SOURCES))("%s starts with @contract <name> v<n>[.<m>[.<p>]] and @consumers", (_path, text) => {
    const [first, second] = text.split(/\r?\n/);
    expect(first).toMatch(/^\/\/ @contract [a-z][a-z0-9/.-]* v\d+(?:\.\d+){0,2}( \(placeholder\))?$/);
    expect(second).toMatch(/^\/\/ @consumers \S/);
  });

  it("names each file after its path in the @contract header", () => {
    for (const [path, text] of Object.entries(SOURCES)) {
      const name = path.replace(/^\.\//, "").replace(/\.ts$/, "");
      expect(text.split(/\r?\n/)[0], path).toContain(`@contract ${name} v`);
    }
  });
});

describe("barrels", () => {
  it("has a sub-barrel per module-boundaries folder, each re-exported by the root barrel in order", () => {
    const root = SOURCES["./index.ts"] ?? "";
    const exported = [...root.matchAll(/^export \* from "\.\/([a-z]+)";$/gm)].map((m) => m[1]);
    expect(exported).toEqual([...FOLDERS]);
    for (const folder of FOLDERS) expect(SOURCES[`./${folder}/index.ts`], folder).toBeDefined();
  });

  it("re-exports every source file through its folder barrel", () => {
    for (const path of Object.keys(SOURCES)) {
      const match = /^\.\/([a-z]+)\/([a-z.-]+)\.ts$/.exec(path);
      if (match === null || match[2] === "index") continue;
      const barrel = SOURCES[`./${match[1]}/index.ts`] ?? "";
      expect(barrel, path).toContain(`export * from "./${match[2]}";`);
    }
  });

  it("imports nothing outside the package except zod", () => {
    for (const [path, text] of Object.entries(SOURCES)) {
      for (const m of text.matchAll(/^import .* from "([^"]+)";$/gm)) {
        const spec = m[1] ?? "";
        expect(spec === "zod" || spec.startsWith("./") || spec.startsWith("../"), `${path}: ${spec}`).toBe(true);
      }
    }
  });

  it("exposes the version constants and one runtime value per folder at the root", () => {
    expect(shared.PROTOCOL_VERSION).toBe(1);
    expect(shared.SAVE_FORMAT_VERSION).toBe(1);
    expect(shared.GAME_DATA_SCHEMA_VERSION).toBe(1);
    const values: unknown[] = [
      shared.MESSAGE_CATALOG, // protocol
      shared.MAX_PLAYERS_PER_ROOM, // sim
      shared.STANDARD_PLOT_COUNT, // world
      shared.EVENT_NAMES, // events
      shared.SERVICE_KEYS, // client
      shared.INITIAL_UI_STATE, // ui
      shared.AUDIO_CUE_IDS, // audio
      shared.QUALITY_PRESETS, // render
      shared.GAME_DATA_TABLES, // config
      shared.HealthResponseSchema, // api
      shared.SAVE_HEADER_GOLDEN_VECTORS, // save
    ];
    for (const value of values) expect(value).toBeDefined();
    // ids and units are types only.
    expectTypeOf<shared.PlotId>().toExtend<number>();
    expectTypeOf<shared.Metres>().toEqualTypeOf<number>();
  });
});
