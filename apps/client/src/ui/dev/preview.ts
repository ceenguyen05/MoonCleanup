// UI sandbox (dev only, served at /src/ui/dev/preview.html): mounts the real UiModule with the real app store and event
// bus over a plain 2D canvas that renders at half resolution, so the HUD crispness bench and the waking overlay can be
// inspected and captured without the full renderer. `?conn=waking|connecting|lost|connected` writes the store through its
// action path; `&next=connected&after=6` changes it later. Never imported by the app.

import {
  QUALITY_PRESETS,
  type NetConnectionState,
  type QualityPresetId,
  type ServiceTypes,
} from "@moon-cleanup/shared";
import { createEventBus } from "../../app/event-bus";
import { createServiceRegistry } from "../../app/service-registry";
import { createUiStore } from "../../app/ui-store";
import { UiModule } from "../module";
import { createMemoryControlsPort } from "../menus/controls-model";
import type { UiIntentPort } from "../menus/intents";
import type { OnlineEntryPort } from "../online/online-model";

const params = new URLSearchParams(window.location.search);
const scale = Number(params.get("canvasScale") ?? "0.5");

document.documentElement.style.cssText = "margin:0;height:100%;background:#000";
document.body.style.cssText = "margin:0;height:100%;overflow:hidden;background:#000";
const stage = document.createElement("div");
stage.id = "mc-stage";
stage.style.cssText = "position:fixed;inset:0";
document.body.append(stage);
const canvas = document.createElement("canvas");
canvas.style.cssText = "width:100%;height:100%;display:block;image-rendering:auto";
stage.append(canvas);

function paint(): void {
  const dpr = window.devicePixelRatio;
  canvas.width = Math.max(1, Math.round(window.innerWidth * dpr * scale));
  canvas.height = Math.max(1, Math.round(window.innerHeight * dpr * scale));
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const { width: w, height: h } = canvas;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, "#04060c");
  sky.addColorStop(1, "#1a2233");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const ground = ctx.createLinearGradient(0, h * 0.55, 0, h);
  ground.addColorStop(0, "#f1ece0");
  ground.addColorStop(1, "#b9b2a2");
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  for (let i = 0; i < 40; i += 1) {
    const x = ((i * 9301 + 49297) % 233280) / 233280;
    const y = 0.56 + (((i * 1103515245 + 12345) % 2147483648) / 2147483648) * 0.44;
    ctx.fillStyle = i % 3 === 0 ? "#7d6149" : "#d4cbb8";
    ctx.beginPath();
    ctx.ellipse(x * w, y * h, w * 0.03, w * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(w * 0.7, h * 0.12, w * 0.06, w * 0.06);
}
paint();
window.addEventListener("resize", paint);

const events = createEventBus({ onListenerError: (name, error) => console.error(name, error) });
const store = createUiStore();
const services = createServiceRegistry<ServiceTypes>();

// `?online=preview` mounts the online entry over a fake port (no network, no online code): `&fail=busy|capacity|notfound`
// makes join-by-code answer that error; `&guest=0` starts signed out and shows the one-time recovery code on first use.
function previewOnlinePort(): OnlineEntryPort {
  const fail = params.get("fail");
  let signedIn = params.get("guest") !== "0";
  const contract = {
    id: "01930000-aaaa-7bbb-8ccc-000000000001",
    name: "Brightside Crew",
    shiftType: "private",
    role: "holder",
    maxPlayers: 6,
    status: "active",
    gridM: 64,
    plotCount: 10,
    shinePolished: 0,
    walletLumens: 0,
    playtimeS: 0,
    lastPlayedAt: null,
    online: 0,
  };
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  return {
    httpUrl: "https://preview.invalid",
    fetch: (input) => {
      const url = String(input);
      if (url.endsWith("/join-code") && fail === "busy") return Promise.resolve(reply(409, { error: "CONTRACT_BUSY" }));
      if (url.endsWith("/join-code") && fail === "capacity")
        return Promise.resolve(reply(503, { error: "AT_CAPACITY" }, { "retry-after": "20" }));
      if (url.endsWith("/join-code") && fail === "notfound") return Promise.resolve(reply(404, { error: "NOT_FOUND" }));
      return Promise.resolve(
        url.endsWith("/join-code") ? reply(200, { contract }) : reply(200, { contract, inviteCode: "7QXK2M9T" }),
      );
    },
    auth: () =>
      Promise.resolve({
        get signedIn() {
          return signedIn;
        },
        signIn: () => {
          signedIn = true;
          return Promise.resolve(true);
        },
        getAccessToken: () => Promise.resolve("preview-token"),
        takeRecoveryCode: () => "7QXK-2M9T-4HJN-PR5V",
      }),
    open: () => {
      dispatchConn("waking");
      window.setTimeout(() => dispatchConn("connecting"), 900);
      window.setTimeout(() => {
        store.dispatch({ type: "session.set", patch: { conn: "connected", rttMs: 38, closeCode: null } });
      }, 1800);
      return Promise.resolve();
    },
    close: () => dispatchConn("asleep"),
  };
}

// Preview intents answer purchases the way gameplay will: spend Lumens, raise the level, announce it. Sandbox only.
const previewIntents: UiIntentPort = {
  purchaseDeskItem: (itemId) => {
    const state = store.getState();
    const item = state.desk.items.find((candidate) => candidate.itemId === itemId);
    if (item === undefined || state.wallet.lm < item.priceLm) return;
    store.dispatch({
      type: "wallet.delta",
      delta: { amountLm: -item.priceLm, source: "purchase", actorSlot: 0, atMs: performance.now() },
      settle: false,
    });
    store.dispatch({
      type: "desk.set",
      patch: {
        items: state.desk.items.map((candidate) =>
          candidate.itemId === itemId ? { ...candidate, levelOwned: candidate.levelOwned + 1 } : candidate,
        ),
      },
    });
    if (itemId === "gear.holster_rig") store.dispatch({ type: "holster.set", patch: { slotCount: 2 } });
  },
  purchaseBoardNode: (nodeId) => {
    const state = store.getState();
    const node = state.board.nodes.find((candidate) => candidate.nodeId === nodeId);
    if (node === undefined || node.nextCostLm === null || state.wallet.lm < node.nextCostLm) return;
    store.dispatch({
      type: "wallet.delta",
      delta: { amountLm: -node.nextCostLm, source: "purchase", actorSlot: 0, atMs: performance.now() },
      settle: false,
    });
    store.dispatch({
      type: "board.set",
      patch: {
        nodes: state.board.nodes.map((candidate) =>
          candidate.nodeId === nodeId
            ? {
                ...candidate,
                level: candidate.level + 1,
                nextCostLm: candidate.level + 1 >= candidate.max ? null : Math.round((node.nextCostLm ?? 0) * 1.6),
              }
            : candidate,
        ),
      },
    });
  },
  // Sandbox quality service: answers like the render module (clamped to `?maxpreset=`, announced as `quality.changed`).
  setQualityPreset: (preset) => {
    const order: readonly QualityPresetId[] = ["low", "medium", "high", "ultra"];
    const clamped = order[Math.min(order.indexOf(preset), order.indexOf(previewMaxPreset))] ?? "medium";
    events.emit("quality.changed", { settings: QUALITY_PRESETS[clamped], previous: null, source: "user" });
  },
  openControls: () => undefined,
};
const previewMaxPreset = (params.get("maxpreset") ?? "ultra") as QualityPresetId;
services.register("quality", { current: QUALITY_PRESETS.medium, maxPreset: previewMaxPreset } as never);

// Binding table in the shape of the input module's defaults (subset), backed by memory.
const previewDefaults = {
  KeyW: "moveForward",
  ArrowUp: "moveForward",
  KeyS: "moveBack",
  ArrowDown: "moveBack",
  KeyA: "moveLeft",
  ArrowLeft: "moveLeft",
  KeyD: "moveRight",
  ArrowRight: "moveRight",
  Space: "jump",
  ShiftLeft: "lope",
  ControlLeft: "descend",
  KeyC: "plotCard",
  KeyE: "interact",
  KeyB: "ballast",
  KeyL: "lampCycle",
  KeyQ: "holsterPrev",
  KeyR: "holsterNext",
  KeyF: "laneLock",
  KeyG: "puckForm",
  KeyX: "pickupDrop",
  KeyT: "seatSwitch",
  KeyV: "cameraMode",
  Digit1: "slot1",
  Digit2: "slot2",
  Digit3: "slot3",
  Digit4: "slot4",
  Digit5: "slot5",
  Digit6: "slot6",
  Mouse0: "toolPrimary",
  Mouse2: "toolSecondary",
  WheelUp: "holsterPrev",
  WheelDown: "holsterNext",
  Pad0: "jump",
  Pad1: "descend",
  Pad2: "interact",
  Pad3: "puckForm",
  Pad4: "holsterPrev",
  Pad5: "holsterNext",
  Pad6: "toolSecondary",
  Pad7: "toolPrimary",
  Pad8: "cameraMode",
  Pad10: "lope",
  Pad11: "laneLock",
  Pad12: "lampCycle",
  Pad13: "ballast",
  Pad14: "pickupDrop",
  Pad15: "seatSwitch",
};

const ui = new UiModule({
  store,
  win: window,
  intents: previewIntents,
  controls: createMemoryControlsPort(previewDefaults),
  search: window.location.search,
  ...(params.get("online") === "preview" ? { online: previewOnlinePort() } : {}),
});
await ui.init({ services, events });

const dispatchConn = (state: NetConnectionState): void => {
  store.dispatch({
    type: "session.set",
    patch: { conn: state, rttMs: null, closeCode: state === "lost" ? 1006 : null },
  });
};
const conn = params.get("conn") as NetConnectionState | null;
if (conn !== null) dispatchConn(conn);
const next = params.get("next") as NetConnectionState | null;
if (next !== null) window.setTimeout(() => dispatchConn(next), Number(params.get("after") ?? "6") * 1000);

const frame = (now: number): void => {
  store.flush(now); // the same call UiModule.update makes each frame
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

// `?uihud=1` seeds the store the way gameplay will (wallet, Shine, Holster with Dust Cells, suit, Next Requisition, a
// prompt, a notice) so the HUD can be inspected and captured without the sim. `&income=1` adds a Lumens gain every 2 s.
if (params.get("uihud") === "1") {
  store.dispatch({ type: "wallet.set", patch: { lm: 12_480 } });
  store.dispatch({
    type: "shine.set",
    patch: { polished: 7_000, total: 163_842, pct: 4.2723, albedo: 0.12, dustRemovedKg: 880, milestonePct: 0 },
  });
  store.dispatch({
    type: "holster.set",
    patch: {
      slots: [
        { toolId: "tool.desk_duster", owned: true, cellKg: 2.9, cellCapKg: 4, cellLevel: 0 },
        { toolId: "tool.crescent_squeegee", owned: true, cellKg: 1.5, cellCapKg: 4, cellLevel: 0 },
      ],
      active: 0,
      slotCount: 2,
    },
  });
  store.dispatch({
    type: "suit.set",
    patch: {
      lampLevel: 1,
      lampMode: "lamp",
      hop: { bursts: 2, max: 3, rechargePct: 40 },
      day: { isDay: true, minutesToTerminator: 12, ringFrac01: 0.4 },
    },
  });
  store.dispatch({
    type: "nextReq.set",
    patch: { itemId: "tool.bristle_broom", priceLm: 18_000, fundedPct: 69, lastPingStep: 50 },
  });
  store.dispatch({
    type: "interaction.set",
    patch: {
      prompt: { actionId: "pour", labelId: "prompt.pour", hold: true, holdMs: 600, blockedReasonId: null },
    },
  });
  store.dispatch({
    type: "notices.push",
    notice: {
      priority: "progress",
      textId: "notice.requisition_approved",
      params: {},
      mergeKey: null,
      actionId: null,
    },
  });
  // Compass, Plot Card, Desk and Board data; `&menu=desk|console|settings` opens that surface; `&slots=1` shows the
  // 1-slot (no Holster Rig) Desk.
  const oneSlot = params.get("slots") === "1";
  store.dispatch({
    type: "compass.set",
    patch: {
      outposts: [{ id: "Boreal", visited: true, accent: "teal" }],
      fenceBearingDeg: 40,
      objectiveMarkerId: "assay_counter",
    },
  });
  // Near Parcels: 6 parcels, 2 collected, bearings spread around the strip; Boreal outpost bearing.
  const parcelDirs = [20, 75, 130, 200, 250, 310];
  ui.setNearParcels(
    {
      nearParcelCount: 6,
      nearParcel: (k, out) => {
        out.x = parcelDirs[k] as number;
        out.y = 0;
        out.z = 0;
        return k === 1 || k === 4;
      },
    },
    (dir) => dir.x,
    30,
  );
  ui.setOutpostBearing("Boreal", 350);
  store.dispatch({
    type: "plotCard.set",
    patch: { open: true, plotId: 1 as never, label: "41-207", state: 1, remainingPct: 64, terrainId: "terrain.mare" },
  });
  if (oneSlot) {
    store.dispatch({
      type: "holster.set",
      patch: {
        slots: [{ toolId: "tool.desk_duster", owned: true, cellKg: 2.9, cellCapKg: 4, cellLevel: 0 }],
        active: 0,
        slotCount: 1,
      },
    });
  }
  const deskItem = (itemId: string, category: "tool" | "gear", price: number, requires: string[] = []) => ({
    itemId,
    category,
    tier: 1,
    levelOwned: 0,
    levelMax: 1,
    listPriceLm: price,
    priceLm: price,
    standardIssue: false,
    requires,
  });
  store.dispatch({
    type: "desk.set",
    patch: {
      items: [
        { ...deskItem("tool.desk_duster", "tool", 0), levelOwned: 1 },
        deskItem("tool.crescent_squeegee", "tool", 1_500),
        deskItem("tool.bristle_broom", "tool", 18_000, ["tool.crescent_squeegee"]),
        deskItem("gear.holster_rig", "gear", 2_500),
        deskItem("gear.crown_lamp", "gear", 900),
      ],
    },
  });
  const boardNode = (nodeId: string, departmentId: string, level: number, max: number, cost: number) => ({
    nodeId,
    departmentId,
    level,
    max,
    nextCostLm: level >= max ? null : cost,
    prereqMet: true,
    requires: [] as string[],
  });
  store.dispatch({
    type: "board.set",
    patch: {
      nodes: [
        boardNode("node.dust_cell_desk_duster", "department.storage", 1, 3, 600),
        boardNode("node.densifier", "department.storage", 0, 3, 3_000),
        {
          ...boardNode("node.scour", "department.technique", 0, 3, 5_000),
          prereqMet: false,
          requires: ["node.broad_strokes"],
        },
        boardNode("node.broad_strokes", "department.technique", 2, 2, 0),
        boardNode("node.cadence", "department.fitness", 0, 3, 14_000),
        boardNode("node.quick_pour", "department.haulage", 0, 3, 800),
        boardNode("node.rate_review", "department.accounts", 0, 3, 2_000),
      ],
      caps: { roost: { used: 1, cap: 3 } },
    },
  });
  const hudPct = Number(params.get("hudpct"));
  if (Number.isFinite(hudPct) && hudPct > 0) store.dispatch({ type: "settings.set", patch: { hudScalePct: hudPct } });
  const menu = params.get("menu");
  const surface = { desk: "requisitions_desk", console: "ops_console", settings: "settings" }[menu ?? ""];
  if (surface !== undefined) store.dispatch({ type: "menus.open", surface: surface as never });
  if (params.get("income") === "1") {
    window.setInterval(() => {
      store.dispatch({
        type: "wallet.delta",
        delta: { amountLm: 140, source: "other", actorSlot: null, atMs: performance.now() },
        settle: false,
      });
    }, 2000);
  }
}
