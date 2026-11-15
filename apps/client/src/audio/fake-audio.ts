// A Node-safe fake of the Web Audio slice in webaudio-types.ts, for tests and the headless audition path. It records
// connections, parameter writes and source starts; it does not render audio.

import type {
  ABuffer,
  ACompressor,
  AContext,
  AFilter,
  AGain,
  AMonoSum,
  ANode,
  AParam,
  APanner,
  ASource,
} from "./webaudio-types";
import type { AudioEnv } from "./module";

export class FakeParam implements AParam {
  value = 1;
  readonly targets: { value: number; time: number; tc: number }[] = [];
  setValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number, time: number, tc: number): void {
    this.targets.push({ value: v, time, tc });
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {}
}

export class FakeNode implements ANode {
  readonly outputs: ANode[] = [];
  disconnected = 0;
  constructor(readonly kind: string) {}
  connect(dest: ANode | AParam): void {
    this.outputs.push(dest as ANode);
  }
  disconnect(): void {
    this.outputs.length = 0;
    this.disconnected++;
  }
  /** True when `target` is reachable from this node through connections. */
  reaches(target: ANode, seen = new Set<ANode>()): boolean {
    if (seen.has(this)) return false;
    seen.add(this);
    for (const o of this.outputs) {
      if (o === target) return true;
      if (o instanceof FakeNode && o.reaches(target, seen)) return true;
    }
    return false;
  }
  /** Kinds of every node on the first path from this node to `target` (for routing assertions). */
  pathKinds(target: ANode): string[] | null {
    if (this === (target as unknown)) return [this.kind];
    for (const o of this.outputs) {
      if (o instanceof FakeNode) {
        const sub = o.pathKinds(target);
        if (sub !== null) return [this.kind, ...sub];
      } else if (o === target) {
        return [this.kind];
      }
    }
    return null;
  }
}

export class FakeGain extends FakeNode implements AGain {
  readonly gain = new FakeParam();
  constructor() {
    super("gain");
  }
}
export class FakePanner extends FakeNode implements APanner {
  readonly pan = new FakeParam();
  constructor() {
    super("panner");
  }
}
export class FakeFilter extends FakeNode implements AFilter {
  type = "lowpass";
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  readonly gain = new FakeParam();
  constructor() {
    super("filter");
  }
}
export class FakeCompressor extends FakeNode implements ACompressor {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  constructor() {
    super("compressor");
  }
}
export class FakeBuffer implements ABuffer {
  channelData: Float32Array | null = null;
  readonly duration: number;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
  }
  copyToChannel(src: Float32Array): void {
    this.channelData = src;
  }
}
export class FakeSource extends FakeNode implements ASource {
  buffer: ABuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  constructor() {
    super("source");
  }
  start(when = 0): void {
    this.startedAt = when;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
  /** Test helper: simulate the engine finishing the source. */
  end(): void {
    this.onended?.();
  }
}

export class FakeContext implements AContext {
  currentTime = 0;
  readonly sampleRate = 48_000;
  state = "suspended";
  onstatechange: (() => void) | null = null;
  readonly destination = new FakeNode("destination");
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly buffers: FakeBuffer[] = [];
  readonly filters: FakeFilter[] = [];
  readonly compressors: FakeCompressor[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  closed = false;
  created = 0;

  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
    this.onstatechange?.();
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = "suspended";
    this.onstatechange?.();
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
  createGain(): FakeGain {
    this.created++;
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createStereoPanner(): FakePanner {
    this.created++;
    return new FakePanner();
  }
  createBiquadFilter(): FakeFilter {
    this.created++;
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createDynamicsCompressor(): FakeCompressor {
    this.created++;
    const c = new FakeCompressor();
    this.compressors.push(c);
    return c;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    const b = new FakeBuffer(length, sampleRate);
    this.buffers.push(b);
    return b;
  }
}

export type { AMonoSum };

/** Fake browser seam: tests trigger gestures and visibility changes by hand and run scheduled callbacks. */
export class FakeEnv implements AudioEnv {
  readonly ctx = new FakeContext();
  gestureListeners = new Set<() => void>();
  visibilityListeners = new Set<(hidden: boolean) => void>();
  hidden = false;
  clockMs = 0;
  readonly queue: { fn: () => void; ms: number }[] = [];
  contexts = 0;
  idleQueue: (() => void)[] = [];
  /** When false the env has no `idle` hook (module falls back to `later`). */
  idle?: (fn: () => void) => void = (fn) => {
    this.idleQueue.push(fn);
  };
  /** Runs the idle callbacks (the post-boot context preparation). */
  runIdle(): void {
    const q = this.idleQueue;
    this.idleQueue = [];
    for (const f of q) f();
  }
  createContext(): AContext {
    this.contexts++;
    return this.ctx;
  }
  onGesture(listener: () => void): () => void {
    this.gestureListeners.add(listener);
    return () => this.gestureListeners.delete(listener);
  }
  onVisibility(listener: (hidden: boolean) => void): () => void {
    this.visibilityListeners.add(listener);
    return () => this.visibilityListeners.delete(listener);
  }
  isHidden(): boolean {
    return this.hidden;
  }
  later(fn: () => void, ms: number): void {
    this.queue.push({ fn, ms });
  }
  nowMs(): number {
    return this.clockMs;
  }
  gesture(): void {
    for (const l of [...this.gestureListeners]) l();
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const l of [...this.visibilityListeners]) l(hidden);
  }
  /** Runs queued callbacks (including ones they queue) up to `max` rounds. */
  flush(max = 400): void {
    for (let i = 0; i < max && this.queue.length > 0; i++) this.queue.shift()?.fn();
  }
}
