import { describe, expect, it, vi } from "vitest";
import { createToastQueue, TOAST_HOLD_MS, TOAST_MAX_VISIBLE } from "./components/toast-queue";
import { summarizeFrameIntervals } from "./hud-test/glass-probe";
import { SPRINGS, tickUpDurationMs } from "./motion/presets";
import { dotTipAt, formatElapsed, isWakingVisible, SLOW_WAKE_AFTER_S, wakingVariant } from "./screens/waking-model";
import { WAKING_DOT_TIPS } from "./strings";
import {
  computeDisplayMetrics,
  computeHudScale,
  formatDpr,
  normalizeDpr,
  snapToDevicePx,
} from "./tokens/display-metrics";
import { parseUiUrlOptions } from "./ui-options";

describe("display metrics", () => {
  it("keeps the HUD scale between 1 and 1.5 times the user setting so 14 px stays >= 14 px", () => {
    expect(computeHudScale(720)).toBe(1);
    expect(computeHudScale(1080)).toBe(1);
    expect(computeHudScale(2160)).toBe(1.5);
    expect(computeHudScale(1080, 1.2)).toBe(1.2);
    expect(computeHudScale(1080, 9)).toBe(1.5);
    expect(computeHudScale(1080, Number.NaN)).toBe(1);
  });
  it("derives the one-device-pixel hairline from dpr", () => {
    expect(computeDisplayMetrics(2, 1080).pxCss).toBe(0.5);
    expect(computeDisplayMetrics(1.25, 1080).pxCss).toBeCloseTo(0.8);
    expect(computeDisplayMetrics(0, 1080).dpr).toBe(1);
  });
  it("removes float32 noise from devicePixelRatio so the hairline is exactly one device pixel", () => {
    expect(normalizeDpr(1.0000000298023224)).toBe(1);
    expect(normalizeDpr(2.0000000596046448)).toBe(2);
    expect(normalizeDpr(1.25)).toBe(1.25);
    expect(normalizeDpr(Number.NaN)).toBe(1);
    expect(computeDisplayMetrics(1.0000000298023224, 1080).pxCss).toBe(1);
    expect(computeDisplayMetrics(2.0000000596046448, 1080).pxCss).toBe(0.5);
    expect(formatDpr(1.0000000298023224)).toBe("1");
    expect(formatDpr(1.5)).toBe("1.5");
    expect(formatDpr(1.3333333)).toBe("1.33");
  });
  it("snaps to whole device pixels", () => {
    expect(snapToDevicePx(10.4, 1.5)).toBeCloseTo(10.6667, 3);
    expect(snapToDevicePx(10.3, 1)).toBe(10);
  });
});

describe("motion presets", () => {
  it("tick-up duration follows clamp(350 + 220 log10 delta, 350, 1200)", () => {
    expect(tickUpDurationMs(0)).toBe(0);
    expect(tickUpDurationMs(1)).toBe(350);
    expect(tickUpDurationMs(1000)).toBeCloseTo(1010);
    expect(tickUpDurationMs(1e9)).toBe(1200);
  });
  it("matches the art-direction spring table", () => {
    expect(SPRINGS.pop).toMatchObject({ stiffness: 520, damping: 16, mass: 0.8 });
    expect(SPRINGS.snap.stiffness).toBe(600);
  });
});

describe("waking overlay model", () => {
  it("is visible only while waking, connecting or lost", () => {
    expect(["asleep", "waking", "connecting", "connected", "lost"].map((c) => isWakingVisible(c as never))).toEqual([
      false,
      true,
      true,
      false,
      true,
    ]);
  });
  it("switches to the slow headline after 120 s", () => {
    expect(wakingVariant("waking", SLOW_WAKE_AFTER_S - 1)).toBe("waking");
    expect(wakingVariant("waking", SLOW_WAKE_AFTER_S)).toBe("slow");
    expect(wakingVariant("connected", 0)).toBeNull();
    expect(wakingVariant("lost", 500)).toBe("lost");
  });
  it("formats m:ss and rotates tips every 8 s", () => {
    expect(formatElapsed(37)).toBe("0:37");
    expect(formatElapsed(125.9)).toBe("2:05");
    expect(dotTipAt(0).index).toBe(0);
    expect(dotTipAt(7.9).index).toBe(0);
    expect(dotTipAt(8).index).toBe(1);
    expect(dotTipAt(8 * WAKING_DOT_TIPS.length).index).toBe(0);
  });
});

describe("toast queue", () => {
  it("keeps three, newest first, and expires after the hold time", () => {
    vi.useFakeTimers();
    const queue = createToastQueue({
      setTimeout: (h, ms) => Number(setTimeout(h, ms)),
      clearTimeout: (id) => clearTimeout(id),
    });
    for (let i = 0; i < 5; i += 1) queue.push(`n${i}`);
    const shown = queue.getSnapshot();
    expect(shown).toHaveLength(TOAST_MAX_VISIBLE);
    expect(shown[0]?.text).toBe("n4");
    vi.advanceTimersByTime(TOAST_HOLD_MS + 1);
    expect(queue.getSnapshot()).toHaveLength(0);
    queue.dispose();
    vi.useRealTimers();
  });
});

describe("misc", () => {
  it("summarises frame intervals", () => {
    const s = summarizeFrameIntervals([10, 20, 30, 40]);
    expect(s).toMatchObject({ frames: 4, meanMs: 25, maxMs: 40 });
    expect(summarizeFrameIntervals([]).frames).toBe(0);
  });
  it("parses url options", () => {
    expect(parseUiUrlOptions("?scene=hud-test&wakePreview=lost&glass=solid&uimotion=reduced&hudscale=3")).toEqual({
      hudTest: true,
      wakePreview: "lost",
      glass: "solid",
      motion: "reduced",
      hudScale: 1.5,
      hudForce: false,
      guidance: true,
    });
    expect(parseUiUrlOptions("?uihud=1").hudForce).toBe(true);
    // Capture lanes: no first-run guidance over the avatar (?onboarding=0, or implied by ?capture=1; ?onboarding=1 wins).
    expect(parseUiUrlOptions("?onboarding=0").guidance).toBe(false);
    expect(parseUiUrlOptions("?capture=1").guidance).toBe(false);
    expect(parseUiUrlOptions("?capture=1&onboarding=1").guidance).toBe(true);
    expect(parseUiUrlOptions("").hudTest).toBe(false);
  });
});
