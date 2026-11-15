// Pooled presentation events emitted by animation (spec 3.7, proposal P4). Fixed-capacity ring of preallocated
// records; consumers drain once per frame. No allocation after construction. Overflow drops the oldest record and
// counts it (visible in the debug metrics) instead of growing.

export const ANIM_EVENT = {
  footPlanted: 1,
  landed: 2,
  toolTurn: 3,
  toolContact: 4,
  cue: 5,
} as const;
export type AnimEventType = (typeof ANIM_EVENT)[keyof typeof ANIM_EVENT];

export class AnimEventRecord {
  type: number = 0;
  slot = 0;
  /** footPlanted: 0 left / 1 right; toolContact: 1 down / 0 up; landed: class (LAND_*); toolTurn: toolClass. */
  code = 0;
  /** footPlanted: impact 0..1; landed: impact m/s; toolTurn: direction +-1. */
  value = 0;
  /** World position (moon-centred metres). */
  x = 0;
  y = 0;
  z = 0;
  /** Seconds since the start of the update window (events in skipped updates keep their original offsets). */
  timeOffsetS = 0;
}

export class AnimEventQueue {
  readonly records: AnimEventRecord[];
  dropped = 0;
  private head = 0;
  private len = 0;

  constructor(readonly capacity = 128) {
    this.records = [];
    for (let i = 0; i < capacity; i++) this.records.push(new AnimEventRecord());
  }

  get length(): number {
    return this.len;
  }

  /**
   * Claims the next record (overwrites the oldest on overflow) with integer fields set and the rest zeroed. Hot paths
   * use this and assign value / x / y / z as fields (no double crosses a call).
   */
  claim(type: number, slot: number, code: number): AnimEventRecord {
    if (this.len === this.capacity) {
      this.head = (this.head + 1) % this.capacity;
      this.len--;
      this.dropped++;
    }
    const r = this.records[(this.head + this.len) % this.capacity]!;
    this.len++;
    r.type = type;
    r.slot = slot;
    r.code = code;
    r.value = 0;
    r.x = 0;
    r.y = 0;
    r.z = 0;
    r.timeOffsetS = 0;
    return r;
  }

  /** Cold-path convenience: claim + fill. */
  push(type: number, slot: number, code: number, value: number, x: number, y: number, z: number): AnimEventRecord {
    const r = this.claim(type, slot, code);
    r.value = value;
    r.x = x;
    r.y = y;
    r.z = z;
    r.timeOffsetS = 0;
    return r;
  }

  /** i-th pending record in emission order (0 <= i < length). */
  at(i: number): AnimEventRecord {
    return this.records[(this.head + i) % this.capacity]!;
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }
}
