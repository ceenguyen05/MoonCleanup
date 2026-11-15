import { describe, expect, it } from "vitest";
import { summarizePath } from "./camera-paths";
import { makeImage } from "./measure/image";
import { frameRois, measureRois, probeRois, profileEdge1090 } from "./measure/rois";
import { normalizeOutPath } from "./paths";
import { UnsupportedSceneError, todSetup, verifyTodApplied } from "./scenes/registry";
import { detectServeMode } from "./serve";
import { earthLitFraction, sidecarExtras } from "./sidecar";

const grey = (v: number) => [v, v, v] as const;
const win = process.platform === "win32";

describe("normalizeOutPath (Git Bash quirk: /c/... resolved to C:\\c\\...)", () => {
  it.runIf(win)("maps MSYS, WSL and cygdrive drive prefixes to the drive", () => {
    const ctx = { platform: "win32", cwd: "C:\\repo" };
    expect(normalizeOutPath("/c/Users/x/out", ctx)).toBe("C:\\Users\\x\\out");
    expect(normalizeOutPath("/mnt/c/Users/x", ctx)).toBe("C:\\Users\\x");
    expect(normalizeOutPath("/cygdrive/d/a", ctx)).toBe("D:\\a");
    expect(normalizeOutPath("C:\\Users\\x", ctx)).toBe("C:\\Users\\x");
  });
  it.runIf(win)("resolves relative paths against INIT_CWD, not the package dir", () => {
    expect(
      normalizeOutPath("docs/out", { platform: "win32", cwd: "C:\\repo\\tools\\screenshots", initCwd: "C:\\repo" }),
    ).toBe("C:\\repo\\docs\\out");
  });
  it("leaves POSIX paths alone and rejects empty", () => {
    if (!win) expect(normalizeOutPath("/c/x", { platform: "linux", cwd: "/r" })).toBe("/c/x");
    expect(() => normalizeOutPath(" ", { platform: "linux", cwd: "/r" })).toThrow();
  });
});

describe("time of day registry", () => {
  it("S01 dawn and noon give different knobs and expected suns", () => {
    expect(todSetup("S01", "dawn").setup).toMatchObject({ params: { time: "dawn" }, sunElevationDeg: 4 });
    expect(todSetup("S01", "noon").setup).toMatchObject({ params: { time: "noon" }, sunElevationDeg: 60 });
  });
  it("verifyTodApplied passes when the sun matches and throws when the client ignored tod", () => {
    const { setup } = todSetup("S01", "dawn");
    expect(() => verifyTodApplied("S01", "dawn", setup, 4.1)).not.toThrow();
    expect(() => verifyTodApplied("S01", "dawn", setup, 60)).toThrow(UnsupportedSceneError);
    expect(() => verifyTodApplied("S01", "dawn", setup, null)).toThrow(/cannot be verified/);
  });
  it("S12 is tod-agnostic and never throws on sun", () => {
    const { setup } = todSetup("S12", "night-near");
    expect(() => verifyTodApplied("S12", "night-near", setup, 60)).not.toThrow();
  });
});

describe("ROI measures (known chart in, known number out)", () => {
  it("patch ROIs: two chips read their own luma, not the frame mean", () => {
    const img = makeImage(100, 50, (x) => (x < 50 ? grey(40) : grey(180)));
    const r = measureRois(img, [
      { kind: "patch", name: "chip:dark", rect: { x: 5, y: 5, w: 20, h: 20 } },
      { kind: "patch", name: "chip:light", rect: { x: 60, y: 5, w: 20, h: 20 } },
    ]);
    const dark = r["chip:dark"]!;
    const light = r["chip:light"]!;
    expect(dark.kind === "patch" && dark.lumaMean).toBeCloseTo(40, 1);
    expect(light.kind === "patch" && light.lumaMean).toBeCloseTo(180, 1);
  });
  it("line ROI: a 6 px linear ramp along a diagonal-free line measures about 4.8 px (10-90 of 6)", () => {
    const img = makeImage(80, 10, (x) => grey(Math.round(Math.max(0, Math.min(1, (x - 37) / 6)) * 255)));
    const r = measureRois(img, [{ kind: "line", name: "line:e", x0: 10, y0: 5, x1: 70, y1: 5 }])["line:e"]!;
    expect(r.kind).toBe("line");
    if (r.kind === "line") {
      expect(r.edge1090Px).toBeCloseTo(4.8, 0);
      expect(r.edgeAt?.x).toBeGreaterThanOrEqual(37);
      expect(r.profile).toHaveLength(61);
    }
  });
  it("profileEdge1090 ignores far features outside the window and returns null for a flat line", () => {
    const flat = Array.from({ length: 50 }, () => 100);
    expect(profileEdge1090(flat)).toBeNull();
    const two = [
      ...Array.from({ length: 20 }, () => 0),
      ...Array.from({ length: 20 }, () => 200),
      ...Array.from({ length: 20 }, () => 10),
    ];
    expect(profileEdge1090(two)?.widthPx).toBeLessThan(1.5);
  });
  it("probeRois scales CSS px to device px and skips probes behind the camera", () => {
    const rois = probeRois({
      dpr: 2,
      lookdev: { chips: { c1: { x: 10, y: 20, w: 30, h: 40 } }, lines: { e: { x0: 1, y0: 2, x1: 3, y1: 4 } } },
      look: { a: { px: { x: 100, y: 50, visible: true } }, b: { px: { x: 1, y: 1, visible: false } } },
    });
    expect(rois.map((r) => r.name)).toEqual(["chip:c1", "line:e", "probe16:a", "probe:a"]);
    expect(rois[0]).toMatchObject({ rect: { x: 20, y: 40, w: 60, h: 80 } });
    expect(rois[1]).toMatchObject({ x0: 2, y1: 8 });
  });
  it("frameRois covers upper, middle, lower, left, center, right", () => {
    expect(frameRois(300, 300).map((r) => r.name)).toEqual([
      "frame:upper",
      "frame:middle",
      "frame:lower",
      "frame:left",
      "frame:center",
      "frame:right",
    ]);
  });
});

describe("sidecar extras", () => {
  it("Earth phase: sun opposite the Earth direction is full, sun behind the viewer toward Earth is new", () => {
    expect(earthLitFraction(0, 0, 0, 0)).toBeCloseTo(0, 5);
    expect(earthLitFraction(180, 0, 0, 0)).toBeCloseTo(1, 5);
    expect(earthLitFraction(90, 0, 0, 0)).toBeCloseTo(0.5, 5);
  });
  it("maps look info to knobs, sun, EV100 and null for what the client does not expose", () => {
    const x = sidecarExtras(
      { renderScale: 0.5, dpr: 1 },
      {
        ev100: 15,
        keyMode: "sun",
        knobs: "aa=traa",
        state: {
          sunElevationDeg: 4,
          sunAzimuthDeg: 100,
          earthElevationDeg: 17,
          earthAzimuthDeg: 48,
          earthDiameterDeg: 4.2,
        },
      },
      "a",
    );
    expect(x.sun).toEqual({ elevationDeg: 4, azimuthDeg: 100 });
    expect(x.ev100).toBe(15);
    expect(x.knobs).toMatchObject({ renderScale: 0.5, aa: "traa" });
    expect(x.camera.pose).toBeNull();
    expect(x.camera.vfovDeg).toBeNull();
    expect(x.camera.note).toMatch(/does not report/);
    expect(x.earth?.litFraction).toBeGreaterThan(0);
  });
  it("copies camera pose and vFOV from look info when present", () => {
    const x = sidecarExtras(
      {},
      {
        camera: {
          position: [1, 2, 3],
          quaternion: [0, 0, 0, 1],
          forward: [0, 0, -1],
          vfovDeg: 52,
          aspect: 1.78,
          nearM: 0.1,
          farM: 5000,
        },
      },
      "a",
    );
    expect(x.camera.view).toBe("a");
    expect(x.camera.vfovDeg).toBe(52);
    expect(x.camera.pose).toEqual({
      positionM: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      forward: [0, 0, -1],
      aspect: 1.78,
      nearM: 0.1,
      farM: 5000,
    });
    expect(x.camera.note).toBeUndefined();
  });
});

describe("serve mode and camera path summary", () => {
  it("detects dev (javascript /@vite/client) vs production (html fallback) vs unreachable", async () => {
    const js = (async () => new Response("x", { headers: { "content-type": "text/javascript" } })) as typeof fetch;
    const html = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await detectServeMode("http://h/", js)).toBe("dev");
    expect(await detectServeMode("http://h/", html)).toBe("production");
    expect(await detectServeMode("http://h/", down)).toBe("unreachable");
  });
  it("summarizePath: a one-frame pop in the ground region shows as a spike ratio", () => {
    const frame = (g: number, popped = false) => makeImage(30, 30, (_x, y) => grey(y >= 20 && popped ? g + 100 : g));
    const frames = [frame(50), frame(52), frame(54), frame(56), frame(58, true), frame(60, true), frame(62, true)];
    const s = summarizePath(frames);
    expect(s.pairDiffGround).toHaveLength(6);
    expect(s.maxGroundDiffAt).toBe(4);
    expect(s.groundSpikeRatio).toBeGreaterThan(5);
  });
});
