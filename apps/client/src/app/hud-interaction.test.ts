import { describe, expect, it } from "vitest";
import type { RoomSimEvent, UiAction } from "@moon-cleanup/shared";
import { ASSAY_POUR_REACH_M, DUMP_PLATE_RADIUS_M, borealStandInSellPoints } from "@moon-cleanup/sim";
import { createPurchasePort, InteractionWriter, outpostStations, type PurchaseHost } from "./hud-interaction";
import { createUiStore } from "./ui-store";

const R = 1737.4e3 / 1000; // any radius works; the stand-in layout scales with it

describe("InteractionWriter", () => {
  it("writes the nearest station prompt, throttled and only on change", () => {
    const stations = outpostStations(borealStandInSellPoints(R), R, ASSAY_POUR_REACH_M, DUMP_PLATE_RADIUS_M);
    expect(stations.map((s) => s.kind)).toEqual([
      "assay_counter",
      "receiving_gate",
      "receiving_gate",
      "receiving_gate",
      "receiving_gate",
      "desk",
    ]);
    const actions: UiAction[] = [];
    const at = new Float64Array([0, R, 0]);
    const w = new InteractionWriter({
      store: { dispatch: (a) => void actions.push(a) },
      samplePos: (out) => {
        out.set(at);
        return true;
      },
      moonRadiusM: R,
      stations,
    });
    // On the Assay Counter.
    w.pump(0);
    expect(actions).toEqual([
      {
        type: "interaction.set",
        patch: { prompt: expect.objectContaining({ labelId: "prompt.assay", actionId: "pour" }) },
      },
    ]);
    // Same place: nothing new; inside the throttle window: not even sampled.
    w.pump(200);
    expect(actions.length).toBe(1);
    // Walk 15 m east onto the east Gate's plate.
    const g = stations[2]!;
    at[0] = g.x * R;
    at[1] = g.y * R;
    at[2] = g.z * R;
    w.pump(250);
    expect(actions.length).toBe(1); // throttled (< 100 ms since 200)
    w.pump(320);
    expect(actions[1]).toEqual({
      type: "interaction.set",
      patch: { prompt: expect.objectContaining({ labelId: "prompt.pour" }) },
    });
    // Desk stand-in.
    const d = stations[5]!;
    at[0] = d.x * R;
    at[1] = d.y * R;
    at[2] = d.z * R;
    w.pump(500);
    expect(actions[2]).toEqual({
      type: "interaction.set",
      patch: { prompt: expect.objectContaining({ actionId: "open_desk" }) },
    });
    // 8 m from everything: prompt cleared.
    at[0] = (8 / R) * R;
    at[1] = R;
    at[2] = (8 / R) * R;
    w.pump(700);
    expect(actions[3]).toEqual({ type: "interaction.set", patch: { prompt: null } });
  });
});

function fakeHost(): PurchaseHost & { intents: unknown[]; emit(e: RoomSimEvent): void } {
  const listeners: ((e: RoomSimEvent) => void)[] = [];
  const intents: unknown[] = [];
  return {
    kind: "local",
    state: "running",
    intents,
    sendIntent: (i) => void intents.push(i),
    onEvent: (l) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    },
    emit: (e) => {
      for (const l of [...listeners]) l(e);
    },
  };
}

describe("createPurchasePort", () => {
  it("sends a purchase intent, tracks pending spend and turns an own refusal into a notice", () => {
    const store = createUiStore();
    const host = fakeHost();
    let n = 0;
    const port = createPurchasePort({
      roomHost: { current: host, onChange: () => () => undefined },
      store,
      newRequestId: () => `00000000-0000-4000-8000-00000000000${n++}`,
    });
    const id = port.purchase("node.quick_pour", 120);
    expect(id).toBe("00000000-0000-4000-8000-000000000000");
    expect(host.intents).toEqual([{ kind: "purchase", requestId: id, itemId: "node.quick_pour" }]);
    store.flush(0);
    expect(store.getState().desk.pending).toEqual([id]);
    expect(store.getState().wallet.pendingSpendLm).toBe(120);

    host.emit({
      name: "purchase.rejected",
      payload: { tick: 5, actorSlot: 0, itemId: "node.quick_pour", reason: "insufficient_funds" },
    } as RoomSimEvent);
    store.flush(1000);
    expect(store.getState().desk.pending).toEqual([]);
    expect(store.getState().wallet.pendingSpendLm).toBe(0);
    const notice = store.getState().notices.queue.find((x) => x.textId === "notice.purchase_rejected");
    expect(notice?.params).toEqual({ reason: "insufficient_funds" });

    port.purchase("gear.holster_rig", 50);
    host.emit({
      name: "purchase.completed",
      payload: { tick: 9, actorSlot: 0, itemId: "gear.holster_rig", level: 1, priceLm: 50, walletLm: 10 },
    } as RoomSimEvent);
    store.flush(2000);
    expect(store.getState().desk.pending).toEqual([]);
    port.dispose();
  });

  it("returns null and sends nothing without a running host", () => {
    const store = createUiStore();
    const port = createPurchasePort({
      roomHost: { current: null, onChange: () => () => undefined },
      store,
      newRequestId: () => "00000000-0000-4000-8000-000000000000",
    });
    expect(port.purchase("node.quick_pour")).toBeNull();
  });
});
