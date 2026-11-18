import { describe, expect, it } from "vitest";
import { createRosterPort, type RosterRoomLike } from "./online-roster";

describe("roster port (OnlineEntryPort.roster)", () => {
  it("reads the open room's session; no room = empty roster, no-op subscribe, kick refused", () => {
    const slot: { current: RosterRoomLike | null } = { current: null };
    const port = createRosterPort(slot);
    expect(port.current()).toEqual([]);
    const unsub = port.subscribe(() => undefined);
    unsub();
    expect(port.kick("p2", "griefing", false)).toBe(false);

    const rows = [{ playerId: "p1", displayName: "A", role: "holder", connected: true, self: true }];
    const listeners: ((r: typeof rows) => void)[] = [];
    const kicks: unknown[] = [];
    slot.current = {
      session: {
        roster: () => rows,
        onRoster: (l) => {
          listeners.push(l);
          return () => listeners.splice(listeners.indexOf(l), 1);
        },
        sendKick: (id, reason, ban) => {
          kicks.push([id, reason, ban]);
          return true;
        },
      },
    };
    expect(port.current()).toBe(rows);
    const seen: unknown[] = [];
    const off = port.subscribe((r) => seen.push(r));
    listeners[0]!(rows);
    expect(seen).toEqual([rows]);
    off();
    expect(listeners).toHaveLength(0);
    expect(port.kick("p2", "cheating", true)).toBe(true);
    expect(kicks).toEqual([["p2", "cheating", true]]);
  });

  it("boot passes the port in the online entry port", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./boot.ts", import.meta.url), "utf8");
    expect(source).toContain("roster: createRosterPort(online),");
  });
});
