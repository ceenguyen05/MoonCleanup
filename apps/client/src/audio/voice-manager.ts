// Voice budget, priorities and cooldowns. Pure logic over a clock; it never touches Web Audio. A voice is one live
// instance of a cue. Rules (audio-direction §7.2/§7.3): per-cue `maxVoices` and `cooldownMs`; a global cap by hardware
// tier; when full, the lowest-priority voice (highest rank number, oldest first) is stolen, but never one that is
// more important than the newcomer. Slots are preallocated: no allocation after construction.

import { AUDIO_CUE_IDS, AUDIO_CUE_DEFS, type AudioCueId } from "@moon-cleanup/shared";

export interface VoiceSlot {
  active: boolean;
  cue: AudioCueId;
  priority: number;
  startedAt: number;
  /** Opaque handle owner uses to stop the voice (index into the player's table). */
  token: number;
}

export type AcquireResult =
  | { readonly ok: true; readonly slot: VoiceSlot; readonly steal: VoiceSlot | null; readonly stealToken: number }
  | { readonly ok: false; readonly reason: "cooldown" | "cue_full" | "budget" };

const REJECT_COOLDOWN = { ok: false, reason: "cooldown" } as const;
const REJECT_CUE_FULL = { ok: false, reason: "cue_full" } as const;
const REJECT_BUDGET = { ok: false, reason: "budget" } as const;

export class VoiceManager {
  private readonly slots: VoiceSlot[] = [];
  private readonly lastPlayMs = new Map<AudioCueId, number>();
  private readonly perCue = new Map<AudioCueId, number>();
  private readonly out = {
    ok: true,
    slot: null as unknown as VoiceSlot,
    steal: null as VoiceSlot | null,
    stealToken: -1,
  };
  private cap: number;

  constructor(cap: number, slotCount = 64) {
    this.cap = cap;
    for (let i = 0; i < slotCount; i++) {
      this.slots.push({ active: false, cue: "ui.click", priority: 0, startedAt: 0, token: -1 });
    }
    for (const id of AUDIO_CUE_IDS) {
      this.perCue.set(id, 0);
      this.lastPlayMs.set(id, -1e9);
    }
  }

  setCap(cap: number): void {
    this.cap = cap;
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  countOf(cue: AudioCueId): number {
    return this.perCue.get(cue) ?? 0;
  }

  /**
   * Asks for a voice. On success the returned slot is already marked active; `steal` (if not null) is a voice that was
   * deactivated to make room and that the caller must fade out. The result object is reused: read it immediately.
   */
  acquire(cue: AudioCueId, priority: number, nowMs: number, token: number): AcquireResult {
    const def = AUDIO_CUE_DEFS[cue];
    if (nowMs - (this.lastPlayMs.get(cue) ?? -1e9) < def.cooldownMs) return REJECT_COOLDOWN;

    let steal: VoiceSlot | null = null;
    if ((this.perCue.get(cue) ?? 0) >= def.maxVoices) {
      steal = this.pickVictim(priority, cue);
      if (steal === null) return REJECT_CUE_FULL;
    } else if (this.activeCount >= this.cap) {
      steal = this.pickVictim(priority, null);
      if (steal === null) return REJECT_BUDGET;
    }
    let stealToken = -1;
    if (steal !== null) {
      stealToken = steal.token;
      this.release(steal);
    }

    let free: VoiceSlot | null = null;
    for (const s of this.slots) {
      if (!s.active) {
        free = s;
        break;
      }
    }
    if (free === null) return REJECT_BUDGET;
    free.active = true;
    free.cue = cue;
    free.priority = priority;
    free.startedAt = nowMs;
    free.token = token;
    this.perCue.set(cue, (this.perCue.get(cue) ?? 0) + 1);
    this.lastPlayMs.set(cue, nowMs);
    this.out.slot = free;
    this.out.steal = steal;
    this.out.stealToken = stealToken;
    return this.out as AcquireResult;
  }

  /** Frees a slot (voice ended or was stopped). Safe to call twice. */
  release(slot: VoiceSlot): void {
    if (!slot.active) return;
    slot.active = false;
    this.perCue.set(slot.cue, Math.max(0, (this.perCue.get(slot.cue) ?? 1) - 1));
  }

  /** Lowest-priority victim no more important than `priority`; oldest among equals. Restrict to one cue when given. */
  private pickVictim(priority: number, onlyCue: AudioCueId | null): VoiceSlot | null {
    let best: VoiceSlot | null = null;
    for (const s of this.slots) {
      if (!s.active) continue;
      if (onlyCue !== null && s.cue !== onlyCue) continue;
      if (s.priority < priority) continue; // more important than the newcomer (rank 1 is highest)
      if (
        best === null ||
        s.priority > best.priority ||
        (s.priority === best.priority && s.startedAt < best.startedAt)
      ) {
        best = s;
      }
    }
    return best;
  }
}
