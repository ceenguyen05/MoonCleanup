import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureOne, captureSequence } from "./capture";
import { generateIndexMd } from "./measure";

// A fake client that honours the harness contract: __mcReady after a few frames, __mcStep, __mcInfo.
const PAGE = `<!doctype html><title>fake</title><body style="margin:0"><canvas id=c></canvas><script>
const q = new URLSearchParams(location.search); const dpr = devicePixelRatio;
const c = document.getElementById('c'); c.width = innerWidth*dpr; c.height = innerHeight*dpr;
c.style.width = innerWidth+'px'; c.style.height = innerHeight+'px';
const g = c.getContext('2d'); let frame = 0;
function draw(){ g.fillStyle='#202020'; g.fillRect(0,0,c.width,c.height); g.fillStyle='#e0e0e0'; g.fillRect(frame%50+10,10,40,40); }
window.__mcLook = { info: () => ({ ev100: 15, keyMode: 'sun', knobs: 'default', state: { sunElevationDeg: q.get('variant') === 'dawn' ? 4 : 60, sunAzimuthDeg: 90, earthElevationDeg: -90, earthAzimuthDeg: 0, earthDiameterDeg: 4 } }), probes: () => ({ pa: { px: { x: 60, y: 60, visible: true } } }) };
window.__mcLookdev = { probes: () => ({ chips: { c1: { x: 5, y: 5, w: 20, h: 20 } }, lines: { edgeLeft: { x0: 10, y0: 30, x1: 80, y1: 30 } }, facts: { variant: 'x' } }) };
window.__mcInfo = { backend: q.get('backend'), frameTimeAvgMs: 1.5, texPoolMB: 0 };
window.__mcStep = async (n) => { frame += n; draw(); };
draw(); setTimeout(() => { window.__mcReady = true; }, 50);
</script>`;

let server: Server;
let browser: Browser | undefined;
let url = "";
const out = mkdtempSync(join(tmpdir(), "mc-shots-"));

beforeAll(async () => {
  server = createServer((_q, s) => {
    s.setHeader("content-type", "text/html");
    s.end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    browser = undefined;
  }
}, 90_000);
afterAll(async () => {
  await browser?.close();
  server.close();
  rmSync(out, { recursive: true, force: true });
});

const req = {
  scene: "S02",
  tod: "noon",
  tier: "A",
  preset: "high",
  backend: "webgl2",
  cssWidth: 320,
  cssHeight: 200,
  dpr: 2,
  hud: "nohud",
  seed: "vt-standard-01",
} as const;

describe("capture harness against a fake client (needs a Chromium browser)", () => {
  it("writes a native-size PNG + sidecar + index.md, waiting on __mcReady", async (ctx) => {
    if (!browser) return ctx.skip();
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    const r = await captureOne(page, url, { ...req, stepFrames: 8 }, out, "ci");
    expect(r.pngPath.endsWith("S02-noon-tierA-high-webgl2-640x400@2-nohud.png")).toBe(true);
    const side = JSON.parse(readFileSync(r.jsonPath, "utf8"));
    expect(side).toMatchObject({ width: 640, height: 400, dpr: 2, backend: "webgl2", stepFrames: 8, texPoolMB: 0 });
    expect(side.measure.nonBlackFraction).toBeGreaterThan(0.5);
    expect(side.commit).toBeTruthy();
    // VT-M0-12: ROI measures, knobs, sun, EV100, serve mode, tod verification
    expect(Object.keys(side.measure.rois)).toEqual(
      expect.arrayContaining(["frame:center", "chip:c1", "line:edgeLeft", "probe:pa"]),
    );
    expect(side.measure.rois["chip:c1"].rect).toEqual({ x: 10, y: 10, w: 40, h: 40 });
    expect(side).toMatchObject({ ev100: 15, sun: { elevationDeg: 60 }, serve: null });
    expect(side.todApplied).toMatch(/^verified/);
    expect(side.knobs).toHaveProperty("renderScale");
    // a tod the client did not apply fails loudly instead of writing a mislabelled capture
    await expect(captureOne(page, url, { ...req, tod: "dawn", stepFrames: 1 }, out, "ci")).resolves.toBeDefined();
    await expect(captureOne(page, url, { ...req, scene: "S03", tod: "dawn" }, out, "ci")).rejects.toThrow(
      /does not support/,
    );
    expect(generateIndexMd(out)).toContain("S02-noon-tierA-high-webgl2-640x400@2-nohud.png");
    // frame-stepped sequence: 3 lossless frames
    const seq = await captureSequence(page, url, req, join(out, "seq"), 3);
    expect(readdirSync(join(out, "seq"))).toHaveLength(3);
    expect(seq).toHaveLength(3);
    await context.close();
  }, 60_000);
});
