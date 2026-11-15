import { createMemoryRepository } from "./memory.ts";
import { runRepositorySuite } from "./contract-suite.ts";
import { runSaveSuite } from "./save-suite.ts";

runRepositorySuite("memory", {
  create() {
    let now = new Date(0);
    return Promise.resolve({
      repo: createMemoryRepository({ clock: () => now }),
      setNow: (date: Date) => {
        now = date;
      },
      now: () => now,
    });
  },
});

runSaveSuite("memory", {
  create() {
    let now = new Date(0);
    return Promise.resolve({
      repo: createMemoryRepository({ clock: () => now }),
      setNow: (date: Date) => {
        now = date;
      },
      now: () => now,
    });
  },
});
