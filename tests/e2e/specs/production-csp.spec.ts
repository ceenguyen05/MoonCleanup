import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const clientRequire = createRequire(new URL("../../../apps/client/package.json", import.meta.url));
const basisJs = readFileSync(clientRequire.resolve("three/examples/jsm/libs/basis/basis_transcoder.js"), "utf8");
const basisWasm = readFileSync(clientRequire.resolve("three/examples/jsm/libs/basis/basis_transcoder.wasm"));
const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const headers = Object.fromEntries(
  vercel.headers.find((entry) => entry.source === "/(.*)")!.headers.map((h) => [h.key, h.value]),
);

test("production CSP permits the shipped Basis texture decoder in a blob worker", async ({ page }) => {
  // Vite's dev server does not apply Vercel headers. Exercise the actual installed decoder
  // under the deployed policy without needing a GPU or booting the rest of the game.
  await page.route("https://csp.test/**", async (route) => {
    if (route.request().url().endsWith("/basis.wasm")) {
      await route.fulfill({ contentType: "application/wasm", body: basisWasm });
    } else {
      await route.fulfill({ contentType: "text/html", headers, body: "<!doctype html><title>CSP probe</title>" });
    }
  });
  await page.goto("https://csp.test/");
  const result = await page.evaluate(async (source) => {
    const binary = await (await fetch("/basis.wasm")).arrayBuffer();
    const url = URL.createObjectURL(
      new Blob(
        [
          source,
          `
        self.addEventListener("unhandledrejection", (event) => {
          self.postMessage({ error: String(event.reason) });
        });
        self.onmessage = async (event) => {
          try {
            const module = await BASIS({ wasmBinary: event.data });
            module.initializeBasis();
            self.postMessage({ ready: typeof module.KTX2File === "function" });
          } catch (error) {
            self.postMessage({ error: String(error) });
          }
        };
      `,
        ],
        { type: "text/javascript" },
      ),
    );
    const worker = new Worker(url);
    try {
      return await new Promise<{ ready?: boolean; error?: string }>((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data as { ready?: boolean; error?: string });
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage(binary, [binary]);
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }, basisJs);
  expect(result).toEqual({ ready: true });
});
