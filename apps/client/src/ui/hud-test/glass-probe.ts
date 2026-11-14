// Glass cost probe for the HUD crispness bench (VT-M0-10): the page reports the frame interval with four glass panels
// with and without `backdrop-filter`. requestAnimationFrame intervals are a vsync-bound proxy (they show a miss, not
// GPU milliseconds); the GPU pass time comes from the debug module's timestamp queries (`?perf=1`).

export interface FrameSummary {
  readonly frames: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export function summarizeFrameIntervals(samplesMs: readonly number[]): FrameSummary {
  if (samplesMs.length === 0) return { frames: 0, meanMs: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    frames: sorted.length,
    meanMs: sum / sorted.length,
    p95Ms: sorted[p95Index] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

/** Skips `warmup` frames, then records `frames` rAF intervals. */
export function measureFrameIntervals(win: Window, frames: number, warmup: number): Promise<FrameSummary> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last: number | null = null;
    let seen = 0;
    const step = (now: number): void => {
      seen += 1;
      if (seen > warmup) {
        if (last !== null) intervals.push(now - last);
        last = now;
      }
      if (intervals.length >= frames) resolve(summarizeFrameIntervals(intervals));
      else win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
  });
}
