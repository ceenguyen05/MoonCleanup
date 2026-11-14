// The slice of the Web Audio API the audio module uses, as structural interfaces. The real AudioContext satisfies them
// and the unit tests pass a fake, so nothing here needs a DOM (apps/client tests run in Node).

export interface AParam {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  setTargetAtTime(v: number, t: number, tc: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}
export interface ANode {
  connect(dest: ANode | AParam): unknown;
  disconnect(): void;
}
export interface AGain extends ANode {
  readonly gain: AParam;
}
export interface APanner extends ANode {
  readonly pan: AParam;
}
export interface AFilter extends ANode {
  type: string;
  readonly frequency: AParam;
  readonly Q: AParam;
  readonly gain: AParam;
}
export interface ACompressor extends ANode {
  readonly threshold: AParam;
  readonly knee: AParam;
  readonly ratio: AParam;
  readonly attack: AParam;
  readonly release: AParam;
}
export interface ABuffer {
  readonly length: number;
  readonly duration: number;
  readonly sampleRate: number;
  copyToChannel(src: Float32Array, channel: number): void;
}
export interface ASource extends ANode {
  buffer: ABuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AParam;
  onended: (() => void) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}
export interface AMonoSum extends ANode {
  channelCount: number;
  channelCountMode: string;
}
export interface AContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: ANode;
  onstatechange: (() => void) | null;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createGain(): AGain;
  createStereoPanner(): APanner;
  createBiquadFilter(): AFilter;
  createDynamicsCompressor(): ACompressor;
  createBufferSource(): ASource;
  createBuffer(channels: number, length: number, sampleRate: number): ABuffer;
}
