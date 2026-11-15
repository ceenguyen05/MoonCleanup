import { expect, test, type Page } from "@playwright/test";

/**
 * Online lobby keyboard navigation (M1 UI). Runs against the UI sandbox (`ui/dev/preview.html?online=preview`: real UI
 * components, fake HTTP/auth/room port, no network and no GPU). Keyboard only: no mouse clicks anywhere in these flows.
 * Set MC_CLIENT_URL (e.g. http://localhost:5291/) to reuse a running dev server.
 */
const SANDBOX = "/src/ui/dev/preview.html?online=preview";

const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return "";
    return el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.tagName.toLowerCase();
  });

/** Records every keydown that reaches `window`: the game listens there, so none may arrive from inside the panel. */
async function trackWindowKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __seenKeys: string[] }).__seenKeys = seen;
    window.addEventListener("keydown", (e) => seen.push(e.key));
  });
}
const windowKeys = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __seenKeys: string[] }).__seenKeys);

async function openWithKeyboard(page: Page): Promise<void> {
  await page.goto(SANDBOX);
  const launcher = page.getByTestId("online-launcher");
  await launcher.waitFor();
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("online-panel")).toBeVisible();
}

test("launcher opens with Enter, focus moves into the dialog, Escape closes and restores focus", async ({ page }) => {
  await openWithKeyboard(page);
  const dialog = page.getByTestId("online-panel");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // Focus is on the view heading (announced by the dialog's aria-labelledby), inside the dialog.
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("online-panel")).toHaveCount(0);
  await expect(page.getByTestId("online-launcher")).toBeFocused();
});

test("Tab and Shift+Tab are trapped inside the dialog and never reach the game", async ({ page }) => {
  await openWithKeyboard(page);
  await trackWindowKeys(page);
  const dialog = page.getByTestId("online-panel");
  const inside = (): Promise<boolean> => dialog.evaluate((el) => el.contains(document.activeElement));
  const order: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
    order.push(await focused(page));
  }
  // The cycle visits close, Solo, Private and wraps back to close: more than one full lap in 8 presses.
  expect(order).toContain("choose-solo");
  expect(order).toContain("choose-private");
  expect(new Set(order).size).toBeLessThan(order.length);
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await inside()).toBe(true);
  }
  expect(await windowKeys(page)).toEqual([]);
});

test("keyboard-only: pick Private Shift, type a code, Enter joins, Leave returns to the choice", async ({ page }) => {
  await openWithKeyboard(page);
  await trackWindowKeys(page);
  const dialog = page.getByTestId("online-panel");
  // Tab to the Private Shift card and activate it with Space.
  for (let i = 0; i < 6 && (await focused(page)) !== "choose-private"; i += 1) await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("choose-private");
  await page.keyboard.press("Space");
  await expect(dialog).toHaveAttribute("data-view", "private");
  // Focus lands on the new view's heading (not <body>) once the view has swapped.
  await expect(page.getByRole("heading", { name: "Private Shift", exact: true })).toBeFocused();
  // Tab to the join code field (after Contract name, Start) and type; WASD-style keys must not reach the game.
  for (let i = 0; i < 8 && (await focused(page)) !== "join-code"; i += 1) await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("join-code");
  await page.keyboard.type("7qxk-2m9t wasd");
  await page.keyboard.press("Enter");
  // Garbage in the code is rejected inline with an alert; fix the code and submit again.
  await expect(page.getByTestId("online-error")).toBeVisible();
  await page.getByTestId("join-code").fill("");
  await page.keyboard.type("7QXK2M9T");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAttribute("data-view", "onShift");
  await expect(page.getByTestId("online-conn")).toHaveAttribute("data-conn", "connected", { timeout: 10_000 });
  await page.getByTestId("leave-shift").focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveAttribute("data-view", "choose");
  expect(await windowKeys(page)).toEqual([]);
});

test("reduced motion: the panel is usable immediately and still keyboard navigable", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await openWithKeyboard(page);
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("online-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("online-launcher")).toBeFocused();
  await context.close();
});
