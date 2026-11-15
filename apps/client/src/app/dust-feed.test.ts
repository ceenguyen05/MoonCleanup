import { describe, expect, it } from "vitest";
import { INPUT_BUTTON_MASK, type SimInputCommand } from "@moon-cleanup/shared";
import { DustSceneSweeper, prefixedStore, type InputSink } from "./dust-feed";
import { loadSoloIdentity, SOLO_STORAGE_KEYS, type KeyValueStore } from "./solo-host";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("dust scene host wiring", () => {
  it("keeps the dust scene's Contract identity apart from the player's", () => {
    const store = memoryStore();
    const random = (b: Uint8Array<ArrayBuffer>): void => b.forEach((_, i) => (b[i] = (i * 31 + 7) & 0xff));
    const game = loadSoloIdentity(store, 1_000, random);
    const scene = loadSoloIdentity(prefixedStore(store, "mc.dustScene."), 2_000, random);
    expect(scene.contractId).not.toBe(game.contractId);
    expect(store.map.get(SOLO_STORAGE_KEYS.contractId)).toBe(game.contractId);
    expect(store.map.get(`mc.dustScene.${SOLO_STORAGE_KEYS.contractId}`)).toBe(scene.contractId);
    expect(prefixedStore(null, "x")).toBeNull();
  });

  it("the sweeper holds the tool, sends one input per step only while the host runs, and reuses its command", () => {
    const seen: SimInputCommand[] = [];
    const seqs: number[] = [];
    const host: InputSink & { state: string } = {
      state: "booting",
      sendInput: (cmd) => {
        seen.push(cmd);
        seqs.push(cmd.seq);
      },
    };
    const sweeper = new DustSceneSweeper(host);
    sweeper.step();
    expect(seen).toHaveLength(0);
    host.state = "running";
    for (let i = 0; i < 600; i++) sweeper.step();
    expect(sweeper.sent).toBe(600);
    expect(new Set(seen).size).toBe(1);
    expect(seqs.slice(0, 3)).toEqual([1, 2, 3]);
    expect(seen[0]!.buttons & INPUT_BUTTON_MASK.toolPrimary).toBe(INPUT_BUTTON_MASK.toolPrimary);
    expect(seen[0]!.moveY).toBeGreaterThan(0);
  });
});
