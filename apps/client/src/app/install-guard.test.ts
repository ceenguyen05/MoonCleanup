import { describe, expect, it } from "vitest";
import { assertInstallableStore } from "./install-guard";

describe("assertInstallableStore", () => {
  it("accepts an IndexedDB store", async () => {
    await expect(assertInstallableStore(() => Promise.resolve({ kind: "indexeddb" }))).resolves.toBeUndefined();
  });

  it("rejects the in-memory fallback with a message that says nothing was changed", async () => {
    await expect(assertInstallableStore(() => Promise.resolve({ kind: "memory" }))).rejects.toThrow(
      /IndexedDB is unavailable.*unchanged/,
    );
  });

  it("surfaces a store open failure", async () => {
    await expect(assertInstallableStore(() => Promise.reject(new Error("open failed")))).rejects.toThrow("open failed");
  });
});
