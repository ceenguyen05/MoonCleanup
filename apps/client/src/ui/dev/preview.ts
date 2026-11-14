// UI sandbox (dev only, served at /src/ui/dev/preview.html): mounts the real UiModule with the real app store and event
// bus over a plain 2D canvas that renders at half resolution, so the HUD crispness bench and the waking overlay can be
// inspected and captured without the full renderer. `?conn=waking|connecting|lost|connected` writes the store through its
// action path; `&next=connected&after=6` changes it later. Never imported by the app.

import type { NetConnectionState, ServiceTypes } from "@moon-cleanup/shared";
import { createEventBus } from "../../app/event-bus";
import { createServiceRegistry } from "../../app/service-registry";
import { createUiStore } from "../../app/ui-store";
import { UiModule } from "../module";

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
const ui = new UiModule({ store, win: window, search: window.location.search });
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
