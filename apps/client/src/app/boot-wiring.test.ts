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
    expect(source).toMatch(/new VisualsModule\(\{ search: moduleSearch[,}]/);
    expect(source).not.toMatch(/new (RenderModule|VisualsModule)\(\{[^}]*search: win\.location\.search/s);
  });
});

describe("audio boot timing", () => {
  it("boot.ts builds the suspended AudioContext after module init and before the frame loop starts", () => {
    const source = readFileSync(new URL("./boot.ts", import.meta.url), "utf8");
    const init = source.indexOf("await module.init(ctx)");
    const prepare = source.indexOf("audio?.prepare()");
    const start = source.indexOf("frameLoop.start()");
    expect(init).toBeGreaterThan(0);
    expect(prepare).toBeGreaterThan(init);
    expect(start).toBeGreaterThan(prepare);
  });
});

describe("M1 wiring applied by the gameplay writer (W3-T05, W5-T08 sign-in, online entry UI)", () => {
  const source = readFileSync(new URL("./boot.ts", import.meta.url), "utf8");

  it("registers the gameplay module (player input) only where the player plays", async () => {
    expect(source).toContain('registered.set("gameplay", gameplay)');
    const { wantsPlayerInput } = await import("./boot");
    expect(wantsPlayerInput("?play=1")).toBe(true);
    expect(wantsPlayerInput("?scene=dust&bot=0")).toBe(true);
    expect(wantsPlayerInput("?scene=dust")).toBe(false); // the scripted sweeper drives (perf captures)
    expect(wantsPlayerInput("?play=1&capture=1")).toBe(false);
    expect(wantsPlayerInput("?play=1&solo=0")).toBe(false);
  }, 60_000); // importing boot.ts pulls the whole client graph (about 6 s under load)

  it("checkpoint sync: Clock In registers the solo Contract and sign-in retries until ready (stopped on teardown)", () => {
    expect(source).toContain("registration: soloRegistration(d.identity.contractId)");
    expect(source).toContain("stopSignIn = signInUntilReady({");
    expect(source).toMatch(/teardown = \(\) => \{\s*stopSignIn\(\);/);
    expect(source).not.toMatch(/\.signIn\(\)\s*\.then/);
  });

  it("online entry UI: UiModule gets the port; open/close hooks exist in every build, the console hook only in dev/perf", () => {
    expect(source).toContain("online: onlinePort");
    const hooks = source.indexOf("const onlineHooks = createOnlineDevHooks(");
    const perfGate = source.indexOf("win.__mcOnline = onlineHooks");
    expect(hooks).toBeGreaterThan(0);
    expect(source.lastIndexOf("if (perfEnabled) {", perfGate)).toBeGreaterThan(hooks);
    expect(source).not.toMatch(/^import .*online-room/m); // room code stays behind the dynamic import
  });
});

describe("QA smoke follow-ups (D1 guest sign-in gate, D2 gameplay readout)", () => {
  const source = readFileSync(new URL("./boot.ts", import.meta.url), "utf8");

  it("D1: checkpoint sync and its guest POST start only with a configured server (or ?sync=1)", async () => {
    expect(source).toMatch(
      /if \(wantsCheckpointSync\(win\.location\.search, import\.meta\.env\["VITE_SERVER_HTTP_URL"\]/,
    );
    const { wantsCheckpointSync } = await import("./boot");
    expect(wantsCheckpointSync("", undefined)).toBe(false);
    expect(wantsCheckpointSync("", " ")).toBe(false);
    expect(wantsCheckpointSync("", "https://api.example")).toBe(true);
    expect(wantsCheckpointSync("?sync=0", "https://api.example")).toBe(false);
    expect(wantsCheckpointSync("?sync=1", undefined)).toBe(true);
  }, 60_000);

  it("D2: __mcGameplay is installed only for dev / ?perf=1", () => {
    expect(source).toContain("debugHost: perfEnabled ? win : null");
  });
});

describe("solo makes no server request on the first click (net wake gate)", () => {
  it("AppNetModule wakes only on ?wake=1 or online intent, never on pointerdown/keydown", async () => {
    const { AppNetModule } = await import("./modules");
    const listeners: string[] = [];
    const win = {
      addEventListener: (type: string) => listeners.push(type),
      removeEventListener: () => undefined,
      navigator: { webdriver: false, userAgent: "Mozilla/5.0" },
      document: { visibilityState: "visible" },
    } as unknown as Window;
    let fetches = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetches++;
      return new Promise(() => undefined);
    }) as typeof fetch;
    try {
      const m = new AppNetModule({
        httpUrl: "http://x.test",
        wsUrl: "ws://x.test",
        clientBuild: "t",
        wakeAtBoot: false,
        win,
      });
      const registered = new Map<string, unknown>();
      const events = { on: () => () => undefined, emit: () => undefined };
      m.init({
        services: {
          get: () => ({ dispatch: () => undefined }),
          register: (k: string, v: unknown) => registered.set(k, v),
          has: () => false,
        },
        events,
      } as never);
      expect(listeners).not.toContain("pointerdown");
      expect(listeners).not.toContain("keydown");
      expect(fetches).toBe(0);
      m.dispose();
    } finally {
      globalThis.fetch = realFetch;
    }
    const source = readFileSync(new URL("./boot.ts", import.meta.url), "utf8");
    expect(source).toMatch(/auth: \(\) => \{\s*netModule\.wakeForOnline\(\);/);
  });
});
