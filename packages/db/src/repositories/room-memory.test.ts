import { uuidv7 } from "../ids.ts";
import { MemoryRoomSaveRepository } from "./room-memory.ts";
import { runRoomSuite } from "./room-suite.ts";

runRoomSuite("memory", {
  create() {
    let now = 0;
    const repo = new MemoryRoomSaveRepository({ now: () => now });
    return Promise.resolve({
      repo,
      setNow: (ms: number) => {
        now = ms;
      },
      now: () => now,
      newContract: () => Promise.resolve(uuidv7()),
    });
  },
});
