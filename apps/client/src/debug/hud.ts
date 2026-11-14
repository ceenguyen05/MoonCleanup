// The F3 overlay (M0-W2-T01): one DOM `<pre>` (crisp at any DPR, VT-M0-11 readable in captures). Text is rebuilt at
// most HUD_REFRESH_HZ times a second and only while visible; nothing runs per frame besides the visibility check.

import type { PerfSnapshot } from "./snapshot";

export const HUD_REFRESH_HZ = 4;
export const HUD_ELEMENT_ID = "mc-perf-hud";

const MB = 1024 * 1024;

function ms(value: number): string {
  return value.toFixed(2);
}

/** Pure text builder, unit-tested. GPU lines say how the number was obtained; nothing is shown as measured otherwise. */
export function formatHudText(snap: PerfSnapshot, selfP95Ms: number): string {
  const lines: string[] = [];
  const { env, frameMs, gpu, render } = snap;
  lines.push(
    `${env.backend} | tier ${env.tier} | ${env.preset} | scale ${env.renderScale.toFixed(2)} | dpr ${env.dpr.toFixed(2)}`,
  );
  lines.push(
    `FPS ${snap.fps.toFixed(1)}  frame p50 ${ms(frameMs.p50)}  p95 ${ms(frameMs.p95)}  p99 ${ms(frameMs.p99)} ms`,
  );
  lines.push(`CPU total avg ${ms(snap.cpuTotalMs.avg)}  p95 ${ms(snap.cpuTotalMs.p95)} ms`);
  for (const [id, s] of Object.entries(snap.cpuMs)) {
    if (s.max > 0) lines.push(`  ${id.padEnd(9)} ${ms(s.avg)} (p95 ${ms(s.p95)})`);
  }
  if (gpu.measured) {
    const label = gpu.source === "timestamp-query" ? "timestamp-query" : "timer-query (webgl2)";
    lines.push(
      `GPU ${label}: render p50 ${ms(gpu.renderMs.p50)}  p95 ${ms(gpu.renderMs.p95)} ms, compute avg ${ms(gpu.computeMs.avg)}`,
    );
  } else {
    lines.push(
      gpu.source === "none" ? "GPU: CPU only (no timer query)" : `GPU ${gpu.source}: waiting for first result`,
    );
  }
  lines.push(`draws ${render.drawCalls}  tris ${render.triangles}  geo ${render.geometries}  tex ${render.textures}`);
  lines.push(
    `GPU mem (ledger) ${(render.gpuMemoryBytes / MB).toFixed(1)} MB  pipelines after warm-up ${render.pipelinesAfterWarmup ?? "n/a"}`,
  );
  const heap = snap.memory.jsHeapBytes;
  lines.push(
    `JS heap ${heap === null ? "n/a" : `${(heap / MB).toFixed(1)} MB`}  ping ${snap.net.rttMs ?? "n/a"} ms (${snap.net.conn ?? "no net"})`,
  );
  lines.push(`HUD cost p95 ${ms(selfP95Ms)} ms  losses ${render.lossCount}`);
  return lines.join("\n");
}

export class PerfHud {
  private readonly el: HTMLPreElement;
  private visible = false;
  private lastRefreshMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly doc: Document) {
    const el = doc.createElement("pre");
    el.id = HUD_ELEMENT_ID;
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    const s = el.style;
    s.position = "fixed";
    s.left = "8px";
    s.top = "8px";
    s.margin = "0";
    s.padding = "6px 8px";
    s.zIndex = "2147483000";
    s.pointerEvents = "none";
    s.font = "12px/1.35 ui-monospace, Consolas, Menlo, monospace";
    s.color = "#d8ffd8";
    s.background = "rgba(0, 0, 0, 0.72)";
    s.whiteSpace = "pre";
    this.el = el;
    doc.body.appendChild(el);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.hidden = !visible;
    if (visible) this.lastRefreshMs = Number.NEGATIVE_INFINITY;
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  /** True when the text should be rebuilt now (visible and the refresh interval elapsed). */
  due(nowMs: number): boolean {
    return this.visible && nowMs - this.lastRefreshMs >= 1000 / HUD_REFRESH_HZ;
  }

  show(text: string, nowMs: number): void {
    this.lastRefreshMs = nowMs;
    this.el.textContent = text;
  }

  dispose(): void {
    this.el.remove();
  }
}
