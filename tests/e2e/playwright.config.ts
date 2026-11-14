import { defineConfig } from "@playwright/test";

/**
 * Two lanes (ADR-0019), selected with MC_LANE (default "ci"):
 *  - ci : headless Chromium, software WebGL2 (SwiftShader). Smoke only, never pixel baselines or frame-time budgets.
 *  - gpu: headed Chrome with WebGPU on a real GPU (local).
 * Ports follow module-boundaries 6: client 5173+N, server 2567+N, N = MC_PORT_OFFSET (default 0).
 * MC_CLIENT_URL / MC_SERVER_URL override the targets (then no dev server is started).
 */
const offset = Number(process.env["MC_PORT_OFFSET"] ?? 0);
const clientPort = 5173 + offset;
const clientUrl = process.env["MC_CLIENT_URL"] ?? `http://localhost:${clientPort}/`;
const lane = process.env["MC_LANE"] === "gpu" ? "gpu" : "ci";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0, // flaky tests are bugs; no blanket retries
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: clientUrl,
    trace: "retain-on-failure",
    ...(lane === "gpu"
      ? {
          headless: false,
          channel: "chrome" as const,
          launchOptions: {
            args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"],
          },
        }
      : {
          headless: true,
          launchOptions: {
            args: [
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader",
              "--ignore-gpu-blocklist",
            ],
          },
        }),
  },
  projects: [{ name: lane }],
  ...(process.env["MC_CLIENT_URL"]
    ? {}
    : {
        webServer: {
          command: `pnpm --filter @moon-cleanup/client exec vite --port ${clientPort} --strictPort`,
          cwd: "../..",
          url: clientUrl,
          reuseExistingServer: !process.env["CI"],
          timeout: 120_000,
        },
      }),
});
