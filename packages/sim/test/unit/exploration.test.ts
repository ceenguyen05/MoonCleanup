// M1-W6-T02: Near Parcels (MVP Stray Cargo), achievement triggers and role checks on shared purchases.
import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  INPUT_BUTTON_MASK as M,
  MVP_SCOPE,
  type RequestId,
  type RoomSimEvent,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { createSimConfig, NEAR_PARCEL_MAX_M, NEAR_PARCEL_MIN_M, type MoonRoomSim } from "../../src";
import { flatWorld, makeSim, PLAYER } from "../support/world";

const data = loadGameData();
const cfg = createSimConfig(data);
const nearLm = data.collectibles.strayCargo.find((c) => c.size === "near_parcel")!.lm;

function listen(sim: MoonRoomSim): RoomSimEvent[] {
  const events: RoomSimEvent[] = [];
  sim.onEvent((e) => events.push(e));
  return events;
}

let seq = 0;
function step(sim: MoonRoomSim, ticks: number, over: Partial<SimInputCommand> = {}): void {
  for (let t = 0; t < ticks; t++) {
    sim.applyInput(0, {
      seq: ++seq & 0xffff,
      moveX: 0,
      moveY: 0,
      yaw: 0,
      pitch: 0,
      buttons: 0,
      toolParam: 255,
      ...over,
    });
    sim.step(cfg.dt);
  }
}

describe("Near Parcels", () => {
  test("MVP count, inside the 30..300 m band around the pad, deterministic per Contract", () => {
    const a = makeSim(flatWorld());
    const b = makeSim(flatWorld());
    expect(a.nearParcelCount).toBe(MVP_SCOPE.nearParcelCount);
    const p = { x: 0, y: 0, z: 0 };
    const q = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < a.nearParcelCount; k++) {
      expect(a.nearParcel(k, p)).toBe(false);
      b.nearParcel(k, q);
      expect(q).toEqual(p);
      const distM = Math.acos(Math.min(1, p.y)) * cfg.moonRadiusM;
      expect(distM).toBeGreaterThanOrEqual(NEAR_PARCEL_MIN_M - 1);
      expect(distM).toBeLessThanOrEqual(NEAR_PARCEL_MAX_M + 1);
    }
  });

  test("walking over one pays its Lumens once, emits collectible.found, survives a checkpoint", () => {
    const probe = makeSim(flatWorld());
    const dir = { x: 0, y: 0, z: 0 };
    probe.nearParcel(0, dir);
    // Slot 3 spawns 1 m off the spawn direction (spacing 2 m around the middle), inside the 1.5 m pickup radius.
    const sim = makeSim(flatWorld(), { spawnDirection: dir });
    const events = listen(sim);
    sim.addActor(3, PLAYER);
    sim.step(cfg.dt);
    sim.step(cfg.dt);
    expect(sim.wallet).toBe(nearLm);
    const found = events.filter((e) => e.name === "collectible.found").map((e) => e.payload);
    expect(found).toMatchObject([{ actorSlot: 3, kind: "stray_cargo", id: "near_parcel", lm: nearLm }]);
    expect(sim.nearParcel(0, dir)).toBe(true);
    const fresh = makeSim(flatWorld(), { spawnDirection: dir });
    fresh.addActor(3, PLAYER);
    expect(fresh.restoreCheckpoint(sim.captureCheckpoint()).ok).toBe(true);
    expect(fresh.stateHash()).toBe(sim.stateHash());
    fresh.step(cfg.dt);
    expect(fresh.wallet).toBe(nearLm);
  });
});

describe("achievement triggers", () => {
  test("Shift Work for both members when a second joins; First Light on the first stroke, once", () => {
    const sim = makeSim(flatWorld());
    const events = listen(sim);
    sim.addActor(0, PLAYER);
    expect(events.filter((e) => e.name === "achievement.unlocked")).toHaveLength(0);
    sim.addActor(1, { ...PLAYER, displayName: "Other" });
    const unlocked = () =>
      events
        .filter((e) => e.name === "achievement.unlocked")
        .map((e) => [e.payload.achievementId, e.payload.actorSlot]);
    expect(unlocked()).toEqual([
      ["achievement.shift_work", 0],
      ["achievement.shift_work", 1],
    ]);
    step(sim, 40, { moveY: 127, buttons: M.toolPrimary });
    expect(unlocked().filter(([id]) => id === "achievement.first_light")).toEqual([["achievement.first_light", 0]]);
  });
});

describe("role checks", () => {
  const rid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}` as RequestId;

  test("a Temp cannot buy shared items without tempCanSpendShared, can buy own tools", () => {
    const sim = makeSim(flatWorld(), { walletLm: 100_000 });
    sim.addActor(0, { ...PLAYER, role: "temp" });
    const buy = (n: number, itemId: string) => sim.applyIntent(0, { kind: "purchase", requestId: rid(n), itemId });
    expect(buy(1, "node.dust_cell_desk_duster")).toMatchObject({ ok: false, code: "role_blocked" });
    expect(buy(2, "gear.crown_lamp")).toMatchObject({ ok: false, code: "role_blocked" });
    expect(buy(3, "robot.sandpiper")).toMatchObject({ ok: false, code: "role_blocked" });
    expect(sim.wallet).toBe(100_000);
    expect(buy(4, "tool.crescent_squeegee")).toMatchObject({ ok: true });
    sim.setTempPermissions({ tempCanBuild: false, tempCanSpendShared: true, tempCanDriveShared: false });
    expect(sim.snapshot().shift.permissions.tempCanSpendShared).toBe(true);
    expect(buy(5, "node.dust_cell_desk_duster")).toMatchObject({ ok: true });
  });

  test("Loaner Kit: a Temp's own tool spending is capped at min(2 % of the wallet, 25,000 LM) per window", () => {
    const sq = data.tools.tools.find((t) => t.id === "tool.crescent_squeegee")!.priceLm;
    // 2 % of this wallet is just below the Squeegee price: refused with cap_reached, wallet untouched.
    const low = makeSim(flatWorld(), { walletLm: Math.floor(((sq - 1) * 100) / 2) });
    low.addActor(0, { ...PLAYER, role: "temp" });
    expect(
      low.applyIntent(0, { kind: "purchase", requestId: rid(10), itemId: "tool.crescent_squeegee" }),
    ).toMatchObject({ ok: false, code: "cap_reached" });
    // A Staff member is not capped.
    low.addActor(1, { ...PLAYER, displayName: "Staff", role: "staff" });
    expect(
      low.applyIntent(1, { kind: "purchase", requestId: rid(11), itemId: "tool.crescent_squeegee" }),
    ).toMatchObject({ ok: true });
    // Enough wallet: allowed.
    const rich = makeSim(flatWorld(), { walletLm: sq * 100 });
    rich.addActor(0, { ...PLAYER, role: "temp" });
    expect(
      rich.applyIntent(0, { kind: "purchase", requestId: rid(12), itemId: "tool.crescent_squeegee" }),
    ).toMatchObject({ ok: true });
  });
});
