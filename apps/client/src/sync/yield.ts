// Cooperative yielding for the sliced main-thread work of the sync module (never used on the frame path).

type SchedulerLike = { yield?: () => Promise<void> };

let channel: MessageChannel | undefined;
let waiting: (() => void)[] = [];

/** Lets the browser run pending input and frames, then continues. `scheduler.yield()` when present, else a MessageChannel hop in a window (no timer clamping), else a timer. */
export function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (sched !== undefined && typeof sched.yield === "function") return sched.yield();
  if (typeof window !== "undefined" && typeof MessageChannel === "function") {
    if (channel === undefined) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => {
        const run = waiting;
        waiting = [];
        for (const r of run) r();
      };
    }
    const port = channel.port2;
    return new Promise((resolve) => {
      waiting.push(resolve);
      port.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}
