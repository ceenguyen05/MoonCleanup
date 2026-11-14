import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke (M0-W1-T05). Software WebGL2 in CI: no pixel baselines, no frame-time assertions.
 * Always asserted: title "Clean The Moon!", no uncaught page errors / console errors.
 * Asserted once the client composition root lands (M0-W1-T06): set MC_REQUIRE_CANVAS=1 to require a booted canvas,
 * window.__mcReady, a non-black frame and a logged backend. Until then these are reported as annotations.
 * /healthz is checked only when MC_SERVER_URL is set (no internet, no production services).
 */
const requireCanvas = process.env["MC_REQUIRE_CANVAS"] === "1";
const serverUrl = process.env["MC_SERVER_URL"];

// Browser-generated noise that is not a client defect.
const IGNORED_ERRORS = [/favicon/i];

function watch(page: Page): { errors: string[]; logs: string[] } {
  const errors: string[] = [];
  const logs: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    logs.push(m.text());
    if (m.type() === "error" && !IGNORED_ERRORS.some((re) => re.test(m.text()) || re.test(m.location().url))) {
      errors.push(`console.error: ${m.text()}`);
    }
  });
  return { errors, logs };
}

test("page loads with the right title and no console errors", async ({ page }) => {
  const { errors } = watch(page);
  await page.goto("/");
  await expect(page).toHaveTitle("Clean The Moon!");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("canvas boots, frame is non-black, backend is logged", async ({ page }, info) => {
  const { logs } = watch(page);
  await page.goto("/");
  const canvas = page.locator("canvas").first();
  if (!requireCanvas && (await canvas.count()) === 0) {
    info.annotations.push({
      type: "pending",
      description: "no canvas yet (client stub); set MC_REQUIRE_CANVAS=1 after M0-W1-T06",
    });
    return;
  }
  await expect(canvas).toBeVisible();
  // Explicit readiness signal, never a fixed sleep.
  await page.waitForFunction(() => (window as unknown as { __mcReady?: boolean }).__mcReady === true, undefined, {
    timeout: 45_000,
  });

  const shot = await canvas.screenshot({ type: "png" });
  const nonBlack = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 12) n++;
    return n / (d.length / 4);
  }, shot.toString("base64"));
  expect(nonBlack, "canvas is black").toBeGreaterThan(0.01);

  expect(
    logs.some((l) => /backend/i.test(l)),
    "backend (webgpu/webgl2) was not logged",
  ).toBe(true);
});

test("/healthz is reachable when a server URL is configured", async ({ request }, info) => {
  test.skip(!serverUrl, "MC_SERVER_URL not set");
  const res = await request.get(new URL("/healthz", serverUrl).toString());
  expect(res.ok()).toBe(true);
  info.annotations.push({ type: "healthz", description: await res.text() });
});
