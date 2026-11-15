// Guard of the Solo save install path (composition root). The install port writes the restored copy through a
// main-thread view of the host's IndexedDB database; when IndexedDB failed to open there, `openCheckpointStore("auto")`
// falls back to a MemoryCheckpointStore that the worker host never reads, so an install would report success while
// changing nothing.

/** Rejects when the main-thread checkpoint store is the in-memory fallback. Call before stopping the host. */
export async function assertInstallableStore(
  store: () => Promise<{ readonly kind: "indexeddb" | "memory" }>,
): Promise<void> {
  if ((await store()).kind === "memory") {
    throw new Error(
      "The save cannot be installed: IndexedDB is unavailable in this tab, so the local copy was left unchanged",
    );
  }
}
